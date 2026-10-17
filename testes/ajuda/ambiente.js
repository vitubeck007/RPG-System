/* Ajuda dos testes de integração: sobe o servidor REAL numa cópia temporária do projeto
   (para não sujar a pasta players/ de verdade) e abre a ficha REAL (index.html + os scripts de JS/)
   num DOM simulado, ligada a esse servidor por socket.io. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { JSDOM, VirtualConsole } = require("jsdom");
const { io: clienteIo } = require("socket.io-client");

const RAIZ = path.resolve(__dirname, "..", "..");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Limite padrão folgado: com vários arquivos de teste rodando juntos a máquina fica lenta (só quem falha espera tudo).
async function esperarAte(condicao, { ms = 10_000, tempoMs, passo = 25, rotulo = "condição" } = {}) {
  const limite = Date.now() + (tempoMs ?? ms);
  while (Date.now() < limite) {
    const v = await condicao();
    if (v) return v;
    await esperar(passo);
  }
  throw new Error(`Tempo esgotado esperando: ${rotulo}`);
}

// Cópia isolada do projeto (sem players/ nem config.json); subprocessos resolvem dependências via NODE_PATH.
function copiarProjeto() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-"));
  for (const item of ["server.js", "personagem.js", "acesso.js", "campanha.js", "comandos.js", "entregas.js", "batalha.js", "rolagem.js", "dano.js", "index.html", "mestre", "JS", "catalogo"]) {
    const origem = path.join(RAIZ, item);
    if (fs.existsSync(origem)) fs.cpSync(origem, path.join(dir, item), { recursive: true });
  }
  return dir;
}

let proximaPorta = 4100 + Math.floor(Math.random() * 400);

async function iniciarServidor(dir = copiarProjeto(), extraEnv = {}) {
  const porta = proximaPorta++;
  const url = `http://127.0.0.1:${porta}`;
  let processo = null;
  const logs = [];

  async function ligar() {
    processo = spawn(process.execPath, ["server.js"], {
      cwd: dir,
      env: {
        ...process.env,
        PORT: String(porta),
        SENHA_MESTRE: "senha-teste",
        NODE_PATH: [path.join(RAIZ, "node_modules"), process.env.NODE_PATH]
          .filter(Boolean)
          .join(path.delimiter),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    processo.stdout.on("data", (d) => logs.push(String(d)));
    processo.stderr.on("data", (d) => logs.push(String(d)));
    await esperarAte(
      async () => {
        try { return (await fetch(`${url}/api/catalogo/magias`)).status === 401; } catch { return false; }
      },
      { ms: 8000, rotulo: "servidor responder" },
    );
  }

  async function desligar() {
    if (!processo) return;
    const p = processo;
    processo = null;
    await new Promise((r) => { p.once("exit", r); p.kill(); });
  }

  const limparPasta = () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };

  try {
    await ligar();
  } catch (erro) {
    // O servidor não subiu: não deixa a cópia temporária para trás (e mostra o motivo).
    await desligar();
    const saida = logs.join("").trim();
    limparPasta();
    throw new Error(`${erro.message}${saida ? `\n--- saída do servidor ---\n${saida}` : ""}`);
  }
  return {
    dir, porta, url, logs,
    reiniciar: async () => { await desligar(); await ligar(); },
    desligar, ligar, // desliga/liga SEM apagar a pasta (para mexer nos arquivos com o servidor parado)
    parar: async () => {
      await desligar();
      limparPasta();
    },
    async api(rota, corpo, token) {
      const r = await fetch(url + rota, {
        method: corpo ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      return { status: r.status, ...(await r.json().catch(() => ({}))) };
    },
    lerArquivo: (player, nomePasta, arquivo) =>
      JSON.parse(fs.readFileSync(path.join(dir, "players", player, nomePasta, `${arquivo}.json`), "utf8")),
  };
}

// Abre a ficha de um personagem e espera o servidor entregar os dados.
// `atrasarInicio` (ms): adia o DOMContentLoaded, como numa página lenta (vários scripts baixados em
// sequência). A conexão com o servidor pode terminar ANTES de a ficha registrar os seus eventos.
async function abrirFicha(servidor, { player, nomePasta, token, esperarCarga = true, atrasarInicio = 0, antesDoInicio = null, omitirScripts = [], capturar = null }) {
  const htmlOriginal = fs.readFileSync(path.join(servidor.dir, "index.html"), "utf8");
  const html = htmlOriginal.replace(/<script[\s\S]*?<\/script>/g, "");
  const erros = [];
  const virtual = new VirtualConsole();
  virtual.on("jsdomError", (e) => erros.push(e.message));
  const dom = new JSDOM(html, { url: `${servidor.url}/`, pretendToBeVisual: true, runScripts: "outside-only", virtualConsole: virtual });
  const w = dom.window;
  if (atrasarInicio > 0) {
    const original = w.addEventListener.bind(w);
    w.addEventListener = (tipo, fn, opcoes) => {
      if (tipo !== "DOMContentLoaded") return original(tipo, fn, opcoes);
      setTimeout(() => {
        if (antesDoInicio) antesDoInicio((codigo) => new vm.Script(codigo).runInContext(dom.getInternalVMContext()));
        fn.call(w, new w.Event(tipo));
      }, atrasarInicio);
    };
  }
  w.sessionStorage.setItem("rpg_token", token);
  w.sessionStorage.setItem("rpg_character", JSON.stringify({ player, nomePasta }));
  w.fetch = (u, o) => fetch(new URL(u, servidor.url), o);
  // `capturar` (array): guarda TODO evento que a ficha recebe do servidor, desde antes de conectar (auditoria de vazamento)
  w.io = (opcoes) => {
    const sock = clienteIo(servidor.url, { ...opcoes, transports: ["websocket"], forceNew: true });
    if (capturar) sock.onAny((evento, ...args) => capturar.push([evento, args]));
    return sock;
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  // jsdom não implementa innerText (a ficha usa); espelha em textContent para ler a tela.
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
  });

  const ctx = dom.getInternalVMContext();
  const rodar = (codigo) => new vm.Script(codigo).runInContext(ctx);
  // Os mesmos scripts, na mesma ordem, que o index.html carrega (assim o teste acompanha a página real).
  const scripts = [...htmlOriginal.matchAll(/<script src="(JS\/[^"]+)"/g)].map((m) => m[1]);
  if (scripts.length < 2) throw new Error("index.html sem os scripts da ficha");
  for (const arq of scripts.filter((a) => !omitirScripts.includes(a))) {
    rodar(fs.readFileSync(path.join(servidor.dir, arq), "utf8").replace(/^\uFEFF/, ""));
  }
  // (o jsdom dispara o DOMContentLoaded sozinho; disparar de novo rodaria a inicialização da ficha duas vezes)

  const ficha = {
    window: w, document: w.document, run: rodar, erros,
    // espera todos os salvamentos da ficha chegarem ao servidor
    async salvos() {
      await esperarAte(() => rodar("arquivosSujos.size === 0 && totalEmVoo() === 0"), { rotulo: "salvamentos concluírem" });
    },
    fechar() { try { rodar("socket.close()"); } catch { /* a página já foi fechada */ } w.close(); },
    carregada: () => rodar("personagemCarregado"),
    aguardarCarga: () => esperarAte(() => rodar("personagemCarregado"), { rotulo: "ficha carregar do servidor" }),
  };
  if (esperarCarga) await ficha.aguardarCarga();
  return ficha;
}

// Abre uma página do painel do mestre (mestre/<pagina>.html), rodando os scripts locais que ELA declara.
// Por padrão usa um `io` FALSO (sem rede): guarda os eventos registrados em `eventos` e o que a página
// envia em `emitidos`; `disparar(evento, dado)` simula o servidor. Com { real: true } conecta ao servidor.
// `tokenInicial` simula um token já digitado numa página anterior (sessionStorage da aba).
async function abrirPaginaMestre(servidor, pagina = "index", { real = false, tokenInicial = "" } = {}) {
  const htmlOriginal = fs.readFileSync(path.join(servidor.dir, "mestre", `${pagina}.html`), "utf8");
  const html = htmlOriginal.replace(/<script[\s\S]*?<\/script>/g, "");
  const erros = [];
  const virtual = new VirtualConsole();
  virtual.on("jsdomError", (e) => erros.push(e.message));
  const dom = new JSDOM(html, { url: `${servidor.url}/mestre`, pretendToBeVisual: true, runScripts: "outside-only", virtualConsole: virtual });
  const w = dom.window;
  if (tokenInicial) w.sessionStorage.setItem("rpg_mestre_token", tokenInicial);
  // jsdom não implementa innerText (a Mesa usa); espelha em textContent para ler a tela.
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
  });

  const eventos = {};
  const emitidos = [];
  const falso = { conexoes: 0, pedidos: [] }; // pedidos: emit com confirmação (socket.timeout(ms).emit)
  w.io = real
    ? (opcoes) => clienteIo(servidor.url, { ...opcoes, transports: ["websocket"], forceNew: true })
    : () => ({
        on: (e, fn) => { (eventos[e] ||= []).push(fn); },
        emit: (e, d) => { emitidos.push([e, d]); },
        timeout: (ms) => ({ emit: (e, d, cb) => { emitidos.push([e, d]); falso.pedidos.push({ evento: e, dados: d, cb, ms }); } }),
        connect: () => { falso.conexoes++; },
        close() {}, connected: false, active: false,
      });

  const rodar = (codigo) => new vm.Script(codigo).runInContext(dom.getInternalVMContext());
  // Só os scripts locais do painel (o Tailwind e o socket.io vêm de fora e não rodam aqui).
  // (comentários HTML ficam de fora: o navegador não carrega um <script> que está dentro de um comentário)
  const todos = [...htmlOriginal.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const locais = todos.filter((src) => /^\/(JS|mestre\/JS)\//.test(src) && !src.endsWith("tailwind-config.js"));
  for (const src of locais) rodar(fs.readFileSync(path.join(servidor.dir, src), "utf8"));

  const pg = {
    window: w, document: w.document, run: rodar, erros, eventos, emitidos, falso, scripts: todos,
    disparar: (evento, dado) => (eventos[evento] || []).forEach((fn) => fn(dado)),
    fechar() { try { rodar("socket.close()"); } catch { /* a página já foi fechada */ } w.close(); },
  };
  // O cabeçalho é montado no DOMContentLoaded (o jsdom o dispara sozinho, logo depois dos scripts).
  await esperarAte(() => w.document.getElementById("master-token-input"), { rotulo: "cabeçalho do mestre montar" });
  return pg;
}

module.exports = { esperar, esperarAte, iniciarServidor, abrirFicha, abrirPaginaMestre };

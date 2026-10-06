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

async function esperarAte(condicao, { ms = 4000, passo = 25, rotulo = "condição" } = {}) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const v = await condicao();
    if (v) return v;
    await esperar(passo);
  }
  throw new Error(`Tempo esgotado esperando: ${rotulo}`);
}

// Cópia do projeto (sem players/ nem config.json), com node_modules ligado por link.
function copiarProjeto() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-"));
  for (const item of ["server.js", "personagem.js", "acesso.js", "index.html", "mestre.html", "JS", "catalogo"]) {
    const origem = path.join(RAIZ, item);
    if (fs.existsSync(origem)) fs.cpSync(origem, path.join(dir, item), { recursive: true });
  }
  fs.symlinkSync(path.join(RAIZ, "node_modules"), path.join(dir, "node_modules"), "junction");
  return dir;
}

let proximaPorta = 4100 + Math.floor(Math.random() * 400);

async function iniciarServidor(dir = copiarProjeto()) {
  const porta = proximaPorta++;
  const url = `http://localhost:${porta}`;
  let processo = null;
  const logs = [];

  async function ligar() {
    processo = spawn(process.execPath, ["server.js"], {
      cwd: dir,
      env: { ...process.env, PORT: String(porta), SENHA_MESTRE: "senha-teste" },
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
    // Desfaz o link de node_modules antes de apagar (no Windows, é uma "junction").
    const link = path.join(dir, "node_modules");
    try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch {} }
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
async function abrirFicha(servidor, { player, nomePasta, token, esperarCarga = true }) {
  const htmlOriginal = fs.readFileSync(path.join(servidor.dir, "index.html"), "utf8");
  const html = htmlOriginal.replace(/<script[\s\S]*?<\/script>/g, "");
  const erros = [];
  const virtual = new VirtualConsole();
  virtual.on("jsdomError", (e) => erros.push(e.message));
  const dom = new JSDOM(html, { url: `${servidor.url}/`, pretendToBeVisual: true, runScripts: "outside-only", virtualConsole: virtual });
  const w = dom.window;
  w.sessionStorage.setItem("rpg_token", token);
  w.sessionStorage.setItem("rpg_character", JSON.stringify({ player, nomePasta }));
  w.fetch = (u, o) => fetch(new URL(u, servidor.url), o);
  w.io = (opcoes) => clienteIo(servidor.url, { ...opcoes, transports: ["websocket"], forceNew: true });
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
  for (const arq of scripts) {
    rodar(fs.readFileSync(path.join(servidor.dir, arq), "utf8").replace(/^\uFEFF/, ""));
  }
  // (o jsdom dispara o DOMContentLoaded sozinho; disparar de novo rodaria a inicialização da ficha duas vezes)

  const ficha = {
    window: w, document: w.document, run: rodar, erros,
    // espera todos os salvamentos da ficha chegarem ao servidor
    async salvos() {
      await esperarAte(() => rodar("arquivosSujos.size === 0 && totalEmVoo() === 0"), { rotulo: "salvamentos concluírem" });
    },
    fechar() { try { rodar("socket.close()"); } catch {} w.close(); },
    carregada: () => rodar("personagemCarregado"),
    aguardarCarga: () => esperarAte(() => rodar("personagemCarregado"), { rotulo: "ficha carregar do servidor" }),
  };
  if (esperarCarga) await ficha.aguardarCarga();
  return ficha;
}

module.exports = { esperar, esperarAte, iniciarServidor, abrirFicha };

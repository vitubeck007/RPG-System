/* Checkup geral: robustez. Lança entradas absurdas (tipos errados, valores gigantes, protótipo, estruturas
   fundas) em TODOS os eventos de socket (anônimo, jogador, mestre com token válido) e em todas as rotas HTTP, e
   exige: servidor vivo e respondendo, nenhum erro não tratado no log, nenhuma pasta criada fora do lugar e
   dados íntegros depois (o servidor liga de novo sem avisos). */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { io: clienteIo } = require("socket.io-client");
const { iniciarServidor, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";

// Gerador pseudoaleatório fixo (reproduzível): mulberry32.
function aleatorio(semente) {
  let a = semente;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fundo = (n) => { let o = { x: 1 }; for (let i = 0; i < n; i++) o = { a: [o] }; return o; };
const LIXOS = () => [
  undefined, null, true, false, 0, 1, -1, 1.5, 1e308, -1e308, 2 ** 53, "", " ", "x", "../../etc/passwd", "a".repeat(70_000), "\u0000", "💥".repeat(500), "<img src=x onerror=alert(1)>",
  [], [null], [[]], ["a", 1, null], Array.from({ length: 5000 }, (_, i) => i), {}, { a: 1 }, { __proto__: { admin: true } }, JSON.parse('{"__proto__":{"admin":true}}'), JSON.parse('{"constructor":{"prototype":{"admin":true}}}'),
  { toString: 1 }, { length: -1 }, fundo(200), Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`k${i}`, i])),
];
const CAMPOS = ["tipo", "id", "item", "itens", "delta", "atual", "valor", "alvos", "alvoId", "modeloId", "quantidade", "componentes", "liberado", "derrotado", "player", "nomePasta", "catalogId", "rolagemId", "aplicacaoId", "config", "charId", "type", "arquivo", "dados", "bauId", "linhaId", "pedidoId", "entregaId", "motivo", "name", "vitals", "total", "details", "character", "action", "context", "mult", "nome", "hp"];

describe("Robustez: entradas absurdas não derrubam nem corrompem nada", { concurrency: false }, () => {
  let s, ana, pasta;
  const abertos = [];
  const arquivosAntes = () => fs.readdirSync(path.join(s.dir)).sort();

  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const vivo = async () => {
    const r = await fetch(`${s.url}/api/personagens`).catch(() => null);
    assert.ok(r && r.status === 401, `o servidor respondeu e continua de pé\n--- fim do log do servidor ---\n${s.logs.join("").slice(-1800)}`);
    const m = await conectar();
    assert.equal((await pedir(m, "master_entrar", { token: SENHA })).ok, true, "e o mestre ainda entra");
    m.close();
  };
  const errosNoLog = () => s.logs.join("").split("\n").filter((l) => /FALHA EM EVENTO|FALHA NÃO TRATADA|TypeError|ReferenceError|RangeError|SyntaxError|UnhandledPromiseRejection|Uncaught|ERR_UNHANDLED|is not a function|Cannot read properties|Cannot destructure/.test(l));

  before(async () => {
    s = await iniciarServidor(undefined, { RESERVA_EXPIRA_MS: "2000" });
    const token = (await s.api("/api/login", { nome: "ana", senha: "x", criarSeNaoExistir: true })).token;
    pasta = (await s.api("/api/personagens", { nome: "Ana" }, token)).personagem.nomePasta;
    ana = { token };
  });
  after(async () => { abertos.forEach((k) => k.close()); await s?.parar(); });

  it("eventos do mestre com TOKEN VÁLIDO e campos absurdos: sempre uma resposta ou nenhuma, nunca queda", async () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    const eventos = [...new Set([...codigo.matchAll(/(?:socket\.on|ouvir)\("(master_\w+)"/g)].map((m) => m[1]).concat([...codigo.matchAll(/comandos\.registrar\(\s*socket,\s*"(master_\w+)"/g)].map((m) => m[1])))];
    assert.ok(eventos.length >= 20);
    const m = await conectar();
    await pedir(m, "master_entrar", { token: SENHA });
    const rnd = aleatorio(20261012);
    const lixos = LIXOS();
    let enviados = 0;
    for (const evento of eventos) {
      for (let i = 0; i < 60; i++) {
        const dados = { token: SENHA, acaoId: `acao_fz_${evento}_${i}` };
        const quantos = 1 + Math.floor(rnd() * 6);
        for (let k = 0; k < quantos; k++) dados[CAMPOS[Math.floor(rnd() * CAMPOS.length)]] = lixos[Math.floor(rnd() * lixos.length)];
        // metade dos pedidos com o corpo inteiro trocado por lixo (mas com token, quando for objeto)
        const corpo = i % 5 === 0 ? { token: SENHA, ...(lixos[Math.floor(rnd() * lixos.length)] ?? {}), acaoId: dados.acaoId } : dados;
        await Promise.race([pedir(m, evento, corpo), esperar(150)]); // eventos antigos não confirmam
        enviados++;
      }
    }
    assert.ok(enviados >= 1200);
    await vivo();
    assert.deepEqual(errosNoLog(), [], errosNoLog().slice(0, 3).join("\n"));
  });

  it("eventos do jogador (ficha aberta) e do anônimo com lixo: nada cai e nada vaza", async () => {
    const j = await conectar(ana.token);
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: pasta }); });
    j.emit("entregas_pedir");
    const anon = await conectar();
    const eventos = ["carregar_personagem", "salvar_personagem", "player_update", "dice_roll", "client_log", "entregas_pedir", "entrega_aplicada", "entrega_recusada", "jogador_pegar_item", "disconnecting_x"];
    const rnd = aleatorio(777);
    const lixos = LIXOS();
    const vistos = [];
    j.onAny((ev) => vistos.push(ev));
    for (const sock of [j, anon]) {
      for (const evento of eventos) {
        for (let i = 0; i < 60; i++) {
          const dados = {};
          for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) dados[CAMPOS[Math.floor(rnd() * CAMPOS.length)]] = lixos[Math.floor(rnd() * lixos.length)];
          if (i % 7 === 0) dados.player = "ana";
          if (i % 7 === 0) dados.nomePasta = pasta;
          const corpo = i % 6 === 0 ? lixos[Math.floor(rnd() * lixos.length)] : dados;
          sock.emit(evento, corpo); // sem confirmação
          if (i % 3 === 0) sock.emit(evento, corpo, () => {});
        }
        await esperar(30);
      }
    }
    await esperar(400);
    await vivo();
    assert.deepEqual(errosNoLog(), [], errosNoLog().slice(0, 3).join("\n"));
    assert.ok(!vistos.includes("campanha_atualizada"));
    // o personagem continua legível e íntegro depois de salvamentos com lixo
    const lido = s.lerArquivo("ana", pasta, "perfil");
    assert.equal(typeof lido.nome, "string");
  });

  it("rotas HTTP com corpos e cabeçalhos absurdos: respostas de erro limpas, nada criado fora do lugar", async () => {
    const antes = arquivosAntes();
    const pai = fs.readdirSync(path.dirname(s.dir)).length;
    const enviar = (caminho, { metodo = "POST", corpo, tipo = "application/json", cabecalhos = {} } = {}) =>
      new Promise((resolver) => {
        const dados = corpo === undefined ? null : typeof corpo === "string" ? corpo : JSON.stringify(corpo);
        const req = http.request(s.url + caminho, { method: metodo, headers: { "Content-Type": tipo, ...(dados ? { "Content-Length": Buffer.byteLength(dados) } : {}), ...cabecalhos } }, (res) => {
          let t = "";
          res.on("data", (d) => { t += d; });
          res.on("end", () => resolver({ status: res.statusCode, corpo: t.slice(0, 300) }));
        });
        req.on("error", () => resolver({ status: 0, corpo: "erro de conexão" }));
        if (dados) req.write(dados);
        req.end();
      });
    const lixos = LIXOS().filter((l) => l !== undefined);
    const respostas = [];
    for (const lixo of lixos) {
      respostas.push(await enviar("/api/login", { corpo: lixo }));
      respostas.push(await enviar("/api/login", { corpo: { nome: lixo, senha: lixo, criarSeNaoExistir: lixo } }));
      respostas.push(await enviar("/api/personagens", { corpo: { nome: lixo }, cabecalhos: { Authorization: `Bearer ${ana.token}` } }));
      respostas.push(await enviar("/api/personagens", { metodo: "GET", cabecalhos: { Authorization: typeof lixo === "string" ? encodeURIComponent(lixo).slice(0, 200) : "Bearer x" } }));
    }
    for (const nome of ["../fora", "..\\fora", "a/../../fora", ".", "..", "con", "x".repeat(300), "%2e%2e%2ffora", "nome\u0000x", "a:b", "<b>"]) {
      respostas.push(await enviar("/api/login", { corpo: { nome, senha: "x", criarSeNaoExistir: true } }));
    }
    for (const corpo of ["{ não é json", "", "[", "null", "\u0000", "{\"a\":" + "[".repeat(5000)]) respostas.push(await enviar("/api/login", { corpo }));
    respostas.push(await enviar("/api/login", { corpo: JSON.stringify({ nome: "x".repeat(2_000_000), senha: "y" }) })); // corpo enorme
    respostas.push(await enviar("/api/login", { corpo: "nome=a&senha=b", tipo: "application/x-www-form-urlencoded" }));
    for (const rota of ["/api/catalogo/__proto__", "/api/catalogo/constructor", "/api/catalogo/../../server.js", "/api/catalogo/habilidades%00", "/api/catalogo/", "/api/nao-existe", "/%", "/%zz", "/mestre/%", "/JS/%2e%2e/server.js", "/JS/../server.js", "/..%2fserver.js"]) {
      respostas.push(await enviar(rota, { metodo: "GET" }));
    }
    assert.ok(respostas.length > 150);
    assert.ok(respostas.every((r) => r.status === 0 || (r.status >= 200 && r.status < 600)), "toda resposta é HTTP válida");
    assert.ok(respostas.filter((r) => r.status >= 500).length === 0, `respostas 5xx: ${JSON.stringify(respostas.filter((r) => r.status >= 500).slice(0, 2))}`);
    assert.ok(!respostas.some((r) => /at .*server\.js|node_modules|stack/i.test(r.corpo)), "nenhuma resposta vaza pilha de erro");
    await vivo();
    assert.deepEqual(errosNoLog(), [], errosNoLog().slice(0, 3).join("\n"));
    assert.deepEqual(arquivosAntes(), antes, "nada novo na raiz do projeto");
    assert.equal(fs.readdirSync(path.dirname(s.dir)).length, pai, "nada criado fora da pasta do servidor");
    // eslint-disable-next-line no-control-regex -- procura justamente por NUL em nome de pasta
    for (const nome of fs.readdirSync(path.join(s.dir, "players"))) assert.ok(!/[\\/:\u0000<>]|^\.\.?$/.test(nome), `pasta de conta suspeita: ${nome}`);
  });

  it("depois de tudo isso os dados continuam íntegros: o servidor religa sem avisos e o protótipo global está limpo", async () => {
    await s.reiniciar();
    const m = await conectar();
    const r = await pedir(m, "master_entrar", { token: SENHA });
    assert.equal(r.ok, true);
    assert.deepEqual(r.dados.avisos, []);
    assert.equal(({}).admin, undefined);
    for (const f of fs.readdirSync(path.join(s.dir, "campanha")).filter((x) => x.endsWith(".json"))) JSON.parse(fs.readFileSync(path.join(s.dir, "campanha", f), "utf8"));
    for (const f of fs.readdirSync(path.join(s.dir, "players", "ana", pasta)).filter((x) => x.endsWith(".json"))) JSON.parse(fs.readFileSync(path.join(s.dir, "players", "ana", pasta, f), "utf8"));
    assert.deepEqual(errosNoLog(), []);
  });
});

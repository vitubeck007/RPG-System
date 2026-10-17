/* Checkup geral: estabilidade (Windows, porta ocupada, erro não tratado, limites de memória, respostas de erro). */
const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gravarJson, trocarArquivo } = require("../personagem.js");
const { iniciarServidor } = require("./ajuda/ambiente.js");

const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-estab-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("troca de arquivo resiliente (Windows: antivírus/indexador segurando o arquivo)", () => {
  const erro = (code) => Object.assign(new Error(`${code}: simulado`), { code });

  it("EPERM/EBUSY passageiro: tenta de novo e conclui; nada de .tmp sobrando; o conteúdo é o novo", () => {
    const dir = novaPasta();
    const alvo = path.join(dir, "dados.json");
    fs.writeFileSync(alvo, '{"v":1}');
    const original = fs.renameSync;
    let chamadas = 0;
    const m = mock.method(fs, "renameSync", (...a) => { if (++chamadas <= 2) throw erro(chamadas === 1 ? "EPERM" : "EBUSY"); return original(...a); });
    try { gravarJson(alvo, { v: 2 }); } finally { m.mock.restore(); }
    assert.equal(chamadas, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(alvo, "utf8")), { v: 2 });
    assert.deepEqual(fs.readdirSync(dir), ["dados.json"]);
  });

  it("bloqueio persistente: depois das tentativas copia por cima (não perde o dado) e limpa o temporário", () => {
    const dir = novaPasta();
    const alvo = path.join(dir, "dados.json");
    fs.writeFileSync(alvo, '{"v":1}');
    let chamadas = 0;
    const m = mock.method(fs, "renameSync", () => { chamadas++; throw erro("EPERM"); });
    try { gravarJson(alvo, { v: 3 }); } finally { m.mock.restore(); }
    assert.equal(chamadas, 6);
    assert.deepEqual(JSON.parse(fs.readFileSync(alvo, "utf8")), { v: 3 });
    assert.deepEqual(fs.readdirSync(dir), ["dados.json"]);
  });

  it("erro de outro tipo (ex.: pasta inexistente) não é repetido: falha na hora com a causa", () => {
    let chamadas = 0;
    const m = mock.method(fs, "renameSync", () => { chamadas++; throw erro("ENOENT"); });
    try { assert.throws(() => trocarArquivo("/x/a", "/x/b"), { code: "ENOENT" }); } finally { m.mock.restore(); }
    assert.equal(chamadas, 1);
  });
});

describe("servidor: estabilidade e respostas", { concurrency: false }, () => {
  let s;
  before(async () => { s = await iniciarServidor(); });
  after(async () => { await s?.parar(); });

  it("porta ocupada: o segundo servidor termina com mensagem clara (código 1), sem pilha de erro", () => {
    const porta = new URL(s.url).port;
    const r = spawnSync(process.execPath, ["server.js"], { cwd: s.dir, env: { ...process.env, NODE_PATH: path.join(process.cwd(), "node_modules"), PORT: porta, SENHA_MESTRE: "senha-teste" }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 1, `saída: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /A porta \d+ já está em uso/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, "sem pilha de erro para o usuário");
  });

  it("erro não tratado (rejeição esquecida) é registrado e o servidor continua de pé", () => {
    const script = `
      process.env.PORT = "${Number(new URL(s.url).port) + 311}"; process.env.SENHA_MESTRE = "x";
      require("./server.js");
      Promise.reject(new Error("rejeicao-esquecida"));
      setTimeout(() => { process.emit("uncaughtException", new Error("excecao-solta")); }, 100);
      setTimeout(() => { console.log("CONTINUA-VIVO"); process.exit(0); }, 600);`;
    const r = spawnSync(process.execPath, ["-e", script], { cwd: s.dir, env: { ...process.env, NODE_PATH: path.join(process.cwd(), "node_modules") }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CONTINUA-VIVO/);
    assert.match(r.stderr, /FALHA NÃO TRATADA[\s\S]*rejeicao-esquecida/);
    assert.match(r.stderr, /FALHA NÃO TRATADA[\s\S]*excecao-solta/);
  });

  it("respostas: sem x-powered-by; corpo malformado/enorme vira JSON limpo (400/413) sem pilha de erro", async () => {
    const r1 = await fetch(`${s.url}/api/catalogo/habilidades`);
    assert.equal(r1.headers.get("x-powered-by"), null);
    const post = (corpo, tipo = "application/json") => fetch(`${s.url}/api/login`, { method: "POST", headers: { "Content-Type": tipo }, body: corpo });
    const ruim = await post("{ não é json");
    assert.equal(ruim.status, 400);
    assert.deepEqual(await ruim.json(), { success: false, message: "Pedido inválido." });
    const grande = await post(JSON.stringify({ nome: "x".repeat(2_000_000), senha: "y" }));
    assert.equal(grande.status, 413);
    assert.deepEqual(await grande.json(), { success: false, message: "Pedido grande demais." });
    for (const corpo of ["null", "[]", "true", '"texto"', "123"]) {
      const r = await post(corpo);
      assert.ok(r.status >= 400 && r.status < 500, `${corpo} -> ${r.status}`);
      assert.equal((await r.json()).success, false);
    }
    const semCorpo = await fetch(`${s.url}/api/login`, { method: "POST" });
    assert.ok(semCorpo.status >= 400 && semCorpo.status < 500, `sem corpo -> ${semCorpo.status}`);
    assert.doesNotMatch(s.logs.join(""), /SyntaxError|body-parser|\n\s+at .*node_modules/, "o log não despeja pilha de erro de corpo inválido");
  });

  it("nomes de conta impossíveis de virar pasta são recusados (400), e nada é criado", async () => {
    const antes = fs.readdirSync(path.join(s.dir, "players")).sort();
    const login = (nome) => fetch(`${s.url}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, senha: "x", criarSeNaoExistir: true }) });
    for (const nome of ["con", "NUL", "com1", "lpt9.txt", "ana.", "a\u0000b", "a\u001fb", "..", ".", "x".repeat(41), "", "   "]) {
      const r = await login(nome);
      assert.equal(r.status, 400, `${JSON.stringify(nome)} -> ${r.status}`);
    }
    assert.deepEqual(fs.readdirSync(path.join(s.dir, "players")).sort(), antes);
    assert.equal((await login("conta-normal")).status, 200);
    assert.equal((await login("João da Silva")).status, 200, "acentos e espaços no meio continuam valendo");
  });

  it("sessões têm teto (2000): a mais antiga é descartada e a memória não cresce sem limite", async () => {
    const login = async () => (await (await fetch(`${s.url}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "sessoes", senha: "x", criarSeNaoExistir: true }) })).json()).token;
    const primeiro = await login();
    const status = async (t) => (await fetch(`${s.url}/api/personagens`, { headers: { Authorization: `Bearer ${t}` } })).status;
    assert.equal(await status(primeiro), 200);
    let ultimo;
    for (let i = 0; i < 2001; i++) ultimo = await login();
    assert.equal(await status(primeiro), 401, "a sessão mais antiga foi descartada");
    assert.equal(await status(ultimo), 200, "a mais recente continua válida");
  });
});

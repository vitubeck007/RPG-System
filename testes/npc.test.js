/* NPCs: modelo, persistência, privacidade e compatibilidade das rotas antigas. A UI atual está nos testes de figurantes. */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const { criarCampanha, normalizarNpc, LIMITE_DE_ITENS } = require("../campanha.js");
const { iniciarServidor, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const SEGREDO = "SEGREDO-NPC-4471";
const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-npc-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("Modelo do NPC (armazém)", () => {
  it("limites: nome, papel, lore 4000, segredo 2000, notas 2000; atributos opcionais; retrato validado", () => {
    const n = normalizarNpc({
      nome: "  Brenna  ", papel: "p".repeat(200), lore: "l".repeat(5000), segredo: "s".repeat(3000), notas: "n".repeat(3000),
      retrato: "javascript:alert(1)", atributos: { FOR: "12", DES: "", INT: "abc", SAB: -4, PRE: 5000, VON: null, XXX: 9 }, hp: { atual: 50, max: 20 },
    });
    assert.equal(n.nome, "Brenna");
    assert.equal(n.papel.length, 80);
    assert.equal(n.lore.length, 4000);
    assert.equal(n.segredo.length, 2000);
    assert.equal(n.notas.length, 2000);
    assert.equal(n.retrato, "");
    assert.deepEqual(n.atributos, { FOR: 12, SAB: 0, PRE: 999 });
    assert.deepEqual(n.hp, { atual: 20, max: 20 });
    assert.equal(normalizarNpc({ nome: "x", retrato: "https://ex.com/a.png" }).retrato, "https://ex.com/a.png");
    assert.equal(normalizarNpc({ nome: "x", retrato: "/JS/a.png" }).retrato, "/JS/a.png");
    assert.equal(normalizarNpc({ nome: "x", retrato: "//evil.com/a.png" }).retrato, "");
    assert.equal(normalizarNpc({ nome: "   " }).nome, "NPC", "nome vazio vira 'NPC'");
  });

  it("reduzir o HP máximo corta o atual; HP máximo 0 é aceito", () => {
    assert.deepEqual(normalizarNpc({ nome: "x", hp: { atual: 30, max: 10 } }).hp, { atual: 10, max: 10 });
    assert.deepEqual(normalizarNpc({ nome: "x", hp: { atual: 5, max: 0 } }).hp, { atual: 0, max: 0 });
    assert.deepEqual(normalizarNpc({ nome: "x" }).hp, { atual: 10, max: 10 });
  });

  it("limite de 500 NPCs e persistência", async () => {
    const dir = novaPasta();
    const c = criarCampanha(dir, { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    await c.atualizar("npcs", (lista) => { for (let i = 0; i < LIMITE_DE_ITENS.npcs; i++) lista.push({ nome: `N${i}` }); });
    assert.equal(c.ler("npcs").length, 500);
    await assert.rejects(() => c.salvarItem("npcs", { nome: "501" }), { codigo: "limite_atingido" });
    const outra = criarCampanha(dir, { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    assert.equal(outra.ler("npcs").length, 500);
  });
});

describe("NPCs com o servidor real", { concurrency: false }, () => {
  let s, ana;
  const abertos = [];
  let contador = 0;

  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_n${++contador}`, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  const salvar = async (m, item) => (await cmd(m, "master_campanha_salvar", { tipo: "npcs", item })).dados;
  const listar = async (m) => (await pedir(m, "master_campanha_ler", { token: SENHA, tipo: "npcs" })).dados;

  afterEach(async () => {
    abertos.splice(0).forEach((k) => k.close());
    await esperar(200);
  });
  before(async () => {
    s = await iniciarServidor();
    const token = (await s.api("/api/login", { nome: "ana", senha: "x", criarSeNaoExistir: true })).token;
    const pasta = (await s.api("/api/personagens", { nome: "Ana" }, token)).personagem.nomePasta;
    ana = { token, pasta };
  });
  after(async () => { await s?.parar(); });

  it("CRUD pela rede: cria, lê, edita (mesmo id), duplica e remove; dado hostil é limpo", async () => {
    const m = await mestre();
    const a = await salvar(m, { nome: "Brenna", papel: "Ferreira", lore: "Forja desde criança.", segredo: SEGREDO, hp: { atual: 8, max: 12 }, atributos: { FOR: 14 }, retrato: "https://ex.com/b.png" });
    assert.match(a.id, /^npc_/);
    assert.deepEqual([a.hp, a.atributos, a.segredo], [{ atual: 8, max: 12 }, { FOR: 14 }, SEGREDO]);
    const b = await salvar(m, { ...a, nome: "Brenna Ferro", hp: { atual: 3, max: 12 } });
    assert.equal(b.id, a.id);
    assert.equal(b.criadoEm, a.criadoEm);
    assert.equal((await listar(m)).filter((n) => n.id === a.id).length, 1);
    const hostil = await salvar(m, { nome: "<img src=x onerror=alert(1)>", retrato: "javascript:alert(1)", lore: "x".repeat(900), __proto__: { admin: 1 }, hp: { atual: "abc", max: 99999999 } });
    assert.equal(hostil.retrato, "");
    assert.equal(hostil.lore.length, 900);
    assert.equal(hostil.admin, undefined);
    assert.ok(hostil.hp.max <= 100000);
    const r = await cmd(m, "master_campanha_remover", { tipo: "npcs", id: a.id });
    assert.deepEqual(r, { ok: true, dados: { removido: true } });
    assert.ok(!(await listar(m)).some((n) => n.id === a.id));
  });

  it("jogador e anônimo não leem nem gravam NPCs (todo tipo de token forjado)", async () => {
    const m = await mestre();
    const npc = await salvar(m, { nome: "Reservado", segredo: SEGREDO });
    for (const sock of [await conectar(ana.token), await conectar()]) {
      for (const token of [undefined, "", "errado", ana.token]) {
        for (const [evento, dados] of [
          ["master_campanha_ler", { tipo: "npcs" }],
          ["master_campanha_ler", {}],
          ["master_campanha_salvar", { tipo: "npcs", item: { nome: "Hack" }, acaoId: "acao_h1" }],
          ["master_campanha_remover", { tipo: "npcs", id: npc.id, acaoId: "acao_h2" }],
        ]) {
          const r = await pedir(sock, evento, { ...dados, token });
          assert.equal(r.erro, "nao_autorizado", `${evento} ${token}`);
          assert.equal(r.dados, undefined);
        }
      }
    }
    const lista = await listar(m);
    assert.ok(lista.some((n) => n.id === npc.id));
    assert.ok(!lista.some((n) => n.nome === "Hack"));
  });

  it("VAZAMENTO: o jogador, com a ficha aberta, nunca recebe NPC nem segredo", async () => {
    const m = await mestre();
    const j = await conectar(ana.token);
    const vistos = [];
    j.onAny((ev, ...a) => vistos.push([ev, a]));
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: ana.pasta }); });
    j.emit("entregas_pedir");
    const n = await salvar(m, { nome: "Nome-Oculto-NPC4471", lore: "lore-oculta-4471", segredo: SEGREDO });
    await salvar(m, { ...n, notas: "mudou-4471" });
    await cmd(m, "master_campanha_remover", { tipo: "npcs", id: n.id });
    await esperar(400);
    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0);
    assert.ok(!tudo.includes("4471"), "dado de NPC vazou para o jogador");
    assert.ok(!tudo.includes("campanha_atualizada"));
    assert.equal((await s.api("/api/catalogo/npcs", null, ana.token)).success, false);
  });

  it("os NPCs sobrevivem ao reinício do servidor", async () => {
    const m = await mestre();
    const n = await salvar(m, { nome: "Persistente", papel: "Guarda", segredo: SEGREDO, atributos: { VON: 12 } });
    await s.reiniciar();
    const m2 = await mestre();
    const depois = (await listar(m2)).find((x) => x.id === n.id);
    assert.deepEqual(depois, n);
  });

  it("auditoria: NPC só circula pela sala dos mestres", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    assert.ok(!/(io\.emit|broadcast\.emit)\(\s*["'][^"']*npc/i.test(codigo));
    assert.ok(!/bausPublicos[^;]*npcs|npcs[^;]*SALA_BAUS/.test(codigo));
  });

  // As páginas separadas foram substituídas pela interface unificada.
  // O fluxo visual é coberto em figurantes.test.js e figurantes-cartoes.test.js.
  it("rota antiga de npc abre Figurantes e o endereço .html continua compatível", async () => {
    const resposta = await fetch(s.url + "/mestre/npc");
    assert.equal(resposta.status, 200);
    assert.match(await resposta.text(), /id="fig-cartoes"/);
    const antiga = await fetch(s.url + "/mestre/npc.html", { redirect: "manual" });
    assert.equal(antiga.status, 302);
    assert.equal(antiga.headers.get("location"), "/mestre/npc");
  });
});

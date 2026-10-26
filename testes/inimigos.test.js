/* Sprint 5 (Fase 2): biblioteca de inimigos, batalha no servidor e lista de alvos. */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const { criarCampanha, normalizarArquivo, LIMITE_COMBATENTES } = require("../campanha.js");
const regras = require("../batalha.js");
const { iniciarServidor, abrirFicha, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const SEGREDO = "SEGREDO-INI-8812";
const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-ini-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const modelo = (extra = {}) => ({
  id: "ini_goblin", nome: "Goblin", imagem: "https://ex.com/g.png", hpMax: 7, atributos: { FOR: 8 },
  ataques: [{ nome: "Faca", dado: "1d4+1", tipo: "Corte", alcance: "Toque", nota: "" }], habilidades: [{ nome: "Fuga", nota: "sai correndo" }], nota: "covarde", ...extra,
});
const novaBatalha = () => ({ ativa: false, combatentes: [] });
const norm = (b) => normalizarArquivo("batalha", { schemaVersion: 1, ...b });

describe("Regras da batalha (batalha.js)", () => {
  it("adicionar: cópias numeradas, HP cheio, ataques copiados; a numeração continua e reinicia sem ninguém", () => {
    let b = regras.adicionar(novaBatalha(), modelo(), 3);
    b = norm(b);
    assert.deepEqual(b.combatentes.map((c) => c.nome), ["Goblin 1", "Goblin 2", "Goblin 3"]);
    assert.equal(b.ativa, true);
    assert.ok(b.combatentes.every((c) => c.hp.atual === 7 && c.hp.max === 7 && !c.derrotado && c.modeloId === "ini_goblin"));
    assert.equal(new Set(b.combatentes.map((c) => c.alvoId)).size, 3, "ids próprios e únicos");
    assert.equal(b.combatentes[0].ataques[0].dado, "1d4+1");
    b.combatentes[0].ataques[0].nome = "ALTERADO";
    assert.equal(b.combatentes[1].ataques[0].nome, "Faca", "cada combatente tem a sua cópia");
    b = regras.remover(b, b.combatentes[1].alvoId); // tira o 2
    b = norm(regras.adicionar(b, modelo(), 1));
    assert.deepEqual(b.combatentes.map((c) => c.nome), ["Goblin 1", "Goblin 3", "Goblin 4"], "não reaproveita número em uso");
    b = norm(regras.adicionar(b, modelo({ id: "ini_orc", nome: "Orc" }), 2));
    assert.deepEqual(b.combatentes.slice(-2).map((c) => c.nome), ["Orc 1", "Orc 2"], "cada modelo tem a sua contagem");
    b = norm(regras.limpar(b));
    assert.deepEqual([b.combatentes.length, b.ativa], [0, false]);
    assert.deepEqual(norm(regras.adicionar(b, modelo(), 1)).combatentes.map((c) => c.nome), ["Goblin 1"], "batalha vazia recomeça em 1");
  });

  it("limites: 1 a 20 cópias por vez e 60 na batalha", () => {
    for (const q of [0, -1, 21, 1.5, "2", null, NaN]) assert.throws(() => regras.adicionar(novaBatalha(), modelo(), q), { codigo: "quantidade_invalida" }, String(q));
    let b = novaBatalha();
    for (let i = 0; i < 3; i++) b = norm(regras.adicionar(b, modelo(), 20));
    assert.equal(b.combatentes.length, LIMITE_COMBATENTES);
    assert.throws(() => regras.adicionar(b, modelo(), 1), { codigo: "limite_atingido" });
  });

  it("HP: delta ou valor absoluto (só um), limitado a 0..máx, zero = derrotado, subiu = de pé; entradas inválidas recusadas", () => {
    let b = norm(regras.adicionar(novaBatalha(), modelo(), 1));
    const id = b.combatentes[0].alvoId;
    b = regras.ajustarHp(b, id, { delta: -3 });
    assert.equal(b.combatentes[0].hp.atual, 4);
    b = regras.ajustarHp(b, id, { delta: -50 });
    assert.deepEqual([b.combatentes[0].hp.atual, b.combatentes[0].derrotado], [0, true]);
    b = regras.ajustarHp(b, id, { delta: 2 });
    assert.deepEqual([b.combatentes[0].hp.atual, b.combatentes[0].derrotado], [2, false]);
    b = regras.ajustarHp(b, id, { atual: 999 });
    assert.equal(b.combatentes[0].hp.atual, 7);
    b = regras.ajustarHp(b, id, { atual: 0 });
    assert.equal(b.combatentes[0].derrotado, true);
    for (const ruim of [{}, { delta: 1, atual: 1 }, { delta: 1.5 }, { delta: "3" }, { delta: NaN }, { delta: 1e9 }, { atual: -0.5 }, { delta: null }]) {
      assert.throws(() => regras.ajustarHp(b, id, ruim), { negocio: true }, JSON.stringify(ruim));
    }
    assert.throws(() => regras.ajustarHp(b, "nao_existe", { delta: 1 }), { codigo: "alvo_inexistente" });
  });

  it("derrotado manual exige booleano; remover alvo inexistente falha", () => {
    let b = norm(regras.adicionar(novaBatalha(), modelo(), 2));
    const id = b.combatentes[0].alvoId;
    b = regras.marcarDerrotado(b, id, true);
    assert.equal(b.combatentes[0].derrotado, true);
    assert.equal(b.combatentes[0].hp.atual, 7, "derrotado manual não mexe no HP");
    for (const v of ["sim", 1, null, undefined]) assert.throws(() => regras.marcarDerrotado(b, id, v), { codigo: "formato_invalido" });
    assert.throws(() => regras.remover(b, "x"), { codigo: "alvo_inexistente" });
  });

  it("no armazém: 50 ajustes simultâneos de −1 em 100 de HP = exatamente 50; excluir o modelo não mexe nos combatentes; persiste", async () => {
    const dir = novaPasta();
    const cat = novaPasta();
    const c = criarCampanha(dir, { log: mudo, pastaCatalogo: cat }).iniciar();
    const m = await c.salvarItem("inimigos", { nome: "Dragão", hpMax: 100, ataques: [{ nome: "Sopro", dado: "6d6" }] });
    await c.atualizar("batalha", (b) => regras.adicionar(b, m, 1));
    const alvoId = c.ler("batalha").combatentes[0].alvoId;
    await Promise.all(Array.from({ length: 50 }, () => c.atualizar("batalha", (b) => regras.ajustarHp(b, alvoId, { delta: -1 }))));
    assert.equal(c.ler("batalha").combatentes[0].hp.atual, 50);
    await c.removerItem("inimigos", m.id);
    const depois = criarCampanha(dir, { log: mudo, pastaCatalogo: cat }).iniciar().ler("batalha");
    assert.equal(depois.combatentes[0].nome, "Dragão 1");
    assert.equal(depois.combatentes[0].ataques[0].dado, "6d6");
    assert.equal(depois.combatentes[0].hp.atual, 50);
  });
});

describe("Inimigos e batalha com o servidor real", { concurrency: false }, () => {
  let s, ana;
  const abertos = [];
  const paginas = [];
  const fichas = [];
  let contador = 0;

  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_i${++contador}`, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  const criarModelo = async (m, extra = {}) => (await cmd(m, "master_campanha_salvar", { tipo: "inimigos", item: { nome: `Inimigo${++contador}`, hpMax: 10, ...extra } })).dados;
  const batalha = async (m) => (await pedir(m, "master_campanha_ler", { token: SENHA, tipo: "batalha" })).dados;
  const limpar = (m) => cmd(m, "master_batalha_limpar");

  afterEach(async () => {
    paginas.splice(0).forEach((p) => p.fechar());
    fichas.splice(0).forEach((f) => f.fechar());
    abertos.splice(0).forEach((k) => k.close());
    await esperar(250);
  });
  before(async () => {
    s = await iniciarServidor();
    const token = (await s.api("/api/login", { nome: "ana", senha: "x", criarSeNaoExistir: true })).token;
    const pasta = (await s.api("/api/personagens", { nome: "Ana" }, token)).personagem.nomePasta;
    ana = { token, pasta };
  });
  after(async () => { await s?.parar(); });

  const EVENTOS = [
    ["master_batalha_adicionar", { modeloId: "x", quantidade: 1 }],
    ["master_batalha_hp", { alvoId: "x", delta: -1 }],
    ["master_batalha_derrotado", { alvoId: "x", derrotado: true }],
    ["master_batalha_remover", { alvoId: "x" }],
    ["master_batalha_limpar", {}],
    ["master_listar_alvos", {}],
    ["master_campanha_salvar", { tipo: "inimigos", item: { nome: "Hack" } }],
  ];

  it("jogador e anônimo são recusados em todo evento de batalha (tokens forjados) e nada muda", async () => {
    const m = await mestre();
    const modeloBase = await criarModelo(m, { segredo: SEGREDO });
    await cmd(m, "master_batalha_adicionar", { modeloId: modeloBase.id, quantidade: 2 });
    const antes = JSON.stringify(await batalha(m));
    for (const sock of [await conectar(ana.token), await conectar()]) {
      for (const [evento, dados] of EVENTOS) {
        for (const token of [undefined, "", "errado", ana.token]) {
          const r = await pedir(sock, evento, { ...dados, token, acaoId: "acao_forja" });
          assert.equal(r.erro, "nao_autorizado", `${evento} ${token}`);
          assert.equal(r.dados, undefined);
        }
      }
    }
    assert.equal(JSON.stringify(await batalha(m)), antes);
    await limpar(m);
  });

  it("fluxo: biblioteca → batalha (cópias numeradas) → HP → derrotado → remover → limpar; respostas no padrão", async () => {
    const m = await mestre();
    const g = await criarModelo(m, { nome: "Goblin", hpMax: 8, ataques: [{ nome: "Faca", dado: "1d4" }], habilidades: [{ nome: "Fuga" }] });
    const add = await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 3 });
    assert.deepEqual(add.dados.adicionados.map((a) => a.nome), ["Goblin 1", "Goblin 2", "Goblin 3"]);
    const [g1, g2, g3] = add.dados.adicionados.map((a) => a.alvoId);
    assert.deepEqual((await cmd(m, "master_batalha_hp", { alvoId: g1, delta: -5 })).dados, { hp: { atual: 3, max: 8 }, derrotado: false });
    assert.deepEqual((await cmd(m, "master_batalha_hp", { alvoId: g1, delta: -99 })).dados, { hp: { atual: 0, max: 8 }, derrotado: true });
    assert.deepEqual((await cmd(m, "master_batalha_hp", { alvoId: g2, atual: 4 })).dados.hp.atual, 4);
    assert.equal((await cmd(m, "master_batalha_derrotado", { alvoId: g3, derrotado: true })).dados.derrotado, true);
    assert.equal((await cmd(m, "master_batalha_remover", { alvoId: g2 })).ok, true);
    let b = await batalha(m);
    assert.deepEqual(b.combatentes.map((c) => [c.nome, c.hp.atual, c.derrotado]), [["Goblin 1", 0, true], ["Goblin 3", 8, true]]);
    assert.equal(b.ativa, true);
    assert.equal((await limpar(m)).ok, true);
    b = await batalha(m);
    assert.deepEqual([b.combatentes.length, b.ativa], [0, false]);
  });

  it("pedidos inválidos: modelo inexistente, ids perigosos, quantidades e HP fora do padrão", async () => {
    const m = await mestre();
    const g = await criarModelo(m);
    await limpar(m);
    const erro = async (evento, dados) => (await cmd(m, evento, dados)).erro;
    assert.equal(await erro("master_batalha_adicionar", { modeloId: "nao_existe", quantidade: 1 }), "modelo_inexistente");
    assert.equal(await erro("master_batalha_adicionar", { modeloId: "../x", quantidade: 1 }), "id_invalido");
    for (const q of [0, 21, 1.5, "2", null]) assert.equal(await erro("master_batalha_adicionar", { modeloId: g.id, quantidade: q }), "quantidade_invalida", String(q));
    assert.equal((await batalha(m)).combatentes.length, 0);
    const { alvoId } = (await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 1 })).dados.adicionados[0];
    assert.equal(await erro("master_batalha_hp", { alvoId: "../x", delta: 1 }), "id_invalido");
    assert.equal(await erro("master_batalha_hp", { alvoId: "nao_existe", delta: 1 }), "alvo_inexistente");
    for (const d of [{}, { delta: 1, atual: 1 }, { delta: "3" }, { delta: 1.5 }, { delta: 1e12 }]) assert.equal(await erro("master_batalha_hp", { alvoId, ...d }), "formato_invalido", JSON.stringify(d));
    assert.equal(await erro("master_batalha_derrotado", { alvoId, derrotado: "sim" }), "formato_invalido");
    assert.equal(await erro("master_batalha_remover", { alvoId: "nao_existe" }), "alvo_inexistente");
    assert.equal((await pedir(m, "master_batalha_hp", { token: SENHA, alvoId, delta: 1 })).erro, "acao_id_obrigatorio");
    assert.equal((await batalha(m)).combatentes[0].hp.atual, 10);
    await limpar(m);
  });

  it("idempotente: o mesmo acaoId (duplo clique/reenvio) aplica o ajuste uma vez só", async () => {
    const m = await mestre();
    const g = await criarModelo(m, { hpMax: 20 });
    await limpar(m);
    const { alvoId } = (await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 1 })).dados.adicionados[0];
    const pedido = { token: SENHA, alvoId, delta: -5, acaoId: "acao_unica_9" };
    const rs = await Promise.all([pedir(m, "master_batalha_hp", pedido), pedir(m, "master_batalha_hp", pedido), pedir(m, "master_batalha_hp", pedido)]);
    const depois = await pedir(m, "master_batalha_hp", pedido);
    assert.ok([...rs, depois].every((r) => r.ok && r.dados.hp.atual === 15));
    assert.equal((await batalha(m)).combatentes[0].hp.atual, 15);
    // 30 ajustes diferentes e simultâneos de −1: todos contam
    await Promise.all(Array.from({ length: 10 }, () => cmd(m, "master_batalha_hp", { alvoId, delta: -1 })));
    assert.equal((await batalha(m)).combatentes[0].hp.atual, 5);
    await limpar(m);
  });

  it("duas abas do mestre ficam sincronizadas (a outra recebe a batalha inteira em tempo real)", async () => {
    const a = await mestre();
    const b = await mestre();
    const recebidas = [];
    b.on("campanha_atualizada", (d) => { if (d.tipo === "batalha") recebidas.push(d.dados); });
    const g = await criarModelo(a, { nome: "Sync", hpMax: 9 });
    await limpar(a);
    const { alvoId } = (await cmd(a, "master_batalha_adicionar", { modeloId: g.id, quantidade: 1 })).dados.adicionados[0];
    await cmd(a, "master_batalha_hp", { alvoId, delta: -4 });
    await esperarAte(() => recebidas.some((r) => r.combatentes[0]?.hp.atual === 5), { rotulo: "outra aba receber o HP" });
    assert.deepEqual(Object.keys(recebidas.at(-1)).sort(), ["ativa", "combatentes"]);
    await limpar(a);
  });

  it("excluir o modelo não mexe nos combatentes que já estão em batalha", async () => {
    const m = await mestre();
    const g = await criarModelo(m, { nome: "Efêmero", ataques: [{ nome: "Garra", dado: "1d8" }] });
    await limpar(m);
    await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 2 });
    await cmd(m, "master_campanha_remover", { tipo: "inimigos", id: g.id });
    const b = await batalha(m);
    assert.deepEqual(b.combatentes.map((c) => c.nome), ["Efêmero 1", "Efêmero 2"]);
    assert.equal(b.combatentes[0].ataques[0].dado, "1d8");
    assert.equal((await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 1 })).erro, "modelo_inexistente");
    await limpar(m);
  });

  it("VAZAMENTO: o jogador com a ficha aberta nunca recebe inimigo, batalha ou HP de inimigo", async () => {
    const m = await mestre();
    const j = await conectar(ana.token);
    const vistos = [];
    j.onAny((ev, ...a) => vistos.push([ev, a]));
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: ana.pasta }); });
    j.emit("entregas_pedir");
    const g = await criarModelo(m, { nome: "Besta-Oculta-8812", nota: SEGREDO, ataques: [{ nome: "Mordida-8812", dado: "2d6" }] });
    await limpar(m);
    const { alvoId } = (await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 2 })).dados.adicionados[0];
    await cmd(m, "master_batalha_hp", { alvoId, delta: -3 });
    await cmd(m, "master_listar_alvos");
    await cmd(m, "master_batalha_remover", { alvoId });
    await limpar(m);
    await esperar(400);
    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0);
    assert.ok(!tudo.includes("8812"), "dado de inimigo vazou para o jogador");
    assert.ok(!tudo.includes("campanha_atualizada"));
  });

  it("persistência: batalha, HP e derrotados sobrevivem ao reinício do servidor", async () => {
    const m = await mestre();
    const g = await criarModelo(m, { nome: "Persistente", hpMax: 12 });
    await limpar(m);
    const add = (await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 2 })).dados.adicionados;
    await cmd(m, "master_batalha_hp", { alvoId: add[0].alvoId, delta: -7 });
    await cmd(m, "master_batalha_derrotado", { alvoId: add[1].alvoId, derrotado: true });
    const antes = await batalha(m);
    await s.reiniciar();
    const m2 = await mestre();
    assert.deepEqual(await batalha(m2), antes);
    assert.deepEqual(antes.combatentes.map((c) => [c.nome, c.hp.atual, c.derrotado]), [["Persistente 1", 5, false], ["Persistente 2", 12, true]]);
    await limpar(m2);
    const token = (await s.api("/api/login", { nome: "ana", senha: "x" })).token; // sessões não sobrevivem ao reinício
    ana.token = token;
  });

  it("alvos: jogador online (com HP), NPCs e inimigos em batalha, com ids estáveis; jogador sai da lista ao fechar", async () => {
    const m = await mestre();
    const npc = (await cmd(m, "master_campanha_salvar", { tipo: "npcs", item: { nome: "Alvo NPC", hp: { atual: 4, max: 9 } } })).dados;
    const g = await criarModelo(m, { nome: "Alvo Inimigo", hpMax: 6 });
    await limpar(m);
    const { alvoId } = (await cmd(m, "master_batalha_adicionar", { modeloId: g.id, quantidade: 1 })).dados.adicionados[0];
    const ficha = await abrirFicha(s, { player: "ana", nomePasta: ana.pasta, token: ana.token });
    fichas.push(ficha);
    await esperarAte(() => ficha.run("personagemCarregado"), { rotulo: "ficha carregar" });
    const pegar = async () => (await cmd(m, "master_listar_alvos")).dados.alvos;
    const alvos = await esperarAte(async () => { const a = await pegar(); return a.some((x) => x.tipo === "jogador") && a; }, { rotulo: "jogador online na lista" });
    const jog = alvos.find((x) => x.tipo === "jogador");
    assert.deepEqual([jog.nome, jog.player, jog.nomePasta], ["Ana", "ana", ana.pasta]);
    assert.ok(Number.isInteger(jog.hp.atual) && Number.isInteger(jog.hp.max));
    assert.match(jog.alvoId, /^jog_[0-9a-f]{16}$/);
    assert.deepEqual(alvos.find((x) => x.tipo === "npc" && x.alvoId === npc.id), { alvoId: npc.id, tipo: "npc", nome: "Alvo NPC", imagem: "", hp: { atual: 4, max: 9 }, energia: { atual: 10, max: 10 } });
    assert.deepEqual(alvos.find((x) => x.tipo === "inimigo"), { alvoId, tipo: "inimigo", nome: "Alvo Inimigo 1", imagem: "", hp: { atual: 6, max: 6 }, energia: { atual: 10, max: 10 }, derrotado: false });
    const ids = alvos.map((x) => x.alvoId);
    assert.equal(new Set(ids).size, ids.length, "ids únicos");
    assert.ok(ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)));
    assert.deepEqual((await pegar()).map((x) => x.alvoId), ids, "ids estáveis entre chamadas");
    ficha.fechar();
    await esperarAte(async () => !(await pegar()).some((x) => x.tipo === "jogador"), { rotulo: "jogador sair da lista" });
    await limpar(m);
  });

  it("auditoria: eventos novos no padrão de comandos e nada de batalha por broadcast geral", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    for (const ev of ["master_batalha_adicionar", "master_batalha_hp", "master_batalha_derrotado", "master_batalha_remover", "master_batalha_limpar", "master_listar_alvos"]) {
      assert.match(codigo, new RegExp(`comandos\\.registrar\\(\\s*socket,\\s*"${ev}"`), ev);
    }
    assert.ok(!/(io\.emit|broadcast\.emit)\(\s*["'][^"']*(batalha|combat|inimigo)/i.test(codigo));
  });

  /* ---- página ---- */
  describe("página Inimigos (navegador)", () => {
    const abrirPagina = async (opcoes = { real: true, tokenInicial: SENHA }) => {
      const pg = await abrirPaginaMestre(s, "inimigos", opcoes);
      paginas.push(pg);
      return pg;
    };
    const clicar = (pg, el) => el.dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true }));
    const preencher = (pg, id, v) => {
      const el = pg.document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new pg.window.Event("input", { bubbles: true }));
    };
    const cartoes = (pg) => [...pg.document.querySelectorAll("#ini-cartoes [data-id]")];
    const cartao = (pg, nome) => cartoes(pg).find((c) => c.querySelector("h4").textContent === nome);
    const combatentes = (pg) => [...pg.document.querySelectorAll("#ini-combatentes [data-alvo-id]")];
    const combatente = (pg, nome) => combatentes(pg).find((c) => c.querySelector("h4").textContent === nome);

    it("biblioteca: criar com ataques e habilidades, validar dado/imagem, XSS, editar, buscar, duplicar, excluir", async () => {
      const m = await mestre();
      await limpar(m);
      const pg = await abrirPagina();
      await esperarAte(() => pg.run("ini.carregou"), { rotulo: "página carregar" });
      const xss = "Lobo <img src=x onerror=alert(1)>";
      clicar(pg, pg.document.getElementById("ini-novo"));
      clicar(pg, pg.document.getElementById("in-salvar"));
      assert.match(pg.document.getElementById("toast-container").textContent, /Dê um nome ao inimigo/);
      preencher(pg, "in-nome", xss);
      preencher(pg, "in-hpMax", "15");
      preencher(pg, "in-attr-FOR", "13");
      clicar(pg, pg.document.getElementById("in-add-ataque"));
      const linha = pg.document.querySelector("#in-ataques > div");
      const campoDe = (n) => linha.querySelector(`[data-campo="${n}"]`);
      campoDe("nome").value = "Mordida";
      campoDe("dado").value = "2d6; apagar";
      clicar(pg, pg.document.getElementById("in-salvar"));
      assert.match(pg.document.getElementById("toast-container").textContent, /Dado inválido/);
      campoDe("dado").value = "2d6+1";
      campoDe("tipo").value = "Perfurante";
      clicar(pg, pg.document.getElementById("in-add-habilidade"));
      pg.document.querySelector('#in-habilidades [data-campo="nome"]').value = "Uivo";
      preencher(pg, "in-imagem", "javascript:alert(1)");
      clicar(pg, pg.document.getElementById("in-salvar"));
      assert.match(pg.document.getElementById("toast-container").textContent, /Imagem inválida/);
      preencher(pg, "in-imagem", "https://exemplo.com/lobo.png");
      clicar(pg, pg.document.getElementById("in-salvar"));
      await esperarAte(() => cartao(pg, xss), { rotulo: "cartão" });
      const c = cartao(pg, xss);
      assert.match(c.textContent, /HP 15/);
      assert.match(c.textContent, /Mordida · 2d6\+1 · Perfurante/);
      assert.match(c.textContent, /✦ Uivo/);
      assert.equal(c.querySelector("img").getAttribute("src"), "https://exemplo.com/lobo.png");
      assert.equal(pg.document.querySelectorAll("#ini-cartoes img[onerror], #ini-cartoes b").length, 0);

      clicar(pg, c.querySelector('[data-acao="editar"]'));
      assert.equal(pg.document.querySelectorAll("#in-ataques > div").length, 1);
      assert.equal(pg.document.getElementById("in-attr-DES").value, "");
      clicar(pg, pg.document.querySelector('#in-ataques [data-acao="remover-linha"]'));
      preencher(pg, "in-nome", "Lobo");
      clicar(pg, pg.document.getElementById("in-salvar"));
      await esperarAte(() => cartao(pg, "Lobo"), { rotulo: "cartão editado" });
      assert.ok(!/Mordida/.test(cartao(pg, "Lobo").textContent), "ataque removido no editor");
      assert.equal(cartoes(pg).filter((x) => x.querySelector("h4").textContent.startsWith("Lobo")).length, 1);

      preencher(pg, "ini-busca", "LOBO");
      assert.equal(cartoes(pg).length, 1);
      preencher(pg, "ini-busca", "zzz");
      assert.equal(cartoes(pg).length, 0);
      preencher(pg, "ini-busca", "");
      clicar(pg, cartao(pg, "Lobo").querySelector('[data-acao="duplicar"]'));
      await esperarAte(() => cartao(pg, "Lobo (cópia)"), { rotulo: "cópia" });
      const excluir = () => cartao(pg, "Lobo (cópia)").querySelector('[data-acao="excluir"]');
      clicar(pg, excluir());
      assert.equal(excluir().textContent, "Confirmar?");
      clicar(pg, excluir());
      await esperarAte(() => !cartao(pg, "Lobo (cópia)"), { rotulo: "cópia excluída" });
    });

    it("batalha: colocar cópias, ajustar HP (cliques rápidos), derrotado automático e manual, remover, limpar; excluir o modelo não afeta", async () => {
      const m = await mestre();
      const g = await criarModelo(m, { nome: "Esqueleto", hpMax: 10, ataques: [{ nome: "Osso", dado: "1d6" }] });
      await limpar(m);
      const pg = await abrirPagina();
      await esperarAte(() => cartao(pg, "Esqueleto"), { rotulo: "cartão" });
      const cartaoEsq = () => cartao(pg, "Esqueleto");
      cartaoEsq().querySelector('[data-campo="copias"]').value = "3";
      clicar(pg, cartaoEsq().querySelector('[data-acao="batalhar"]'));
      await esperarAte(() => combatentes(pg).length === 3, { rotulo: "3 combatentes" });
      assert.match(pg.document.getElementById("toast-container").textContent, /Esqueleto 1, Esqueleto 2, Esqueleto 3/);
      assert.equal(pg.document.getElementById("ini-aba-batalha").textContent, "Batalha (3)");
      cartaoEsq().querySelector('[data-campo="copias"]').value = "99";
      clicar(pg, cartaoEsq().querySelector('[data-acao="batalhar"]'));
      assert.match(pg.document.getElementById("toast-container").textContent, /1 a 20/);

      clicar(pg, pg.document.getElementById("ini-aba-batalha"));
      assert.ok(!pg.document.getElementById("ini-batalha").classList.contains("hidden"));
      assert.match(combatente(pg, "Esqueleto 1").textContent, /Osso · 1d6/);
      const botao = (nome, acao) => combatente(pg, nome).querySelector(`[data-acao="${acao}"]`);
      for (let i = 0; i < 3; i++) clicar(pg, botao("Esqueleto 1", "hp-1"));
      await esperarAte(() => /HP 7\/10/.test(combatente(pg, "Esqueleto 1").textContent), { rotulo: "HP 7" });
      for (let i = 0; i < 2; i++) clicar(pg, botao("Esqueleto 1", "hp-5"));
      await esperarAte(() => combatente(pg, "Esqueleto 1").dataset.derrotado === "1", { rotulo: "derrotado automático" });
      assert.match(combatente(pg, "Esqueleto 1").textContent, /HP 0\/10/);
      assert.match(pg.document.getElementById("ini-batalha-resumo").textContent, /2 de 3 em pé/);
      clicar(pg, botao("Esqueleto 1", "hp+5"));
      await esperarAte(() => combatente(pg, "Esqueleto 1").dataset.derrotado === "0", { rotulo: "reerguido por HP" });

      clicar(pg, botao("Esqueleto 2", "derrotado"));
      await esperarAte(() => combatente(pg, "Esqueleto 2").dataset.derrotado === "1", { rotulo: "derrotado manual" });
      assert.equal(botao("Esqueleto 2", "derrotado").textContent, "Reerguer");
      clicar(pg, botao("Esqueleto 2", "derrotado"));
      await esperarAte(() => combatente(pg, "Esqueleto 2").dataset.derrotado === "0", { rotulo: "reerguido" });

      // excluir o modelo na biblioteca não mexe em quem está em batalha
      await cmd(m, "master_campanha_remover", { tipo: "inimigos", id: g.id });
      await esperarAte(() => !cartao(pg, "Esqueleto"), { rotulo: "modelo excluído" });
      assert.equal(combatentes(pg).length, 3);

      clicar(pg, botao("Esqueleto 3", "remover"));
      await esperarAte(() => combatentes(pg).length === 2, { rotulo: "removido" });
      const limparBtn = pg.document.getElementById("ini-limpar");
      clicar(pg, limparBtn);
      assert.equal(limparBtn.textContent, "Confirmar?");
      assert.equal(combatentes(pg).length, 2, "o primeiro clique só pede confirmação");
      clicar(pg, limparBtn);
      await esperarAte(() => combatentes(pg).length === 0, { rotulo: "batalha limpa" });
      assert.match(pg.document.getElementById("ini-combatentes").textContent, /Nenhuma batalha/);
    });

    it("duas páginas sincronizadas; token errado não carrega nada", async () => {
      const m = await mestre();
      const g = await criarModelo(m, { nome: "Gêmeo", hpMax: 6 });
      await limpar(m);
      const a = await abrirPagina();
      const b = await abrirPagina();
      await esperarAte(() => cartao(a, "Gêmeo") && cartao(b, "Gêmeo"), { rotulo: "páginas carregarem" });
      clicar(a, cartao(a, "Gêmeo").querySelector('[data-acao="batalhar"]'));
      await esperarAte(() => combatente(b, "Gêmeo 1"), { rotulo: "combatente na outra página" });
      clicar(b, combatente(b, "Gêmeo 1").querySelector('[data-acao="hp-5"]'));
      await esperarAte(() => /HP 1\/6/.test(combatente(a, "Gêmeo 1").textContent), { rotulo: "HP na primeira página" });
      await cmd(m, "master_campanha_remover", { tipo: "inimigos", id: g.id });
      await limpar(m);
      const errada = await abrirPagina({ real: true, tokenInicial: "errado" });
      await esperarAte(() => errada.run("socket.connected"), { rotulo: "conectar" });
      await esperar(400);
      assert.equal(errada.run("ini.carregou"), false);
      assert.equal(cartoes(errada).length + combatentes(errada).length, 0);
    });
  });
});

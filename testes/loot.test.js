/* Sprint 3 (Fase 2): catálogo de itens, baús, liberar e pegar (reserva em 2 fases), expiração e página Loot. */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const { criarCampanha, normalizarItemDeLoot, bausPublicos } = require("../campanha.js");
const { criarEntregas } = require("../entregas.js");
const personagemModelo = require("../personagem.js");
const { iniciarServidor, abrirFicha, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const EXPIRA_MS = 3000;
const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-loot-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/* ------------------------------ unitários ------------------------------ */
describe("Itens de loot e baús (armazém)", () => {
  it("item de loot: só campos conhecidos, limites e id seguro", () => {
    const i = normalizarItemDeLoot({ id: "../x", name: "  Espada  ", type: "Arma", weight: 1.2345, w: 99, h: 0, maxStack: 5000, icon: "fa-sword", color: "<b>", dice: "1d8+2", twoHanded: "sim", isBackpackItem: true, backpackType: "x", segredo: 1, uid: "it_abcd", quantity: 9 });
    assert.match(i.id, /^itm_/);
    assert.deepEqual({ ...i, id: "x" }, { id: "x", name: "Espada", type: "Arma", desc: "", weight: 1.23, w: 10, h: 1, maxStack: 999, twoHanded: false, icon: "fa-sword", dice: "1d8+2" });
    assert.equal(normalizarItemDeLoot({ name: "   " }), null);
    assert.equal(normalizarItemDeLoot("x"), null);
  });

  it("visão pública: só baús liberados, nome e itens disponíveis (sem histórico nem controle)", () => {
    const c = criarCampanha(novaPasta(), { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    const baus = [
      { id: "b1", nome: "Aberto", liberado: true, historico: [{ jogador: "X" }], itens: [{ id: "l1", item: { id: "p", name: "Poção", type: "Poção", desc: "cura", icon: "fa-flask" }, quantidade: 3 }, { id: "l2", item: { id: "e", name: "Esgotado" }, quantidade: 0 }] },
      { id: "b2", nome: "Fechado", liberado: false, itens: [{ id: "l3", item: { id: "o", name: "Oculto" }, quantidade: 1 }] },
    ];
    const publico = bausPublicos(baus);
    assert.deepEqual(publico, [{ id: "b1", nome: "Aberto", itens: [{ id: "l1", nome: "Poção", tipo: "Poção", icone: "fa-flask", desc: "cura", quantidade: 3 }] }]);
    assert.ok(c);
  });

  it("reservar: só baú liberado, nunca mais que o disponível; 30 pedidos simultâneos de 1 em 10 = exatamente 10", async () => {
    const c = criarCampanha(novaPasta(), { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    const bau = await c.salvarItem("baus", { nome: "B", liberado: true, itens: [{ item: { id: "moeda", name: "Moeda" }, quantidade: 10 }] });
    const linha = bau.itens[0].id;
    assert.equal(bau.liberado, true);
    const rs = await Promise.allSettled(Array.from({ length: 30 }, () => c.reservarDoBau(bau.id, linha, 1)));
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 10);
    assert.ok(rs.filter((r) => r.status === "rejected").every((r) => r.reason.codigo === "indisponivel"));
    assert.equal(c.ler("baus")[0].itens[0].quantidade, 0);
    await assert.rejects(() => c.reservarDoBau(bau.id, linha, 1), { codigo: "indisponivel" });
    await assert.rejects(() => c.reservarDoBau("nao-existe", linha, 1), { codigo: "bau_indisponivel" });
    await assert.rejects(() => c.reservarDoBau(bau.id, "nao-existe", 1), { codigo: "bau_indisponivel" });
    for (const q of [0, -1, 1.5, "1", null, NaN]) await assert.rejects(() => c.reservarDoBau(bau.id, linha, q), { negocio: true }, String(q));
    // devolver
    assert.equal(await c.devolverAoBau(bau.id, linha, 4, { jogador: "Ana", item: "Moeda", resultado: "expirou" }), true);
    assert.equal(c.ler("baus")[0].itens[0].quantidade, 4);
    assert.equal(c.ler("baus")[0].historico.at(-1).resultado, "expirou");
    assert.equal(await c.devolverAoBau(bau.id, "sumiu", 1), false);
    // baú não liberado
    await c.atualizar("baus", (b) => { b[0].liberado = false; });
    await assert.rejects(() => c.reservarDoBau(bau.id, linha, 1), { codigo: "bau_indisponivel" });
  });

  it("histórico guarda só os 50 últimos", async () => {
    const c = criarCampanha(novaPasta(), { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    const bau = await c.salvarItem("baus", { nome: "B" });
    for (let i = 0; i < 60; i++) await c.registrarNoBau(bau.id, { jogador: `J${i}`, item: "x", quantidade: 1, resultado: "pegou" });
    const h = c.ler("baus")[0].historico;
    assert.equal(h.length, 50);
    assert.equal(h.at(-1).jogador, "J59");
  });
});

describe("Entregas de loot e recibo", () => {
  it("item só com origem; cancelar vale uma vez; várias entregas do mesmo item permitidas", async () => {
    const raiz = novaPasta();
    fs.mkdirSync(path.join(raiz, "ana", "H_0001"), { recursive: true });
    const e = criarEntregas({ pastaDoPersonagem: (p, n) => path.join(raiz, p, n), log: mudo });
    const entrada = { id: "p", name: "Poção", quantity: 2, catalogId: "p" };
    await assert.rejects(() => e.adicionar("ana", "H_0001", { tipo: "itens", entrada }), { codigo: "entrega_invalida" });
    const origem = { bauId: "b1", linhaId: "l1", quantidade: 2 };
    const a = await e.adicionar("ana", "H_0001", { tipo: "itens", entrada, origem });
    const b = await e.adicionar("ana", "H_0001", { tipo: "itens", entrada, origem });
    assert.notEqual(a.entregaId, b.entregaId);
    assert.equal(e.pendentes("ana", "H_0001").length, 2);
    assert.equal((await e.cancelar("ana", "H_0001", a.entregaId, "expirou")).status, "cancelada");
    assert.equal(await e.cancelar("ana", "H_0001", a.entregaId, "expirou"), null);
    assert.equal(await e.marcarEntregue("ana", "H_0001", a.entregaId), null, "cancelada não vira entregue");
    assert.equal(e.pendentes("ana", "H_0001").length, 1);
    await assert.rejects(() => e.adicionar("ana", "H_0001", { tipo: "itens", entrada, origem: { bauId: "../x", linhaId: "l", quantidade: 1 } }), { codigo: "entrega_invalida" });
    await assert.rejects(() => e.adicionar("ana", "H_0001", { tipo: "itens", entrada, origem: { bauId: "b", linhaId: "l", quantidade: 0 } }), { codigo: "entrega_invalida" });
  });

  it("o inventário do personagem guarda o recibo (só ids seguros, no máximo 50)", () => {
    const base = { items: [], equipped: {} };
    const n = personagemModelo.NORMALIZADORES.inventario({ ...base, recebidas: ["ent_1", "../x", 5, null, ...Array.from({ length: 70 }, (_, i) => `e${i}`)] });
    assert.equal(n.recebidas.length, 50);
    assert.ok(!n.recebidas.includes("../x"));
    assert.deepEqual(personagemModelo.NORMALIZADORES.inventario(base).recebidas, []);
    assert.deepEqual(personagemModelo.DEFAULTS.inventario().recebidas, []);
  });
});

/* ------------------------------ integração ------------------------------ */
describe("Loot com o servidor real", { concurrency: false }, () => {
  let s, ana, bia, caio;
  const abertos = [];
  const fichas = [];
  let contador = 0;

  const criarJogador = async (conta, nome) => {
    const token = (await s.api("/api/login", { nome: conta, senha: "x", criarSeNaoExistir: true })).token;
    const pasta = (await s.api("/api/personagens", { nome }, token)).personagem.nomePasta;
    return { conta, token, pasta };
  };
  const relogar = async (j) => { j.token = (await s.api("/api/login", { nome: j.conta, senha: "x" })).token; };
  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_l${++contador}`, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  // jogador "cru": abre o personagem e fica pronto para baús, mas NÃO aplica entregas (não é uma ficha)
  const jogadorCru = async (j) => {
    const sock = await conectar(j.token);
    sock.baus = [];
    sock.on("baus_estado", (d) => sock.baus.push(d.baus));
    sock.entregas = [];
    sock.on("entrega", (e) => sock.entregas.push(e));
    await new Promise((res) => { sock.once("personagem_carregado", res); sock.emit("carregar_personagem", { player: j.conta, nomePasta: j.pasta }); });
    sock.emit("entregas_pedir");
    await esperarAte(() => sock.baus.length >= 1, { rotulo: "estado inicial dos baús" });
    return sock;
  };
  const pegar = (sock, bauId, linhaId, quantidade, extra = {}) => pedir(sock, "jogador_pegar_item", { bauId, linhaId, quantidade, ...extra });
  const abrir = async (j) => {
    const f = await abrirFicha(s, { player: j.conta, nomePasta: j.pasta, token: j.token });
    fichas.push(f);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
    await esperar(250);
    return f;
  };
  const criarItem = async (m, extra = {}) => (await cmd(m, "master_campanha_salvar", { tipo: "itens", item: { name: `Item${++contador}`, type: "Poção", ...extra } })).dados;
  const criarBau = async (m, linhas, extra = {}) => (await cmd(m, "master_campanha_salvar", { tipo: "baus", item: { nome: `Baú${++contador}`, itens: linhas.map(([item, quantidade]) => ({ item, quantidade })), ...extra } })).dados;
  const liberar = (m, bau, liberado = true) => cmd(m, "master_bau_liberar", { id: bau.id, liberado });
  const lerBau = (m, id) => pedir(m, "master_campanha_ler", { token: SENHA, tipo: "baus" }).then((r) => r.dados.find((b) => b.id === id));
  const arquivoBaus = (id) => JSON.parse(fs.readFileSync(path.join(s.dir, "campanha", "baus.json"), "utf8")).items.find((b) => b.id === id);
  const caixa = (j) => JSON.parse(fs.readFileSync(path.join(s.dir, "players", j.conta, j.pasta, "entregas.json"), "utf8")).items;
  const fecharTudo = async () => {
    fichas.splice(0).forEach((f) => f.fechar());
    abertos.splice(0).forEach((k) => k.close());
    await esperar(400);
  };

  afterEach(fecharTudo); // uma falha nunca deixa ficha/socket aberto para o teste seguinte (uma aba por personagem)
  before(async () => {
    s = await iniciarServidor(undefined, { RESERVA_EXPIRA_MS: String(EXPIRA_MS) });
    ana = await criarJogador("ana", "Ana");
    bia = await criarJogador("bia", "Bia");
    caio = await criarJogador("caio", "Caio");
  });
  after(async () => {
    await fecharTudo();
    await s?.parar();
  });

  /* ---- catálogo de itens e segurança ---- */
  it("catálogo de itens: salva, nasce no arquivo certo, limpo; o jogador não o enxerga", async () => {
    const m = await mestre();
    const novoItem = await criarItem(m, { desc: "SEGREDO-LOOT-9", icon: "fa-flask", weight: 0.5, isBackpackItem: true, lixo: 1 });
    assert.equal(novoItem.isBackpackItem, undefined);
    assert.equal(novoItem.lixo, undefined);
    assert.ok(fs.existsSync(path.join(s.dir, "catalogo", "itens.json")));
    const r = await s.api("/api/catalogo/itens", null, ana.token);
    assert.equal(r.success, false, "a ficha não lê o catálogo de itens");
    assert.ok(!JSON.stringify(await s.api("/api/catalogo/habilidades", null, ana.token)).includes("SEGREDO-LOOT-9"));
    assert.equal((await cmd(m, "master_campanha_salvar", { tipo: "itens", item: { name: "  " } })).erro, "item_invalido");
  });

  it("jogador e anônimo: não editam itens/baús, não liberam, não pegam sem ficha", async () => {
    const m = await mestre();
    const item = await criarItem(m);
    const bau = await criarBau(m, [[item, 3]]);
    const jogador = await conectar(ana.token);
    const anonimo = await conectar();
    for (const sock of [jogador, anonimo]) {
      for (const [evento, dados] of [
        ["master_campanha_salvar", { tipo: "itens", item: { name: "Hack" }, acaoId: "acao_x1" }],
        ["master_campanha_salvar", { tipo: "baus", item: { nome: "Hack", liberado: true }, acaoId: "acao_x2" }],
        ["master_campanha_remover", { tipo: "baus", id: bau.id, acaoId: "acao_x3" }],
        ["master_bau_liberar", { id: bau.id, liberado: true, acaoId: "acao_x4" }],
      ]) {
        for (const token of [undefined, "errado", ana.token]) assert.equal((await pedir(sock, evento, { ...dados, token })).erro, "nao_autorizado", `${evento} ${token}`);
      }
      const r = await pegar(sock, bau.id, bau.itens[0].id, 1);
      assert.equal(r.ok, false);
      assert.equal(r.erro, "sem_personagem");
    }
    const depois = await lerBau(m, bau.id);
    assert.equal(depois.liberado, false);
    assert.equal(depois.itens[0].quantidade, 3);
  });

  it("o editor não libera nem mexe no histórico; baú liberado não se edita; liberar é só pelo comando", async () => {
    const m = await mestre();
    const item = await criarItem(m);
    const novo = await criarBau(m, [[item, 2]], { liberado: true, historico: [{ jogador: "Falso", item: "x", quantidade: 1, resultado: "pegou" }] });
    assert.equal(novo.liberado, false);
    assert.deepEqual(novo.historico, []);
    assert.equal((await liberar(m, novo)).ok, true);
    const editar = await cmd(m, "master_campanha_salvar", { tipo: "baus", item: { ...novo, nome: "Mudou", itens: [{ item, quantidade: 999 }] } });
    assert.equal(editar.erro, "bau_liberado");
    assert.equal((await lerBau(m, novo.id)).itens[0].quantidade, 2);
    assert.equal((await liberar(m, novo, false)).ok, true);
    assert.equal((await cmd(m, "master_campanha_salvar", { tipo: "baus", item: { ...novo, nome: "Mudou" } })).ok, true);
    // pedidos inválidos
    assert.equal((await cmd(m, "master_bau_liberar", { id: "../x", liberado: true })).erro, "formato_invalido");
    assert.equal((await cmd(m, "master_bau_liberar", { id: novo.id, liberado: "sim" })).erro, "formato_invalido");
    assert.equal((await cmd(m, "master_bau_liberar", { id: "nao_existe", liberado: true })).erro, "bau_inexistente");
  });

  /* ---- liberar, ver, recolher ---- */
  it("jogador só vê baú liberado, só nome e itens; recolher some; novo jogador já vê o estado atual", async () => {
    await fecharTudo();
    const m = await mestre();
    const item = await criarItem(m, { desc: "cura", icon: "fa-flask" });
    const bau = await criarBau(m, [[item, 3]]);
    const j = await jogadorCru(ana);
    assert.deepEqual(j.baus.at(-1), [], "baú preparado não aparece");
    assert.ok(!JSON.stringify(j.baus).includes(bau.nome));
    await liberar(m, bau);
    await esperarAte(() => j.baus.at(-1).length === 1, { rotulo: "baú liberado aparecer" });
    const visto = j.baus.at(-1)[0];
    assert.deepEqual(Object.keys(visto).sort(), ["id", "itens", "nome"]);
    assert.deepEqual(Object.keys(visto.itens[0]).sort(), ["desc", "icone", "id", "nome", "quantidade", "tipo"]);
    assert.equal(visto.itens[0].quantidade, 3);
    const tardio = await jogadorCru(bia);
    assert.equal(tardio.baus.at(-1).length >= 1, true, "quem abre a ficha depois já vê o baú liberado");
    await liberar(m, bau, false);
    await esperarAte(() => j.baus.at(-1).every((b) => b.id !== bau.id), { rotulo: "baú recolhido sumir" });
    // pegar de baú recolhido
    assert.equal((await pegar(j, bau.id, bau.itens[0].id, 1)).erro, "bau_indisponivel");
    await fecharTudo();
  });

  /* ---- pegar: validações e corrida ---- */
  it("ids forjados e quantidades inválidas são recusados sem alterar o baú", async () => {
    const m = await mestre();
    const item = await criarItem(m);
    const bau = await criarBau(m, [[item, 2]]);
    const fechado = await criarBau(m, [[item, 5]]);
    await liberar(m, bau);
    const j = await jogadorCru(ana);
    const linha = bau.itens[0].id;
    const casos = [
      [{ bauId: "nao_existe", linhaId: linha, quantidade: 1 }, "bau_indisponivel"],
      [{ bauId: bau.id, linhaId: "nao_existe", quantidade: 1 }, "bau_indisponivel"],
      [{ bauId: fechado.id, linhaId: fechado.itens[0].id, quantidade: 1 }, "bau_indisponivel"],
      [{ bauId: bau.id, linhaId: linha, quantidade: 3 }, "indisponivel"],
      [{ bauId: "../x", linhaId: linha, quantidade: 1 }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: "a b", quantidade: 1 }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: linha, quantidade: 0 }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: linha, quantidade: -1 }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: linha, quantidade: 1.5 }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: linha, quantidade: "1" }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: linha, quantidade: 1000 }, "formato_invalido"],
      [{ bauId: bau.id, linhaId: linha, quantidade: 1, pedidoId: "../p" }, "formato_invalido"],
      [null, "formato_invalido"], ["texto", "formato_invalido"],
    ];
    for (const [dados, erro] of casos) {
      const r = await pedir(j, "jogador_pegar_item", dados);
      assert.equal(r.erro, erro, JSON.stringify(dados));
    }
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 2);
    assert.equal((await lerBau(m, fechado.id)).itens[0].quantidade, 5);
    assert.equal(j.entregas.length, 0, "nenhuma entrega nasceu de um pedido inválido");
    await fecharTudo();
  });

  it("CORRIDA: dois jogadores no último item: só um leva; 20 pedidos de 1 num baú de 5 = 5", async () => {
    const m = await mestre();
    const item = await criarItem(m);
    const ultimo = await criarBau(m, [[item, 1]]);
    const cinco = await criarBau(m, [[item, 5]]);
    await liberar(m, ultimo);
    await liberar(m, cinco);
    const a = await jogadorCru(ana);
    const b = await jogadorCru(bia);
    const [ra, rb] = await Promise.all([pegar(a, ultimo.id, ultimo.itens[0].id, 1), pegar(b, ultimo.id, ultimo.itens[0].id, 1)]);
    assert.deepEqual([ra.ok, rb.ok].sort(), [false, true]);
    assert.equal([ra, rb].find((r) => !r.ok).erro, "indisponivel");
    assert.equal((await lerBau(m, ultimo.id)).itens[0].quantidade, 0);
    assert.equal(a.entregas.length + b.entregas.length, 1);

    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => pegar(i % 2 ? a : b, cinco.id, cinco.itens[0].id, 1)));
    assert.equal(rs.filter((r) => r.ok).length, 5);
    assert.ok(rs.filter((r) => !r.ok).every((r) => r.erro === "indisponivel"));
    assert.equal((await lerBau(m, cinco.id)).itens[0].quantidade, 0);
    await fecharTudo();
    // as reservas de quem desconectou voltam ao baú (testado com mais calma adiante)
  });

  it("reenviar o mesmo pedidoId (duplo clique) reserva uma vez só", async () => {
    await esperar(EXPIRA_MS + 1500); // deixa as reservas da corrida expirarem
    const m = await mestre();
    const item = await criarItem(m);
    const bau = await criarBau(m, [[item, 5]]);
    await liberar(m, bau);
    const j = await jogadorCru(ana);
    const dados = { bauId: bau.id, linhaId: bau.itens[0].id, quantidade: 2, pedidoId: "pedido_1" };
    const [r1, r2] = await Promise.all([pedir(j, "jogador_pegar_item", dados), pedir(j, "jogador_pegar_item", dados)]);
    const r3 = await pedir(j, "jogador_pegar_item", dados);
    assert.deepEqual([r1.ok, r2.ok, r3.ok], [true, true, true]);
    assert.equal(r1.dados.entregaId, r2.dados.entregaId);
    assert.equal(r1.dados.entregaId, r3.dados.entregaId);
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 3, "só 2 reservados, não 6");
    await esperar(200);
    assert.equal(j.entregas.length, 1, "uma entrega só");
    // outro pedido (id novo) é outra reserva
    assert.equal((await pedir(j, "jogador_pegar_item", { ...dados, pedidoId: "pedido_2", quantidade: 1 })).ok, true);
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 2);
    await fecharTudo();
  });

  /* ---- ponta a ponta com a ficha ---- */
  it("PEGAR de verdade: item entra na mochila (com recibo), baú diminui para todos, histórico registra", async () => {
    await esperar(EXPIRA_MS + 1500);
    const m = await mestre();
    const item = await criarItem(m, { name: "Poção de Cura", icon: "fa-flask", weight: 0.5, maxStack: 5 });
    const bau = await criarBau(m, [[item, 4]]);
    await liberar(m, bau);
    const fa = await abrir(ana);
    const fb = await abrir(bia);
    await esperarAte(() => fa.document.getElementById("bau-janela").textContent.includes("Poção de Cura"), { rotulo: "janela do baú aparecer" });
    assert.ok(!fa.document.getElementById("bau-janela").classList.contains("hidden"));
    const janelaB = () => fb.document.getElementById("bau-janela").textContent;
    assert.match(janelaB(), /× 4/);

    const linhaEl = fa.document.querySelector(`#bau-janela [data-linha-id="${bau.itens[0].id}"]`);
    linhaEl.querySelector("input").value = "3";
    linhaEl.querySelector('button[data-acao="pegar"]').dispatchEvent(new fa.window.MouseEvent("click", { bubbles: true }));
    await esperarAte(() => fa.run("STATE.backpackItems.filter((i) => i.id === " + JSON.stringify(item.id) + ").reduce((t, i) => t + i.quantity, 0)") === 3, { rotulo: "item na mochila" });
    assert.match(fa.document.getElementById("toast-container").textContent, /Você pegou: 3 × Poção de Cura/);
    await esperarAte(() => /× 1/.test(janelaB()), { rotulo: "outro jogador ver o baú diminuir" });

    // salvo no arquivo, com recibo; entrega marcada como entregue; histórico do baú
    await esperarAte(() => caixa(ana).some((e) => e.tipo === "itens" && e.status === "entregue"), { rotulo: "entrega entregue" });
    const inv = s.lerArquivo("ana", ana.pasta, "inventario");
    const salvos = inv.items.filter((i) => i.id === item.id);
    assert.equal(salvos.reduce((t, i) => t + i.quantity, 0), 3);
    assert.ok(salvos.every((i) => /^it_/.test(i.uid) && i.maxStack === 5));
    const entrega = caixa(ana).find((e) => e.tipo === "itens" && e.origem?.bauId === bau.id);
    assert.ok(inv.recebidas.includes(entrega.entregaId));
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 1);
    const hist = (await lerBau(m, bau.id)).historico;
    assert.deepEqual([hist[0].jogador, hist[0].item, hist[0].quantidade, hist[0].resultado], ["Ana", "Poção de Cura", 3, "pegou"]);

    // o item não pode ser aplicado duas vezes (mesma entrega repetida)
    const antes = fa.run("STATE.backpackItems.length + ':' + STATE.backpackItems.reduce((t, i) => t + i.quantity, 0)");
    fa.run(`aplicarEntrega(${JSON.stringify({ entregaId: entrega.entregaId, tipo: "itens", entrada: { ...entrega.entrada } })})`);
    assert.equal(fa.run("STATE.backpackItems.length + ':' + STATE.backpackItems.reduce((t, i) => t + i.quantity, 0)"), antes);
    assert.deepEqual(fa.erros, []);
    await fecharTudo();

    // reabrir a ficha: nada é reaplicado
    const fa2 = await abrir(ana);
    await esperar(500);
    assert.equal(fa2.run("STATE.backpackItems.filter((i) => i.id === " + JSON.stringify(item.id) + ").reduce((t, i) => t + i.quantity, 0)"), 3);
    await fecharTudo();
  });

  it("SEM ESPAÇO: a ficha recusa, o inventário não muda e o item volta ao baú", async () => {
    const m = await mestre();
    const grande = await criarItem(m, { name: "Estátua", w: 10, h: 10 });
    const bau = await criarBau(m, [[grande, 2]]);
    await liberar(m, bau);
    const f = await abrir(bia);
    await esperarAte(() => f.document.getElementById("bau-janela").textContent.includes("Estátua"), { rotulo: "baú na janela" });
    const antes = f.run("JSON.stringify(STATE.backpackItems)");
    const linhaEl = f.document.querySelector(`#bau-janela [data-linha-id="${bau.itens[0].id}"]`);
    linhaEl.querySelector('button[data-acao="pegar"]').dispatchEvent(new f.window.MouseEvent("click", { bubbles: true }));
    await esperarAte(() => /Sem espaço na mochila/.test(f.document.getElementById("toast-container").textContent), { rotulo: "aviso de falta de espaço" });
    await esperarAte(async () => (await lerBau(m, bau.id)).itens[0].quantidade === 2 && (await lerBau(m, bau.id)).historico.length === 1, { rotulo: "item voltar ao baú" });
    assert.equal(f.run("JSON.stringify(STATE.backpackItems)"), antes);
    const hist = (await lerBau(m, bau.id)).historico[0];
    assert.deepEqual([hist.jogador, hist.item, hist.resultado], ["Bia", "Estátua", "sem_espaco"]);
    const e = caixa(bia).find((x) => x.tipo === "itens" && x.origem?.bauId === bau.id);
    assert.equal(e.status, "cancelada");
    assert.equal(e.motivo, "sem_espaco");
    assert.ok(!s.lerArquivo("bia", bia.pasta, "inventario").recebidas.includes(e.entregaId));
    await fecharTudo();
  });

  it("tudo-ou-nada na ficha: se a quantidade inteira não cabe, pilhas existentes não são alteradas", async () => {
    const f = await abrir(caio); // personagem só deste teste: ele lota a mochila e salva
    // enche a mochila: todas as células ocupadas, sobrando só uma pilha com espaço
    const dim = f.run("JSON.stringify(configMochila())");
    const { cols, rows } = JSON.parse(dim);
    const celulas = cols * rows;
    f.run(`STATE.backpackItems.length = 0; for (let i = 0; i < ${celulas - 1}; i++) STATE.backpackItems.push({ uid: 'cx_fill' + i, id: 'fill' + i, name: 'F', type: 'x', weight: 0, w: 1, h: 1, maxStack: 1, quantity: 1, col: 1 + (i % ${cols}), row: 1 + Math.floor(i / ${cols}) });
      STATE.backpackItems.push({ uid: 'cx_pilha1', id: 'pilha', name: 'Pilha', type: 'x', weight: 0, w: 1, h: 1, maxStack: 3, quantity: 1, col: ${cols}, row: ${rows} });`);
    const antes = f.run("JSON.stringify(STATE.backpackItems)");
    const r = f.run("adicionarItemAoInventario({ id: 'pilha', name: 'Pilha', type: 'x', weight: 0, w: 1, h: 1, maxStack: 3 }, 5, { tudoOuNada: true, silencioso: true })");
    assert.deepEqual([r.adicionado, r.sobrou], [0, 5]);
    assert.equal(f.run("JSON.stringify(STATE.backpackItems)"), antes, "nada mudou");
    assert.ok(!/Sem espaço/.test(f.document.getElementById("toast-container").textContent), "silencioso: sem aviso");
    // cabendo: completa a pilha
    const ok = f.run("adicionarItemAoInventario({ id: 'pilha', name: 'Pilha', type: 'x', weight: 0, w: 1, h: 1, maxStack: 3 }, 2, { tudoOuNada: true, silencioso: true })");
    assert.equal(ok.adicionado, 2);
    assert.equal(f.run("STATE.backpackItems.find((i) => i.uid === 'cx_pilha1').quantity"), 3);
    await fecharTudo();
  });

  /* ---- desconexão, expiração e reinício ---- */
  it("DESCONEXÃO no meio: a reserva expira, o item volta ao baú e a entrega é cancelada (não é entregue depois)", async () => {
    await esperar(EXPIRA_MS + 1500);
    const m = await mestre();
    const item = await criarItem(m, { name: "Gema" });
    const bau = await criarBau(m, [[item, 3]]);
    await liberar(m, bau);
    const j = await jogadorCru(bia);
    assert.equal((await pegar(j, bau.id, bau.itens[0].id, 2)).ok, true);
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 1);
    j.close(); // some sem aplicar nada
    await esperar(300);
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 1, "ainda reservado dentro do prazo");
    await esperarAte(async () => (await lerBau(m, bau.id)).itens[0].quantidade === 3, { tempoMs: EXPIRA_MS + 6000, rotulo: "reserva expirar" });
    const e = caixa(bia).filter((x) => x.tipo === "itens" && x.origem?.bauId === bau.id).at(-1);
    assert.deepEqual([e.status, e.motivo], ["cancelada", "expirou"]);
    const hist = (await lerBau(m, bau.id)).historico.at(-1);
    assert.deepEqual([hist.item, hist.quantidade, hist.resultado], ["Gema", 2, "expirou"]);
    // abrir a ficha depois: não recebe nada
    const f = await abrir(bia);
    await esperar(500);
    assert.equal(f.run("STATE.backpackItems.filter((i) => i.id === " + JSON.stringify(item.id) + ").length"), 0);
    await fecharTudo();
  });

  it("volta a tempo: jogador cai mas reabre a ficha dentro do prazo e o item é entregue (sem duplicar no baú)", async () => {
    await esperar(EXPIRA_MS + 1500);
    const m = await mestre();
    const item = await criarItem(m, { name: "Anel" });
    const bau = await criarBau(m, [[item, 1]]);
    await liberar(m, bau);
    const j = await jogadorCru(ana);
    assert.equal((await pegar(j, bau.id, bau.itens[0].id, 1)).ok, true);
    j.close();
    await esperar(200);
    const f = await abrir(ana);
    await esperarAte(() => f.run("STATE.backpackItems.some((i) => i.id === " + JSON.stringify(item.id) + ")"), { rotulo: "item aplicado ao reabrir" });
    await esperarAte(async () => (await lerBau(m, bau.id)).historico.some((h) => h.item === "Anel" && h.resultado === "pegou"), { rotulo: "histórico pegou" });
    await esperar(EXPIRA_MS + 1500);
    assert.equal((await lerBau(m, bau.id)).itens[0].quantidade, 0, "não voltou ao baú");
    await fecharTudo();
  });

  it("REINÍCIO: baú liberado continua liberado; reserva pendente é reconstruída e expira devolvendo o item", async () => {
    await esperar(EXPIRA_MS + 1500);
    const m = await mestre();
    const item = await criarItem(m, { name: "Chave" });
    const bau = await criarBau(m, [[item, 2]]);
    await liberar(m, bau);
    const j = await jogadorCru(bia);
    assert.equal((await pegar(j, bau.id, bau.itens[0].id, 1)).ok, true);
    assert.equal(arquivoBaus(bau.id).itens[0].quantidade, 1, "a reserva já está no disco");
    await fecharTudo();
    await s.reiniciar();
    await relogar(ana);
    await relogar(bia);
    await relogar(caio);
    const m2 = await mestre();
    const depois = await lerBau(m2, bau.id);
    assert.equal(depois.liberado, true);
    assert.equal(depois.itens[0].quantidade, 1);
    await esperarAte(async () => (await lerBau(m2, bau.id)).itens[0].quantidade === 2, { tempoMs: EXPIRA_MS + 6000, rotulo: "reserva reconstruída expirar" });
    assert.equal((await lerBau(m2, bau.id)).historico.at(-1).resultado, "expirou");
    // quem abre a ficha depois do reinício vê o baú liberado
    const v = await jogadorCru(ana);
    assert.ok(v.baus.at(-1).some((b) => b.id === bau.id));
    await fecharTudo();
  });

  it("VAZAMENTO: o jogador nunca recebe baú não liberado, catálogo de itens nem dado do mestre", async () => {
    const m = await mestre();
    const item = await criarItem(m, { name: "Tesouro-ZZ7", desc: "SEGREDO-ZZ7" });
    const oculto = await criarBau(m, [[item, 1]], { nome: "Baú-oculto-ZZ7" });
    const j = await conectar(ana.token);
    const vistos = [];
    j.onAny((ev, ...a) => vistos.push([ev, a]));
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: ana.pasta }); });
    j.emit("entregas_pedir");
    await cmd(m, "master_campanha_salvar", { tipo: "itens", item: { ...item, name: "Tesouro-ZZ7-b" } });
    await cmd(m, "master_campanha_salvar", { tipo: "baus", item: { ...oculto, nome: "Baú-oculto-ZZ7-b" } });
    await esperar(400);
    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0);
    assert.ok(!tudo.includes("ZZ7"), "dado do mestre vazou para o jogador");
    assert.ok(!tudo.includes("campanha_atualizada"));
    j.close();
    await esperar(300);
  });

  it("auditoria: eventos novos no padrão certo; baús só por salas; jogador_pegar_item exige ficha aberta", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    assert.match(codigo, /comandos\.registrar\(\s*socket,\s*"master_bau_liberar"/);
    assert.ok(!/io\.emit\(\s*["']baus_estado/.test(codigo));
    assert.equal([...codigo.matchAll(/baus_estado/g)].every((m) => /io\.to\(SALA_BAUS\)|socket\.emit\(/.test(codigo.slice(Math.max(0, m.index - 80), m.index))), true);
    const bloco = codigo.slice(codigo.indexOf('ouvir("jogador_pegar_item"'), codigo.indexOf('ouvir("jogador_pegar_item"') + 900);
    assert.match(bloco, /socket\.data\.personagem/);
    assert.match(bloco, /recebeEntregas/);
    assert.ok(/reservarDoBau/.test(codigo) && /finalizarReserva/.test(codigo));
  });

  /* ---- página do mestre ---- */
  describe("página Loot (navegador)", () => {
    const abrirPagina = () => abrirPaginaMestre(s, "loot", { real: true, tokenInicial: SENHA });
    const clicar = (pg, el) => el.dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true }));
    const preencher = (pg, id, v) => {
      const el = pg.document.getElementById(id);
      if (el.type === "checkbox") el.checked = v; else el.value = v;
      el.dispatchEvent(new pg.window.Event("input", { bubbles: true }));
      el.dispatchEvent(new pg.window.Event("change", { bubbles: true }));
    };
    const cartoes = (pg, lista) => [...pg.document.querySelectorAll(`#${lista} [data-id]`)];
    const cartao = (pg, lista, nome) => cartoes(pg, lista).find((c) => c.querySelector("h4").textContent === nome);

    it("itens: criar, filtrar por tipo, buscar, duplicar, excluir com confirmação; texto nunca vira HTML", async () => {
      const pg = await abrirPagina();
      try {
        await esperarAte(() => pg.run("loot.carregou"), { rotulo: "página carregar" });
        const nomeXss = "Espada <img src=x onerror=alert(1)>";
        clicar(pg, pg.document.getElementById("loot-novo-item"));
        preencher(pg, "li-name", "Dardo");
        preencher(pg, "li-dice", "1d6; apagar");
        clicar(pg, pg.document.getElementById("li-salvar"));
        assert.match(pg.document.getElementById("toast-container").textContent, /Dado inválido/);
        preencher(pg, "li-dice", "1d6");
        preencher(pg, "li-type", "Arma");
        preencher(pg, "li-weight", "0.5");
        preencher(pg, "li-maxStack", "20");
        clicar(pg, pg.document.getElementById("li-salvar"));
        await esperarAte(() => cartao(pg, "loot-lista-itens", "Dardo"), { rotulo: "cartão Dardo" });
        assert.match(cartao(pg, "loot-lista-itens", "Dardo").textContent, /0\.5 kg · 1×1 · pilha 20 · 1d6/);

        clicar(pg, pg.document.getElementById("loot-novo-item"));
        preencher(pg, "li-name", nomeXss);
        preencher(pg, "li-type", "Mágico");
        clicar(pg, pg.document.getElementById("li-salvar"));
        await esperarAte(() => cartao(pg, "loot-lista-itens", nomeXss), { rotulo: "cartão XSS" });
        assert.equal(pg.document.querySelectorAll("#loot-lista-itens img").length, 0);

        // filtro por tipo e busca (sem acento)
        const filtro = pg.document.getElementById("loot-filtro-tipo");
        assert.ok([...filtro.options].some((o) => o.value === "Arma") && [...filtro.options].some((o) => o.value === "Mágico"));
        preencher(pg, "loot-filtro-tipo", "Arma");
        assert.ok(cartoes(pg, "loot-lista-itens").every((c) => /Arma/.test(c.textContent)));
        assert.ok(!cartao(pg, "loot-lista-itens", nomeXss));
        preencher(pg, "loot-filtro-tipo", "");
        preencher(pg, "loot-busca-item", "MÁGICO");
        assert.deepEqual(cartoes(pg, "loot-lista-itens").map((c) => c.querySelector("h4").textContent), [nomeXss]);
        preencher(pg, "loot-busca-item", "");

        // duplicar e excluir
        clicar(pg, cartao(pg, "loot-lista-itens", "Dardo").querySelector('[data-acao="duplicar"]'));
        await esperarAte(() => cartao(pg, "loot-lista-itens", "Dardo (cópia)"), { rotulo: "cópia" });
        const excluir = () => cartao(pg, "loot-lista-itens", "Dardo (cópia)").querySelector('[data-acao="excluir"]');
        clicar(pg, excluir());
        assert.equal(excluir().textContent, "Confirmar?");
        clicar(pg, excluir());
        await esperarAte(() => !cartao(pg, "loot-lista-itens", "Dardo (cópia)"), { rotulo: "cópia excluída" });
      } finally { pg.fechar(); }
    });

    it("baús: montar com itens do catálogo, salvar, liberar/recolher em 1 clique, ver histórico; liberado não edita", async () => {
      const pg = await abrirPagina();
      const outra = await abrirPagina();
      try {
        await esperarAte(() => pg.run("loot.carregou") && outra.run("loot.carregou"), { rotulo: "páginas carregarem" });
        for (const p of [pg, outra]) clicar(p, p.document.getElementById("loot-aba-baus"));
        assert.ok(!pg.document.getElementById("loot-baus").classList.contains("hidden"));
        assert.ok(pg.document.getElementById("loot-itens").classList.contains("hidden"));

        clicar(pg, pg.document.getElementById("loot-novo-bau"));
        clicar(pg, pg.document.getElementById("lb-salvar"));
        assert.match(pg.document.getElementById("toast-container").textContent, /Dê um nome ao baú/);
        preencher(pg, "lb-nome", "Baú do Dragão <b>");
        const seletor = pg.document.getElementById("lb-item");
        const dardo = [...seletor.options].find((o) => /^Dardo/.test(o.textContent));
        assert.ok(dardo, "o catálogo aparece no seletor");
        seletor.value = dardo.value;
        preencher(pg, "lb-qtd", "7");
        clicar(pg, pg.document.getElementById("lb-add"));
        assert.equal(pg.document.querySelectorAll("#lb-linhas > div").length, 1);
        clicar(pg, pg.document.getElementById("lb-salvar"));
        await esperarAte(() => cartao(pg, "loot-lista-baus", "Baú do Dragão <b>"), { rotulo: "baú salvo" });
        await esperarAte(() => cartao(outra, "loot-lista-baus", "Baú do Dragão <b>"), { rotulo: "baú na outra página (tempo real)" });
        const c = () => cartao(pg, "loot-lista-baus", "Baú do Dragão <b>");
        assert.equal(c().querySelector("[data-estado]").dataset.estado, "preparado");
        assert.match(c().textContent, /7 × Dardo/);
        assert.equal(pg.document.querySelectorAll("#loot-lista-baus b").length, 0);

        // liberar com 1 clique
        clicar(pg, c().querySelector('[data-acao="liberar"]'));
        await esperarAte(() => c().querySelector("[data-estado]").dataset.estado === "liberado", { rotulo: "baú liberado" });
        assert.equal(c().querySelector('[data-acao="liberar"]').textContent, "Recolher");
        // liberado não edita
        clicar(pg, c().querySelector('[data-acao="editar"]'));
        assert.match(pg.document.getElementById("toast-container").textContent, /Recolha o baú antes de editar/);
        assert.ok(pg.document.getElementById("loot-editor-bau").classList.contains("hidden"));

        // um jogador pega e o histórico aparece no cartão
        const bauId = c().dataset.id;
        const j = await jogadorCru(ana);
        const linha = (await lerBau(await mestre(), bauId)).itens[0].id;
        assert.equal((await pegar(j, bauId, linha, 2)).ok, true);
        await esperarAte(() => /5 × Dardo/.test(c().textContent), { rotulo: "quantidade diminuir na página" });
        j.close();
        await esperarAte(() => c().querySelector("[data-historico]")?.textContent.includes("expirou): 2 × Dardo"), { tempoMs: EXPIRA_MS + 6000, rotulo: "histórico expirou" });
        assert.match(c().textContent, /7 × Dardo/);

        // recolher, duplicar, excluir
        clicar(pg, c().querySelector('[data-acao="liberar"]'));
        await esperarAte(() => c().querySelector("[data-estado]").dataset.estado === "preparado", { rotulo: "baú recolhido" });
        clicar(pg, c().querySelector('[data-acao="duplicar"]'));
        await esperarAte(() => cartao(pg, "loot-lista-baus", "Baú do Dragão <b> (cópia)"), { rotulo: "baú duplicado" });
        assert.equal(cartao(pg, "loot-lista-baus", "Baú do Dragão <b> (cópia)").querySelector("[data-estado]").dataset.estado, "preparado");
        const excluir = () => cartao(pg, "loot-lista-baus", "Baú do Dragão <b> (cópia)").querySelector('[data-acao="excluir"]');
        clicar(pg, excluir());
        clicar(pg, excluir());
        await esperarAte(() => !cartao(pg, "loot-lista-baus", "Baú do Dragão <b> (cópia)"), { rotulo: "cópia excluída" });
      } finally { pg.fechar(); outra.fechar(); await fecharTudo(); }
    });

    it("com token errado a página não carrega nada", async () => {
      const pg = await abrirPaginaMestre(s, "loot", { real: true, tokenInicial: "errado" });
      try {
        await esperarAte(() => pg.run("socket.connected"), { rotulo: "conectar" });
        await esperar(400);
        assert.equal(pg.run("loot.carregou"), false);
      } finally { pg.fechar(); }
    });
  });
});

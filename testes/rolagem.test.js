/* Sprint 6 (Fase 2): rolagem do mestre no servidor, aplicar dano com multiplicador por alvo e desfazer. */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const regras = require("../JS/regras.js");
const { rolar, criarHistoricoDeRolagens } = require("../rolagem.js");
const { criarDano } = require("../dano.js");
const { criarCampanha } = require("../campanha.js");
const regrasDaBatalha = require("../batalha.js");
const { iniciarServidor, abrirFicha, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-rol-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/* ------------------------------ unitários ------------------------------ */
describe("Fórmulas e conta do dano (compartilhadas)", () => {
  it("lerFormulaCombo: válidas, inválidas e limites (999 dados, 1000 lados, bônus ±100000)", () => {
    const ok = {
      "d20": { tipo: "dados", qtd: 1, lados: 20, bonus: 0 }, "2d6": { qtd: 2, lados: 6, bonus: 0 }, " 3D12 - 2 ": { qtd: 3, lados: 12, bonus: -2 },
      "2d6+3": { qtd: 2, lados: 6, bonus: 3 }, "999d1000": { qtd: 999, lados: 1000 }, "+5": { tipo: "bonus", bonus: 5 }, "- 3": { tipo: "bonus", bonus: -3 }, "+100000": { bonus: 100000 },
    };
    for (const [f, esperado] of Object.entries(ok)) {
      const r = regras.lerFormulaCombo(f);
      assert.ok(r, f);
      for (const [k, v] of Object.entries(esperado)) assert.equal(r[k], v, `${f}.${k}`);
    }
    for (const f of ["", "   ", "abc", "d", "0d6", "1d0", "1000d6", "1d1001", "2d6+", "2d6+x", "5", "++5", "1d6;rm", "d20 + d6", "+100001", "2d6+100001", "-100001", null, undefined, 5, "1e3", "１d6"]) {
      assert.equal(regras.lerFormulaCombo(f), null, String(f));
    }
  });

  it("calcularDano: multiplicadores não negativos, decimais e arredondamento para baixo", () => {
    const casos = [[7, 1, 7], [7, 0.5, 3], [7, 2, 14], [1, 0.5, 0], [0, 2, 0], [9, 0.5, 4], [8, 0.5, 4], [-4, 1, 0], [-4, 2, 0], [100000, 2, 200000], [20, 3, 60], [7, 1.5, 10], [20, 0, 0], [20, 0.3, 6]];
    for (const [t, m, esperado] of casos) assert.equal(regras.calcularDano(t, m), esperado, `${t} × ${m}`);
    for (const m of [-1, "1", null, undefined, NaN, Infinity]) assert.equal(regras.calcularDano(5, m), null, String(m));
    for (const t of ["x", NaN, Infinity, undefined]) assert.equal(regras.calcularDano(t, 1), null, String(t));
    assert.deepEqual(regras.MULTIPLICADORES_DANO, [0.5, 1, 2]);
  });
});

describe("Rolagem no servidor (rolagem.js)", () => {
  it("rola com os dados detalhados, soma bônus e componentes (aleatório injetado)", () => {
    const seq = [3, 5, 2];
    const r = rolar([{ nome: "Espada", formula: "2d6+3" }, { formula: "+2" }, { nome: "Fogo", formula: "d8-1" }], () => seq.shift());
    assert.deepEqual(r.componentes[0], { nome: "Espada", formula: "2d6+3", dados: [3, 5], bonus: 3, soma: 11 });
    assert.deepEqual(r.componentes[1], { nome: "", formula: "+2", dados: [], bonus: 2, soma: 2 });
    assert.deepEqual(r.componentes[2], { nome: "Fogo", formula: "d8-1", dados: [2], bonus: -1, soma: 1 });
    assert.equal(r.total, 14);
  });

  it("valida tudo ANTES de rolar: um componente ruim cancela a rolagem inteira (nenhum dado é sorteado)", () => {
    let sorteios = 0;
    const conta = () => { sorteios++; return 1; };
    for (const comps of [[{ formula: "2d6" }, { formula: "xx" }], [], null, "x", [{ formula: "d20" }, null], Array.from({ length: 11 }, () => ({ formula: "d6" })), [{ formula: "a".repeat(40) }], [{ formula: "600d6" }, { formula: "600d6" }]]) {
      assert.throws(() => rolar(comps, conta), { negocio: true }, JSON.stringify(comps)?.slice(0, 60));
    }
    assert.equal(sorteios, 0);
  });

  it("aleatório de verdade: 3d6 sempre entre 3 e 18 e todas as faces aparecem em 3000 dados", () => {
    const faces = new Set();
    for (let i = 0; i < 1000; i++) {
      const r = rolar([{ formula: "3d6" }]);
      assert.ok(r.total >= 3 && r.total <= 18);
      r.componentes[0].dados.forEach((d) => { assert.ok(Number.isInteger(d) && d >= 1 && d <= 6); faces.add(d); });
    }
    assert.equal(faces.size, 6);
    assert.ok(rolar([{ formula: "1d1" }]).total === 1);
  });

  it("histórico guarda as últimas 100 por id", () => {
    const h = criarHistoricoDeRolagens(3);
    const ids = [1, 2, 3, 4].map((n) => h.guardar({ total: n, componentes: [] }).rolagemId);
    assert.equal(h.obter(ids[0]), null);
    assert.equal(h.obter(ids[3]).total, 4);
    assert.equal(h.obter("nao_existe"), null);
  });
});

describe("Aplicar dano e desfazer (dano.js)", () => {
  const preparar = async () => {
    const c = criarCampanha(novaPasta(), { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    const npc = await c.salvarItem("npcs", { nome: "Ana NPC", hp: { atual: 20, max: 20 } });
    const modelo = await c.salvarItem("inimigos", { nome: "Orc", hpMax: 20 });
    await c.atualizar("batalha", (b) => regrasDaBatalha.adicionar(b, modelo, 1));
    const orc = c.ler("batalha").combatentes[0];
    const jogadores = { hp: { atual: 20, max: 20 }, presente: true, chamadas: [] };
    const d = criarDano({
      campanha: c,
      jogadores: {
        resolver: (id) => (id === "jog_x" && jogadores.presente ? { charId: "c1", nome: "Herói", hp: { ...jogadores.hp } } : null),
        ajustar: (charId, delta) => { const antes = jogadores.hp.atual; jogadores.hp.atual = Math.max(0, Math.min(jogadores.hp.max, antes + delta)); jogadores.chamadas.push(delta); return { antes, depois: jogadores.hp.atual }; },
      },
    });
    return { c, d, npc, orc, jogadores };
  };

  it("×1, ×½ e ×2 com número ímpar em jogador, NPC e inimigo; resultado antes → depois", async () => {
    const { d, npc, orc } = await preparar();
    const r = await d.aplicar({ total: 7, alvos: [{ alvoId: "jog_x", mult: 1 }, { alvoId: npc.id, mult: 0.5 }, { alvoId: orc.alvoId, mult: 2 }] });
    assert.deepEqual(r.resultados.map((x) => [x.tipo, x.mult, x.dano, x.antes, x.depois, x.derrotado]), [["jogador", 1, 7, 20, 13, false], ["npc", 0.5, 3, 20, 17, false], ["inimigo", 2, 14, 20, 6, false]]);
    assert.match(r.aplicacaoId, /^apl_/);
  });

  it("HP nunca passa de 0 (derrotado), ×½ de 1 = 0 não muda o alvo, alvo ausente é relatado sem dano", async () => {
    const { c, d, npc, orc, jogadores } = await preparar();
    const r = await d.aplicar({ total: 1000, alvos: [{ alvoId: orc.alvoId, mult: 1 }, { alvoId: npc.id, mult: 2 }] });
    assert.deepEqual(r.resultados.map((x) => [x.depois, x.derrotado]), [[0, true], [0, true]]);
    assert.equal(c.ler("batalha").combatentes[0].derrotado, true);
    const r2 = await d.aplicar({ total: 1, alvos: [{ alvoId: "jog_x", mult: 0.5 }] });
    assert.deepEqual([r2.resultados[0].dano, r2.resultados[0].antes, r2.resultados[0].depois], [0, 20, 20]);
    assert.deepEqual(jogadores.chamadas, [], "dano 0 não toca no jogador");
    jogadores.presente = false;
    await c.removerItem("npcs", npc.id);
    const r3 = await d.aplicar({ total: 5, alvos: [{ alvoId: "jog_x", mult: 1 }, { alvoId: npc.id, mult: 1 }, { alvoId: "nao_existe", mult: 1 }] });
    assert.ok(r3.resultados.every((x) => x.ok === false && x.motivo === "ausente"));
    assert.deepEqual(jogadores.chamadas, []);
  });

  it("recusa alvos e multiplicadores inválidos antes de aplicar qualquer coisa", async () => {
    const { d, npc, c } = await preparar();
    const antes = JSON.stringify(c.ler("npcs"));
    const casos = [
      [{ total: 5, alvos: [] }, "alvos_invalidos"], [{ total: 5, alvos: "x" }, "alvos_invalidos"], [{ total: 5, alvos: [null] }, "alvos_invalidos"],
      [{ total: 5, alvos: [{ alvoId: "../x", mult: 1 }] }, "alvos_invalidos"], [{ total: 5, alvos: Array.from({ length: 101 }, (_, i) => ({ alvoId: `a${i}`, mult: 1 })) }, "alvos_invalidos"],
      [{ total: 5, alvos: [{ alvoId: npc.id, mult: -1 }] }, "multiplicador_invalido"], [{ total: 5, alvos: [{ alvoId: npc.id, mult: "1" }] }, "multiplicador_invalido"],
      [{ total: 5, alvos: [{ alvoId: npc.id, mult: 1 }, { alvoId: npc.id, mult: 2 }] }, "alvo_repetido"],
      [{ total: 5.5, alvos: [{ alvoId: npc.id, mult: 1 }] }, "formato_invalido"], [{ total: "5", alvos: [{ alvoId: npc.id, mult: 1 }] }, "formato_invalido"],
      [{ total: 5, alvos: [{ alvoId: npc.id, mult: 1 }, { alvoId: npc.id + "x", mult: -5 }] }, "multiplicador_invalido"],
    ];
    for (const [dados, codigo] of casos) await assert.rejects(() => d.aplicar(dados), { codigo }, JSON.stringify(dados).slice(0, 80));
    assert.equal(JSON.stringify(c.ler("npcs")), antes);
  });

  it("desfazer: só a última, só uma vez, só restaura quem ainda está com o HP do dano", async () => {
    const { c, d, npc, orc, jogadores } = await preparar();
    const a1 = await d.aplicar({ total: 4, alvos: [{ alvoId: npc.id, mult: 1 }] });
    const a2 = await d.aplicar({ total: 6, alvos: [{ alvoId: npc.id, mult: 1 }, { alvoId: orc.alvoId, mult: 1 }, { alvoId: "jog_x", mult: 1 }] });
    await assert.rejects(() => d.desfazer(a1.aplicacaoId), { codigo: "nao_e_a_ultima" });
    await assert.rejects(() => d.desfazer("apl_nao_existe"), { codigo: "nao_e_a_ultima" });
    // o orc é curado fora do dano (HP mudou) e o jogador sai: só o NPC volta
    await c.atualizar("batalha", (b) => regrasDaBatalha.ajustarHp(b, orc.alvoId, { delta: 3 }));
    jogadores.presente = false;
    const u = await d.desfazer(a2.aplicacaoId);
    assert.deepEqual(u.restaurados.map((x) => [x.ok, x.motivo ?? null]), [[true, null], [false, "hp_mudou"], [false, "ausente"]]);
    assert.equal(c.ler("npcs")[0].hp.atual, 16, "NPC voltou ao que era antes da 2ª aplicação (20-4)");
    assert.equal(c.ler("batalha").combatentes[0].hp.atual, 17, "o orc ficou como estava (curado)");
    await assert.rejects(() => d.desfazer(a2.aplicacaoId), { codigo: "ja_desfeita" });
  });

  it("aplicações simultâneas são serializadas: 20 de dano 1 no mesmo alvo = 20", async () => {
    const { c, d, orc } = await preparar();
    await Promise.all(Array.from({ length: 20 }, () => d.aplicar({ total: 1, alvos: [{ alvoId: orc.alvoId, mult: 1 }] })));
    assert.equal(c.ler("batalha").combatentes[0].hp.atual, 0);
  });
});

/* ------------------------------ integração ------------------------------ */
describe("Rolagem e dano com o servidor real", { concurrency: false }, () => {
  let s, ana, bia;
  const abertos = [];
  const paginas = [];
  const fichas = [];
  let contador = 0;

  const criarJogador = async (conta, nome) => {
    const token = (await s.api("/api/login", { nome: conta, senha: "x", criarSeNaoExistir: true })).token;
    const pasta = (await s.api("/api/personagens", { nome }, token)).personagem.nomePasta;
    return { conta, nome, token, pasta };
  };
  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_r${++contador}`, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  const statusArquivo = (j, hp) => fs.writeFileSync(path.join(s.dir, "players", j.conta, j.pasta, "status.json"), JSON.stringify({ schemaVersion: 1, hp: { current: hp, max: hp }, vigor: { current: 0, max: 0 }, sanity: { current: 0, max: 0 } }));
  const abrir = async (j, hp = 20) => {
    statusArquivo(j, hp);
    const f = await abrirFicha(s, { player: j.conta, nomePasta: j.pasta, token: j.token });
    fichas.push(f);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
    return f;
  };
  const alvos = async (m) => (await cmd(m, "master_listar_alvos")).dados.alvos;
  const jogadorAlvo = async (m, j) => (await esperarAte(async () => (await alvos(m)).find((a) => a.tipo === "jogador" && a.nomePasta === j.pasta), { rotulo: `${j.nome} na lista de alvos` }));
  const criarNpc = async (m, nome, hp = 20) => (await cmd(m, "master_campanha_salvar", { tipo: "npcs", item: { nome, hp: { atual: hp, max: hp } } })).dados;
  const criarInimigoEmBatalha = async (m, nome, hp = 20) => {
    const modelo = (await cmd(m, "master_campanha_salvar", { tipo: "inimigos", item: { nome, hpMax: hp } })).dados;
    return (await cmd(m, "master_batalha_adicionar", { modeloId: modelo.id, quantidade: 1 })).dados.adicionados[0];
  };
  const hpDoNpc = async (m, id) => (await pedir(m, "master_campanha_ler", { token: SENHA, tipo: "npcs" })).dados.find((n) => n.id === id).hp.atual;
  const hpDoInimigo = async (m, id) => (await pedir(m, "master_campanha_ler", { token: SENHA, tipo: "batalha" })).dados.combatentes.find((c) => c.alvoId === id).hp.atual;

  afterEach(async () => {
    paginas.splice(0).forEach((p) => p.fechar());
    fichas.splice(0).forEach((f) => f.fechar());
    abertos.splice(0).forEach((k) => k.close());
    await esperar(250);
  });
  before(async () => {
    s = await iniciarServidor();
    ana = await criarJogador("ana", "Ana");
    bia = await criarJogador("bia", "Bia");
  });
  after(async () => { await s?.parar(); });

  it("jogador e anônimo são recusados em rolar, aplicar e desfazer (tokens forjados); nada muda", async () => {
    const m = await mestre();
    const npc = await criarNpc(m, "Intocável");
    for (const sock of [await conectar(ana.token), await conectar()]) {
      for (const [evento, dados] of [
        ["master_rolar", { componentes: [{ formula: "d20" }] }],
        ["master_aplicar_dano", { valor: 5, alvos: [{ alvoId: npc.id, mult: 1 }] }],
        ["master_desfazer_dano", { aplicacaoId: "apl_x" }],
      ]) {
        for (const token of [undefined, "", "errado", ana.token]) {
          const r = await pedir(sock, evento, { ...dados, token, acaoId: "acao_forja" });
          assert.equal(r.erro, "nao_autorizado", `${evento} ${token}`);
          assert.equal(r.dados, undefined);
        }
      }
    }
    assert.equal(await hpDoNpc(m, npc.id), 20);
  });

  it("master_rolar: resultado detalhado, validações, mesmo acaoId = mesma rolagem", async () => {
    const m = await mestre();
    const r = await cmd(m, "master_rolar", { componentes: [{ nome: "Espada", formula: "2d6+3" }, { formula: "+2" }] });
    assert.equal(r.ok, true);
    assert.match(r.dados.rolagemId, /^rol_/);
    const [c1, c2] = r.dados.componentes;
    assert.equal(c1.dados.length, 2);
    assert.ok(c1.dados.every((d) => d >= 1 && d <= 6));
    assert.equal(c1.soma, c1.dados[0] + c1.dados[1] + 3);
    assert.equal(r.dados.total, c1.soma + c2.soma);
    assert.equal(c2.soma, 2);
    // reenvio (duplo clique): a MESMA rolagem, não uma nova
    const pedido = { token: SENHA, acaoId: "acao_rol_fixa", componentes: [{ formula: "10d100" }] };
    const [a, b] = await Promise.all([pedir(m, "master_rolar", pedido), pedir(m, "master_rolar", pedido)]);
    assert.deepEqual(a.dados, b.dados);
    assert.deepEqual((await pedir(m, "master_rolar", pedido)).dados, a.dados);
    // inválidas
    for (const [comps, codigo] of [[[{ formula: "xx" }], "formula_invalida"], [[{ formula: "2d6" }, { formula: "1000d6" }], "formula_invalida"], [[], "formato_invalido"], [null, "formato_invalido"], [Array.from({ length: 11 }, () => ({ formula: "d6" })), "formato_invalido"], [[{ formula: "600d6" }, { formula: "600d6" }], "dados_demais"], [[{ formula: "+999999" }], "formula_invalida"]]) {
      assert.equal((await cmd(m, "master_rolar", { componentes: comps })).erro, codigo, JSON.stringify(comps).slice(0, 50));
    }
  });

  it("dano em NPC, inimigo e jogador com ×1, ×½ e ×2 (valor ímpar); ficha, card e disco ficam iguais", async () => {
    const m = await mestre();
    const f = await abrir(ana, 20);
    const jog = await jogadorAlvo(m, ana);
    const cards = [];
    m.on("player_updated", (c) => cards.push(c));
    const npc = await criarNpc(m, "Alvo NPC", 20);
    const orc = await criarInimigoEmBatalha(m, "Alvo Orc", 20);
    const r = await cmd(m, "master_aplicar_dano", { valor: 7, alvos: [{ alvoId: jog.alvoId, mult: 1 }, { alvoId: npc.id, mult: 0.5 }, { alvoId: orc.alvoId, mult: 2 }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.dados.resultados.map((x) => [x.nome, x.mult, x.dano, x.antes, x.depois]), [["Ana", 1, 7, 20, 13], ["Alvo NPC", 0.5, 3, 20, 17], ["Alvo Orc 1", 2, 14, 20, 6]]);
    assert.equal(await hpDoNpc(m, npc.id), 17);
    assert.equal(await hpDoInimigo(m, orc.alvoId), 6);
    // jogador: ficha (memória), disco e card do mestre contam a mesma história
    await esperarAte(() => f.run("STATE.vitals.hp.current") === 13, { rotulo: "ficha receber o dano" });
    assert.equal(s.lerArquivo("ana", ana.pasta, "status").hp.current, 13);
    await esperarAte(() => cards.some((c) => c.vitals.hp.current === 13), { rotulo: "card do mestre atualizar" });
    assert.equal((await alvos(m)).find((a) => a.alvoId === jog.alvoId).hp.atual, 13);
    assert.deepEqual(f.erros, []);
  });

  it("o total vem do servidor: atacar com `rolagemId` usa o total daquela rolagem (o cliente não escolhe o número)", async () => {
    const m = await mestre();
    const npc = await criarNpc(m, "Alvo Rolagem", 20000);
    const rol = (await cmd(m, "master_rolar", { componentes: [{ formula: "3d20+50" }] })).dados;
    const r = await cmd(m, "master_aplicar_dano", { rolagemId: rol.rolagemId, alvos: [{ alvoId: npc.id, mult: 0.5 }] });
    assert.equal(r.dados.total, rol.total);
    assert.equal(r.dados.resultados[0].dano, Math.floor(rol.total / 2));
    assert.equal(await hpDoNpc(m, npc.id), 20000 - Math.floor(rol.total / 2));
    assert.equal((await cmd(m, "master_aplicar_dano", { rolagemId: "rol_nao_existe", alvos: [{ alvoId: npc.id, mult: 1 }] })).erro, "rolagem_inexistente");
    assert.equal((await cmd(m, "master_aplicar_dano", { rolagemId: "../x", alvos: [{ alvoId: npc.id, mult: 1 }] })).erro, "rolagem_inexistente");
  });

  it("pedidos inválidos de dano: nada é aplicado", async () => {
    const m = await mestre();
    const npc = await criarNpc(m, "Intacto");
    const erro = async (dados) => (await cmd(m, "master_aplicar_dano", dados)).erro;
    const a = [{ alvoId: npc.id, mult: 1 }];
    assert.equal(await erro({ alvos: a }), "formato_invalido");
    assert.equal(await erro({ valor: 5, rolagemId: "rol_x", alvos: a }), "formato_invalido");
    for (const v of [-1, 1.5, "5", null, 1e9, NaN]) assert.equal(await erro({ valor: v, alvos: a }), "formato_invalido", String(v));
    for (const m_ of ["2", null, -1]) assert.equal(await erro({ valor: 5, alvos: [{ alvoId: npc.id, mult: m_ }] }), "multiplicador_invalido", String(m_));
    assert.equal(await erro({ valor: 5, alvos: [] }), "alvos_invalidos");
    assert.equal(await erro({ valor: 5, alvos: [{ alvoId: "../x", mult: 1 }] }), "alvos_invalidos");
    assert.equal(await erro({ valor: 5, alvos: [{ alvoId: npc.id, mult: 1 }, { alvoId: npc.id, mult: 2 }] }), "alvo_repetido");
    assert.equal((await pedir(m, "master_aplicar_dano", { token: SENHA, valor: 5, alvos: a })).erro, "acao_id_obrigatorio");
    assert.equal(await hpDoNpc(m, npc.id), 20);
  });

  it("jogador que saiu (ficha fechada) é relatado como ausente e não recebe dano; os outros alvos recebem", async () => {
    const m = await mestre();
    const f = await abrir(bia, 20);
    const jog = await jogadorAlvo(m, bia);
    f.fechar();
    await esperarAte(async () => !(await alvos(m)).some((a) => a.alvoId === jog.alvoId), { rotulo: "jogador sair" });
    const npc = await criarNpc(m, "Presente");
    const r = await cmd(m, "master_aplicar_dano", { valor: 5, alvos: [{ alvoId: jog.alvoId, mult: 1 }, { alvoId: npc.id, mult: 1 }, { alvoId: "alvo_fantasma", mult: 1 }] });
    assert.deepEqual(r.dados.resultados.map((x) => [x.ok, x.motivo ?? null]), [[false, "ausente"], [true, null], [false, "ausente"]]);
    assert.equal(await hpDoNpc(m, npc.id), 15);
    assert.equal(s.lerArquivo("bia", bia.pasta, "status").hp.current, 20, "o disco do jogador ausente não mudou");
  });

  it("duplo clique (mesmo acaoId, ao mesmo tempo ou depois) aplica o dano uma vez só", async () => {
    const m = await mestre();
    const npc = await criarNpc(m, "Duplo", 50);
    const pedido = { token: SENHA, valor: 10, alvos: [{ alvoId: npc.id, mult: 1 }], acaoId: "acao_dano_dupla" };
    const rs = await Promise.all([pedir(m, "master_aplicar_dano", pedido), pedir(m, "master_aplicar_dano", pedido), pedir(m, "master_aplicar_dano", pedido)]);
    const depois = await pedir(m, "master_aplicar_dano", pedido);
    assert.ok([...rs, depois].every((r) => r.ok && r.dados.aplicacaoId === rs[0].dados.aplicacaoId));
    assert.equal(await hpDoNpc(m, npc.id), 40);
  });

  it("DESFAZER: restaura jogador (ficha, disco e card), NPC e inimigo; só a última; só uma vez; quem mudou de HP não é tocado", async () => {
    const m = await mestre();
    const f = await abrir(ana, 20);
    const jog = await jogadorAlvo(m, ana);
    const npc = await criarNpc(m, "Desfaz NPC");
    const orc = await criarInimigoEmBatalha(m, "Desfaz Orc");
    const antiga = (await cmd(m, "master_aplicar_dano", { valor: 1, alvos: [{ alvoId: npc.id, mult: 1 }] })).dados;
    const a = (await cmd(m, "master_aplicar_dano", { valor: 8, alvos: [{ alvoId: jog.alvoId, mult: 1 }, { alvoId: npc.id, mult: 0.5 }, { alvoId: orc.alvoId, mult: 1 }] })).dados;
    assert.equal((await cmd(m, "master_desfazer_dano", { aplicacaoId: antiga.aplicacaoId })).erro, "nao_e_a_ultima");
    await esperarAte(() => f.run("STATE.vitals.hp.current") === 12, { rotulo: "ficha com dano" });
    // o inimigo é curado depois do dano: não deve ser mexido
    await cmd(m, "master_batalha_hp", { alvoId: orc.alvoId, delta: 5 });
    const u = await cmd(m, "master_desfazer_dano", { aplicacaoId: a.aplicacaoId });
    assert.equal(u.ok, true, JSON.stringify(u));
    assert.deepEqual(u.dados.restaurados.map((x) => [x.nome, x.ok, x.motivo ?? null]), [["Ana", true, null], ["Desfaz NPC", true, null], ["Desfaz Orc 1", false, "hp_mudou"]]);
    await esperarAte(() => f.run("STATE.vitals.hp.current") === 20, { rotulo: "ficha restaurada" });
    assert.equal(s.lerArquivo("ana", ana.pasta, "status").hp.current, 20);
    assert.equal((await alvos(m)).find((x) => x.alvoId === jog.alvoId).hp.atual, 20);
    assert.equal(await hpDoNpc(m, npc.id), 19, "NPC voltou ao estado de antes da 2ª aplicação (20-1)");
    assert.equal(await hpDoInimigo(m, orc.alvoId), 17, "inimigo curado fica como está (12 + 5)");
    assert.equal((await cmd(m, "master_desfazer_dano", { aplicacaoId: a.aplicacaoId })).erro, "ja_desfeita");
    assert.equal((await cmd(m, "master_desfazer_dano", { aplicacaoId: "../x" })).erro, "id_invalido");
  });

  it("mesmo cálculo no cliente e no servidor: a ficha e a página usam o leitor e a conta compartilhados", async () => {
    const f = await abrir(ana, 10);
    const pg = await abrirPaginaMestre(s, "rolagem");
    paginas.push(pg);
    const formulas = ["d20", "2d6+3", "3D12 - 2", "+5", "-3", "1000d6", "2d6+", "abc", "+100001", "999d1000"];
    for (const fo of formulas) {
      const servidor = JSON.stringify(regras.lerFormulaCombo(fo));
      assert.equal(JSON.stringify(f.run(`lerFormulaCombo(${JSON.stringify(fo)})`)), servidor, `ficha ${fo}`);
      assert.equal(JSON.stringify(pg.run(`lerFormulaCombo(${JSON.stringify(fo)})`)), servidor, `página ${fo}`);
    }
    for (const t of [0, 1, 7, 8, 9, 100, -3]) for (const mult of [0.5, 1, 2, 3]) {
      assert.equal(pg.run(`calcularDano(${t}, ${mult})`), regras.calcularDano(t, mult), `${t} × ${mult}`);
    }
  });

  it("VAZAMENTO: o jogador nunca recebe rolagem, NPC, inimigo ou resultado de dano alheio", async () => {
    const m = await mestre();
    const j = await conectar(ana.token);
    const vistos = [];
    j.onAny((ev, ...a) => vistos.push([ev, a]));
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: ana.pasta }); });
    j.emit("entregas_pedir");
    const npc = await criarNpc(m, "NPC-Oculto-5530");
    const orc = await criarInimigoEmBatalha(m, "Inimigo-Oculto-5530");
    const rol = (await cmd(m, "master_rolar", { componentes: [{ nome: "Golpe-5530", formula: "4d8+9" }] })).dados;
    const ap = (await cmd(m, "master_aplicar_dano", { rolagemId: rol.rolagemId, alvos: [{ alvoId: npc.id, mult: 2 }, { alvoId: orc.alvoId, mult: 0.5 }] })).dados;
    await cmd(m, "master_desfazer_dano", { aplicacaoId: ap.aplicacaoId });
    await esperar(400);
    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0);
    assert.ok(!tudo.includes("5530"), "dado do mestre vazou");
    assert.ok(!tudo.includes(rol.rolagemId) && !tudo.includes(ap.aplicacaoId));
    assert.ok(!tudo.includes("campanha_atualizada"));
  });

  it("auditoria: eventos novos no padrão de comandos e a ficha não declara mais o leitor de fórmulas", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    for (const ev of ["master_rolar", "master_aplicar_dano", "master_desfazer_dano"]) assert.match(codigo, new RegExp(`comandos\\.registrar\\(\\s*socket,\\s*"${ev}"`), ev);
    assert.ok(!/(io\.emit|broadcast\.emit)\(\s*["'][^"']*(rolagem|dano|rolar)/i.test(codigo));
    assert.ok(!/function lerFormulaCombo/.test(fs.readFileSync(path.join(s.dir, "JS", "dados.js"), "utf8")));
    assert.ok(/function lerFormulaCombo/.test(fs.readFileSync(path.join(s.dir, "JS", "regras.js"), "utf8")));
  });

  /* ---- página ---- */
  describe("página Rolagem e Dano (navegador)", () => {
    const abrirPagina = async (opcoes = { real: true, tokenInicial: SENHA }) => {
      const pg = await abrirPaginaMestre(s, "rolagem", opcoes);
      paginas.push(pg);
      return pg;
    };
    const clicar = (pg, el) => el.dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true }));
    const mudar = (pg, el, valor) => {
      if (el.type === "checkbox") el.checked = valor; else el.value = valor;
      el.dispatchEvent(new pg.window.Event(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    };
    const linha = (pg, nome) => [...pg.document.querySelectorAll("#atk-alvos [data-alvo-id]")].find((l) => l.querySelector(".fig-resumo-nome")?.textContent === nome);

    it("rolar: valida expressão antes de enviar, mostra dados individuais e mantém histórico compacto", async () => {
      const pg = await abrirPagina();
      await esperarAte(() => pg.run("rol.carregou"), { rotulo: "página carregar" });
      const expressao = pg.document.getElementById("rol-expressao");
      mudar(pg, expressao, "2d6;apagar");
      clicar(pg, pg.document.getElementById("rol-rolar"));
      assert.equal(pg.run("rol.historico.length"), 0, "nada foi enviado");
      mudar(pg, expressao, "2d6+3+2");
      clicar(pg, pg.document.getElementById("rol-rolar"));
      await esperarAte(() => pg.run("rol.historico.length === 1 && !rol.ocupada"), { rotulo: "resultado" });
      const total = Number(pg.document.getElementById("rol-total").textContent);
      const r = pg.run("rol.historico[0]");
      assert.equal(total, r.total);
      assert.equal(r.componentes[0].dados.length, 2);
      assert.equal(r.total, r.componentes.reduce((soma, c) => soma + c.soma, 0));
      assert.ok(pg.document.getElementById("rol-detalhes").textContent.trim());
      assert.equal(pg.document.querySelectorAll("#rol-resultado img").length, 0, "nome nunca vira HTML");
      clicar(pg, pg.document.getElementById("rol-rolar"));
      await esperarAte(() => pg.run("rol.historico.length === 2 && !rol.ocupada"), { rotulo: "2ª rolagem" });
      assert.notEqual(pg.run("rol.historico[0].rolagemId"), r.rolagemId);
    });

    it("atacar: seleção entre categorias, multiplicador por alvo, aplicação automática e desfazer", async () => {
      const m = await mestre();
      const f = await abrir(ana, 20);
      await jogadorAlvo(m, ana);
      const npc = await criarNpc(m, "Alvo-Página-NPC", 20);
      await criarInimigoEmBatalha(m, "Alvo-Página-Orc", 20);
      const pg = await abrirPagina();
      await esperarAte(() => linha(pg, "Ana"), { rotulo: "jogador na página" });
      clicar(pg, linha(pg, "Ana").querySelector(".fig-resumo-selecionar"));
      clicar(pg, pg.document.getElementById("atk-inimigos"));
      await esperarAte(() => linha(pg, "Alvo-Página-NPC") && linha(pg, "Alvo-Página-Orc 1"), { rotulo: "inimigos na página" });
      clicar(pg, linha(pg, "Alvo-Página-NPC").querySelector(".fig-resumo-selecionar"));
      mudar(pg, linha(pg, "Alvo-Página-NPC").querySelector('[data-campo="mult"]'), "0.5");
      clicar(pg, linha(pg, "Alvo-Página-Orc 1").querySelector(".fig-resumo-selecionar"));
      mudar(pg, linha(pg, "Alvo-Página-Orc 1").querySelector('[data-campo="mult"]'), "2");
      // Constantes substituem o campo manual separado, usando o mesmo fluxo de rolagem.
      mudar(pg, pg.document.getElementById("rol-expressao"), "7");
      clicar(pg, pg.document.getElementById("rol-rolar"));
      await esperarAte(() => pg.run("rol.historico.length === 1 && !rol.ocupada"));
      assert.equal(await hpDoNpc(m, npc.id), 20, "seleção não causa dano com ataque desligado");
      mudar(pg, pg.document.getElementById("atk-atacar"), true);
      clicar(pg, pg.document.getElementById("rol-rolar"));
      await esperarAte(() => pg.run("rol.ultimaAplicacao && !rol.ocupada"), { rotulo: "resultado do ataque" });
      const resultados = JSON.parse(pg.run("JSON.stringify(rol.ultimaAplicacao.resultados)"));
      assert.deepEqual(resultados.map(x => [x.nome, x.dano, x.depois]).sort(), [["Ana", 7, 13], ["Alvo-Página-NPC", 3, 17], ["Alvo-Página-Orc 1", 14, 6]].sort());
      assert.equal(await hpDoNpc(m, npc.id), 17);
      await esperarAte(() => f.run("STATE.vitals.hp.current") === 13, { rotulo: "ficha com dano" });
      await esperarAte(() => pg.run(`rol.alvos.find(a => a.alvoId === ${JSON.stringify(npc.id)}).hp.atual`) === 17, { rotulo: "alvos atualizados na página" });

      // desfazer
      assert.equal(pg.document.getElementById("atk-desfazer").hidden, false);
      clicar(pg, pg.document.getElementById("atk-desfazer"));
      await esperarAte(() => /Dano desfeito/.test(pg.document.getElementById("atk-resultado").textContent), { rotulo: "desfeito" });
      assert.ok(pg.document.getElementById("atk-desfazer").hidden || pg.document.getElementById("atk-desfazer").classList.contains("hidden"));
      assert.equal(await hpDoNpc(m, npc.id), 20);
      await esperarAte(() => f.run("STATE.vitals.hp.current") === 20, { rotulo: "ficha restaurada" });
      assert.equal(s.lerArquivo("ana", ana.pasta, "status").hp.current, 20);
    });

    it("atacar com uma rolagem do servidor; derrotado aparece no resultado; página com token errado não carrega alvos", async () => {
      const m = await mestre();
      const npc = await criarNpc(m, "Frágil-Página", 3);
      const pg = await abrirPagina();
      await esperarAte(() => pg.run("rol.carregou"));
      clicar(pg, pg.document.getElementById("atk-inimigos"));
      await esperarAte(() => linha(pg, "Frágil-Página"), { rotulo: "alvo na página" });
      mudar(pg, pg.document.getElementById("rol-expressao"), "+10");
      clicar(pg, linha(pg, "Frágil-Página").querySelector(".fig-resumo-selecionar"));
      mudar(pg, pg.document.getElementById("atk-atacar"), true);
      clicar(pg, pg.document.getElementById("rol-rolar"));
      await esperarAte(() => pg.run("rol.ultimaAplicacao && !rol.ocupada"), { rotulo: "derrotado" });
      assert.equal(pg.run("rol.ultimaAplicacao.resultados[0].derrotado"), true);
      assert.equal(await hpDoNpc(m, npc.id), 0);

      const errada = await abrirPagina({ real: true, tokenInicial: "errado" });
      await esperarAte(() => errada.run("socket.connected"), { rotulo: "conectar" });
      await esperar(400);
      assert.equal(errada.run("rol.carregou"), false);
      assert.equal(errada.document.querySelectorAll("#atk-alvos [data-alvo-id]").length, 0);
    });
  });
});

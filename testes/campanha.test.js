/* Sprint 1 (Fase 2): armazém dos dados do mestre (campanha.js) e convenção dos comandos (comandos.js).
   Testes unitários: não sobem servidor. Pastas temporárias em /tmp/rpg-teste-campanha-* (removidas no fim). */
const { describe, it, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { criarCampanha, normalizarArquivo, normalizarNpc, normalizarInimigo, normalizarBau, MAX_BACKUPS, LIMITE_DE_ITENS } = require("../campanha.js");
const { criarComandos } = require("../comandos.js");

const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-campanha-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// Relógio controlável: cada backup precisa de um carimbo diferente.
function relogio(inicio = Date.parse("2026-10-01T12:00:00")) {
  let t = inicio;
  return () => new Date((t += 60_000));
}
const nova = (dir = novaPasta(), extra = {}) => criarCampanha(dir, { log: mudo, agora: relogio(), ...extra }).iniciar();
const arquivosTmp = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));

describe("Normalizadores da campanha", () => {
  it("NPC: limites, tipos e campos desconhecidos descartados", () => {
    const n = normalizarNpc({
      nome: "  Ana  ", lore: "x".repeat(900), segredo: "s".repeat(3000), papel: 5,
      hp: { atual: 99, max: 20 }, atributos: { FOR: "15", DES: "abc", XXX: 3, INT: 5000 },
      retrato: "javascript:alert(1)", hackeado: true, id: "../etc",
    });
    assert.equal(n.nome, "Ana");
    assert.equal(n.lore.length, 500);
    assert.equal(n.segredo.length, 2000);
    assert.deepEqual(n.hp, { atual: 20, max: 20 });
    assert.deepEqual(n.atributos, { FOR: 15, INT: 999 });
    assert.equal(n.retrato, "");
    assert.equal(n.hackeado, undefined);
    assert.match(n.id, /^npc_[0-9a-f]{10}$/);
  });

  it("Inimigo: dado inválido vira vazio e listas têm teto", () => {
    const n = normalizarInimigo({
      nome: "Goblin", hpMax: -5,
      ataques: [{ nome: "Faca", dado: "1d6+2" }, { nome: "Fogo", dado: "bola de fogo" }, "lixo", null],
      habilidades: Array.from({ length: 50 }, (_, i) => ({ nome: `H${i}` })),
    });
    assert.equal(n.hpMax, 1);
    assert.equal(n.ataques.length, 2);
    assert.equal(n.ataques[0].dado, "1d6+2");
    assert.equal(n.ataques[1].dado, "");
    assert.equal(n.habilidades.length, 20);
  });

  it("Baú: item só com campos conhecidos (cópia do catálogo), linhas inválidas descartadas, 0 = esgotado", () => {
    const b = normalizarBau({
      nome: "Baú", liberado: "sim",
      itens: [
        { item: { id: "adaga", name: "Adaga", weight: 1.2345, w: 99, segredo: "x", isBackpackItem: true }, quantidade: 5000 },
        { item: { id: "sem-nome" } },
        { item: { name: "Pesado", desc: "x".repeat(10_000) }, quantidade: 0 },
        "lixo",
      ],
    });
    assert.equal(b.liberado, false, "só `true` de verdade libera");
    assert.equal(b.itens.length, 2);
    assert.equal(b.itens[0].quantidade, 999);
    assert.deepEqual(Object.keys(b.itens[0].item).sort(), ["desc", "h", "id", "maxStack", "name", "twoHanded", "type", "w", "weight"]);
    assert.equal(b.itens[0].item.weight, 1.23);
    assert.equal(b.itens[0].item.w, 10);
    assert.equal(b.itens[1].quantidade, 0);
    assert.equal(b.itens[1].item.desc.length, 2000);
    assert.deepEqual(b.historico, []);
  });

  it("Arquivo inteiro: ids repetidos são descartados, teto por tipo, formato inválido = null", () => {
    const dois = normalizarArquivo("npcs", { items: [{ id: "a", nome: "1" }, { id: "a", nome: "2" }] });
    assert.equal(dois.items.length, 1);
    assert.equal(dois.items[0].nome, "1");
    const muitos = normalizarArquivo("baus", { items: Array.from({ length: 150 }, (_, i) => ({ id: `b${i}` })) });
    assert.equal(muitos.items.length, LIMITE_DE_ITENS.baus);
    assert.equal(normalizarArquivo("npcs", { items: "x" }), null);
    assert.equal(normalizarArquivo("npcs", [1]), null);
    assert.equal(normalizarArquivo("npcs", null), null);
  });

  it("Batalha: combatentes com tipo fechado e alvoId único", () => {
    const b = normalizarArquivo("batalha", {
      ativa: "true",
      combatentes: [{ alvoId: "c1", tipo: "dragao", nome: "X", hp: { max: 5 } }, { alvoId: "c1", nome: "repetido" }],
    });
    assert.equal(b.ativa, false);
    assert.equal(b.combatentes.length, 1);
    assert.equal(b.combatentes[0].tipo, "inimigo");
  });

  it("Idempotência: normalizar de novo não muda nada (o arquivo gravado é estável)", () => {
    const entradas = {
      npcs: { items: [{ nome: "Ana", hp: { max: 8 } }] },
      inimigos: { items: [{ nome: "Orc", ataques: [{ dado: "2d8" }] }] },
      baus: { items: [{ nome: "Baú", itens: [{ item: { name: "Poção", weight: 0.5 }, quantidade: 2 }] }] },
      batalha: { ativa: true, combatentes: [{ nome: "Orc", hp: { atual: 3, max: 9 } }] },
    };
    for (const [tipo, bruto] of Object.entries(entradas)) {
      const um = normalizarArquivo(tipo, bruto);
      assert.deepEqual(normalizarArquivo(tipo, um), um, tipo);
    }
  });
});

describe("Armazém: gravar, ler e remover", () => {
  it("salva, relê do disco depois de 'reiniciar' e mantém o mesmo conteúdo", async () => {
    const dir = novaPasta();
    const c = nova(dir);
    const npc = await c.salvarItem("npcs", { nome: "Ana", lore: "Ferreira da vila", segredo: "É espiã" });
    assert.equal(npc.segredo, "É espiã");
    const reiniciada = nova(dir);
    assert.deepEqual(reiniciada.ler("npcs"), [npc]);
  });

  it("editar mantém criadoEm e muda atualizadoEm; datas do cliente são ignoradas", async () => {
    const c = nova();
    const a = await c.salvarItem("npcs", { nome: "Ana", criadoEm: "2000-01-01T00:00:00Z" });
    assert.notEqual(a.criadoEm, "2000-01-01T00:00:00.000Z");
    const b = await c.salvarItem("npcs", { id: a.id, nome: "Ana Maria", atualizadoEm: "1999-01-01T00:00:00Z" });
    assert.equal(b.id, a.id);
    assert.equal(b.criadoEm, a.criadoEm);
    assert.ok(b.atualizadoEm > a.atualizadoEm);
    assert.equal(c.ler("npcs").length, 1);
  });

  it("remove, e remover algo que não existe devolve false", async () => {
    const c = nova();
    const a = await c.salvarItem("inimigos", { nome: "Orc" });
    assert.equal(await c.removerItem("inimigos", a.id), true);
    assert.equal(await c.removerItem("inimigos", a.id), false);
    assert.deepEqual(c.ler("inimigos"), []);
  });

  it("recusa tipo desconhecido, id inseguro, item inválido/grande e estoura o limite", async () => {
    const c = nova();
    await assert.rejects(() => c.salvarItem("batalha", { nome: "x" }), { codigo: "tipo_invalido" });
    await assert.rejects(() => c.salvarItem("../x", { nome: "x" }), { codigo: "tipo_invalido" });
    assert.throws(() => c.ler("players"), { codigo: "tipo_invalido" });
    await assert.rejects(() => c.removerItem("npcs", "../../etc"), { codigo: "id_invalido" });
    await assert.rejects(() => c.salvarItem("npcs", "texto"), { codigo: "item_invalido" });
    await assert.rejects(() => c.salvarItem("npcs", { nome: "x", notas: "y".repeat(40_000) }), { codigo: "item_grande" });
    for (let i = 0; i < LIMITE_DE_ITENS.baus; i++) await c.salvarItem("baus", { nome: `B${i}` });
    await assert.rejects(() => c.salvarItem("baus", { nome: "a mais" }), { codigo: "limite_atingido" });
    assert.equal(c.ler("baus").length, LIMITE_DE_ITENS.baus);
  });

  it("o que ler() devolve é cópia: mexer nela não altera o armazém", async () => {
    const c = nova();
    await c.salvarItem("npcs", { nome: "Ana" });
    const lista = c.ler("npcs");
    lista[0].nome = "ALTERADO";
    lista.push({ id: "x" });
    assert.equal(c.ler("npcs")[0].nome, "Ana");
    assert.equal(c.ler("npcs").length, 1);
  });

  it("aoMudar avisa depois de gravar, com a lista nova", async () => {
    const c = nova();
    const avisos = [];
    c.aoMudar = (tipo, dados) => avisos.push([tipo, dados.length]);
    await c.salvarItem("npcs", { nome: "Ana" });
    await c.salvarItem("npcs", { nome: "Bia" });
    assert.deepEqual(avisos, [["npcs", 1], ["npcs", 2]]);
  });
});

describe("Leitura sem cópia (ver): contrato somente-leitura", () => {
  it("ver não copia (é a estrutura viva) enquanto ler sempre devolve cópia; tipo inválido recusado", async () => {
    const c = nova();
    await c.salvarItem("npcs", { nome: "Ana" });
    assert.strictEqual(c.ver("npcs"), c.ver("npcs"), "mesma referência: nada é clonado");
    assert.notStrictEqual(c.ler("npcs"), c.ver("npcs"));
    assert.deepEqual(c.ler("npcs"), c.ver("npcs"));
    assert.throws(() => c.ver("players"), { codigo: "tipo_invalido" });
  });

  it("os leitores internos (visão pública dos baús, entrada pública do catálogo, entrega à ficha, dano) NÃO alteram o armazém", async () => {
    const { bausPublicos, entradaPublica, entradaParaFicha, itemParaInventario } = require("../campanha.js");
    const { criarDano } = require("../dano.js");
    const c = nova();
    const item = await c.salvarItem("itens", { name: "Poção", type: "Poção", desc: "cura" });
    await c.salvarItem("baus", { nome: "B", itens: [{ item, quantidade: 3 }] });
    await c.atualizar("baus", (b) => { b[0].liberado = true; });
    const hab = await c.salvarItem("habilidades", { nome: "H", publico: true, efeitos: ["a", "b"], cost: { vital: "hp", amount: 2 } });
    const npc = await c.salvarItem("npcs", { nome: "N", hp: { atual: 9, max: 9 } });
    const foto = () => JSON.stringify(c.lerTudo());
    const antes = foto();
    // o que o servidor faz com `ver` em cada caminho de leitura
    const publica = bausPublicos(c.ver("baus"));
    publica[0].itens[0].quantidade = 999; // quem recebe a visão pública pode mexer à vontade: é cópia nova
    const entrada = entradaPublica(c.ver("habilidades")[0]);
    entrada.efeitos.length = 0; // a entrada pública é cópia inclusive nos aninhados: mexer nela não toca no armazém
    entrada.cost.amount = 999;
    const paraFicha = entradaParaFicha(c.ver("habilidades")[0]);
    assert.equal(paraFicha.catalogId, hab.id);
    paraFicha.efeitos.push("lixo");
    paraFicha.cost.vital = "sanity";
    itemParaInventario(c.ver("itens")[0]);
    await criarDano({ campanha: c, jogadores: { resolver: () => null, ajustar: () => ({}) } }).aplicar({ total: 3, alvos: [{ alvoId: npc.id, mult: 1 }] });
    // única mudança permitida: o HP do NPC pelo dano (por `atualizar`)
    const depois = JSON.parse(foto());
    assert.equal(depois.npcs[0].hp.atual, 6);
    depois.npcs[0].hp.atual = 9;
    depois.npcs[0].atualizadoEm = JSON.parse(antes).npcs[0].atualizadoEm;
    assert.deepEqual(depois, JSON.parse(antes), "nenhum leitor alterou os dados guardados");
  });
});

describe("Armazém: concorrência e gravação atômica", () => {
  it("50 gravações ao mesmo tempo: nenhuma se perde e o arquivo fica íntegro", async () => {
    const dir = novaPasta();
    const c = nova(dir);
    await Promise.all(Array.from({ length: 50 }, (_, i) => c.salvarItem("npcs", { nome: `NPC ${i}` })));
    assert.equal(c.ler("npcs").length, 50);
    const noDisco = JSON.parse(fs.readFileSync(path.join(dir, "npcs.json"), "utf8"));
    assert.equal(noDisco.items.length, 50);
    assert.equal(noDisco.schemaVersion, 1);
    assert.deepEqual(arquivosTmp(dir), []);
  });

  it("alterações ao MESMO item, ao mesmo tempo, são aplicadas em ordem (a última vence, nada some)", async () => {
    const c = nova();
    const base = await c.salvarItem("npcs", { nome: "Ana" });
    await Promise.all(Array.from({ length: 20 }, (_, i) => c.atualizar("npcs", (lista) => { lista[0].hp.max = i + 1; lista[0].hp.atual = i + 1; })));
    assert.equal(c.ler("npcs")[0].hp.max, 20);
    assert.equal(c.ler("npcs")[0].id, base.id);
  });

  it("um erro numa gravação não trava as seguintes nem corrompe o arquivo", async () => {
    const c = nova();
    await c.salvarItem("npcs", { nome: "Ana" });
    const resultados = await Promise.allSettled([
      c.salvarItem("npcs", { nome: "Bia" }),
      c.atualizar("npcs", () => { throw new Error("falha no meio"); }),
      c.salvarItem("npcs", { nome: "Cau" }),
    ]);
    assert.deepEqual(resultados.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
    assert.deepEqual(c.ler("npcs").map((n) => n.nome), ["Ana", "Bia", "Cau"]);
  });

  it("a visão devolvida por atualizar é normalizada: dado ruim não entra", async () => {
    const c = nova();
    await c.atualizar("npcs", (lista) => { lista.push({ nome: "Ana", segredo: "s".repeat(9000) }, "lixo", null); });
    assert.equal(c.ler("npcs").length, 1);
    assert.equal(c.ler("npcs")[0].segredo.length, 2000);
  });
});

describe("Armazém: arquivos estragados e editados à mão", () => {
  it("arquivo corrompido: vai para _corrompidos, começa vazio e avisa; nada é apagado", () => {
    const dir = novaPasta();
    fs.writeFileSync(path.join(dir, "npcs.json"), "{ isto não é json");
    const c = nova(dir);
    assert.deepEqual(c.ler("npcs"), []);
    assert.equal(c.avisos.length, 1);
    assert.match(c.avisos[0], /npcs\.json/);
    const guardados = fs.readdirSync(path.join(dir, "_corrompidos"));
    assert.equal(guardados.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, "_corrompidos", guardados[0]), "utf8"), "{ isto não é json");
  });

  it("formato errado (json válido, mas não é o esperado) também é tratado como corrompido", () => {
    const dir = novaPasta();
    fs.writeFileSync(path.join(dir, "baus.json"), JSON.stringify({ items: "x" }));
    const c = nova(dir);
    assert.equal(c.avisos.length, 1);
    assert.deepEqual(c.ler("baus"), []);
  });

  it("arquivo editado à mão com dados fora do padrão: backup do original e versão limpa gravada", () => {
    const dir = novaPasta();
    fs.writeFileSync(path.join(dir, "npcs.json"), JSON.stringify({ schemaVersion: 1, items: [{ id: "n1", nome: "Ana", lore: "y".repeat(800), extra: 1 }] }));
    const c = nova(dir);
    assert.equal(c.ler("npcs")[0].lore.length, 500);
    const gravado = JSON.parse(fs.readFileSync(path.join(dir, "npcs.json"), "utf8"));
    assert.equal(gravado.items[0].extra, undefined);
    const backups = c.listarBackups();
    assert.ok(backups.some((b) => b.endsWith("_normalizacao")), backups.join(","));
    const original = JSON.parse(fs.readFileSync(path.join(dir, "_backup", backups.find((b) => b.endsWith("_normalizacao")), "npcs.json"), "utf8"));
    assert.equal(original.items[0].lore.length, 800, "o backup guarda o original, antes da limpeza");
  });

  it("sem dados ainda: não cria arquivos nem backup; pastas só aparecem quando há o que guardar", () => {
    const dir = novaPasta();
    const c = nova(dir);
    assert.deepEqual(c.listarBackups(), []);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".json")), []);
  });
});

describe("Backup e restauração", () => {
  it("ao ligar com dados: cria backup; ligar de novo sem mudança não repete", async () => {
    const dir = novaPasta();
    const c = nova(dir);
    await c.salvarItem("npcs", { nome: "Ana" });
    const c2 = nova(dir);
    assert.equal(c2.listarBackups().length, 1);
    const c3 = nova(dir);
    assert.equal(c3.listarBackups().length, 1, "idêntico ao último: não duplica");
    await c3.salvarItem("npcs", { nome: "Bia" });
    assert.equal(nova(dir).listarBackups().length, 2);
  });

  it(`mantém só os ${MAX_BACKUPS} últimos`, async () => {
    const dir = novaPasta();
    const c = nova(dir);
    for (let i = 0; i < 12; i++) {
      await c.salvarItem("npcs", { nome: `N${i}` });
      c.backup("teste");
    }
    const lista = c.listarBackups();
    assert.equal(lista.length, MAX_BACKUPS);
    assert.deepEqual(lista, [...lista].sort().reverse(), "do mais novo para o mais antigo");
    const maisNovo = JSON.parse(fs.readFileSync(path.join(dir, "_backup", lista[0], "npcs.json"), "utf8"));
    assert.equal(maisNovo.items.length, 12, "o mais novo é o estado atual; os antigos é que saem");
  });

  it("restaurar volta ao estado do backup, guarda o estado atual antes e avisa a sala", async () => {
    const dir = novaPasta();
    const c = nova(dir);
    await c.salvarItem("npcs", { nome: "Ana" });
    await c.salvarItem("inimigos", { nome: "Orc" });
    const ponto = c.backup("ponto");
    await c.salvarItem("npcs", { nome: "Bia" });
    await c.removerItem("inimigos", c.ler("inimigos")[0].id);
    const avisos = [];
    c.aoMudar = (tipo) => avisos.push(tipo);

    await c.restaurar(ponto);
    assert.deepEqual(c.ler("npcs").map((n) => n.nome), ["Ana"]);
    assert.deepEqual(c.ler("inimigos").map((n) => n.nome), ["Orc"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "npcs.json"), "utf8")).items.map((n) => n.nome), ["Ana"]);
    assert.ok(c.listarBackups().some((b) => b.endsWith("_antes-de-restaurar")), "o estado anterior não se perde");
    assert.deepEqual([...avisos].sort(), ["baus", "batalha", "habilidades", "inimigos", "itens", "magias", "npcs"].sort());

    // e dá para desfazer a restauração
    await c.restaurar(c.listarBackups().find((b) => b.endsWith("_antes-de-restaurar")));
    assert.deepEqual(c.ler("npcs").map((n) => n.nome), ["Ana", "Bia"]);
  });

  it("restaurar remove arquivos que não existiam naquele backup", async () => {
    const dir = novaPasta();
    const c = nova(dir);
    await c.salvarItem("npcs", { nome: "Ana" });
    const ponto = c.backup("so-npcs");
    await c.salvarItem("baus", { nome: "Baú novo" });
    await c.restaurar(ponto);
    assert.deepEqual(c.ler("baus"), []);
    assert.equal(fs.existsSync(path.join(dir, "baus.json")), false);
  });

  it("recusa nome de backup perigoso ou inexistente", async () => {
    const c = nova();
    await c.salvarItem("npcs", { nome: "Ana" });
    for (const ruim of ["../x", "a/b", "", null, 5, "..\\x"]) {
      await assert.rejects(() => c.restaurar(ruim), { codigo: "backup_invalido" }, String(ruim));
    }
    await assert.rejects(() => c.restaurar("2000-01-01_000000_nao-existe"), { codigo: "backup_inexistente" });
  });

  it("linha de comando: lista e restaura (servidor parado)", async () => {
    const dir = novaPasta();
    const c = nova(dir);
    await c.salvarItem("npcs", { nome: "Ana" });
    const ponto = c.backup("cli");
    await c.salvarItem("npcs", { nome: "Bia" });
    const rodar = (...args) => spawnSync(process.execPath, [path.join(__dirname, "..", "campanha.js"), ...args], { env: { ...process.env, CAMPANHA_DIR: dir, CATALOGO_DIR: novaPasta() }, encoding: "utf8" });
    const lista = rodar("backups");
    assert.equal(lista.status, 0);
    assert.ok(lista.stdout.includes(ponto), lista.stdout);
    const r = rodar("restaurar", ponto);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(nova(dir).ler("npcs").map((n) => n.nome), ["Ana"]);
    const ruim = rodar("restaurar", "../fora");
    assert.equal(ruim.status, 1);
    assert.match(ruim.stderr, /inválido/);
  });
});

/* ------------------------------ comandos.js ------------------------------ */
function socketFalso() {
  const tratadores = {};
  return { id: "sock1", on: (e, fn) => { tratadores[e] = fn; }, chamar: (e, dados, cb) => tratadores[e](dados, cb) };
}
const chamar = (s, evento, dados) => new Promise((resolver) => { s.chamar(evento, dados, resolver); });

describe("Convenção dos comandos do mestre", () => {
  const SENHA = "senha-x";
  let avisos;
  let comandos;
  let s;
  beforeEach(() => {
    avisos = [];
    comandos = criarComandos({ senhaMestre: SENHA, log: { log() {}, warn: (m) => avisos.push(m), error: () => avisos.push("erro") }, tamanhoMaximo: 2000 });
    s = socketFalso();
  });

  it("sem token, token errado ou pedido que não é objeto: recusa e não executa o tratador", async () => {
    let chamadas = 0;
    comandos.registrar(s, "master_x", () => { chamadas++; return 1; });
    assert.deepEqual(await chamar(s, "master_x", {}), { ok: false, erro: "nao_autorizado", mensagem: "Token/Senha do mestre incorreta!" });
    assert.equal((await chamar(s, "master_x", { token: "outra" })).erro, "nao_autorizado");
    for (const ruim of [null, undefined, "texto", 42, [SENHA]]) {
      assert.equal((await chamar(s, "master_x", ruim)).erro, "formato_invalido", String(ruim));
    }
    assert.equal(chamadas, 0);
    assert.ok(avisos.length >= 2, "tentativas recusadas ficam no log");
  });

  it("pedido grande demais é recusado antes de qualquer coisa", async () => {
    comandos.registrar(s, "master_x", () => 1);
    const r = await chamar(s, "master_x", { token: SENHA, lixo: "x".repeat(3000) });
    assert.equal(r.erro, "pedido_grande");
  });

  it("com token certo: devolve { ok, dados }; tratador assíncrono também", async () => {
    comandos.registrar(s, "master_a", (d) => ({ eco: d.valor }));
    comandos.registrar(s, "master_b", async () => { await new Promise((r) => setTimeout(r, 5)); return "depois"; });
    comandos.registrar(s, "master_c", () => {});
    assert.deepEqual(await chamar(s, "master_a", { token: SENHA, valor: 7 }), { ok: true, dados: { eco: 7 } });
    assert.deepEqual(await chamar(s, "master_b", { token: SENHA }), { ok: true, dados: "depois" });
    assert.deepEqual(await chamar(s, "master_c", { token: SENHA }), { ok: true, dados: null });
  });

  it("erro esperado mostra a mensagem; erro inesperado não vaza detalhes", async () => {
    const { ErroCampanha } = require("../campanha.js");
    comandos.registrar(s, "master_a", () => { throw new ErroCampanha("limite_atingido", "Limite atingido."); });
    comandos.registrar(s, "master_b", () => { throw new Error("ENOENT /home/segredo/caminho"); });
    assert.deepEqual(await chamar(s, "master_a", { token: SENHA }), { ok: false, erro: "limite_atingido", mensagem: "Limite atingido." });
    const r = await chamar(s, "master_b", { token: SENHA });
    assert.equal(r.erro, "erro_interno");
    assert.ok(!JSON.stringify(r).includes("segredo"));
  });

  it("sem função de confirmação (callback) não quebra", async () => {
    comandos.registrar(s, "master_a", () => 1);
    await s.chamar("master_a", { token: SENHA });
    await s.chamar("master_a", { token: "errado" });
  });

  it("evento que muda estado exige acaoId seguro", async () => {
    comandos.registrar(s, "master_m", () => 1, { mudaEstado: true });
    assert.equal((await chamar(s, "master_m", { token: SENHA })).erro, "acao_id_obrigatorio");
    assert.equal((await chamar(s, "master_m", { token: SENHA, acaoId: "../x" })).erro, "acao_id_obrigatorio");
    assert.equal((await chamar(s, "master_m", { token: SENHA, acaoId: "acao_1" })).ok, true);
  });

  it("mesmo acaoId repetido: executa UMA vez e devolve a mesma resposta", async () => {
    let n = 0;
    comandos.registrar(s, "master_m", () => ({ vez: ++n }), { mudaEstado: true });
    const a = await chamar(s, "master_m", { token: SENHA, acaoId: "acao_1" });
    const b = await chamar(s, "master_m", { token: SENHA, acaoId: "acao_1" });
    const c = await chamar(s, "master_m", { token: SENHA, acaoId: "acao_2" });
    assert.deepEqual(a, b);
    assert.equal(c.dados.vez, 2);
    assert.equal(n, 2);
  });

  it("mesmo acaoId chegando ao mesmo tempo (duplo clique): executa uma vez só", async () => {
    let n = 0;
    comandos.registrar(s, "master_m", async () => { await new Promise((r) => setTimeout(r, 20)); return ++n; }, { mudaEstado: true });
    const r = await Promise.all([1, 2, 3].map(() => chamar(s, "master_m", { token: SENHA, acaoId: "acao_dup" })));
    assert.equal(n, 1);
    assert.deepEqual(r.map((x) => x.dados), [1, 1, 1]);
  });

  it("falha NÃO fica memorizada: dá para tentar de novo com o mesmo acaoId", async () => {
    let n = 0;
    comandos.registrar(s, "master_m", () => { if (++n === 1) throw new Error("instável"); return "ok"; }, { mudaEstado: true });
    assert.equal((await chamar(s, "master_m", { token: SENHA, acaoId: "acao_1" })).ok, false);
    assert.equal((await chamar(s, "master_m", { token: SENHA, acaoId: "acao_1" })).dados, "ok");
  });

  it("acaoId é por evento: reaproveitar o id em outro evento não devolve a resposta errada", async () => {
    comandos.registrar(s, "master_m1", () => "um", { mudaEstado: true });
    comandos.registrar(s, "master_m2", () => "dois", { mudaEstado: true });
    await chamar(s, "master_m1", { token: SENHA, acaoId: "acao_1" });
    assert.equal((await chamar(s, "master_m2", { token: SENHA, acaoId: "acao_1" })).dados, "dois");
  });

  it("a memória de ações tem teto (não cresce sem limite)", async () => {
    const pequeno = criarComandos({ senhaMestre: SENHA, log: { log() {}, warn() {}, error() {} }, maxAcoes: 3 });
    let n = 0;
    pequeno.registrar(s, "master_m", () => ++n, { mudaEstado: true });
    for (let i = 1; i <= 5; i++) await chamar(s, "master_m", { token: SENHA, acaoId: `a${i}` });
    assert.equal((await chamar(s, "master_m", { token: SENHA, acaoId: "a5" })).dados, 5, "recente: lembrado");
    assert.equal((await chamar(s, "master_m", { token: SENHA, acaoId: "a1" })).dados, 6, "antigo: esquecido, executa de novo");
  });
});

/* Sprint 2 (Fase 2): catálogo do mestre, visibilidade, caixa de entregas e página Habilidades e Magias. */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const { criarCampanha, normalizarEntradaCatalogo, entradaParaFicha, entradaPublica } = require("../campanha.js");
const { criarEntregas, MAX_PENDENTES } = require("../entregas.js");
const { iniciarServidor, abrirFicha, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-habmag-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/* ------------------------------ unitários ------------------------------ */
describe("Catálogo no armazém", () => {
  it("normaliza: campos avançados com teto, dado inválido sai, publico é estrito, extras somem", () => {
    const n = normalizarEntradaCatalogo("hab")({
      nome: "Golpe", icon: "fa-fire", dice: "2d8+3", tipoDano: "Fogo", cost: { vital: "vigor", amount: 4 },
      acao: "Rápida", alcance: "Toque", duracao: "1 turno", requisitos: "Nível 3",
      desc: "d".repeat(3000), descLonga: "l".repeat(5000), efeitos: Array.from({ length: 15 }, (_, i) => ` e${i} `).concat([5, "", null]),
      publico: "true", hackeado: 1, __proto__: { x: 1 },
    });
    assert.equal(n.desc.length, 2000);
    assert.equal(n.descLonga.length, 4000);
    assert.equal(n.efeitos.length, 10);
    assert.equal(n.efeitos[0], "e0");
    assert.equal(n.publico, false, 'só `true` de verdade torna público');
    assert.equal(n.hackeado, undefined);
    assert.match(n.id, /^hab_/);
    const ruim = normalizarEntradaCatalogo("mag")({ nome: "x", dice: "1d6; rm", icon: "<svg>", cost: { vital: "ouro", amount: -4 } });
    assert.equal(ruim.dice, undefined);
    assert.equal(ruim.icon, undefined);
    assert.deepEqual(ruim.cost, { vital: "", amount: 0 });
    assert.deepEqual(normalizarEntradaCatalogo("hab")(n), n, "idempotente");
  });

  it("entradaParaFicha e entradaPublica tiram o controle do mestre", () => {
    const item = { id: "g1", nome: "Golpe", publico: false, criadoEm: "x", atualizadoEm: "y", dice: "1d6" };
    assert.deepEqual(entradaParaFicha(item), { nome: "Golpe", dice: "1d6", catalogId: "g1" });
    assert.deepEqual(entradaPublica(item), { id: "g1", nome: "Golpe", dice: "1d6" });
  });

  it("catálogo antigo (sem `publico`) segue público, entrada sem id é ignorada, e o original vai para backup", () => {
    const dir = novaPasta();
    const cat = novaPasta();
    fs.writeFileSync(path.join(cat, "habilidades.json"), JSON.stringify({ schemaVersion: 1, items: [{ id: "a", nome: "A" }, { nome: "sem id" }, { id: "b", nome: "B", publico: false }] }));
    const c = criarCampanha(dir, { log: mudo, pastaCatalogo: cat }).iniciar();
    assert.deepEqual(c.ler("habilidades").map((e) => [e.id, e.publico]), [["a", true], ["b", false]]);
    assert.ok(c.listarBackups().some((b) => b.endsWith("_normalizacao")));
    const outra = criarCampanha(dir, { log: mudo, pastaCatalogo: cat }).iniciar();
    assert.equal(outra.ler("habilidades").length, 2, "ligar de novo não muda nada");
  });

  it("salvar cria o catálogo, nova entrada nasce privada e restaurar backup antigo não apaga o catálogo", async () => {
    const dir = novaPasta();
    const cat = novaPasta();
    const c = criarCampanha(dir, { log: mudo, pastaCatalogo: cat }).iniciar();
    await c.salvarItem("npcs", { nome: "Ana" });
    const antigo = c.backup("sem-catalogo");
    const e = await c.salvarItem("magias", { nome: "Bola" });
    assert.equal(e.publico, false);
    assert.ok(fs.existsSync(path.join(cat, "magias.json")));
    await c.restaurar(antigo);
    assert.ok(fs.existsSync(path.join(cat, "magias.json")), "o catálogo nunca é apagado por restauração");
    assert.equal(c.ler("magias").length, 1);
  });
});

describe("Caixa de entregas (entregas.js)", () => {
  const nova = () => {
    const raiz = novaPasta();
    fs.mkdirSync(path.join(raiz, "ana", "Heroi_0001"), { recursive: true });
    return { raiz, e: criarEntregas({ pastaDoPersonagem: (p, n) => path.join(raiz, p, n), log: mudo }) };
  };
  const entrada = (id) => ({ nome: id, catalogId: id });

  it("adiciona, recusa repetida pendente, marca entregue uma vez só", async () => {
    const { e } = nova();
    const a = await e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada("m1") });
    assert.match(a.entregaId, /^ent_/);
    await assert.rejects(() => e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada("m1") }), { codigo: "ja_pendente" });
    await e.adicionar("ana", "Heroi_0001", { tipo: "habilidades", entrada: entrada("m1") }); // outro tipo: pode
    assert.equal(e.pendentes("ana", "Heroi_0001").length, 2);
    assert.ok(await e.marcarEntregue("ana", "Heroi_0001", a.entregaId));
    assert.equal(await e.marcarEntregue("ana", "Heroi_0001", a.entregaId), null, "segunda vez: nada");
    assert.equal(await e.marcarEntregue("ana", "Heroi_0001", "../x"), null);
    assert.equal(e.pendentes("ana", "Heroi_0001").length, 1);
    // depois de entregue, dá para entregar de novo (o servidor é que recusa se o personagem já tem)
    await e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada("m1") });
  });

  it("recusa entrega inválida e caixa cheia; 30 gravações simultâneas não se perdem", async () => {
    const { raiz, e } = nova();
    for (const ruim of [{ tipo: "itens", entrada: entrada("x") }, { tipo: "magias", entrada: { nome: "sem catalogId" } }, { tipo: "magias", entrada: { catalogId: "../x" } }, { tipo: "magias", entrada: { catalogId: "ok", lixo: "z".repeat(9000) } }]) {
      await assert.rejects(() => e.adicionar("ana", "Heroi_0001", ruim), { codigo: "entrega_invalida" });
    }
    await Promise.all(Array.from({ length: 30 }, (_, i) => e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada(`m${i}`) })));
    assert.equal(e.pendentes("ana", "Heroi_0001").length, 30);
    assert.deepEqual(fs.readdirSync(path.join(raiz, "ana", "Heroi_0001")).filter((f) => f.endsWith(".tmp")), []);
    for (let i = 30; i < MAX_PENDENTES; i++) await e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada(`m${i}`) });
    await assert.rejects(() => e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada("a-mais") }), { codigo: "caixa_cheia" });
  });

  it("caixa corrompida é guardada à parte e recomeça vazia", async () => {
    const { raiz, e } = nova();
    fs.writeFileSync(path.join(raiz, "ana", "Heroi_0001", "entregas.json"), "{ lixo");
    assert.deepEqual(e.pendentes("ana", "Heroi_0001"), []);
    assert.ok(fs.readdirSync(path.join(raiz, "ana", "Heroi_0001")).some((f) => f.includes("corrompido")));
    await e.adicionar("ana", "Heroi_0001", { tipo: "magias", entrada: entrada("m1") });
    assert.equal(e.pendentes("ana", "Heroi_0001").length, 1);
  });
});

/* ------------------------------ integração ------------------------------ */
describe("Habilidades e Magias com o servidor real", { concurrency: false }, () => {
  let s, ana, bia;
  const abertos = [];
  const fichas = [];

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
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  let contador = 0;
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_t${++contador}`, ...dados });
  const criarEntrada = async (m, tipo, extra = {}) => (await cmd(m, "master_campanha_salvar", { tipo, item: { nome: `E${++contador}`, ...extra } })).dados;
  const abrir = async (j) => {
    const f = await abrirFicha(s, { player: j.conta, nomePasta: j.pasta, token: j.token });
    fichas.push(f);
    return f;
  };
  const caixa = (j) => JSON.parse(fs.readFileSync(path.join(s.dir, "players", j.conta, j.pasta, "entregas.json"), "utf8")).items;

  afterEach(async () => { // uma falha nunca deixa ficha/socket aberto para o teste seguinte
    fichas.splice(0).forEach((f) => f.fechar());
    abertos.splice(0).forEach((k) => k.close());
    await esperar(300);
  });
  before(async () => {
    s = await iniciarServidor();
    ana = await criarJogador("ana", "Ana");
    bia = await criarJogador("bia", "Bia");
  });
  after(async () => {
    fichas.forEach((f) => f.fechar());
    abertos.forEach((k) => k.close());
    await s?.parar();
  });

  /* ---- visibilidade ---- */
  it("a ficha só enxerga entradas PÚBLICAS, sem controle do mestre; privadas só por entrega", async () => {
    const m = await mestre();
    const pub = await criarEntrada(m, "habilidades", { publico: true, descLonga: "texto longo", efeitos: ["a"] });
    const priv = await criarEntrada(m, "habilidades", { desc: "SEGREDO-PRIVADO-55" });
    assert.equal(priv.publico, false, "nasce privada");
    const r = await s.api("/api/catalogo/habilidades", null, ana.token);
    const ids = r.items.map((i) => i.id);
    assert.ok(ids.includes(pub.id));
    assert.ok(!ids.includes(priv.id));
    assert.ok(!JSON.stringify(r).includes("SEGREDO-PRIVADO-55"));
    const vista = r.items.find((i) => i.id === pub.id);
    assert.equal(vista.publico, undefined);
    assert.equal(vista.criadoEm, undefined);
    assert.equal(vista.descLonga, "texto longo", "campo avançado vai junto (a ficha o ignora)");
    // sem login nada
    assert.equal((await s.api("/api/catalogo/habilidades", null, "token-falso")).success, false);
    // tornar pública depois aparece; excluir some
    await cmd(m, "master_campanha_salvar", { tipo: "habilidades", item: { ...priv, publico: true } });
    assert.ok((await s.api("/api/catalogo/habilidades", null, ana.token)).items.some((i) => i.id === priv.id));
    await cmd(m, "master_campanha_remover", { tipo: "habilidades", id: priv.id });
    assert.ok(!(await s.api("/api/catalogo/habilidades", null, ana.token)).items.some((i) => i.id === priv.id));
  });

  /* ---- segurança ---- */
  it("jogador e anônimo: não editam catálogo, não entregam, não listam personagens", async () => {
    const jogador = await conectar(ana.token);
    const anonimo = await conectar();
    for (const sock of [jogador, anonimo]) {
      for (const [evento, dados] of [
        ["master_campanha_salvar", { tipo: "habilidades", item: { nome: "Hack", publico: true }, acaoId: "acao_h1" }],
        ["master_campanha_remover", { tipo: "habilidades", id: "golpe-demolidor", acaoId: "acao_h2" }],
        ["master_entregar", { tipo: "habilidades", catalogId: "golpe-demolidor", player: "ana", nomePasta: ana.pasta, acaoId: "acao_h3" }],
        ["master_listar_personagens", {}],
      ]) {
        for (const token of [undefined, "errado", ana.token]) {
          const r = await pedir(sock, evento, { ...dados, token });
          assert.equal(r.erro, "nao_autorizado", `${evento} token=${token}`);
        }
      }
    }
    const m = await mestre();
    assert.ok(!(await pedir(m, "master_campanha_ler", { token: SENHA, tipo: "habilidades" })).dados.some((e) => e.nome === "Hack"));
  });

  it("entrega: personagem inexistente/perigoso, catálogo inexistente, tipo e id inválidos", async () => {
    const m = await mestre();
    const e = await criarEntrada(m, "magias");
    const erro = async (d) => (await cmd(m, "master_entregar", { tipo: "magias", catalogId: e.id, player: "ana", nomePasta: ana.pasta, ...d })).erro;
    assert.equal(await erro({ nomePasta: "Fantasma_9999" }), "personagem_inexistente");
    assert.equal(await erro({ nomePasta: "../ana/" + ana.pasta }), "personagem_inexistente");
    assert.equal(await erro({ player: "../bia" }), "personagem_inexistente");
    assert.equal(await erro({ player: "naoexiste" }), "personagem_inexistente");
    assert.equal(await erro({ catalogId: "nao-existe" }), "catalogo_inexistente");
    assert.equal(await erro({ catalogId: "../x" }), "id_invalido");
    assert.equal(await erro({ tipo: "itens" }), "tipo_invalido");
    assert.equal((await pedir(m, "master_entregar", { token: SENHA, tipo: "magias", catalogId: e.id, player: "ana", nomePasta: ana.pasta })).erro, "acao_id_obrigatorio");
    assert.ok(!fs.existsSync(path.join(s.dir, "players", "ana", "..", "entregas.json")));
  });

  it("listar personagens mostra quem existe e quem está online", async () => {
    const m = await mestre();
    let lista = (await cmd(m, "master_listar_personagens", { acaoId: undefined })).dados;
    const da = lista.find((p) => p.nomePasta === ana.pasta);
    assert.deepEqual([da.player, da.nome, da.online], ["ana", "Ana", false]);
    const f = await abrir(ana);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
    await esperar(200);
    lista = (await cmd(m, "master_listar_personagens")).dados;
    assert.equal(lista.find((p) => p.nomePasta === ana.pasta).online, true);
    assert.equal(lista.find((p) => p.nomePasta === bia.pasta).online, false);
    f.fechar();
    await esperar(300);
  });

  /* ---- entrega ---- */
  it("entrega ONLINE: aparece na ficha na hora, é salva no arquivo, confirmada e marcada como entregue", async () => {
    const m = await mestre();
    const e = await criarEntrada(m, "habilidades", { nome: "Fúria", dice: "1d8", cost: { vital: "vigor", amount: 2 }, descLonga: "avançado", efeitos: ["x"] });
    const f = await abrir(ana);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
    await esperar(200);
    const r = await cmd(m, "master_entregar", { tipo: "habilidades", catalogId: e.id, player: "ana", nomePasta: ana.pasta });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.dados.online, true);
    await esperarAte(() => f.run("STATE.abilities.some((a) => a.catalogId === " + JSON.stringify(e.id) + ")"), { rotulo: "entrada na ficha" });
    assert.match(f.document.getElementById("toast-container")?.textContent || "", /Você recebeu: Fúria/);
    assert.ok(f.run("document.getElementById('abilities-container')?.textContent || document.body.textContent").includes("Fúria"), "aparece no Códice sem recarregar");
    await esperarAte(() => caixa(ana).some((x) => x.entregaId === r.dados.entregaId && x.status === "entregue"), { rotulo: "marcada entregue" });
    const salvo = s.lerArquivo("ana", ana.pasta, "habilidades").items.find((a) => a.catalogId === e.id);
    assert.equal(salvo.nome, "Fúria");
    assert.equal(salvo.publico, undefined);
    assert.equal(salvo.id, undefined);
    assert.match(salvo.uid, /^cx_/);
    // já possui: o servidor recusa nova entrega
    assert.equal((await cmd(m, "master_entregar", { tipo: "habilidades", catalogId: e.id, player: "ana", nomePasta: ana.pasta })).erro, "ja_possui");
    assert.deepEqual(f.erros, []);
    f.fechar();
    await esperar(300);
  });

  it("entrega OFFLINE: espera na caixa (inclusive depois de reiniciar o servidor) e entra ao abrir a ficha, uma vez só", async () => {
    const m = await mestre();
    const e = await criarEntrada(m, "magias", { nome: "Bola de Gelo" });
    const id = JSON.stringify(e.id);
    const r = await cmd(m, "master_entregar", { tipo: "magias", catalogId: e.id, player: "bia", nomePasta: bia.pasta });
    assert.equal(r.dados.online, false);
    // mesma entrega pedida outra vez (nova ação) enquanto pendente: recusada
    assert.equal((await cmd(m, "master_entregar", { tipo: "magias", catalogId: e.id, player: "bia", nomePasta: bia.pasta })).erro, "ja_pendente");
    // reenvio da MESMA ação: mesma resposta, sem duplicar
    const pedido = { tipo: "magias", catalogId: e.id, player: "bia", nomePasta: bia.pasta, acaoId: "acao_fixa_1", token: SENHA };
    const a = await pedir(m, "master_entregar", pedido);
    assert.equal(a.erro, "ja_pendente");
    assert.equal(caixa(bia).filter((x) => x.entrada.catalogId === e.id).length, 1);

    await s.reiniciar();
    await relogar(ana);
    await relogar(bia);
    assert.equal(caixa(bia).filter((x) => x.status === "pendente" && x.entrada.catalogId === e.id).length, 1, "sobreviveu ao reinício");

    const f = await abrir(bia);
    await esperarAte(() => f.run(`STATE.spells.some((a) => a.catalogId === ${id})`), { rotulo: "entrega pendente aplicada" });
    await esperarAte(() => caixa(bia).every((x) => x.status === "entregue"), { rotulo: "marcada entregue" });
    assert.equal(f.run(`STATE.spells.filter((a) => a.catalogId === ${id}).length`), 1);
    // reabrir a ficha não aplica de novo
    f.fechar();
    await esperar(300);
    const f2 = await abrir(bia);
    await esperarAte(() => f2.run("personagemCarregado"), { rotulo: "ficha carregar" });
    await esperar(400);
    assert.equal(f2.run(`STATE.spells.filter((a) => a.catalogId === ${id}).length`), 1);
    assert.equal(s.lerArquivo("bia", bia.pasta, "magias").items.filter((x) => x.catalogId === e.id).length, 1);
    f2.fechar();
    await esperar(300);
  });

  it("entregas em sequência e simultâneas (2 mestres): todas chegam, sem duplicar", async () => {
    const m1 = await mestre();
    const m2 = await mestre();
    const lista = [];
    for (let i = 0; i < 6; i++) lista.push(await criarEntrada(m1, i % 2 ? "magias" : "habilidades", { nome: `Lote${i}` }));
    const rs = await Promise.all(lista.map((e, i) => cmd(i % 2 ? m1 : m2, "master_entregar", { tipo: i % 2 ? "magias" : "habilidades", catalogId: e.id, player: "ana", nomePasta: ana.pasta })));
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.find((r) => !r.ok)));
    const f = await abrirFicha(s, {
      player: ana.conta, nomePasta: ana.pasta, token: ana.token, atrasarInicio: 20,
      antesDoInicio: rodar => rodar(`if (!window.__monitorLote) {
        window.__monitorLote = { prematuras: [], maxEmVoo: 0 };
        const tipos = new Map(), emitir = socket.emit.bind(socket);
        socket.on('entrega', e => tipos.set(e.entregaId, e.tipo === 'itens' ? 'inventario' : e.tipo));
        socket.emit = (evento, dados, ...resto) => {
          if (evento === 'salvar_personagem') window.__monitorLote.maxEmVoo = Math.max(window.__monitorLote.maxEmVoo, emVoo[dados.arquivo] || 0);
          const tipo = tipos.get(dados?.entregaId);
          if (evento === 'entrega_aplicada' && tipo && arquivoProtegido(tipo)) window.__monitorLote.prematuras.push(dados.entregaId);
          return emitir(evento, dados, ...resto);
        };
      }`),
    });
    fichas.push(f);
    await esperarAte(() => lista.every((e) => f.run(`[...STATE.abilities, ...STATE.spells].some((a) => a.catalogId === ${JSON.stringify(e.id)})`)), { rotulo: "6 entregas aplicadas" });
    await f.salvos();
    await esperarAte(() => caixa(ana).filter((x) => lista.some((e) => e.id === x.entrada.catalogId)).every((x) => x.status === "entregue"), { rotulo: "todas entregues" });
    assert.ok(f.run("window.__monitorLote.maxEmVoo") >= 2, "o cenário exercita salvamentos sobrepostos");
    assert.equal(f.run("window.__monitorLote.prematuras.length"), 0, "nenhuma entrega é confirmada antes de terminar o salvamento do arquivo");
    assert.equal(f.run("[...STATE.abilities, ...STATE.spells].filter((a) => /^Lote/.test(a.nome)).length"), 6);
    f.fechar();
    await esperar(300);
  });

  it("ficha com edição pendente não perde dados quando chega uma entrega", async () => {
    const m = await mestre();
    const f = await abrir(ana);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
    f.run("adicionarEntradaCodice('habilidades', { uid: 'cx_propria1', nome: 'Original' })");
    await esperarAte(() => s.lerArquivo("ana", ana.pasta, "habilidades").items.some((a) => a.nome === "Original"), { rotulo: "própria salva" });
    // edição ainda não enviada (salvamento com atraso) quando a entrega chega
    f.run("STATE.abilities.find((a) => a.uid === 'cx_propria1').nome = 'Editada agora'; marcarAlterado('habilidades')");
    const e = await criarEntrada(m, "habilidades", { nome: "Chegou no meio" });
    await cmd(m, "master_entregar", { tipo: "habilidades", catalogId: e.id, player: "ana", nomePasta: ana.pasta });
    await esperarAte(() => s.lerArquivo("ana", ana.pasta, "habilidades").items.some((a) => a.nome === "Chegou no meio"), { rotulo: "entrega salva" });
    const nomes = s.lerArquivo("ana", ana.pasta, "habilidades").items.map((a) => a.nome);
    assert.ok(nomes.includes("Editada agora"), nomes.join());
    assert.ok(nomes.includes("Chegou no meio"));
    f.fechar();
    await esperar(300);
  });

  it("a ficha recusa entrega de formato inválido e não duplica o que já tem", async () => {
    const f = await abrir(bia);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
    const antes = f.run("STATE.abilities.length + STATE.spells.length");
    const ruins = [
      null, "texto", {}, { entregaId: "e1", tipo: "itens", entrada: { catalogId: "x" } },
      { entregaId: "../e", tipo: "magias", entrada: { catalogId: "x" } },
      { entregaId: "e2", tipo: "magias", entrada: { nome: "sem catalogId" } },
      { entregaId: "e3", tipo: "magias", entrada: { catalogId: "x y" } },
      { entregaId: "e4", tipo: "magias", entrada: { catalogId: "x", lixo: "z".repeat(9000) } },
      { entregaId: "e5", tipo: "constructor", entrada: { catalogId: "x" } },
    ];
    for (const r of ruins) assert.equal(f.run(`aplicarEntrega(${JSON.stringify(r)})`), false, JSON.stringify(r));
    assert.equal(f.run("STATE.abilities.length + STATE.spells.length"), antes);
    // entrega que a ficha já tem: confirma sem duplicar
    const existente = f.run("STATE.spells[0]?.catalogId");
    if (existente) {
      f.run(`aplicarEntrega({ entregaId: "ex1", tipo: "magias", entrada: { catalogId: ${JSON.stringify(existente)}, nome: "dup" } })`);
      assert.equal(f.run("STATE.abilities.length + STATE.spells.length"), antes);
    }
    f.fechar();
    await esperar(300);
  });

  it("jogador forjando: confirmar entrega de outro ou sem ficha não marca nada; pedir caixa sem ficha não recebe nada", async () => {
    const m = await mestre();
    const e = await criarEntrada(m, "habilidades", { nome: "Só da Bia" });
    const r = await cmd(m, "master_entregar", { tipo: "habilidades", catalogId: e.id, player: "bia", nomePasta: bia.pasta });
    const entregaId = r.dados.entregaId;
    const intruso = await conectar(ana.token); // ana, sem abrir ficha nenhuma
    const recebidas = [];
    intruso.on("entrega", (x) => recebidas.push(x));
    intruso.emit("entregas_pedir");
    intruso.emit("entrega_aplicada", { entregaId });
    intruso.emit("entrega_aplicada", { entregaId: "../x" });
    intruso.emit("entrega_aplicada", null);
    await esperar(300);
    assert.equal(recebidas.length, 0);
    assert.equal(caixa(bia).find((x) => x.entregaId === entregaId).status, "pendente");
    // a bia abre a ficha, mas "confirma" sem ter salvo: o servidor confere o arquivo e não marca
    const falsa = await conectar(bia.token);
    await new Promise((res) => { falsa.once("personagem_carregado", res); falsa.emit("carregar_personagem", { player: "bia", nomePasta: bia.pasta }); });
    falsa.emit("entrega_aplicada", { entregaId });
    await esperar(300);
    assert.equal(caixa(bia).find((x) => x.entregaId === entregaId).status, "pendente", "sem estar no arquivo, não vale");
    falsa.close();
    await esperar(300);
  });

  it("VAZAMENTO: nenhum jogador recebe o catálogo privado nem entrega de outro personagem", async () => {
    const m = await mestre();
    const j = await conectar(ana.token);
    const vistos = [];
    j.onAny((ev, ...a) => vistos.push([ev, a]));
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: ana.pasta }); });
    j.emit("entregas_pedir");
    const priv = await criarEntrada(m, "magias", { nome: "Magia-oculta-ZZ9", desc: "SEGREDO-ZZ9" });
    const pubExtra = await criarEntrada(m, "habilidades", { nome: "Pública-ZZ9", publico: true });
    await cmd(m, "master_entregar", { tipo: "magias", catalogId: priv.id, player: "bia", nomePasta: bia.pasta });
    await cmd(m, "master_listar_personagens");
    await cmd(m, "master_campanha_remover", { tipo: "habilidades", id: pubExtra.id });
    await esperar(300);
    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0);
    assert.ok(!tudo.includes("ZZ9"), "dado do mestre vazou para outro jogador");
    assert.ok(!tudo.includes("campanha_atualizada"));
    // o que a ana recebe de "entrega" é só dela (nunca a entrega da bia)
    assert.ok(vistos.filter(([ev]) => ev === "entrega").every(([, a]) => a[0].entrada.catalogId !== priv.id));
    j.close(); // libera a ficha da ana para os testes seguintes (uma aba por personagem)
    await esperar(300);
  });

  it("auditoria: eventos novos exigem o padrão de comandos e nada de catálogo sai por broadcast geral", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    for (const ev of ["master_listar_personagens", "master_entregar"]) assert.match(codigo, new RegExp(`comandos\\.registrar\\(\\s*socket,\\s*"${ev}"`));
    assert.ok(!/io\.emit\(\s*["']entrega/.test(codigo));
    assert.match(codigo, /entradaPublica/);
  });

  /* ---- página do mestre ---- */
  describe("página Habilidades e Magias (navegador)", () => {
    const abrirPagina = () => abrirPaginaMestre(s, "habilidades-magias", { real: true, tokenInicial: SENHA });
    const cartoes = (pg) => [...pg.document.querySelectorAll("#habmag-lista [data-id]")];
    const cartaoDe = (pg, nome) => cartoes(pg).find((c) => c.querySelector("h4").textContent === nome);
    const preencher = (pg, id, valor) => {
      const el = pg.document.getElementById(id);
      if (el.type === "checkbox") el.checked = valor; else el.value = valor;
      el.dispatchEvent(new pg.window.Event("input", { bubbles: true }));
    };
    const clicar = (pg, el) => el.dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true }));

    it("criar (nasce privada), editar, publicar, duplicar, buscar e excluir com confirmação", async () => {
      const { dadoDePoderValido } = require("../JS/regras.js");
      for (const formula of ["1d6+1d4+2", "2d8+3", "1d6 + 1d4 - 2"]) {
        assert.ok(dadoDePoderValido(formula));
        assert.equal(require("../personagem.js").normalizarEntradaCodice({ nome: "Teste", dice: formula }, new Set()).dice, formula);
      }
      for (const formula of ["1d6++1d4", "1d6; apagar", "1000d6+1d4", "1d0+1d4"]) assert.equal(dadoDePoderValido(formula), false);
      assert.equal(require("../rolagem.js").rolar("1d6+1d4+2", lados => lados).total, 12);
      const pg = await abrirPagina();
      try {
        await esperarAte(() => pg.run("habmag.carregou"), { rotulo: "página carregar" });
        clicar(pg, pg.document.getElementById("habmag-novo"));
        assert.equal(pg.document.getElementById("hm-publico").checked, false, "nova entrada começa privada");
        preencher(pg, "hm-nome", "Chama Viva <img src=x onerror=alert(1)>");
        preencher(pg, "hm-dice", "1d6; apagar");
        clicar(pg, pg.document.getElementById("hm-salvar"));
        assert.equal(pg.document.getElementById("hm-dice").getAttribute("aria-invalid"), "true");
        assert.match(pg.document.getElementById("hm-dice-erro").textContent, /Dado inválido/, "valida antes de enviar");
        preencher(pg, "hm-dice", "1d6+1d4+2");
        preencher(pg, "hm-tipoDano", "Fogo");
        preencher(pg, "hm-custo-vital", "vigor");
        preencher(pg, "hm-custo-valor", "3");
        preencher(pg, "hm-efeitos", "queima\n\natordoa");
        clicar(pg, pg.document.getElementById("hm-salvar"));
        const nome = "Chama Viva <img src=x onerror=alert(1)>";
        await esperarAte(() => cartaoDe(pg, nome), { rotulo: "cartão aparecer" });
        const c = cartaoDe(pg, nome);
        assert.equal(c.querySelector("[data-visibilidade]").dataset.visibilidade, "privado");
        assert.equal(pg.document.querySelectorAll("#habmag-lista img").length, 0, "texto do usuário nunca vira HTML");
        assert.match(c.textContent, /1d6\+1d4\+2 · Fogo · 3 Vigor/);
        const arquivo = JSON.parse(fs.readFileSync(path.join(s.dir, "catalogo", "habilidades.json"), "utf8"));
        assert.equal(arquivo.items.find(item => item.nome === nome).dice, "1d6+1d4+2", "fórmula composta preservada no JSON");

        // editar e publicar
        clicar(pg, c.querySelector('[data-acao="editar"]'));
        assert.equal(pg.document.getElementById("hm-efeitos").value, "queima\natordoa");
        preencher(pg, "hm-publico", true);
        preencher(pg, "hm-nome", "Chama Viva");
        clicar(pg, pg.document.getElementById("hm-salvar"));
        await esperarAte(() => cartaoDe(pg, "Chama Viva"), { rotulo: "cartão editado" });
        assert.equal(cartoes(pg).filter((x) => x.querySelector("h4").textContent.startsWith("Chama Viva")).length, 1, "editar não cria outra");
        assert.equal(cartaoDe(pg, "Chama Viva").querySelector("[data-visibilidade]").dataset.visibilidade, "publico");
        const id = cartaoDe(pg, "Chama Viva").dataset.id;
        assert.ok((await s.api("/api/catalogo/habilidades", null, ana.token)).items.some((i) => i.id === id), "pública: a ficha vê");

        // duplicar: cópia privada com id novo
        clicar(pg, cartaoDe(pg, "Chama Viva").querySelector('[data-acao="duplicar"]'));
        await esperarAte(() => cartaoDe(pg, "Chama Viva (cópia)"), { rotulo: "cópia" });
        const copia = cartaoDe(pg, "Chama Viva (cópia)");
        assert.notEqual(copia.dataset.id, id);
        assert.equal(copia.querySelector("[data-visibilidade]").dataset.visibilidade, "privado");

        // busca sem acento e sem maiúsculas
        preencher(pg, "habmag-busca", "CÓPIA");
        assert.deepEqual(cartoes(pg).map((x) => x.querySelector("h4").textContent), ["Chama Viva (cópia)"]);
        preencher(pg, "habmag-busca", "");

        // excluir: primeiro clique só pede confirmação
        const botao = () => cartaoDe(pg, "Chama Viva (cópia)").querySelector('[data-acao="excluir"]');
        clicar(pg, botao());
        assert.equal(botao().textContent, "Confirmar?");
        assert.ok(cartaoDe(pg, "Chama Viva (cópia)"), "ainda existe");
        clicar(pg, botao());
        await esperarAte(() => !cartaoDe(pg, "Chama Viva (cópia)"), { rotulo: "cópia excluída" });
        assert.ok(cartaoDe(pg, "Chama Viva"));
      } finally { pg.fechar(); }
    });

    it("duas páginas abertas: o que uma cria aparece na outra em tempo real; abas separam habilidades e magias", async () => {
      const a = await abrirPagina();
      const b = await abrirPagina();
      try {
        await esperarAte(() => a.run("habmag.carregou") && b.run("habmag.carregou"), { rotulo: "páginas carregarem" });
        clicar(a, a.document.getElementById("habmag-aba-magias"));
        clicar(b, b.document.getElementById("habmag-aba-magias"));
        clicar(a, a.document.getElementById("habmag-novo"));
        preencher(a, "hm-nome", "Raio Tempo Real");
        clicar(a, a.document.getElementById("hm-salvar"));
        await esperarAte(() => cartaoDe(b, "Raio Tempo Real"), { rotulo: "aparecer na outra página" });
        clicar(b, b.document.getElementById("habmag-aba-habilidades"));
        assert.ok(!cartaoDe(b, "Raio Tempo Real"), "magia não aparece na aba de habilidades");
      } finally { a.fechar(); b.fechar(); }
    });

    it("Adicionar à ficha: escolher o personagem e 1 clique entrega (online entra na hora)", async () => {
      const pg = await abrirPagina();
      const f = await abrir(ana);
      try {
        await esperarAte(() => pg.run("habmag.carregou"), { rotulo: "página carregar" });
        await esperarAte(() => f.run("personagemCarregado"), { rotulo: "ficha carregar" });
        await esperar(200);
        clicar(pg, pg.document.getElementById("habmag-atualizar-personagens"));
        await esperarAte(() => [...pg.document.getElementById("habmag-personagem").options].some((o) => /● Ana/.test(o.textContent)), { rotulo: "personagem online na lista" });
        const select = pg.document.getElementById("habmag-personagem");
        select.value = [...select.options].find((o) => /Ana/.test(o.textContent)).value;
        clicar(pg, pg.document.getElementById("habmag-novo"));
        preencher(pg, "hm-nome", "Entregue Por Clique");
        clicar(pg, pg.document.getElementById("hm-salvar"));
        await esperarAte(() => cartaoDe(pg, "Entregue Por Clique"), { rotulo: "cartão" });
        clicar(pg, cartaoDe(pg, "Entregue Por Clique").querySelector('[data-acao="enviar"]'));
        await esperarAte(() => f.run("STATE.abilities.some((a) => a.nome === 'Entregue Por Clique')"), { rotulo: "entrega na ficha" });
        assert.match(pg.document.getElementById("toast-container").textContent, /entregue a Ana/);
        // sem personagem escolhido: avisa
        select.value = "";
        clicar(pg, cartaoDe(pg, "Entregue Por Clique").querySelector('[data-acao="enviar"]'));
        assert.match(pg.document.getElementById("toast-container").textContent, /Escolha o personagem/);
      } finally { pg.fechar(); f.fechar(); }
    });

    it("com token errado a página não carrega o catálogo", async () => {
      const pg = await abrirPaginaMestre(s, "habilidades-magias", { real: true, tokenInicial: "errado" });
      try {
        await esperarAte(() => pg.run("socket.connected"), { rotulo: "conectar" });
        await esperarAte(() => /incorreta/.test(pg.run("habmag.erro")), { rotulo: "erro de autorização no catálogo" });
        assert.equal(pg.run("habmag.carregou"), false);
        assert.match(pg.document.getElementById("habmag-lista").textContent, /incorreta/);
      } finally { pg.fechar(); }
    });
  });
});

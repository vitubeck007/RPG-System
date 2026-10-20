const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { criarCampanha } = require("../campanha.js");
const { nomePastaFigurante } = require("../figurantes.js");
const { iniciarServidor, abrirPaginaMestre, esperarAte } = require("./ajuda/ambiente.js");

it("pastas de figurantes: organiza dados antigos, renomeia, remove e reconstrói ao restaurar backup", async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-figurantes-"));
  try {
    const dir = path.join(raiz, "campanha");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "npcs.json"), JSON.stringify({ schemaVersion: 1, items: [{ id: "npc_antigo", nome: "Ancião", lore: "Uma história antiga", segredo: "Não revelar" }] }));
    const opcoes = { pastaFigurantes: path.join(raiz, "Figurante"), log: { log() {}, warn() {}, error() {} } };
    const campanha = criarCampanha(dir, opcoes).iniciar();
    const original = campanha.ler("npcs")[0];
    const pasta = (item) => path.join(opcoes.pastaFigurantes, "NPCs", nomePastaFigurante(item));
    assert.equal(JSON.parse(fs.readFileSync(path.join(pasta(original), "figurante.json"))).segredo, "Não revelar");
    const backup = campanha.backup("antes") || campanha.listarBackups()[0];
    const novo = await campanha.salvarItem("npcs", { ...original, nome: "Ancião Renomeado", energia: { atual: 2, max: 5 } });
    assert.ok(fs.existsSync(path.join(pasta(novo), "figurante.json")));
    assert.equal(fs.existsSync(pasta(original)), false);
    const minusculo = await campanha.salvarItem("npcs", { ...novo, nome: novo.nome.toLowerCase() });
    assert.ok(fs.existsSync(path.join(pasta(minusculo), "figurante.json")), "trocar só maiúsculas/minúsculas não apaga o JSON no Windows");
    await campanha.removerItem("npcs", novo.id);
    assert.equal(fs.existsSync(pasta(novo)), false);
    await campanha.restaurar(backup);
    assert.ok(fs.existsSync(path.join(pasta(original), "figurante.json")));
    assert.equal(campanha.ler("npcs")[0].id, original.id);
    fs.writeFileSync(path.join(dir, "npcs.json"), "{ arquivo corrompido");
    const recuperacao = criarCampanha(dir, opcoes).iniciar();
    assert.ok(fs.existsSync(path.join(pasta(original), "figurante.json")), "corrupção do agregado preserva a cópia individual");
    await recuperacao.restaurar(backup);
    // Um arquivo bloqueando a nova pasta faz a operação falhar e mantém o estado confirmado anterior.
    const destinoBloqueado = path.join(opcoes.pastaFigurantes, "NPCs", "Bloqueado_npc_bloqueado");
    fs.writeFileSync(destinoBloqueado, "arquivo do usuário");
    await assert.rejects(campanha.salvarItem("npcs", { id: "npc_bloqueado", nome: "Bloqueado" }));
    assert.deepEqual(campanha.ler("npcs").map((n) => n.id), [original.id]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "npcs.json"))).items.map((n) => n.id), [original.id]);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

it("fluxo virtual: ficha unificada, criação e catálogo sobrepostos, energia, batalha, disco e reinício", async () => {
  const s = await iniciarServidor();
  let pagina, outra;
  const ler = (tipo, item) => JSON.parse(fs.readFileSync(path.join(s.dir, "Figurante", tipo, nomePastaFigurante(item), "figurante.json"), "utf8"));
  try {
    pagina = await abrirPaginaMestre(s, "figurantes", { real: true, tokenInicial: "senha-teste" });
    outra = await abrirPaginaMestre(s, "figurantes", { real: true, tokenInicial: "senha-teste" });
    await esperarAte(() => pagina.run("figurantes.carregou") && outra.run("figurantes.carregou"));
    const valor = (id, v) => { pagina.document.getElementById(id).value = v; };
    await pagina.run("abrirFichaFigurante()");
    valor("fig-nome", "Guardião da cripta"); valor("fig-descricao", "Armadura oxidada. Anda arrastando correntes.");
    valor("fig-lore", "Criado há séculos para proteger o túmulo."); valor("fig-notas", "Ao morrer, vira cinzas e deixa uma chave.");
    valor("fig-hp-max", "40"); valor("fig-energia-atual", "3"); valor("fig-energia-max", "3");
    pagina.run("abrirCriacaoPoderFig()");
    assert.equal(pagina.document.getElementById("fig-editor").classList.contains("hidden"), false);
    valor("fig-poder-tipo", "magias"); valor("fig-poder-nome", "Chama espectral"); valor("fig-poder-descricao", "<img src=x onerror=alert(1)> Fogo azul.");
    valor("fig-poder-efeito", "Queima por dois turnos."); valor("fig-poder-custo", "2"); valor("fig-poder-dano", "1d20+5");
    valor("fig-poder-alcance", "12 metros"); valor("fig-poder-duracao", "2 turnos"); valor("fig-poder-canalizacao", "1 ação");
    pagina.run('adicionarDanoExtraFig({ tipo: "Mental", dado: "1d6", efeito: "Causa medo" })');
    await pagina.run("salvarPoderFig()");
    assert.equal(pagina.document.getElementById("fig-poder-editor").classList.contains("hidden"), true);
    assert.equal(pagina.document.querySelector("#fig-poderes-lista img"), null, "descrição é texto, sem injeção HTML");
    await pagina.run("salvarFichaFigurante()");
    const inimigo = pagina.run("figurantes.inimigos[0]");
    const arquivo = ler("Inimigos", inimigo);
    assert.equal(arquivo.hpMax, 40); assert.equal(arquivo.magias[0].dice, "1d20+5");
    assert.equal(arquivo.magias[0].efeito, "Queima por dois turnos.");
    assert.equal(arquivo.magias[0].canalizacao, "1 ação");
    assert.equal(arquivo.magias[0].danosExtras[0].tipo, "Mental");
    assert.match(arquivo.nota, /chave/);
    assert.equal(pagina.run("figurantes.magias[0].publico"), false);
    await esperarAte(() => outra.run("figurantes.inimigos.length") === 1);

    await pagina.run('figurantes.tipo = "npcs"; renderizarFigurantes(); abrirFichaFigurante()');
    valor("fig-nome", "Anciã da vila"); valor("fig-descricao", "Fala baixo."); valor("fig-lore", "Conhece o guardião.");
    valor("fig-hp-atual", "8"); valor("fig-hp-max", "12"); valor("fig-energia-atual", "5"); valor("fig-energia-max", "5");
    await pagina.run("abrirCatalogoFig()");
    valor("fig-catalogo-tipo", "magias"); pagina.run("renderizarCatalogoFig()");
    pagina.document.querySelector('#fig-catalogo-lista button[data-acao="adicionar-catalogo"]').click();
    assert.equal(pagina.run("figurantes.poderes.magias.length"), 1);
    pagina.run('fecharJanelaFig("fig-catalogo")');
    await pagina.run("salvarFichaFigurante()");
    const npc = pagina.run("figurantes.npcs[0]");
    assert.equal(ler("NPCs", npc).magias[0].nome, "Chama espectral");
    // Vida/energia não editadas numa ficha antiga não desfazem ajustes feitos em outra aba.
    await pagina.run("abrirFichaFigurante(figurantes.npcs[0])");
    await outra.run(`pedirAoServidor("master_npc_hp", {id:${JSON.stringify(npc.id)}, delta:-2}, {muda:true})`);
    await outra.run(`pedirAoServidor("master_figurante_energia", {tipo:"npcs", id:${JSON.stringify(npc.id)}, delta:-1}, {muda:true})`);
    valor("fig-lore", "História atualizada sem desfazer os vitais."); await pagina.run("salvarFichaFigurante()");
    assert.equal(ler("NPCs", npc).hp.atual, 6); assert.equal(ler("NPCs", npc).energia.atual, 4);
    await pagina.run(`pedirAoServidor("master_batalha_adicionar", {modeloId:${JSON.stringify(inimigo.id)}, quantidade:1}, {muda:true})`);
    const alvo = pagina.run("figurantes.batalha.combatentes[0]");
    assert.equal(alvo.magias[0].canalizacao, "1 ação");
    const pedido = JSON.stringify({ tipo: "batalha", id: alvo.alvoId, lista: "magias", indice: 0, nome: "Chama espectral" });
    await pagina.run(`pedirAoServidor("master_figurante_usar_poder", ${pedido}, {muda:true})`);
    await assert.rejects(pagina.run(`pedirAoServidor("master_figurante_usar_poder", ${pedido}, {muda:true})`), /Energia insuficiente/);
    assert.equal(pagina.run("figurantes.batalha.combatentes[0].energia.atual"), 1);
    const proibido = await fetch(`${s.url}/Figurante/Inimigos/${nomePastaFigurante(inimigo)}/figurante.json`);
    assert.equal(proibido.status, 404, "não expõe dados privados por URL");
    assert.equal((await fetch(`${s.url}/mestre/figurantes`)).status, 200);
    pagina.fechar(); pagina = null; outra.fechar(); outra = null;
    await s.reiniciar();
    pagina = await abrirPaginaMestre(s, "figurantes", { real: true, tokenInicial: "senha-teste" });
    await esperarAte(() => pagina.run("figurantes.carregou"));
    assert.equal(pagina.run("figurantes.npcs[0].lore"), "História atualizada sem desfazer os vitais.");
    assert.equal(pagina.run("figurantes.batalha.combatentes[0].energia.atual"), 1);
    assert.equal(pagina.run("figurantes.inimigos[0].magias[0].danosExtras[0].dado"), "1d6");
    assert.deepEqual(pagina.erros, []);
  } finally { pagina?.fechar(); outra?.fechar(); await s.parar(); }
});

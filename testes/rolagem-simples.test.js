/* Refatoração compacta: regras compartilhadas e um fluxo completo em servidor descartável. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lerExpressaoRolagem, calcularDano } = require("../JS/regras.js");
const { rolar } = require("../rolagem.js");
const { iniciarServidor, abrirPaginaMestre, abrirFicha, esperarAte } = require("./ajuda/ambiente");

test("expressões compostas, dados negativos e multiplicadores decimais usam a mesma regra", () => {
  assert.ok(lerExpressaoRolagem("2d20+5+3d6+1"));
  const resultado = rolar("2d20+5+3d6+1", () => 1);
  assert.equal(resultado.total, 11);
  assert.equal(resultado.componentes.flatMap(c => c.dados).length, 5);
  assert.equal(rolar("2d6-1d4-2", () => 1).total, -1);
  assert.equal(rolar("20", () => { throw new Error("Constante não sorteia dados"); }).total, 20);
  for (const lados of [20, 12, 10, 8, 6, 4]) {
    const r = rolar(`3d${lados}`, () => lados);
    assert.equal(r.total, lados * 3);
    assert.deepEqual(r.componentes.flatMap(c => c.dados), [lados, lados, lados]);
  }
  for (const expressao of ["", "2d20++5", "2d20+", "0d6", "1000d6", "d1001", "1d20/2", "1d6;alert(1)", "NaN", "Infinity", null]) {
    assert.equal(lerExpressaoRolagem(expressao), null, String(expressao));
  }
  for (const [mult, esperado] of [[0, 0], [0.5, 10], [1, 20], [1.5, 30], [2.5, 50], [3, 60]]) assert.equal(calcularDano(20, mult), esperado);
  assert.equal(calcularDano(7, 0.5), 3, "arredondamento existente para baixo");
  assert.equal(calcularDano(100, 0.29), 29, "produto decimal exato não perde um ponto por arredondamento binário");
  assert.equal(calcularDano(10, 0.09999999999999999), 0, "não adiciona epsilon a um resultado realmente abaixo de um");
  for (const mult of [-1, NaN, Infinity, "1", null]) assert.equal(calcularDano(20, mult), null);
});

test("mesa compacta: seis atalhos, seleção entre categorias, ataque único e sincronização", async () => {
  const s = await iniciarServidor();
  const paginas = [], fichas = [], identidades = [];
  const clicar = el => { assert.ok(el, "controle existe"); el.click(); };
  const mudar = (pg, el, valor) => {
    assert.ok(el, "campo existe");
    if (el.type === "checkbox") el.checked = valor; else el.value = String(valor);
    el.dispatchEvent(new pg.window.Event("input", { bubbles: true }));
    el.dispatchEvent(new pg.window.Event("change", { bubbles: true }));
  };
  try {
    for (const nome of ["Ana", "Bia", "Caio"]) {
      const login = await s.api("/api/login", { nome: `rol-${nome.toLowerCase()}`, senha: "teste", criarSeNaoExistir: true });
      const criado = await s.api("/api/personagens", { nome }, login.token);
      const identidade = { player: login.player, token: login.token, nomePasta: criado.personagem.nomePasta, nome };
      identidades.push(identidade);
      fs.writeFileSync(path.join(s.dir, "players", identidade.player, identidade.nomePasta, "status.json"), JSON.stringify({ schemaVersion: 1, hp: { current: 1000, max: 1000 }, vigor: { current: 13, max: 20 }, sanity: { current: 8, max: 10 } }));
      fichas.push(await abrirFicha(s, identidade));
    }
    const pg = await abrirPaginaMestre(s, "rolagem", { real: true, tokenInicial: "senha-teste" }); paginas.push(pg);
    await esperarAte(() => pg.run("rol.carregou && rol.alvos.filter(a => a.tipo === 'jogador').length === 3"));
    const pedir = (evento, dados = {}) => pg.run(`pedirAoServidor(${JSON.stringify(evento)}, ${JSON.stringify(dados)}, { muda: true })`);
    const modelo = await pedir("master_campanha_salvar", { tipo: "inimigos", item: { nome: "Guardião", hpMax: 1000, energia: { atual: 11, max: 15 }, imagem: "/CSS/retrato-padrao.svg" } });
    const adicionado = await pedir("master_batalha_adicionar", { modeloId: modelo.id, quantidade: 1 });
    const inimigoId = adicionado.adicionados[0].alvoId;
    const npc = await pedir("master_campanha_salvar", { tipo: "npcs", item: { nome: "Observador", hp: { atual: 1000, max: 1000 }, energia: { atual: 9, max: 12 } } });
    await pg.run("carregarAlvos()");
    const alvoId = nome => pg.run(`rol.alvos.find(a => a.nome === ${JSON.stringify(nome)}).alvoId`);
    const linha = id => pg.document.querySelector(`#atk-alvos [data-alvo-id="${id}"]`);
    const selecionar = id => clicar(linha(id)?.querySelector(".fig-resumo-selecionar"));
    const mult = (id, valor) => mudar(pg, linha(id).querySelector('[data-campo="mult"]'), valor);
    const rolagens = () => pg.run("rol.historico.length");
    const terminou = n => esperarAte(() => pg.run("!rol.ocupada") && rolagens() === n);
    const executar = async expressao => {
      const antes = rolagens(); mudar(pg, pg.document.getElementById("rol-expressao"), expressao);
      clicar(pg.document.getElementById("rol-rolar")); await terminou(antes + 1);
      return JSON.parse(pg.run("JSON.stringify(rol.historico[0])"));
    };
    const ana = alvoId("Ana"), bia = alvoId("Bia"), caio = alvoId("Caio");
    assert.equal(pg.document.getElementById("atk-atacar").checked, false);
    assert.equal(pg.document.querySelectorAll("[data-dado]").length, 6);
    for (const lados of [20, 12, 10, 8, 6, 4]) {
      const antes = rolagens(); clicar(pg.document.querySelector(`[data-dado="${lados}"]`)); await terminou(antes + 1);
      const dados = JSON.parse(pg.run("JSON.stringify(rol.historico[0].componentes.flatMap(c => c.dados))"));
      assert.equal(dados.length, 1); assert.ok(dados[0] >= 1 && dados[0] <= lados);
    }
    mudar(pg, pg.document.getElementById("rol-quantidade"), 3);
    let antes = rolagens(); clicar(pg.document.querySelector('[data-dado="20"]')); await terminou(antes + 1);
    assert.equal(pg.run("rol.historico[0].componentes.flatMap(c => c.dados).length"), 3);
    const composta = await executar("2d20+5+3d6+1");
    assert.equal(composta.componentes.flatMap(c => c.dados).length, 5);
    assert.equal(composta.total, composta.componentes.reduce((soma, c) => soma + c.soma, 0));
    assert.equal(Number(pg.document.getElementById("rol-total").textContent), composta.total);
    assert.ok(pg.document.getElementById("rol-detalhes").textContent.trim());
    assert.equal(fichas[0].run("STATE.vitals.hp.current"), 1000, "sem alvos/ataque desligado, rolar não causa dano");

    selecionar(ana); mult(ana, 0.5); selecionar(bia); mult(bia, 1.5);
    clicar(pg.document.getElementById("atk-inimigos"));
    assert.equal(linha(ana), null, "jogadores ficam ocultos na outra categoria");
    assert.ok(linha(inimigoId)); assert.ok(linha(npc.id));
    selecionar(inimigoId); mult(inimigoId, 3);
    assert.equal(pg.run("[...rol.marcados.values()].filter(a => a.marcado).length"), 3);
    await executar("20");
    assert.equal(fichas[0].run("STATE.vitals.hp.current"), 1000, "selecionar com Atacar desligado não aplica dano");
    clicar(pg.document.getElementById("atk-jogadores"));
    assert.equal(linha(ana).querySelector('[data-campo="mult"]').value, "0.5");
    assert.equal(linha(bia).querySelector('[data-campo="mult"]').value, "1.5");
    assert.equal(linha(ana).querySelector("button").getAttribute("aria-pressed"), "true");
    mudar(pg, pg.document.getElementById("atk-atacar"), true);
    const selecaoAntes = pg.run("JSON.stringify([...rol.marcados])");
    mudar(pg, pg.document.getElementById("atk-atacar"), false);
    assert.equal(pg.run("JSON.stringify([...rol.marcados])"), selecaoAntes, "interruptor não apaga seleção/multiplicadores");
    mudar(pg, pg.document.getElementById("atk-atacar"), true);

    const batalha = await abrirPaginaMestre(s, "figurantes", { real: true, tokenInicial: "senha-teste" }); paginas.push(batalha);
    await esperarAte(() => batalha.run("figurantes.carregou"));
    const ataque = await executar("20");
    await esperarAte(() => fichas[0].run("STATE.vitals.hp.current") === 990 && fichas[1].run("STATE.vitals.hp.current") === 970);
    await esperarAte(() => batalha.run(`figurantes.batalha.combatentes.find(c => c.alvoId === ${JSON.stringify(inimigoId)}).hp.atual`) === 940);
    assert.equal(fichas[2].run("STATE.vitals.hp.current"), 1000, "não selecionado não recebe dano");
    for (const ficha of fichas) assert.equal(ficha.run("STATE.vitals.vigor.current"), 13, "dano não altera energia");
    assert.equal(batalha.run(`figurantes.batalha.combatentes.find(c => c.alvoId === ${JSON.stringify(inimigoId)}).energia.atual`), 11);
    assert.equal(s.lerArquivo(identidades[0].player, identidades[0].nomePasta, "status").hp.current, 990);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "campanha", "batalha.json"), "utf8")).combatentes[0].hp.atual, 940);

    const repeticoes = await Promise.all([1, 2].map(() => pedir("master_aplicar_dano", { rolagemId: ataque.rolagemId, alvos: [{ alvoId: ana, mult: 0.5 }, { alvoId: bia, mult: 1.5 }, { alvoId: inimigoId, mult: 3 }] })));
    assert.equal(repeticoes[0].aplicacaoId, repeticoes[1].aplicacaoId);
    const outraOrdem = await pedir("master_aplicar_dano", { rolagemId: ataque.rolagemId, alvos: [{ alvoId: inimigoId, mult: 3 }, { alvoId: bia, mult: 1.5 }, { alvoId: ana, mult: 0.5 }] });
    assert.equal(outraOrdem.aplicacaoId, repeticoes[0].aplicacaoId, "reordenar a mesma seleção continua sendo o mesmo ataque");
    for (const alvos of [[{ alvoId: caio, mult: 1 }], [{ alvoId: ana, mult: 2 }, { alvoId: bia, mult: 1.5 }, { alvoId: inimigoId, mult: 3 }]]) {
      await assert.rejects(pedir("master_aplicar_dano", { rolagemId: ataque.rolagemId, alvos }), erro => erro.codigo === "rolagem_ja_aplicada", "mesmo rolId não pode ser reaproveitado com outro alvo/multiplicador");
    }
    assert.equal(fichas[0].run("STATE.vitals.hp.current"), 990, "mesma rolagem com novo acaoId não causa dano novamente");
    assert.equal((await pedir("master_campanha_ler", { tipo: "npcs" })).find(a => a.id === npc.id).hp.atual, 1000);
    const excesso = await pedir("master_aplicar_dano", { valor: 100000, alvos: [{ alvoId: ana, mult: 3 }, { alvoId: inimigoId, mult: 1 }] });
    assert.ok(excesso.resultados.every(r => r.ok && r.depois === 0 && r.derrotado), "dano excessivo para em zero");
    await esperarAte(() => fichas[0].run("STATE.vitals.hp.current") === 0);
    assert.equal(fichas[0].run("STATE.vitals.vigor.current"), 13);
    await pedir("master_desfazer_dano", { aplicacaoId: excesso.aplicacaoId });
    await esperarAte(() => fichas[0].run("STATE.vitals.hp.current") === 990);

    // Entradas inválidas não criam outra rolagem nem deixam a página bloqueada.
    antes = rolagens();
    for (const invalida of ["2d20++5", "d0", "1d20;alert(1)"]) {
      mudar(pg, pg.document.getElementById("rol-expressao"), invalida); clicar(pg.document.getElementById("rol-rolar"));
      assert.equal(rolagens(), antes); assert.equal(pg.run("rol.ocupada"), false);
    }
    mudar(pg, pg.document.getElementById("rol-quantidade"), 0); clicar(pg.document.querySelector('[data-dado="6"]'));
    assert.equal(rolagens(), antes);
    mudar(pg, pg.document.getElementById("rol-quantidade"), 1);
    mult(ana, -1); clicar(pg.document.querySelector('[data-dado="6"]'));
    assert.equal(rolagens(), antes);
    mult(ana, 0.5);
    await assert.rejects(pedir("master_aplicar_dano", { valor: 20, alvos: [{ alvoId: ana, mult: -1 }] }), /ultiplicador/);
    await assert.rejects(pedir("master_rolar", { expressao: "2d20++5" }), /inválida/i);

    mudar(pg, pg.document.getElementById("atk-atacar"), false);
    selecionar(ana); assert.equal(pg.run(`rol.marcados.get(${JSON.stringify(ana)}).marcado`), false);
    antes = rolagens();
    clicar(pg.document.querySelector('[data-dado="4"]')); clicar(pg.document.querySelector('[data-dado="4"]'));
    await terminou(antes + 1);
    const ultimaRolagem = pg.run("rol.historico[0].rolagemId");
    pg.document.querySelector('[data-dado="4"]').dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true, detail: 2 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pg.run("rol.ocupada"), false, "segundo clique físico tardio é ignorado mesmo após concluir o primeiro");
    assert.equal(pg.run("rol.historico[0].rolagemId"), ultimaRolagem);

    const fichaBia = fichas.splice(1, 1)[0]; fichaBia.fechar();
    await esperarAte(async () => {
      await pg.run("carregarAlvos()");
      return pg.run(`!rol.alvos.some(a => a.alvoId === ${JSON.stringify(bia)}) && rol.ausentes.some(a => a.alvoId === ${JSON.stringify(bia)})`);
    }, { rotulo: "jogadora desconectada permanece selecionada como indisponível" });
    assert.equal(pg.run(`rol.marcados.get(${JSON.stringify(bia)}).marcado`), true);
    assert.equal(linha(bia).querySelector('[data-campo="mult"]').value, "1.5");
    assert.match(linha(bia).textContent, /Indisponível/);
    selecionar(bia);
    assert.equal(pg.run(`rol.marcados.get(${JSON.stringify(bia)}).marcado`), false);
    assert.equal(linha(bia), null, "card indisponível pode ser desmarcado sem recarregar a página");
    assert.deepEqual(pg.erros, []); assert.deepEqual(batalha.erros, []);
  } finally {
    paginas.forEach(pg => pg.fechar()); fichas.forEach(ficha => ficha.fechar()); await s.parar();
  }
});

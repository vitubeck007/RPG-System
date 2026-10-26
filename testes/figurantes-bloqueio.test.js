const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { abrirPaginaMestre, esperarAte } = require("./ajuda/ambiente");

test("HP sem resumo no HTML: confirmações, recusas e falhas locais liberam os controles", async () => {
  const pg = await abrirPaginaMestre({ dir: path.resolve(__dirname, ".."), url: "http://127.0.0.1:3000" }, "figurantes", { tokenInicial: "chave-ficticia" });
  const avisos = [], falhas = [];
  pg.window.toast = texto => avisos.push(texto);
  pg.window.console.error = (...args) => falhas.push(args);
  try {
    pg.run(`socket.connected = true;
      figurantes.carregou = true; figurantes.aba = "batalha";
      figurantes.inimigos = [{id:"ini_teste",nome:"Teste",hpMax:20,energia:{atual:10,max:10},atributos:{},habilidades:[],magias:[]}];
      figurantes.batalha = {ativa:true,combatentes:[{alvoId:"cb_teste",modeloId:"ini_teste",tipo:"inimigo",nome:"Teste 1",hp:{atual:20,max:20},energia:{atual:10,max:10},atributos:{},habilidades:[],magias:[]}]};`);
    // Reproduz a remoção intencional do resumo mesmo se ele voltar ao HTML no futuro.
    pg.document.getElementById("fig-batalha-resumo")?.remove();
    assert.doesNotThrow(() => pg.run("renderizarFigurantes()"));
    const vida = () => pg.document.querySelector('#fig-selecionado [aria-label="Vida atual de Teste 1"]');
    const diminuir = () => pg.document.querySelector('#fig-selecionado [aria-label="Diminuir vida de Teste 1"]');
    const pedidosHp = () => pg.falso.pedidos.filter(p => p.evento === "master_batalha_hp");
    const liberou = () => pg.run("recursosPendentesFig.size === 0") && !vida().disabled && !diminuir().disabled;

    diminuir().click();
    await esperarAte(() => pedidosHp().length === 1);
    assert.equal(vida().disabled, true, "bloqueio existe apenas enquanto o pedido está pendente");
    assert.equal(pedidosHp()[0].dados.token, "chave-ficticia");
    assert.equal(pedidosHp()[0].dados.delta, -1);
    const atualizado = JSON.parse(pg.run("JSON.stringify(figurantes.batalha)"));
    atualizado.combatentes[0].hp.atual = 19;
    pg.disparar("campanha_atualizada", { tipo: "batalha", dados: atualizado });
    pedidosHp()[0].cb(null, { ok: true, dados: { hp: { atual: 19, max: 20 }, derrotado: false } });
    await esperarAte(liberou);
    assert.equal(vida().value, "19");

    diminuir().click();
    await esperarAte(() => pedidosHp().length === 2);
    pedidosHp()[1].cb(null, { ok: false, erro: "nao_autorizado", mensagem: "Chave recusada no teste" });
    await esperarAte(liberou);
    assert.equal(vida().value, "19", "recusa não aplica o valor localmente");

    pg.run(`var renderOriginalTeste = renderizarFigurantes;
      renderizarFigurantes = () => { renderizarFigurantes = renderOriginalTeste; throw new Error("Falha visual simulada"); };`);
    diminuir().click();
    await esperarAte(liberou);
    assert.equal(pedidosHp().length, 2, "falha antes do envio não cria pedido nem deixa pendência presa");
    assert.ok(avisos.some(texto => texto.includes("Falha na interface")));

    pg.run(`renderizarFigurantes = () => { renderizarFigurantes = renderOriginalTeste; throw new Error("Falha ao carregar interface"); };
      carregarFigurantes();`);
    const leitura = pg.falso.pedidos.at(-1);
    assert.equal(leitura.evento, "master_campanha_ler");
    leitura.cb(null, { ok: true, dados: JSON.parse(pg.run("JSON.stringify({inimigos:figurantes.inimigos,npcs:[],habilidades:[],magias:[],batalha:figurantes.batalha})")) });
    await esperarAte(() => avisos.some(texto => texto.includes("Falha ao montar a interface")));
    assert.equal(avisos.some(texto => texto.includes("Confira a conexão e o token")), false);
    assert.equal(falhas.length, 2, "falhas locais ficam registradas no console");
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

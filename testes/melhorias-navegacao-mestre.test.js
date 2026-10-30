const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { abrirPaginaMestre } = require('./ajuda/ambiente');

test('mestre: recuperação local, campos inválidos, seleção, biblioteca e alvos visíveis', async () => {
  const paginas = [];
  const abrir = async nome => {
    const pg = await abrirPaginaMestre({ dir: path.resolve(__dirname, '..'), url: 'http://localhost' }, nome);
    paginas.push(pg); return pg;
  };
  const input = (pg, id, valor) => {
    const el = pg.document.getElementById(id); el.value = valor;
    el.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
  };
  try {
    const fig = await abrir('figurantes');
    fig.run(`figurantes.carregou = true;
      figurantes.inimigos = Array.from({length:105}, (_, i) => ({id:'i'+i,nome:'Inimigo '+String(i).padStart(3,'0'),hpMax:10,energia:{atual:8,max:10}}));
      renderizarFigurantes();`);
    assert.equal(fig.document.querySelectorAll('#fig-cartoes > article').length, 100);
    fig.document.getElementById('fig-carregar-mais').click();
    assert.equal(fig.document.querySelectorAll('#fig-cartoes > article').length, 105);
    assert.equal(fig.document.getElementById('fig-carregar-mais').hidden, true);
    assert.match(fig.document.querySelector('[data-fig-maximo="hp"]').textContent, /Máxima do modelo/);
    fig.run(`figurantes.aba = 'batalha';
      figurantes.batalha.combatentes = ['A','B'].map(nome => ({alvoId:nome,tipo:'inimigo',nome,hp:{atual:10,max:10},energia:{atual:8,max:10}}));
      figurantes.selecionados.inimigos = 'A'; renderizarFigurantes();`);
    input(fig, 'fig-busca', 'B');
    assert.equal(fig.run('figurantes.selecionados.inimigos'), 'A');
    assert.equal(fig.document.getElementById('fig-selecao-aviso').hidden, false);
    assert.equal(fig.document.querySelector('#fig-selecionado article').dataset.id, 'A');
    assert.equal(JSON.parse(fig.window.sessionStorage.getItem('rpg_mestre_contexto:figurantes')).selecionados.inimigos, 'A');
    fig.document.getElementById('fig-limpar-filtro').click();
    assert.equal(fig.document.getElementById('fig-selecao-aviso').hidden, true);
    let confirmacao = '';
    fig.window.confirm = texto => { confirmacao = texto; return false; };
    fig.document.getElementById('fig-limpar').click();
    assert.match(confirmacao, /2 combatentes/);
    assert.equal(fig.falso.pedidos.some(p => p.evento === 'master_batalha_limpar'), false);

    fig.run(`figurantes.aba = 'biblioteca'; renderizarFigurantes();
      entrarNaSalaDoMestre = async () => ({recursos:{armaFigurante:true}});`);
    fig.document.getElementById('master-token-input').value = 'teste';
    await fig.run('abrirFichaFigurante()');
    input(fig, 'fig-nome', 'Guardião'); input(fig, 'fig-imagem', 'javascript:erro');
    await fig.run('salvarFichaFigurante()');
    assert.equal(fig.document.getElementById('fig-imagem').getAttribute('aria-invalid'), 'true');
    assert.equal(fig.document.activeElement.id, 'fig-imagem');
    input(fig, 'fig-imagem', '');
    fig.run(`figurantes.poderes.habilidades.push({nome:'Golpe',dice:'1d6+1d4+2'}); renderizarPoderesFig();
      guardarRascunhoEditorMestre('fig-editor');`);
    const chave = [...Array(fig.window.localStorage.length)].map((_, i) => fig.window.localStorage.key(i)).find(k => k.includes(':fig-editor:'));
    const rascunho = fig.window.localStorage.getItem(chave);
    assert.ok(rascunho);
    fig.run("limparProtecaoEditorMestre('fig-editor'); fecharJanelaFig('fig-editor', true)");
    fig.window.localStorage.setItem(chave, rascunho);
    await fig.run('abrirFichaFigurante()');
    assert.equal(fig.document.getElementById('fig-nome').disabled, true);
    fig.document.querySelector('[data-acao="restaurar-rascunho"]').click();
    assert.equal(fig.document.getElementById('fig-nome').value, 'Guardião');
    assert.equal(fig.run('figurantes.poderes.habilidades[0].dice'), '1d6+1d4+2');
    assert.equal(fig.document.getElementById('fig-nome').disabled, false);
    fig.run("fecharJanelaFig('fig-editor', true)");
    assert.equal(fig.window.localStorage.getItem(chave), null);

    const hm = await abrir('habilidades-magias');
    hm.run("abrirEditor(null)"); input(hm, 'hm-nome', 'Rascunho de magia');
    hm.run("guardarRascunhoEditorMestre('habmag-editor')");
    assert.ok([...Array(hm.window.localStorage.length)].some((_, i) => hm.window.localStorage.key(i).includes('habmag-editor')));
    hm.run("habmag.tipo='magias'; habmag.busca='Chama'");
    hm.window.dispatchEvent(new hm.window.Event('pagehide'));
    assert.equal(JSON.parse(hm.window.sessionStorage.getItem('rpg_mestre_contexto:poderes')).tipo, 'magias');

    const rol = await abrir('rolagem');
    rol.run(`rol.alvos = [{alvoId:'p',nome:'Ana',tipo:'jogador'},{alvoId:'g',nome:'Goblin',tipo:'inimigo'}];
      rol.marcados.set('p',{marcado:true,mult:1}); rol.marcados.set('g',{marcado:true,mult:0.5});
      rol.ultimaRolagem={dados:{total:10},aplicada:false,chave:''}; renderizarAlvos();`);
    assert.equal(rol.document.querySelectorAll('#atk-selecao-resumo li').length, 2);
    assert.match(rol.document.getElementById('atk-selecao-resumo').textContent, /Goblin.*5 de dano/);
    rol.document.querySelector('[aria-label="Desmarcar Goblin"]').click();
    assert.equal(rol.run("rol.marcados.get('g').marcado"), false);
    assert.equal(rol.document.querySelectorAll('#atk-selecao-resumo li').length, 1);
    for (const pg of paginas) assert.deepEqual(pg.erros, []);
  } finally { paginas.forEach(pg => pg.fechar()); }
});

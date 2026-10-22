// Um caso básico virtual: sem servidor, rede, escrita de personagens ou campanha.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { abrirPaginaMestre } = require('./ajuda/ambiente');
const raiz = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function abrirLocal(arquivo, sessao = {}, socket = null) {
  const original = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
  const erros = [], consoleVirtual = new VirtualConsole();
  consoleVirtual.on('jsdomError', erro => erros.push(erro.message));
  const dom = new JSDOM(original.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: `http://localhost/${arquivo}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: consoleVirtual,
  });
  const w = dom.window;
  Object.entries(sessao).forEach(([k, v]) => w.sessionStorage.setItem(k, v));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, set(v) { this.textContent = v; } });
  w.confirm = () => true;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, items: [], personagens: [] }) });
  w.io = () => socket;
  const run = codigo => new vm.Script(codigo).runInContext(dom.getInternalVMContext());
  for (const [, src, inline] of original.matchAll(/<script(?: src="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)) {
    if (src && /^\/?JS\//.test(src)) run(fs.readFileSync(path.join(raiz, src.replace(/^\//, '')), 'utf8'));
    else if (!src && !inline.includes('tailwind.config')) run(inline);
  }
  await tick();
  return { w, run, erros, fechar: () => w.close() };
}

test('smoke 9–16 e 21: acesso antecipado, estado visual, ajustes, edição e espera limitada', async () => {
  const fechar = [];
  const abrirMestre = async pagina => {
    const pg = await abrirPaginaMestre({ dir: raiz, url: 'http://localhost' }, pagina);
    fechar.push(() => pg.fechar()); return pg;
  };
  try {
    const fig = await abrirMestre('figurantes');
    const el = id => fig.document.getElementById(id);
    el('fig-nome').value = 'Não apagar antes de autorizar';
    await fig.run('abrirFichaFigurante()');
    assert.equal(el('fig-editor').classList.contains('hidden'), true);
    assert.equal(fig.document.activeElement.id, 'master-token-input');
    assert.equal(el('fig-nome').value, 'Não apagar antes de autorizar');
    el('master-token-input').value = 'chave-teste'; fig.run('socket.connected = true');
    const abertura = fig.run('abrirFichaFigurante()');
    fig.run('abrirFichaFigurante()');
    assert.equal(fig.falso.pedidos.filter(p => p.evento === 'master_entrar').length, 1);
    assert.equal(el('fig-editor').classList.contains('hidden'), true, 'aguarda autorização antes de abrir');
    fig.falso.pedidos.at(-1).cb(null, { ok: false, erro: 'nao_autorizado', mensagem: 'Chave inválida' });
    await abertura;
    assert.equal(el('fig-editor').classList.contains('hidden'), true);
    const aberturaValida = fig.run('abrirFichaFigurante()');
    fig.falso.pedidos.at(-1).cb(null, { ok: true, dados: { sala: 'mestres', recursos: { armaFigurante: true } } });
    await aberturaValida;
    assert.equal(el('fig-editor').classList.contains('hidden'), false);
    el('fig-nome').value = 'Rascunho em andamento';
    fig.run(`figurantes.inimigos = [{id:'i1',nome:'Guardião',hpMax:40,energia:{atual:9,max:10},habilidades:[{uid:'p1',nome:'Fogo',desc:'Chama'}]}];
      figurantes.carregou = true; renderizarFigurantes()`);
    let card = el('fig-cartoes').firstElementChild;
    card.querySelector('details').open = true;
    card.querySelector('[data-preservar="copias"]').value = '7'; card.querySelector('[data-preservar="copias"]').focus();
    fig.run(`figurantes.inimigos[0].energia.atual = 8; renderizarFigurantes()`);
    card = el('fig-cartoes').firstElementChild;
    assert.equal(card.querySelector('details').open, true);
    assert.equal(card.querySelector('[data-preservar="copias"]').value, '7');
    assert.equal(fig.document.activeElement, card.querySelector('[data-preservar="copias"]'));
    assert.equal(card.querySelector('[data-preservar-foco="energia"]').value, '8');
    assert.equal(el('fig-nome').value, 'Rascunho em andamento');
    fig.run('fecharJanelaFig("fig-editor", true)');
    const energia = card.querySelector('[data-preservar-foco="energia"]');
    energia.value = '4'; energia.dispatchEvent(new fig.window.Event('change'));
    const ajuste = fig.falso.pedidos.at(-1);
    assert.equal(ajuste.evento, 'master_figurante_energia'); assert.equal(ajuste.dados.atual, 4);
    ajuste.cb(null, { ok: true, dados: {} }); await tick();
    assert.equal(card.querySelector('[data-acao="Ajustar energia…"]'), null);

    const rol = await abrirMestre('rolagem');
    rol.run(`rol.alvos = [{alvoId:'npc:1',nome:'Aliado',tipo:'npc',hp:{atual:20,max:20}}]; renderizarAlvos()`);
    let linha = rol.document.querySelector('[data-alvo-id]');
    linha.querySelector('label').click();
    assert.equal(linha.querySelector('input').checked, true);
    const mult = linha.querySelector('select'); mult.value = '0.5';
    mult.dispatchEvent(new rol.window.Event('change')); mult.focus();
    rol.run(`rol.alvos[0].hp.atual = 17; renderizarAlvos()`);
    linha = rol.document.querySelector('[data-alvo-id]');
    assert.equal(linha.dataset.marcado, 'true'); assert.equal(linha.querySelector('select').value, '0.5');
    assert.equal(rol.document.activeElement, linha.querySelector('select'));
    linha.querySelector('select').click(); assert.equal(linha.querySelector('input').checked, true);

    for (const [pagina, editor, nome, numero] of [
      ['loot', 'abrirEditorItem()', 'li-name', 'li-w'],
      ['habilidades-magias', 'abrirEditor()', 'hm-nome', 'hm-custo-valor'],
    ]) {
      const pg = await abrirMestre(pagina);
      pg.run(editor);
      const salvar = pagina === 'loot' ? 'salvarItem()' : 'salvarEditor()';
      await pg.run(salvar);
      assert.equal(pg.document.getElementById(nome).getAttribute('aria-invalid'), 'true');
      assert.equal(pg.document.activeElement.id, nome);
      pg.document.getElementById(nome).value = 'Somente teste';
      pg.document.getElementById(numero).value = '-1';
      await pg.run(salvar);
      assert.equal(pg.document.getElementById(numero).getAttribute('aria-invalid'), 'true');
      assert.equal(pg.falso.pedidos.filter(p => p.evento === 'master_campanha_salvar').length, 0);
      assert.deepEqual(pg.erros, []);
    }

    const socket = { connected: false, active: false, on() {}, emit() {}, connect() {}, close() {}, timeout() { return { emit() {} }; } };
    const ficha = await abrirLocal('index.html', { rpg_token: 'teste', rpg_character: JSON.stringify({ player: 'teste', nomePasta: 'Ficha_1' }) }, socket);
    fechar.push(ficha.fechar);
    ficha.run(`personagemCarregado = true; GLOBAL_CONFIG.AtivarMana = true;
      STATE.vitals = {hp:{current:10,max:20},vigor:{current:10,max:10},sanity:{current:10,max:10}};
      STATE.abilities = [{uid:'cx_fixo',catalogId:'cat_fixo',nome:'Fogo',dice:'1d6',cost:{vital:'vigor',amount:3},efeitos:['Queima'],duracao:'2 turnos'}];
      renderizarCodice(); renderizarPericias(); abrirAjusteVital('hp')`);
    const fd = ficha.w.document;
    fd.getElementById('rpg-ajuste-delta').value = '-6';
    fd.getElementById('rpg-ajuste-delta').dispatchEvent(new ficha.w.Event('input'));
    ficha.run('STATE.vitals.hp.current = 12');
    fd.getElementById('rpg-ajuste').querySelector('form').dispatchEvent(new ficha.w.Event('submit', { cancelable: true }));
    assert.equal(ficha.run('STATE.vitals.hp.current'), 12, 'mudança concorrente exige reconferir a prévia');
    fd.getElementById('rpg-ajuste').querySelector('form').dispatchEvent(new ficha.w.Event('submit', { cancelable: true }));
    await tick(); assert.equal(ficha.run('STATE.vitals.hp.current'), 6);
    ficha.run(`abrirModalCodice('criar'); document.getElementById('codice-f-nome').value='Rascunho novo'; fecharModalCodice(); editarEntradaCodice('habilidades', STATE.abilities[0])`);
    assert.equal(fd.getElementById('codice-f-custo-valor').value, '3');
    fd.getElementById('codice-f-nome').value = 'Fogo editado';
    ficha.run('criarEntradaCodice()');
    assert.equal(ficha.run('STATE.abilities.length'), 1);
    assert.equal(ficha.run('STATE.abilities[0].uid'), 'cx_fixo');
    assert.equal(ficha.run('STATE.abilities[0].catalogId'), 'cat_fixo');
    assert.equal(ficha.run('STATE.abilities[0].efeitos[0]'), 'Queima');
    assert.equal(ficha.run('STATE.abilities[0].cost.amount'), 3);
    assert.equal(ficha.run('STATE.abilities[0].duracao'), '2 turnos');
    ficha.run(`abrirModalCodice('criar')`);
    assert.equal(fd.getElementById('codice-f-nome').value, 'Rascunho novo');
    ficha.run(`fecharModalCodice(); window.__roll = null; rolarDadoIndividual = () => 10; tocarSomImpacto = () => {}; publicarRolagem = r => window.__roll = r; rolarPericia(STATE.skills[0].id)`);
    assert.equal(ficha.w.__roll.total, ficha.run('10 + calcularPericia(STATE.skills[0]).total'));
    assert.match(ficha.w.__roll.linhas[0].detalhe, /1d20 \(10\)/);

    // O timeout abrange inclusive JSON pendurado e libera a criação sem repeti-la.
    const selecao = await abrirLocal('login/login.html', { rpg_player: 'teste', rpg_token: 'teste' });
    fechar.push(selecao.fechar);
    selecao.w.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) });
    await assert.rejects(selecao.w.RPGUI.pedirJSON('/teste', {}, 10), erro => erro.codigo === 'tempo_limite');
    let pedidos = 0;
    selecao.w.RPGUI.pedirJSON = async () => { pedidos++; const erro = new Error('Espera encerrada'); erro.codigo = 'tempo_limite'; throw erro; };
    selecao.run(`abrirModalNovoPersonagem(); document.getElementById('novo-nome-input').value='Fictício'`);
    await selecao.run('confirmarNovoPersonagem()');
    assert.equal(selecao.w.document.getElementById('novo-nome-input').disabled, false);
    assert.equal(selecao.w.document.getElementById('new-confirm').disabled, true);
    assert.ok(selecao.w.document.getElementById('reconsultar-personagens'));
    await selecao.run('confirmarNovoPersonagem()'); assert.equal(pedidos, 1);
    selecao.w.RPGUI.pedirJSON = async () => ({ response: { ok: true }, result: { success: true, personagens: [] } });
    selecao.w.document.getElementById('reconsultar-personagens').click(); await tick();
    assert.equal(selecao.w.document.getElementById('modal-novo').hidden, true);
    assert.equal(selecao.w.document.getElementById('novo-nome-input').value, 'Fictício');

    const css = fs.readFileSync(path.join(raiz, 'mestre/CSS/painel-visual.css'), 'utf8');
    assert.match(css, /button\.fig-primario:hover[\s\S]*?color: var\(--rpg-on-gold\)/);
    assert.match(css, /\.master-target-label[^}]*min-height: 44px/);
    assert.deepEqual(fig.erros, []); assert.deepEqual(rol.erros, []);
    assert.deepEqual(ficha.erros, []); assert.deepEqual(selecao.erros, []);
  } finally { fechar.reverse().forEach(fn => fn()); }
});

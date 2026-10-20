// Um único smoke virtual para 17–20. Sem rede, servidor ou gravações na campanha.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { abrirPaginaMestre } = require('./ajuda/ambiente');
const raiz = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fichaVirtual() {
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const erros = [], vc = new VirtualConsole();
  vc.on('jsdomError', erro => erros.push(erro.message));
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.sessionStorage.setItem('rpg_character', JSON.stringify({ player: 'teste-ux', nomePasta: 'Ficha_1' }));
  w.sessionStorage.setItem('rpg_token', 'sessao-ficticia');
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, set(v) { this.textContent = v; } });
  w.io = () => ({ connected: false, active: false, on() {}, emit() {}, connect() {}, close() {}, timeout() { return { emit() {} }; } });
  w.fetch = async () => { throw new Error('Este smoke não deve fazer consultas de rede.'); };
  const run = codigo => new vm.Script(codigo).runInContext(dom.getInternalVMContext());
  for (const [, src] of html.matchAll(/<script src="(JS\/[^"]+)"/g)) run(fs.readFileSync(path.join(raiz, src), 'utf8'));
  await tick();
  run('personagemCarregado = true; GLOBAL_CONFIG.AtivarMana = true; atualizarEstadoFicha()');
  return { w, d: w.document, run, erros, fechar: () => w.close() };
}

test('smoke 17–20: combo acessível, mochila pesquisável, perícias compactas e aparência sem perda de dados', async () => {
  const fechar = [];
  try {
    const ficha = await fichaVirtual(); fechar.push(ficha.fechar);
    const { d, w, run } = ficha;
    run(`trocarAba(5); STATE.combo = [];
      adicionarAoCombo('Espada "Longa"', '1d8', 'item'); adicionarAoCombo('Bônus', '+3', 'bonus')`);
    let remover = d.querySelector('[data-remover-combo]');
    assert.equal(remover.getAttribute('aria-label'), 'Remover Espada "Longa" (1d8) do combo');
    assert.equal(remover.title, remover.getAttribute('aria-label'));
    assert.equal(remover.querySelector('.sheet-combo-remove-hint').textContent, remover.title);
    remover.focus(); remover.click();
    assert.equal(run('STATE.combo.length'), 1);
    assert.equal(d.activeElement, d.querySelector('[data-remover-combo]'), 'foco segue para a próxima remoção');
    d.activeElement.click(); assert.equal(d.activeElement.id, 'btn-roll-combo');
    assert.equal(run('STATE.combo.length'), 0);

    run(`trocarAba(3); STATE.backpackItems = [
      {id:'pocao',uid:'it_teste01',name:'Poção de recuperação prolongada',type:'Consumível',desc:'Fictícia',w:1,h:1,col:1,row:1,quantity:3,maxStack:9,weight:1,icon:'fa-flask',color:'from-slate-800 to-slate-900'},
      {id:'espada',uid:'it_teste02',name:'Espada de treinamento',type:'Arma',desc:'Fictícia',w:1,h:2,col:2,row:1,quantity:1,maxStack:1,weight:2,icon:'fa-khanda',color:'from-slate-800 to-slate-900'}
    ]; renderizarMochilaGrid()`);
    const inventarioAntes = run('JSON.stringify(STATE.backpackItems)');
    const gridAntes = d.getElementById('backpack-grid').getAttribute('style');
    const posicaoAntes = d.getElementById('item-node-it_teste02').getAttribute('style');
    assert.equal(d.getElementById('backpack-item-list').children.length, 2);
    const busca = d.getElementById('backpack-search'); busca.value = 'pocao'; run('filtrarItensMochila()');
    assert.equal(d.querySelectorAll('#backpack-item-list li:not([hidden])').length, 1);
    assert.match(d.getElementById('backpack-item-list').textContent, /Poção de recuperação prolongada/);
    assert.equal(d.getElementById('item-node-it_teste02').classList.contains('inventory-item--dimmed'), true);
    assert.equal(d.getElementById('item-node-it_teste01').classList.contains('inventory-item--match'), true);
    assert.equal(d.getElementById('backpack-grid').getAttribute('style'), gridAntes);
    assert.equal(d.getElementById('item-node-it_teste02').getAttribute('style'), posicaoAntes);
    assert.equal(run('JSON.stringify(STATE.backpackItems)'), inventarioAntes, 'buscar não reorganiza nem altera dados');
    let detalhes = d.getElementById('item-details-it_teste01'); detalhes.focus(); detalhes.click();
    // outside-only não executa atributos onclick, mas listeners da lista são reais.
    assert.equal(d.getElementById('item-popover').classList.contains('hidden'), false);
    assert.equal(d.getElementById('popover-title').textContent, 'Poção de recuperação prolongada');
    run('ajustarQuantidadeItemAtual(1)');
    assert.match(d.getElementById('backpack-item-list').textContent, /4 un\./);
    assert.equal(busca.value, 'pocao');
    run('fecharItemPopover()'); assert.equal(d.activeElement.id, 'item-details-it_teste01');
    busca.value = 'inexistente'; run('filtrarItensMochila()');
    assert.equal(d.getElementById('backpack-list-empty').hidden, false);
    busca.value = ''; run('filtrarItensMochila()');
    assert.equal(d.querySelectorAll('#backpack-item-list li:not([hidden])').length, 2);
    assert.equal(d.querySelectorAll('.inventory-item--dimmed, .inventory-item--match').length, 0);

    run('trocarAba(2); renderizarPericias()');
    assert.equal(d.getElementById('skills-edit-bonus').getAttribute('aria-pressed'), 'false');
    assert.ok([...d.querySelectorAll('.skill-bonus')].every(el => el.hidden));
    assert.equal(d.querySelector('.skill-actions [data-rolar-pericia]').hidden, false);
    const habilidadesAntes = run('JSON.stringify(STATE.skills)');
    run('alternarEdicaoBonusPericias()');
    assert.equal(d.getElementById('skills-edit-bonus').getAttribute('aria-pressed'), 'true');
    assert.ok([...d.querySelectorAll('.skill-bonus')].every(el => !el.hidden));
    assert.equal(run('JSON.stringify(STATE.skills)'), habilidadesAntes);
    const skill = run('STATE.skills[0].id');
    const modificadorAntes = run('STATE.skills[0].mod');
    run(`alterarModPericia(${JSON.stringify(skill)}, 1); alternarEdicaoBonusPericias(); renderizarPericias()`);
    assert.equal(run('STATE.skills[0].mod'), modificadorAntes + 1);
    assert.ok([...d.querySelectorAll('.skill-bonus')].every(el => el.hidden));

    for (const [pagina, prefixo, abrir, salvar] of [
      ['loot', 'li', `abrirEditorItem({id:'item-teste',name:'Item fictício',icon:'fa-dragon',color:'text-amber-400'})`, 'salvarItem()'],
      ['habilidades-magias', 'hm', `abrirEditor({id:'poder-teste',nome:'Poder fictício',icon:'fa-dragon'})`, 'salvarEditor()'],
    ]) {
      const pg = await abrirPaginaMestre({ dir: raiz, url: 'http://localhost' }, pagina, { tokenInicial: 'chave-ficticia' });
      fechar.push(() => pg.fechar());
      const elemento = id => pg.document.getElementById(id);
      pg.run(abrir);
      const editor = prefixo === 'li' ? 'loot-editor-item' : 'habmag-editor';
      assert.equal(elemento(`${prefixo}-icon`).value, 'fa-dragon');
      assert.equal(elemento(`${prefixo}-icone-visual`).value, '__personalizado__');
      if (prefixo === 'li') assert.equal(elemento('li-color').value, 'text-amber-400');
      assert.equal(pg.run(`editorMestreAlterado('${editor}')`), false, 'abrir não muda o dado personalizado');
      const seletor = elemento(`${prefixo}-icone-visual`);
      seletor.value = 'fa-fire'; seletor.dispatchEvent(new pg.window.Event('change'));
      assert.equal(elemento(`${prefixo}-icon`).value, 'fa-fire');
      assert.match(elemento(`${prefixo}-aparencia-previa`).getAttribute('aria-label'), /Fogo/);
      if (prefixo === 'li') {
        const cores = elemento('li-cor-visual'); cores.value = 'from-sky-900 to-sky-950';
        cores.dispatchEvent(new pg.window.Event('change'));
        assert.equal(elemento('li-color').value, 'from-sky-900 to-sky-950');
        assert.match(elemento('li-aparencia-previa').getAttribute('aria-label'), /Azul/);
      }
      seletor.value = '__personalizado__'; seletor.dispatchEvent(new pg.window.Event('change'));
      assert.equal(elemento(`${prefixo}-aparencia`).querySelector('details').open, true);
      assert.equal(pg.document.activeElement.id, `${prefixo}-icon`);
      assert.equal(elemento(`${prefixo}-icon`).value, 'fa-fire', 'abrir Avançado não apaga o valor atual');
      elemento(`${prefixo}-icon`).value = 'fa-dragon';
      elemento(`${prefixo}-icon`).dispatchEvent(new pg.window.Event('input', { bubbles: true }));
      assert.equal(seletor.value, '__personalizado__');
      assert.equal(pg.run(`editorMestreAlterado('${editor}')`), prefixo === 'li',
        'voltar ao ícone original desfaz a alteração; no item, a cor continua modificada');
      pg.run('socket.connected = true');
      const gravacao = pg.run(salvar);
      const pedido = pg.falso.pedidos.at(-1);
      assert.equal(pedido.evento, 'master_campanha_salvar');
      assert.equal(pedido.dados.item.icon, 'fa-dragon');
      if (prefixo === 'li') assert.equal(pedido.dados.item.color, 'from-sky-900 to-sky-950');
      assert.equal('icone-visual' in pedido.dados.item, false);
      pedido.cb(null, { ok: true, dados: { id: 'salvo-teste', name: 'Item fictício', nome: 'Poder fictício' } });
      await gravacao;
      pg.run(abrir);
      assert.equal(elemento(`${prefixo}-icon`).value, 'fa-dragon');
      const ids = [...pg.document.querySelectorAll('[id]')].map(el => el.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(pg.erros, []);
    }
    const css = fs.readFileSync(path.join(raiz, 'CSS/ficha.css'), 'utf8');
    assert.match(css, /:focus-visible \.sheet-combo-remove-hint/);
    assert.match(css, /\.sheet-skills \{[^}]*repeat\(2,/);
    assert.match(css, /max-width: 900px/);
    assert.deepEqual(ficha.erros, []);
  } finally { fechar.reverse().forEach(fn => fn()); }
});

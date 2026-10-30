const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrirPaginaMestre } = require('./ajuda/ambiente');
const abrir = pagina => abrirPaginaMestre({ dir: process.cwd(), url: 'http://localhost' }, pagina);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('editores agrupam campos sem duplicar IDs e descarte exige confirmação acessível', async () => {
  const pg = await abrir('loot');
  try {
    pg.document.getElementById('loot-novo-item').click();
    const nome = pg.document.getElementById('li-name');
    assert.equal(pg.document.getElementById('loot-editor-item-modal').hidden, false);
    assert.equal(pg.document.getElementById('mestre-conteudo').inert, true);
    assert.match(nome.closest('fieldset').querySelector('legend').textContent, /Identificação/);
    assert.match(pg.document.getElementById('li-weight').closest('fieldset').querySelector('legend').textContent, /armazenamento/);
    nome.value = 'Não descartar sem confirmar'; nome.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    const cancelar = pg.document.getElementById('li-cancelar'); cancelar.focus(); cancelar.click();
    assert.equal(pg.document.querySelector('.rpg-confirmacao').getAttribute('role'), 'alertdialog');
    assert.equal(pg.document.activeElement.textContent, 'Cancelar');
    pg.document.querySelector('.rpg-confirmacao button').click(); await tick();
    assert.equal(nome.value, 'Não descartar sem confirmar');
    assert.equal(pg.document.getElementById('loot-editor-item').classList.contains('hidden'), false);
    assert.equal(pg.document.activeElement, cancelar);
    cancelar.click(); pg.document.querySelector('.rpg-confirmacao button:last-child').click(); await tick();
    assert.equal(pg.document.getElementById('loot-editor-item').classList.contains('hidden'), true);
    assert.equal(pg.document.getElementById('loot-editor-item-modal').hidden, true);
    assert.equal(Boolean(pg.document.getElementById('mestre-conteudo').inert), false);
    const ids = [...pg.document.querySelectorAll('[id]')].map(el => el.id);
    assert.equal(new Set(ids).size, ids.length); assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

test('excluir só executa após confirmar e Escape cancela sem acionar a operação', async () => {
  const pg = await abrir('loot');
  try {
    pg.run(`window.executadas = 0; window.botaoTeste = botaoDeAcao('excluir', 'Excluir'); document.body.append(botaoTeste);`);
    const pedido = pg.run(`confirmarNoBotao(botaoTeste, () => { executadas++; }, 'Excluir o item de teste?')`);
    pg.document.querySelector('.rpg-confirmacao').dispatchEvent(new pg.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await pedido; assert.equal(pg.run('executadas'), 0);
    const aceito = pg.run(`confirmarNoBotao(botaoTeste, () => { executadas++; }, 'Excluir o item de teste?')`);
    pg.document.querySelector('.rpg-confirmacao button:last-child').click(); await aceito;
    assert.equal(pg.run('executadas'), 1); assert.equal(pg.document.querySelector('.rpg-confirmacao'), null);
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

test('poderes mostram descrição completa por disclosure e mantêm abertura após atualização', async () => {
  const pg = await abrir('habilidades-magias');
  try {
    pg.run(`habmag.carregou = true; habmag.catalogo.habilidades = [{ id: 'poder-teste', nome: 'Chama', desc: 'Primeira linha\\nTexto completo do poder.' }]; renderizarLista()`);
    const descricao = pg.document.querySelector('.rpg-power-description'); descricao.open = true;
    await tick(); assert.match(descricao.querySelector('p').textContent, /Texto completo/);
    assert.equal(descricao.querySelector('.rpg-power-read').textContent, 'Recolher descrição');
    pg.run('renderizarLista()'); assert.equal(pg.document.querySelector('.rpg-power-description').open, true);
    pg.document.getElementById('habmag-novo').click();
    assert.match(pg.document.getElementById('hm-custo-vital').closest('fieldset').textContent, /Uso e custo/);
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

test('validação compartilhada associa erro ao campo e não usa bolha nativa', async () => {
  const pg = await abrir('loot');
  try {
    const input = pg.document.getElementById('li-weight'); input.value = '-1';
    assert.equal(pg.run(`RPGUI.validarFormulario(document.getElementById('li-weight'))`), false);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.match(pg.document.getElementById(input.getAttribute('aria-describedby')).textContent, /a partir de 0/);
    input.value = '2'; assert.equal(pg.run(`RPGUI.validarFormulario(document.getElementById('li-weight'))`), true);
    assert.equal(input.getAttribute('aria-invalid'), 'false');
  } finally { pg.fechar(); }
});

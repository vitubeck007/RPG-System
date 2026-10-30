const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { iniciarServidor, abrirPaginaMestre, esperarAte } = require('./ajuda/ambiente');

test('prévia acompanha os dados e as cores do card; limpar busca restaura o catálogo e o foco', async () => {
  const pg = await abrirPaginaMestre({ dir: process.cwd(), url: 'http://localhost' }, 'loot');
  try {
    pg.run(`loot.carregou = true; loot.itens = [
      { id: 'item-preview', name: 'Lâmina de campanha', type: 'Arma', weight: 3.5,
        dice: '1d8+2', tipoDano: 'Cortante', color: 'from-red-900 to-red-950',
        subtitulo: 'Uma lembrança', desc: 'Descrição que deve continuar legível.' }
    ]; renderizarTudo()`);
    const original = pg.run('JSON.stringify(loot.itens)');
    const card = pg.document.querySelector('#loot-lista-itens article');
    assert.match(card.querySelector('.loot-item-info').textContent, /3,5 kg/);
    assert.equal(card.querySelectorAll('.loot-item-linha').length, 2, 'atributos vazios não ocupam blocos');
    card.querySelector('[data-acao="editar"]').click();
    const previa = () => pg.document.querySelector('#li-aparencia-previa .loot-item-card');
    assert.equal(previa().style.getPropertyValue('--item-base-from'), card.style.getPropertyValue('--item-base-from'));
    assert.equal(previa().querySelector('.loot-item-nome').textContent, 'Lâmina de campanha');
    assert.equal(previa().querySelector('button, summary'), null, 'prévia não tem ações operacionais');
    const cor = pg.document.getElementById('li-cor-visual');
    for (const opcao of [...cor.options].filter(o => o.value !== '__personalizado__')) {
      cor.value = opcao.value; cor.dispatchEvent(new pg.window.Event('change', { bubbles: true }));
      assert.equal(previa().dataset.colorido, String(Boolean(opcao.value)));
      assert.equal(pg.document.getElementById('li-color').value, opcao.value);
    }
    const descricao = pg.document.getElementById('li-desc');
    descricao.value = 'Descrição revisada, sem salvar.';
    descricao.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    assert.equal(previa().querySelector('.loot-item-descricao').textContent, descricao.value);
    const personalizada = pg.document.getElementById('li-color');
    personalizada.value = 'from-rose-950 to-slate-900';
    personalizada.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    assert.equal(cor.value, '__personalizado__');
    assert.equal(previa().dataset.colorido, 'false');
    assert.equal(personalizada.value, 'from-rose-950 to-slate-900', 'cor legada não é substituída');
    assert.equal(pg.run('JSON.stringify(loot.itens)'), original, 'prévia não altera o catálogo antes de salvar');
    const busca = pg.document.getElementById('loot-busca-item');
    busca.value = 'inexistente'; busca.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    assert.match(pg.document.getElementById('loot-lista-itens').textContent, /Nenhum item corresponde/);
    const limpar = busca.parentElement.querySelector('.rpg-search-clear');
    assert.equal(limpar.hidden, false);
    limpar.click();
    assert.equal(busca.value, ''); assert.equal(limpar.hidden, true);
    assert.equal(pg.document.activeElement, busca);
    assert.equal(pg.document.querySelectorAll('#loot-lista-itens article').length, 1);
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

test('Loot salva e exibe imagem, descrição, subtítulo e dano composto', async () => {
  const servidor = await iniciarServidor(); let pg;
  try {
    pg = await abrirPaginaMestre(servidor, 'loot', { real: true });
    await esperarAte(() => pg.run('loot.carregou'));
    pg.document.getElementById('loot-novo-item').click();
    for (const [id, valor] of Object.entries({ 'li-name': 'Martelo de teste', 'li-type': 'Arma', 'li-dice': '1d10+1d4+2', 'li-tipoDano': 'Impacto', 'li-subtitulo': 'Martelo ancestral', 'li-imagem': '/imagem.png', 'li-desc': 'Descrição completa\nSegunda linha.' })) {
      const campo = pg.document.getElementById(id); campo.value = valor; campo.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    }
    pg.document.getElementById('li-salvar').click();
    await esperarAte(() => pg.document.getElementById('loot-editor-item').classList.contains('hidden') && !pg.document.getElementById('li-salvar').disabled);
    await esperarAte(() => [...pg.document.querySelectorAll('#loot-lista-itens article')].some(c => c.textContent.includes('Martelo de teste')));
    const card = [...pg.document.querySelectorAll('#loot-lista-itens article')].find(c => c.textContent.includes('Martelo de teste'));
    for (const texto of ['1d10+1d4+2', 'Impacto', 'Martelo ancestral', 'Descrição completa', 'Segunda linha.']) assert.ok(card.textContent.includes(texto));
    assert.ok(card.querySelector('.loot-item-retrato img'));
    const item = pg.run("loot.itens.find(x => x.name === 'Martelo de teste')");
    assert.equal(item.tipoDano, 'Impacto'); assert.equal(item.subtitulo, 'Martelo ancestral'); assert.equal(item.imagem, '/imagem.png');
    card.querySelector('[data-acao="editar"]').click();
    assert.equal(pg.document.getElementById('loot-editor-item').classList.contains('hidden'), false);
    assert.equal(pg.document.getElementById('li-tipoDano').value, 'Impacto');
    assert.equal(pg.document.getElementById('li-imagem').value, '/imagem.png');
    for (const [id, valor] of Object.entries({ 'li-name': 'Martelo revisado', 'li-tipoDano': 'Fogo', 'li-subtitulo': 'Nova história', 'li-desc': 'Descrição editada', 'li-imagem': '' })) {
      const campo = pg.document.getElementById(id); campo.value = valor; campo.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    }
    pg.document.getElementById('li-salvar').click();
    await esperarAte(() => pg.document.getElementById('loot-editor-item').classList.contains('hidden') && !pg.document.getElementById('li-salvar').disabled);
    const atualizado = pg.run("loot.itens.find(x => x.name === 'Martelo revisado')");
    assert.ok(atualizado, 'edição atualiza o catálogo');
    assert.equal(atualizado.id, item.id); assert.equal(atualizado.tipoDano, 'Fogo'); assert.equal(atualizado.subtitulo, 'Nova história'); assert.equal(atualizado.desc, 'Descrição editada'); assert.equal(atualizado.imagem, undefined);
    const salvoEmDisco = JSON.parse(fs.readFileSync(path.join(servidor.dir, 'catalogo', 'itens.json'), 'utf8')).items.find(i => i.id === item.id);
    assert.equal(salvoEmDisco.name, 'Martelo revisado'); assert.equal(salvoEmDisco.tipoDano, 'Fogo'); assert.equal(salvoEmDisco.subtitulo, 'Nova história');
    const atualizadoCard = [...pg.document.querySelectorAll('#loot-lista-itens article')].find(c => c.textContent.includes('Martelo revisado'));
    atualizadoCard.querySelector('[data-acao="editar"]').click();
    const subtitulo = pg.document.getElementById('li-subtitulo'); subtitulo.value = 'Campo não aceito'; subtitulo.dispatchEvent(new pg.window.Event('input', { bubbles: true }));
    pg.run(`pedirAoServidor = async (_evento, dados) => { const item = { ...dados.item }; delete item.subtitulo; return item; }`);
    await pg.run('salvarItem()');
    assert.equal(pg.document.getElementById('loot-editor-item').classList.contains('hidden'), false, 'não fecha se o servidor descartar campo');
    assert.equal(subtitulo.value, 'Campo não aceito');
    assert.match(pg.document.getElementById('toast-container').textContent, /não confirmou todos os campos/);
  } finally { pg?.fechar(); await servidor.parar(); }
});

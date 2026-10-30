const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, abrirPaginaMestre, esperarAte } = require('./ajuda/ambiente');
const { normalizarItemDeLoot } = require('../campanha');

test('normalização mantém itens antigos e limita campos de cura', () => {
  const antigo = normalizarItemDeLoot({name:'Espada',tipoDano:'Cortante'});
  assert.equal(antigo.tipoDano,'Cortante'); assert.equal(antigo.tipoRolagem,undefined);
  const cura = normalizarItemDeLoot({name:'Poção',tipoRolagem:'cura',tipoCura:'inválido',usos:-4,categoria:'Leve',tipoDano:'Fogo'});
  assert.equal(cura.tipoCura,'vida'); assert.equal(cura.usos,0);
  assert.equal(cura.tipoDano,undefined); assert.equal(cura.categoria,undefined);
});

test('editor alterna Dano/Cura, sugere tipos e persiste um novo tipo com cura', async () => {
  const servidor = await iniciarServidor(); let pg;
  try {
    pg = await abrirPaginaMestre(servidor,'loot',{real:true});
    await esperarAte(()=>pg.run('loot.carregou'));
    pg.document.getElementById('loot-novo-item').click();
    const campo=id=>pg.document.getElementById('li-'+id);
    const preencher=(id,valor)=>{campo(id).value=valor;campo(id).dispatchEvent(new pg.window.Event('input',{bubbles:true}));};
    assert.equal(campo('type').getAttribute('list'),'li-tipos-existentes');
    assert.equal(campo('type').closest('fieldset'),campo('tipo-rolagem').closest('fieldset'));
    preencher('name','Elixir de teste'); preencher('type','Elixir novo'); preencher('dice','1d6');
    preencher('categoria','Leve');
    campo('tipo-rolagem').value='cura';campo('tipo-rolagem').dispatchEvent(new pg.window.Event('change'));
    assert.equal(campo('categoria').disabled,true);assert.equal(campo('tipoDano').closest('label').hidden,true);
    preencher('tipo-cura','mana');preencher('usos','3');
    campo('tipo-rolagem').value='dano';campo('tipo-rolagem').dispatchEvent(new pg.window.Event('change'));
    assert.equal(campo('categoria').value,'Leve');assert.equal(campo('usos').disabled,true);
    campo('tipo-rolagem').value='cura';campo('tipo-rolagem').dispatchEvent(new pg.window.Event('change'));
    campo('salvar').click();
    await esperarAte(()=>pg.run("loot.itens.some(i=>i.name==='Elixir de teste')"));
    const item=pg.run("loot.itens.find(i=>i.name==='Elixir de teste')");
    assert.equal(item.type,'Elixir novo');assert.equal(item.tipoRolagem,'cura');assert.equal(item.tipoCura,'mana');assert.equal(item.usos,3);
    await pg.run("abrirEditorItem(loot.itens.find(i=>i.name==='Elixir de teste'))");
    assert.equal(campo('usos').value,'3');assert.equal(campo('tipo-cura').value,'mana');
    assert.ok([...campo('tipos-existentes').options].some(o=>o.value==='Elixir novo'));
    assert.deepEqual(pg.erros,[]);
  } finally {pg?.fechar();await servidor.parar();}
});

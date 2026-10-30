const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { abrirPaginaMestre } = require('./ajuda/ambiente');

test('Mesa compacta: vitais, atributos, arma e poderes paginados mantêm atualização e controles', async () => {
  const pg = await abrirPaginaMestre({ dir: path.resolve(__dirname, '..'), url: 'http://localhost' }, 'index');
  try {
    pg.run('socket.connected = true');
    pg.disparar('sync_config', { AtivarMana: true });
    const jogador = { id: 'p1', name: 'Ana', avatar: '/retrato.png', vitals: { hp: { current: 8, max: 10 }, vigor: { current: 3, max: 5 }, sanity: { current: 7, max: 10 } } };
    pg.disparar('sync_all_players', { p1: jogador });
    assert.ok(pg.emitidos.some(([evento, dados]) => evento === 'master_get_personagem' && dados.charId === 'p1'));
    const ficha = { atributos: { FOR: 12, DES: 13, INT: 8, SAB: 10, PRE: 11, VON: 9 }, inventario: { items: [], equipped: { mainHand: { name: 'Espada', type: 'Leve', dice: '1d6' } } }, magias: { items: Array.from({ length: 4 }, (_, i) => ({ nome: `Magia ${i + 1}`, dice: '1d4', tipoDano: 'Fogo' })) }, habilidades: { items: [{ nome: 'Golpe' }] }, pericias: { skills: {} } };
    ficha.perfil = { progressao: { nv: '1', ex: '5%' } };
    pg.disparar('master_personagem', { charId: 'p1', personagem: ficha });
    const card = () => pg.document.querySelector('[data-player-id="p1"]');
    assert.match(card().textContent, /FOR12/); assert.equal(card().querySelector('[data-vital="hp"] .mesa-vital-preenchimento').style.width, '80%');
    assert.ok(card().querySelector('.mesa-card-foto img'));
    card().querySelector('[data-foco-mesa="expandir"]').click();
    assert.match(card().querySelector('.mesa-arma').textContent, /Espada.*1d6.*Leve/);
    assert.equal(card().querySelectorAll('.mesa-poder-linha').length, 3);
    card().querySelector('[data-foco-mesa="pagina-proxima"]').click();
    assert.equal(card().querySelectorAll('.mesa-poder-linha').length, 1);
    assert.match(card().querySelector('.mesa-poder-lista').textContent, /Magia 4/);
    pg.disparar('vital_adjusted', { charId: 'p1', vitals: { ...jogador.vitals, hp: { current: 4, max: 10 } } });
    assert.match(card().querySelector('.mesa-poder-lista').textContent, /Magia 4/);
    assert.equal(card().querySelector('[data-vital="hp"] .mesa-vital-preenchimento').style.width, '40%');
    card().querySelector('[data-foco-mesa="aba-habilidades"]').click();
    assert.match(card().querySelector('.mesa-poder-lista').textContent, /Golpe/);
    card().querySelector('[data-foco-mesa="hp-menos"]').click();
    assert.ok(pg.emitidos.some(([evento, dados]) => evento === 'master_adjust_vital' && dados.delta === -1));
    pg.disparar('sync_config', { AtivarMana: false }); assert.equal(card().querySelector('[data-vital="vigor"]'), null);
    const completa = card().querySelector('.mesa-ficha-completa');
    assert.match(completa.textContent, /Lv 1 \/ XP 5%/);
    assert.match(completa.textContent, /Mão principal\s*Espada/);
    assert.ok(completa.querySelector('.mesa-pericia'));
    assert.equal(completa.querySelector('.mesa-pericia').children.length, 3);
    assert.doesNotMatch(completa.textContent, /Atributos|Magias|Habilidades/);
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrirPaginaMestre } = require('./ajuda/ambiente');

test('resumos do mestre acompanham jogadores e configuração em todas as páginas', async () => {
  for (const nome of ['index', 'rolagem', 'figurantes', 'loot', 'habilidades-magias']) {
    const pg = await abrirPaginaMestre({ dir: process.cwd(), url: 'http://localhost' }, nome);
    try {
      const area = pg.document.getElementById('master-resumo-jogadores');
      if (nome === 'index' || nome === 'rolagem') {
        assert.equal(area, null);
        assert.ok(pg.document.getElementById(nome === 'index' ? 'players-cards-container' : 'atk-alvos'));
        continue;
      }
      assert.ok(area);
      pg.disparar('sync_config', { AtivarMana: true });
      pg.disparar('sync_all_players', { p: { id: 'p', name: 'Ana', avatar: 'https://example.com/a.png', vitals: { hp: { current: 9, max: 10 }, vigor: { current: 4, max: 8 } } } });
      assert.match(area.textContent, /Ana/); assert.match(area.textContent, /Vida 9\/10/); assert.match(area.textContent, /Energia 4\/8/); assert.ok(area.querySelector('img'));
      pg.disparar('vital_adjusted', { charId: 'p', vitals: { hp: { current: 5, max: 10 }, vigor: { current: 3, max: 8 } } });
      assert.match(area.textContent, /Vida 5\/10/);
      pg.disparar('sync_config', { AtivarMana: false }); assert.doesNotMatch(area.textContent, /Energia/);
      const jogador = { id: 'p', name: 'Ana', vitals: { hp: { current: 5, max: 10 }, vigor: { current: 3, max: 8 } } };
      pg.disparar('player_removed', { charId: 'p' });
      pg.disparar('player_recently_disconnected', { jogador, expiraEm: Date.now() + 600000 });
      assert.equal(area.querySelector('.master-resumo-jogador').dataset.offline, 'true');
      assert.match(area.textContent, /Ana.*Desconectado/);
      pg.disparar('player_updated', jogador);
      assert.equal(area.querySelectorAll('.master-resumo-jogador').length, 1);
      assert.equal(area.querySelector('.master-resumo-jogador').dataset.offline, 'false');
      pg.disparar('player_removed', { charId: 'p' });
      pg.disparar('sync_recent_players', [{ jogador, expiraEm: Date.now() - 1 }]);
      assert.match(area.textContent, /Nenhum jogador conectado/);
      if (nome === 'figurantes') {
        assert.ok(pg.document.querySelector('.fig-toolbar #fig-tipos'));
        assert.equal(pg.document.getElementById('fig-menu-batalha').hidden, true);
        pg.run("figurantes.aba='batalha';renderizarFigurantes()");
        assert.equal(pg.document.getElementById('fig-menu-batalha').hidden, false);
      }
      assert.deepEqual(pg.erros, []);
    } finally { pg.fechar(); }
  }
});

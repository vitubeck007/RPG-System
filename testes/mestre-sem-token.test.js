const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { iniciarServidor, abrirPaginaMestre, esperarAte } = require('./ajuda/ambiente');

test('mestre sem chave: páginas, carga, edição e validação continuam funcionando', async () => {
  const s = await iniciarServidor();
  let socket;
  const paginas = [];
  try {
    for (const caminho of ['/mestre', '/mestre/figurantes', '/mestre/loot', '/mestre/habilidades-magias', '/mestre/rolagem', '/mestre/JS/comum.js']) {
      assert.equal((await fetch(s.url + caminho)).status, 200);
    }
    socket = io(s.url, { transports: ['websocket'], forceNew: true });
    await new Promise(resolve => socket.on('connect', resolve));
    const pedir = (evento, dados = {}) => new Promise((resolve, reject) => socket.timeout(3000).emit(evento, dados, (erro, resposta) => erro ? reject(erro) : resolve(resposta)));
    assert.equal((await pedir('master_entrar')).ok, true);
    assert.equal((await pedir('master_campanha_ler')).ok, true);
    const dados = { tipo: 'npcs', item: { nome: 'NPC temporário sem chave' }, acaoId: 'sem_chave_1' };
    const salvo = await pedir('master_campanha_salvar', dados);
    assert.equal(salvo.ok, true);
    assert.equal((await pedir('master_campanha_salvar', dados)).dados.id, salvo.dados.id, 'ação repetida não duplica');
    assert.equal((await pedir('master_campanha_salvar', { tipo: 'npcs', item: {} })).erro, 'acao_id_obrigatorio');
    assert.equal((await pedir('master_campanha_ler', null)).erro, 'formato_invalido');
    for (const [nome, pronto] of [['figurantes', 'figurantes.carregou'], ['loot', 'loot.carregou'], ['habilidades-magias', 'habmag.carregou'], ['rolagem', 'rol.carregou']]) {
      const pg = await abrirPaginaMestre(s, nome, { real: true }); paginas.push(pg);
      await esperarAte(() => pg.run(pronto));
      assert.equal(pg.document.getElementById('master-token-input'), null);
      assert.equal(pg.run('typeof tokenDoMestre'), 'undefined');
      if (nome === 'figurantes') {
        await pg.run('abrirFichaFigurante()');
        assert.equal(pg.document.getElementById('fig-editor').classList.contains('hidden'), false);
      }
      assert.deepEqual(pg.erros, []);
    }
    assert.notEqual((await fetch(s.url + '/server.js')).status, 200);
  } finally { paginas.forEach(pg => pg.fechar()); socket?.close(); await s.parar(); }
});

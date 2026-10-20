const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { iniciarServidor, esperarAte } = require('./ajuda/ambiente.js');
const raiz = path.resolve(__dirname, '..');

function abrir(pagina, { fetch, sessao = {} } = {}) {
  const erros = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // JSDOM não navega. A identidade e o destino são conferidos separadamente.
    if (!e.message.includes('navigation')) erros.push(e.message);
  });
  const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'login', pagina), 'utf8'), {
    url: 'http://localhost/' + (pagina === 'entrar.html' ? 'login' : 'selecao'),
    runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(w) {
      for (const [key, value] of Object.entries(sessao)) w.sessionStorage.setItem(key, value);
      w.fetch = fetch || (async () => ({ ok: true, json: async () => ({ success: true, personagens: [] }) }));
      w.eval(fs.readFileSync(path.join(raiz, 'JS/interface.js'), 'utf8'));
    },
  });
  return { dom, w: dom.window, d: dom.window.document, erros, fechar: () => dom.window.close() };
}
const sessao = { rpg_player: 'conta-teste', rpg_token: 'token-teste' };

it('acesso: páginas usam base e ícones locais, IDs únicos e diálogos nomeados', () => {
  for (const pagina of ['entrar.html', 'login.html']) {
    const pg = abrir(pagina, { sessao });
    try {
      assert.ok(pg.d.body.classList.contains('rpg-app'));
      assert.equal(pg.d.querySelectorAll('[src^="https:"], [href^="https:"]').length, 0);
      const ids = [...pg.d.querySelectorAll('[id]')].map((e) => e.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const label of pg.d.querySelectorAll('label[for]')) assert.ok(pg.d.getElementById(label.htmlFor));
      for (const modal of pg.d.querySelectorAll('[role="dialog"]')) {
        assert.equal(modal.getAttribute('aria-modal'), 'true');
        assert.ok(pg.d.getElementById(modal.getAttribute('aria-labelledby')));
        assert.equal(modal.hidden, true);
      }
    } finally { pg.fechar(); }
  }
});

it('login: formulário valida criação e bloqueia pedidos duplicados, exibindo erro persistente', async () => {
  let resolver;
  const pedidos = [];
  const pg = abrir('entrar.html', { fetch: (u, opts) => {
    pedidos.push([u, JSON.parse(opts.body)]);
    return new Promise((r) => { resolver = r; });
  } });
  try {
    await pg.w.autenticar(true);
    assert.equal(pedidos.length, 0, 'campos obrigatórios também na criação');
    pg.d.getElementById('player-name').value = '  Jogador  ';
    pg.d.getElementById('player-password').value = 'senha';
    const primeiro = pg.w.autenticar(true);
    await pg.w.autenticar(false);
    assert.equal(pedidos.length, 1);
    assert.deepEqual(pedidos[0], ['/api/login', { nome: 'Jogador', senha: 'senha', criarSeNaoExistir: true }]);
    assert.equal(pg.d.getElementById('login-button').disabled, true);
    assert.equal(pg.d.getElementById('create-account-button').disabled, true);
    resolver({ ok: false, json: async () => ({ message: 'Senha incorreta.' }) });
    await primeiro;
    assert.equal(pg.d.getElementById('login-message').textContent, 'Senha incorreta.');
    assert.equal(pg.d.getElementById('login-message').dataset.state, 'error');
    assert.equal(pg.d.getElementById('login-button').disabled, false);
    assert.equal(pg.d.getElementById('login-form').getAttribute('aria-busy'), 'false');
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

it('login: mantém contrato de sessão, limpa personagem anterior e recupera falha de rede', async () => {
  const pg = abrir('entrar.html', { sessao: { rpg_character: 'antigo', rpg_character_name: 'Antigo' },
    fetch: async () => ({ ok: true, json: async () => ({ success: true, player: 'Jogador', token: 'sessao' }) }) });
  try {
    pg.d.getElementById('player-name').value = 'Jogador';
    pg.d.getElementById('player-password').value = 'senha';
    await pg.w.autenticar(false);
    assert.equal(pg.w.sessionStorage.getItem('rpg_player'), 'Jogador');
    assert.equal(pg.w.sessionStorage.getItem('rpg_token'), 'sessao');
    assert.equal(pg.w.sessionStorage.getItem('rpg_character'), null);
    assert.equal(pg.w.sessionStorage.getItem('rpg_character_name'), null);
    pg.w.fetch = async () => { throw new Error('offline'); };
    await pg.w.autenticar(false);
    assert.match(pg.d.getElementById('login-message').textContent, /conectar ao servidor/);
    assert.equal(pg.d.getElementById('create-account-button').disabled, false);
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

it('seleção: cartões são botões, escapam nomes e preservam player + nomePasta', async () => {
  const nome = '<img src=x onerror=alert(1)> Aelric';
  const pg = abrir('login.html', { sessao, fetch: async () => ({ ok: true,
    json: async () => ({ success: true, personagens: [{ nome, nomePasta: 'Aelric_123' }] }) }) });
  try {
    await esperarAte(() => pg.d.querySelector('.character-select'));
    assert.equal(pg.d.querySelector('.character-name').textContent, nome);
    assert.equal(pg.d.querySelector('img'), null);
    assert.equal(pg.d.querySelector('.character-select').tagName, 'BUTTON');
    pg.d.querySelector('.character-select').click();
    assert.deepEqual(JSON.parse(pg.w.sessionStorage.getItem('rpg_character')), { player: 'conta-teste', nomePasta: 'Aelric_123' });
    assert.equal(pg.w.sessionStorage.getItem('rpg_character_name'), nome);
    pg.w.deslogar();
    for (const key of ['rpg_player', 'rpg_token', 'rpg_character', 'rpg_character_name']) {
      assert.equal(pg.w.sessionStorage.getItem(key), null, 'sair limpa ' + key);
    }
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

it('seleção: Escape, Tab/Shift+Tab, foco de retorno, fundo inativo e bloqueio durante criação', async () => {
  let resolver;
  let criacoes = 0;
  const pg = abrir('login.html', { sessao });
  try {
    await esperarAte(() => pg.d.getElementById('characters-list').getAttribute('aria-busy') === 'false');
    const abrir = pg.d.getElementById('btn-novo-personagem');
    abrir.focus();
    pg.w.abrirModalNovoPersonagem();
    const modal = pg.d.getElementById('modal-novo');
    assert.equal(modal.hidden, false);
    assert.equal(pg.d.activeElement.id, 'novo-nome-input');
    assert.equal(pg.d.querySelector('[data-modal-background]').inert, true);
    pg.d.getElementById('new-confirm').focus();
    pg.d.dispatchEvent(new pg.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(pg.d.activeElement.getAttribute('aria-label'), 'Fechar criação');
    pg.d.dispatchEvent(new pg.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(pg.d.activeElement.id, 'new-confirm');
    pg.d.dispatchEvent(new pg.w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(modal.hidden, true);
    assert.equal(pg.d.activeElement, abrir);
    assert.notEqual(pg.d.querySelector('[data-modal-background]').inert, true);
    pg.w.abrirModalNovoPersonagem();
    pg.d.getElementById('novo-nome-input').value = 'Aventureiro';
    pg.w.fetch = (url, opts) => {
      if (opts.method === 'POST') { criacoes++; return new Promise((r) => { resolver = r; }); }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, personagens: [] }) });
    };
    const pedido = pg.w.confirmarNovoPersonagem();
    await pg.w.confirmarNovoPersonagem();
    assert.equal(criacoes, 1);
    pg.d.dispatchEvent(new pg.w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(modal.hidden, false, 'não fechar no meio da gravação');
    resolver({ ok: false, json: async () => ({ message: 'Nome inválido.' }) });
    await pedido;
    assert.equal(pg.d.getElementById('new-message').textContent, 'Nome inválido.');
    assert.equal(pg.d.getElementById('new-confirm').disabled, false);
    assert.equal(modal.hidden, false);
    assert.deepEqual(pg.erros, []);
  } finally { pg.fechar(); }
});

it('seleção: falha de lista permite repetir sem apagar sessão; modo excluir impede criação', async () => {
  const pg = abrir('login.html', { sessao, fetch: async () => { throw new Error('offline'); } });
  try {
    await esperarAte(() => pg.d.querySelector('.selection-state[data-state="error"]'));
    assert.equal(pg.w.sessionStorage.getItem('rpg_token'), sessao.rpg_token);
    pg.w.fetch = async () => ({ ok: true, json: async () => ({ success: true, personagens: [{ nome: 'Teste', nomePasta: 'Teste_1' }] }) });
    pg.d.querySelector('.selection-state button').click();
    await esperarAte(() => pg.d.querySelector('.character-card'));
    assert.equal(pg.d.getElementById('selection-message').textContent, '', 'repetir com sucesso limpa o erro anterior');
    pg.w.toggleModoExcluir();
    assert.equal(pg.d.getElementById('btn-toggle-delete').getAttribute('aria-pressed'), 'true');
    assert.equal(pg.d.getElementById('btn-novo-personagem').disabled, true);
    pg.w.abrirModalNovoPersonagem();
    assert.equal(pg.d.getElementById('modal-novo').hidden, true);
    pg.d.querySelector('.trash-icon').click();
    assert.equal(pg.d.activeElement.id, 'delete-cancel');
    pg.d.dispatchEvent(new pg.w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(pg.d.getElementById('modal-confirmar-exclusao').hidden, true);
  } finally { pg.fechar(); }
});

it('seleção: sessão expirada volta ao login; erro temporário preserva credenciais', async () => {
  for (const status of [401, 500]) {
    const pg = abrir('login.html', { sessao, fetch: async () => ({ status, ok: false,
      json: async () => ({ success: false, message: 'Falha de teste' }) }) });
    try {
      await esperarAte(() => pg.d.getElementById('characters-list').getAttribute('aria-busy') === 'false');
      assert.equal(pg.w.sessionStorage.getItem('rpg_token'), status === 401 ? null : sessao.rpg_token);
      assert.equal(pg.w.sessionStorage.getItem('rpg_player'), status === 401 ? null : sessao.rpg_player);
      if (status === 500) assert.ok(pg.d.querySelector('.selection-state[data-state="error"]'));
      assert.deepEqual(pg.erros, []);
    } finally { pg.fechar(); }
  }
});

it('acesso: servidor real serve assets, valida login e cria personagem pela interface', async () => {
  const servidor = await iniciarServidor();
  let login;
  let selecao;
  try {
    for (const asset of ['/login', '/CSS/rpg-ui.css', '/CSS/acesso.css', '/CSS/icones.svg', '/JS/interface.js']) {
      assert.equal((await fetch(servidor.url + asset)).status, 200, asset);
    }
    assert.equal((await fetch(servidor.url + '/selecao', { redirect: 'manual' })).status, 302);
    let cookie;
    const rede = async (url, opts) => {
      const response = await fetch(new URL(url, servidor.url), opts);
      cookie = response.headers.get('set-cookie') || cookie;
      return response;
    };
    login = abrir('entrar.html', { fetch: rede });
    login.d.getElementById('player-name').value = 'visual-teste';
    login.d.getElementById('player-password').value = 'teste';
    await login.w.autenticar(true);
    const token = login.w.sessionStorage.getItem('rpg_token');
    assert.ok(token);
    assert.equal((await fetch(servidor.url + '/selecao', { headers: { Cookie: cookie } })).status, 200);
    const errado = await servidor.api('/api/login', { nome: 'visual-teste', senha: 'errada' });
    assert.equal(errado.success, false);
    selecao = abrir('login.html', { fetch: rede, sessao: { rpg_player: 'visual-teste', rpg_token: token } });
    await esperarAte(() => selecao.d.getElementById('characters-list').getAttribute('aria-busy') === 'false');
    selecao.w.abrirModalNovoPersonagem();
    selecao.d.getElementById('novo-nome-input').value = 'Guardião da Névoa';
    await selecao.w.confirmarNovoPersonagem();
    assert.equal(selecao.d.querySelector('.character-name').textContent, 'Guardião da Névoa');
    assert.equal(selecao.d.getElementById('modal-novo').hidden, true);
    const lista = await servidor.api('/api/personagens', null, token);
    assert.equal(lista.personagens.length, 1);
    assert.ok(fs.existsSync(path.join(servidor.dir, 'players', 'visual-teste', lista.personagens[0].nomePasta, 'status.json')));
    assert.deepEqual(login.erros, []);
    assert.deepEqual(selecao.erros, []);
  } finally {
    login?.fechar(); selecao?.fechar(); await servidor.parar();
  }
});

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { iniciarServidor, abrirFicha, esperarAte } = require('./ajuda/ambiente.js');

describe('rodada 2: apresentação da ficha sem alterar os contratos', { concurrency: false }, () => {
  let servidor, identidade, outra, ficha;
  const criar = async (nome, token) => (await servidor.api('/api/personagens', { nome }, token)).personagem.nomePasta;
  const gravar = (nome, dados) => fs.writeFileSync(path.join(servidor.dir, 'players', identidade.player, identidade.nomePasta, nome + '.json'), JSON.stringify({ schemaVersion: 1, ...dados }));
  const abrir = async () => { ficha = await abrirFicha(servidor, identidade); return ficha; };
  before(async () => {
    servidor = await iniciarServidor();
    const login = await servidor.api('/api/login', { nome: 'visual-ficha', senha: 'teste', criarSeNaoExistir: true });
    identidade = { player: login.player, token: login.token, nomePasta: await criar('Guardião da Névoa', login.token) };
    outra = await criar('Outra ficha', login.token);
    gravar('status', { hp: { current: 35, max: 40 }, vigor: { current: 18, max: 25 }, sanity: { current: 4, max: 10 } });
    gravar('atributos', { FOR: 16, DES: 14, INT: 12, SAB: 13, PRE: 10, VON: 15 });
    gravar('pericias', { skills: { atletismo: { mod: 2 } } });
    gravar('habilidades', { items: [{ uid: 'cx_teste1', nome: 'Golpe preciso', dice: '1d8+2', desc: 'Uma habilidade de teste.' }] });
    gravar('magias', { items: [{ uid: 'cx_teste2', nome: 'Chama azul', dice: '1d6', desc: 'Uma magia de teste.' }] });
    gravar('inventario', { items: [{ id: 'adaga', uid: 'it_visual01', name: 'Adaga', type: 'Arma', w: 1, h: 2, col: 1, row: 1, weight: 1, dice: '1d4', icon: 'fa-dagger' }], equipped: { mainHand: null, offHand: null, back: null, backpack: null } });
    await abrir();
  });
  after(async () => { ficha?.fechar(); await servidor?.parar(); });

  it('mantém campos, IDs únicos, nome visível e todos os painéis ligados às abas', () => {
    const d = ficha.document;
    const ids = [...d.querySelectorAll('[id]')].map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(d.getElementById('sheet-character-name').textContent, 'Guardião da Névoa');
    for (const chave of ['perfil.nome', 'perfil.classe', 'perfil.origem', 'perfil.idade', 'perfil.alinhamento', 'perfil.divindade', 'biografia.history', 'biografia.scars', 'biografia.notes', 'atributos.FOR', 'atributos.DES', 'atributos.INT', 'atributos.SAB', 'atributos.PRE', 'atributos.VON']) {
      assert.equal(d.querySelectorAll(`[data-campo="${chave}"]`).length, 1, chave);
    }
    d.querySelectorAll('[role="tab"]').forEach((btn) => assert.ok(d.getElementById(btn.getAttribute('aria-controls'))));
    assert.deepEqual(ficha.erros, []);
  });

  it('navega por teclado e lembra a área por personagem, sem salvar arquivos', async () => {
    ficha.run('trocarAba(2)');
    const btn = ficha.document.getElementById('tab-btn-2');
    btn.focus();
    btn.dispatchEvent(new ficha.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(ficha.document.activeElement.id, 'tab-btn-3');
    assert.equal(ficha.document.getElementById('tab-btn-3').getAttribute('aria-selected'), 'true');
    assert.equal(ficha.document.querySelectorAll('.tab-btn[tabindex="0"]').length, 1);
    assert.equal(ficha.document.getElementById('aba-2').classList.contains('hidden'), true);
    const chave = `rpg_ficha_aba:${identidade.player}/${identidade.nomePasta}`;
    assert.equal(ficha.window.sessionStorage.getItem(chave), '3');
    assert.equal(ficha.window.sessionStorage.getItem(`rpg_ficha_aba:${identidade.player}/${outra}`), null);
    await ficha.salvos();
  });

  it('perícia exibe o total correto, busca sem acento e distingue bônus de combo', async () => {
    ficha.run('trocarAba(2)');
    const d = ficha.document;
    assert.equal(d.getElementById('skill-mod-atletismo').textContent, '+5');
    const busca = d.getElementById('skills-search');
    busca.value = 'percepcao';
    busca.dispatchEvent(new ficha.window.Event('input'));
    const visiveis = [...d.querySelectorAll('.skill-row')].filter((e) => !e.hidden);
    assert.equal(visiveis.length, 1);
    assert.equal(visiveis[0].dataset.skillId, 'percepcao');
    busca.value = 'xxxxxx'; busca.dispatchEvent(new ficha.window.Event('input'));
    assert.equal(d.getElementById('skills-empty').hidden, false);
    busca.value = ''; busca.dispatchEvent(new ficha.window.Event('input'));
    d.getElementById('skills-edit-bonus').click();
    d.querySelector('[aria-label="Aumentar bônus de Atletismo"]').click();
    assert.equal(d.getElementById('skill-mod-atletismo').textContent, '+6');
    d.querySelector('[aria-label="Adicionar Atletismo ao combo"]').click();
    assert.equal(ficha.run('STATE.combo.at(-1).formula'), '+6');
    await ficha.salvos();
    assert.equal(servidor.lerArquivo(identidade.player, identidade.nomePasta, 'pericias').skills.atletismo.mod, 3);
  });

  it('filtra Todos/Habilidades/Magias sem modificar os dados e mantém tipo explícito no editor', () => {
    const antes = ficha.run('JSON.stringify([STATE.abilities, STATE.spells])');
    ficha.run('trocarAba(4); trocarSubAbaCodice("todos")');
    const d = ficha.document;
    assert.equal(d.getElementById('abilities-container').classList.contains('hidden'), false);
    assert.equal(d.getElementById('spells-container').classList.contains('hidden'), false);
    assert.equal(d.querySelector('[data-tipo="magias"] .sheet-power-tag').textContent, 'Magia');
    ficha.run('trocarSubAbaCodice("magias")');
    assert.equal(d.getElementById('abilities-container').classList.contains('hidden'), true);
    assert.equal(d.getElementById('codice-sub-magias').getAttribute('aria-pressed'), 'true');
    ficha.run('abrirModalCodice("criar")');
    assert.equal(d.getElementById('codice-tipo-entrada').value, 'magias');
    d.getElementById('codice-f-nome').value = 'Texto em edição';
    ficha.run('definirTipoEdicaoCodice("habilidades")');
    assert.equal(d.getElementById('codice-f-nome').value, 'Texto em edição');
    ficha.run('fecharModalCodice(); trocarSubAbaCodice("todos")');
    assert.equal(ficha.run('JSON.stringify([STATE.abilities, STATE.spells])'), antes);
  });

  it('mochila preserva geometria, abre detalhes por teclado fora da grade e fecha por Escape', () => {
    ficha.run('trocarAba(3)');
    const d = ficha.document;
    const item = d.getElementById('item-node-it_visual01');
    assert.equal(item.getAttribute('role'), 'button');
    assert.equal(item.tabIndex, 0);
    assert.equal(item.style.width, '60px');
    assert.equal(item.style.height, '123px');
    assert.equal(d.getElementById('backpack-grid').style.width, '186px');
    assert.equal(d.getElementById('backpack-grid').querySelectorAll('.inventory-cell').length, 9);
    item.focus();
    item.dispatchEvent(new ficha.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const modal = d.getElementById('item-popover');
    assert.equal(modal.hidden, false);
    assert.equal(modal.closest('.sheet-grid-scroll'), null);
    assert.equal(d.activeElement.id, 'item-close');
    assert.equal(d.getElementById('popover-title').textContent, 'Adaga');
    d.dispatchEvent(new ficha.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.hidden, true);
    assert.equal(d.activeElement.id, item.id);
  });

  it('editor aberto em Todos cria magia no JSON correto sem misturar habilidades', async () => {
    ficha.run('trocarAba(4); trocarSubAbaCodice("todos"); abrirModalCodice("criar"); definirTipoEdicaoCodice("magias")');
    ficha.document.getElementById('codice-f-nome').value = 'Magia criada no filtro Todos';
    ficha.document.getElementById('codice-f-dados').value = '1d6+1';
    ficha.run('criarEntradaCodice()');
    await ficha.salvos();
    assert.ok(servidor.lerArquivo(identidade.player, identidade.nomePasta, 'magias').items.some((e) => e.nome === 'Magia criada no filtro Todos'));
    assert.ok(!servidor.lerArquivo(identidade.player, identidade.nomePasta, 'habilidades').items.some((e) => e.nome === 'Magia criada no filtro Todos'));
    assert.equal(ficha.document.getElementById('codice-modal').hidden, true);
  });

  it('Tab no catálogo não leva aos controles escondidos do formulário de criação', async () => {
    ficha.run('abrirModalCodice("catalogo")');
    await esperarAte(() => !ficha.run('CODICE_UI.carregando'));
    const d = ficha.document;
    const painel = d.getElementById('codice-painel-criar');
    assert.equal(painel.classList.contains('hidden'), true);
    const visiveis = [...d.getElementById('codice-modal').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter((e) => !e.closest('[hidden], .hidden'));
    const ultimo = visiveis.at(-1);
    ultimo.focus();
    ultimo.dispatchEvent(new ficha.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(d.activeElement, visiveis[0]);
    assert.equal(painel.contains(d.activeElement), false);
    ficha.run('fecharModalCodice()');
  });

  it('configuração global mantém Mana, riquezas e slot da mochila condicionais', () => {
    ficha.run('aplicarConfiguracaoGlobal({AtivarMana:false, AtivarRiquezas:false, AtivarSlotMochila:false, UsarEx:false})');
    for (const id of ['vigor-card', 'riches-section', 'slot-backpack']) assert.equal(ficha.document.getElementById(id).classList.contains('hidden'), true);
    assert.equal(ficha.document.getElementById('vital-cards-container').classList.contains('grid-cols-2'), true);
    ficha.run('aplicarConfiguracaoGlobal({AtivarMana:true, AtivarRiquezas:true, AtivarSlotMochila:true, UsarEx:true})');
    for (const id of ['vigor-card', 'riches-section', 'slot-backpack']) assert.equal(ficha.document.getElementById(id).classList.contains('hidden'), false);
    assert.equal(ficha.document.getElementById('progression-type-btn').textContent, 'Ex');
  });

  it('salva vital e perícia no personagem correto e mantém os valores ao reabrir', async () => {
    const outroAntes = servidor.lerArquivo(identidade.player, outra, 'status');
    ficha.run('alterarVital("hp", -1)');
    await ficha.salvos();
    await esperarAte(() => servidor.lerArquivo(identidade.player, identidade.nomePasta, 'status').hp.current === 34);
    assert.deepEqual(servidor.lerArquivo(identidade.player, outra, 'status'), outroAntes);
    ficha.fechar();
    await abrir();
    assert.equal(ficha.run('STATE.vitals.hp.current'), 34);
    assert.equal(ficha.document.getElementById('skill-mod-atletismo').textContent, '+6');
    assert.deepEqual(ficha.erros, []);
  });

  it('atalho de seleção não abandona texto ainda aguardando salvamento', async () => {
    const campo = ficha.document.getElementById('bio-notes-text');
    campo.value = 'Texto ainda não confirmado';
    campo.dispatchEvent(new ficha.window.Event('input', { bubbles: true }));
    const evento = new ficha.window.MouseEvent('click', { bubbles: true, cancelable: true });
    ficha.document.querySelector('.sheet-session a').dispatchEvent(evento);
    assert.equal(evento.defaultPrevented, true);
    assert.match(ficha.document.getElementById('toast-container').textContent, /confirmação do salvamento/);
    await ficha.salvos();
    assert.equal(servidor.lerArquivo(identidade.player, identidade.nomePasta, 'biografia').notes, 'Texto ainda não confirmado');
  });

  it('Enter no máximo do vital cancela ativação padrão e retorna ao botão sem reabrir', async () => {
    ficha.run('editarMaximoVital("hp")');
    const campo = ficha.document.querySelector('input[aria-label="Novo máximo de HP"]');
    campo.value = '45';
    const enter = new ficha.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    campo.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(ficha.document.querySelector('input[aria-label="Novo máximo de HP"]'), null);
    assert.equal(ficha.document.activeElement.id, 'hp-max');
    assert.equal(ficha.run('STATE.vitals.hp.max'), 45);
    await ficha.salvos();
  });
});

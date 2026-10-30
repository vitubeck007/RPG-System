const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('ajustes do mestre são agrupados por vital após dois segundos do último ajuste', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../JS/conexao.js'), 'utf8');
  const trecho = fonte.slice(fonte.indexOf('const notificacoesVitaisPendentes'), fonte.indexOf('// O servidor pede o estado'));
  const eventos = {}, timers = new Map(), avisos = []; let relogio = 0, sequencia = 0;
  const contexto = vm.createContext({
    STATE: { id: 'p1', vitals: { hp: { current: 10, max: 20 }, sanity: { current: 8, max: 10 } } },
    socket: { on: (nome, cb) => { eventos[nome] = cb; } },
    setTimeout: (cb, ms) => { const id = ++sequencia; timers.set(id, { cb, vence: relogio + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    toast: (mensagem, tipo) => avisos.push([mensagem, tipo]),
    atualizarBarras() {}, salvarStatus() {}, syncPlayerToServer() {}, registrarNoTerminal() {},
  });
  vm.runInContext(trecho, contexto);
  const avancar = ms => { relogio += ms; for (const [id, t] of [...timers]) if (t.vence <= relogio) { timers.delete(id); t.cb(); } };
  const ajustar = (type, delta) => eventos.vital_adjusted({ charId: 'p1', type, delta, variacao: delta });
  ajustar('hp', -1); avancar(1000); ajustar('hp', -1); avancar(1000); ajustar('hp', -1);
  assert.equal(contexto.STATE.vitals.hp.current, 7, 'vida muda imediatamente');
  avancar(1999); assert.equal(avisos.length, 0);
  avancar(1); assert.deepEqual(avisos.shift(), ['Você tomou 3 de dano!', 'evento']);
  ajustar('hp', 2); ajustar('sanity', -1); avancar(2000);
  assert.deepEqual(avisos, [['Você recuperou 2 de vida!', 'evento'], ['1 de sanidade perdido.', 'evento']]);
  ajustar('hp', -1); ajustar('hp', 1); avancar(2000); assert.equal(avisos.length, 2, 'ajustes opostos se compensam');
});

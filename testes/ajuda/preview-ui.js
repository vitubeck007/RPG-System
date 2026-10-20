/* Preview manual com servidor e personagens descartáveis, sem tocar na mesa real.
   Uso: node testes/ajuda/preview-ui.js. Digite sair para encerrar e limpar. */
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { iniciarServidor } = require('./ambiente.js');

(async () => {
  const servidor = await iniciarServidor();
  let terminal;
  try {
    if (process.argv.includes('--ficha')) {
      await servidor.desligar();
      fs.writeFileSync(path.join(servidor.dir, 'config.json'), JSON.stringify({ AtivarMana: true, AtivarRiquezas: true, AtivarSlotMochila: true, UsarEx: false }));
      await servidor.ligar();
    }
    const login = await servidor.api('/api/login', { nome: 'preview-ui', senha: 'teste-ui', criarSeNaoExistir: true });
    if (!login.success) throw new Error(login.message || 'Falha ao preparar conta de preview.');
    for (const nome of ['Aelric, o Flagelo Silencioso', 'Lyra das Cinzas', 'Thorin, Guardião da Montanha Esquecida']) {
      const criado = await servidor.api('/api/personagens', { nome }, login.token);
      if (!criado.success) throw new Error(criado.message || 'Falha ao preparar personagem de preview.');
      if (process.argv.includes('--ficha') && nome.startsWith('Aelric')) {
        const pasta = path.join(servidor.dir, 'players', login.player, criado.personagem.nomePasta);
        const gravar = (arquivo, dados) => fs.writeFileSync(path.join(pasta, arquivo + '.json'), JSON.stringify({ schemaVersion: 1, ...dados }));
        const perfil = JSON.parse(fs.readFileSync(path.join(pasta, 'perfil.json'), 'utf8'));
        gravar('perfil', { ...perfil, classe: 'Guardião das ruínas', origem: 'Fronteiras do Norte', idade: '32 anos', alinhamento: 'Leal às próprias promessas', divindade: 'A Chama Velada', progressao: { nv: '5', ex: '40%' } });
        gravar('status', { hp: { current: 35, max: 40 }, vigor: { current: 18, max: 25 }, sanity: { current: 4, max: 10 } });
        gravar('atributos', { FOR: 16, DES: 14, INT: 12, SAB: 13, PRE: 10, VON: 15 });
        gravar('pericias', { skills: { atletismo: { mod: 2 }, furtividade: { mod: 3 }, percepcao: { mod: 2 }, vontade: { mod: 1 } } });
        gravar('biografia', { history: 'Aelric aprendeu a ouvir o silêncio antes de empunhar uma lâmina. Nas fronteiras do Norte, prometeu proteger aqueles que já não tinham para onde voltar.', scars: 'A cicatriz no ombro esquerdo é a lembrança de um juramento que ainda não conseguiu cumprir.', notes: 'Encontrar a cartógrafa na próxima lua. A passagem sob a torre continua selada.' });
        gravar('habilidades', { items: [{ uid: 'cx_preview01', nome: 'Golpe do guardião', dice: '1d8+3', desc: 'Uma investida precisa, sem abandonar a posição de defesa.', cost: { vital: 'vigor', amount: 2 }, alcance: 'Corpo a corpo', icon: 'fa-shield-halved' }, { uid: 'cx_preview02', nome: 'Passo silencioso', desc: 'Move-se entre as sombras, atento aos sinais ao redor.', alcance: 'Pessoal', icon: 'fa-eye' }] });
        gravar('magias', { items: [{ uid: 'cx_preview03', nome: 'Chama velada', dice: '2d6', tipoDano: 'Fogo', cost: { vital: 'vigor', amount: 3 }, desc: 'Uma chama azul ilumina a palma da mão antes de avançar pelo ar.', alcance: '12 metros', icon: 'fa-fire' }] });
        const base = { type: 'Item', weight: 1, quantity: 1, maxStack: 1, color: 'from-slate-800 to-slate-900' };
        gravar('inventario', { items: [
          { ...base, id: 'adaga-preview', uid: 'it_preview01', name: 'Adaga de aço', w: 1, h: 2, col: 1, row: 1, type: 'Arma', dice: '1d4+2', icon: 'fa-khanda', desc: 'Lâmina curta, bem equilibrada.' },
          { ...base, id: 'pocao-preview', uid: 'it_preview02', name: 'Poção', w: 1, h: 1, col: 2, row: 1, quantity: 3, maxStack: 5, icon: 'fa-flask', color: 'from-rose-950 to-slate-900', desc: 'Um líquido rubro em um frasco de vidro.' },
          { ...base, id: 'corda-preview', uid: 'it_preview03', name: 'Corda', w: 2, h: 1, col: 3, row: 1, icon: 'fa-link', desc: 'Dez metros de corda de viagem.' }
        ], equipped: { mainHand: { ...base, id: 'espada-preview', uid: 'it_preview04', name: 'Espada longa', type: 'Arma', dice: '1d8+3', w: 1, h: 3, icon: 'fa-khanda' }, offHand: null, back: null, backpack: { ...base, id: 'mochila-preview', uid: 'it_preview05', name: 'Mochila de expedição', w: 2, h: 2, isBackpackItem: true, backpackType: 'carga', icon: 'fa-bag-shopping' } } });
      }
    }
    console.log('[PREVIEW] Cópia temporária: ' + servidor.dir);
    console.log('[PREVIEW] Abra ' + servidor.url + '/login');
    console.log('[PREVIEW] Jogador: preview-ui | Senha: teste-ui');
    console.log('[PREVIEW] Os dados são descartáveis. Digite sair para encerrar.');
    terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => {
      terminal.on('line', (linha) => { if (linha.trim().toLowerCase() === 'sair') resolve(); });
      terminal.on('close', resolve);
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } finally {
    terminal?.close();
    await servidor.parar();
    console.log('[PREVIEW] Servidor encerrado e cópia temporária removida.');
  }
})().catch((erro) => { console.error(erro); process.exitCode = 1; });

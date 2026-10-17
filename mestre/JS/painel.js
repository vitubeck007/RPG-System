/* =========================================================================
   MESA: JOGADORES, STATUS E ROLAGENS
   Script da página principal do painel do mestre (mestre/index.html). Usa o que o comum.js define:
   socket, tokenDoMestre() e toast(). Mostra os cards dos jogadores (vitais com ajuste), a ficha
   completa em somente leitura e o feed de rolagens.
   ========================================================================= */

let players = {};
let systemConfig = { AtivarMana: false };
const MAX_JOGADORES_MESA = 5; // só para o contador do cabeçalho
document.getElementById('max-players').textContent = MAX_JOGADORES_MESA;
let fichas = {};              // charId -> arquivos da ficha (perfil, atributos, ...)
const fichasAbertas = new Set(); // charId com a ficha expandida no painel

function pedirFicha(charId) {
    socket.emit('master_get_personagem', { token: tokenDoMestre(), charId });
}

socket.on('connect', () => {
    // Depois de reconectar o servidor esqueceu a sala dos mestres: recarrega o que está aberto.
    fichas = {};
    if (tokenDoMestre()) fichasAbertas.forEach(pedirFicha);
    else fichasAbertas.clear();
});

socket.on('sync_all_players', (serverPlayers) => {
    players = serverPlayers || {};
    renderizarCardsJogadores();
});

socket.on('sync_config', (config) => {
    if (!config || typeof config.AtivarMana !== 'boolean') return;
    systemConfig = { ...systemConfig, ...config };
    renderizarCardsJogadores();
});

socket.on('player_updated', (playerData) => {
    players[playerData.id] = playerData;
    renderizarCardsJogadores();
});

socket.on('vital_adjusted', (data) => {
    if (players[data.charId]) {
        players[data.charId].vitals = data.vitals;
        renderizarCardsJogadores();
    }
});

socket.on('player_removed', ({ charId }) => {
    delete players[charId];
    delete fichas[charId];
    fichasAbertas.delete(charId);
    renderizarCardsJogadores();
});

// Ficha completa (primeira leitura, vinda do disco)
socket.on('master_personagem', ({ charId, personagem }) => {
    if (!charId || !personagem) return;
    fichas[charId] = personagem;
    renderizarCardsJogadores();
});

// Alteração salva pelo jogador: atualiza só o arquivo que mudou, em tempo real
socket.on('ficha_arquivo', ({ charId, arquivo, dados }) => {
    if (!fichas[charId] || !arquivo) return;
    fichas[charId][arquivo] = dados;
    if (fichasAbertas.has(charId)) renderizarCardsJogadores();
});

socket.on('dice_rolled', (roll) => {
    adicionarRolagemAoFeed(roll);
});

// Feedback das ações do mestre
socket.on('master_feedback', (fb) => {
    toast(fb.message, fb.success ? 'success' : 'error');
    if (!fb.success && fb.charId && fichasAbertas.has(fb.charId) && !fichas[fb.charId]) {
        fichasAbertas.delete(fb.charId);
        renderizarCardsJogadores();
    }
});

function renderizarCardsJogadores() {
    const container = document.getElementById('players-cards-container');
    const countEl = document.getElementById('connected-count');
    const playerIds = Object.keys(players);

    countEl.innerText = playerIds.length;

    if (playerIds.length === 0) {
        container.innerHTML = `
          <div class="col-span-full p-8 text-center bg-dungeon-900/60 border border-dashed border-dungeon-700 rounded-xl text-slate-500 text-sm">
            <i class="fa-solid fa-dice-d20 text-3xl mb-2 text-slate-600"></i>
            <p>Aguardando jogadores abrirem a ficha...</p>
          </div>
        `;
        return;
    }

    container.innerHTML = '';

    playerIds.forEach(id => {
        const p = players[id];
        const zero = { current: 0, max: 0 };
        const v = { hp: zero, vigor: zero, sanity: zero, ...(p.vitals || {}) };

        const hpPct = Math.round((v.hp.current / (v.hp.max || 1)) * 100);
        const vigorPct = Math.round((v.vigor.current / (v.vigor.max || 1)) * 100);
        const sanityPct = Math.round((v.sanity.current / (v.sanity.max || 1)) * 100);

        const card = document.createElement('div');
        card.className = "bg-dungeon-900 border border-dungeon-700 rounded-xl p-4 shadow-xl flex flex-col justify-between";
        card.innerHTML = `
          <div>
            <div class="flex justify-between items-start mb-3 pb-2 border-b border-dungeon-800">
              <div>
                <h3 class="font-cinzel font-bold text-amber-200 text-sm truncate max-w-[200px]">${escaparHtml(p.name || 'Herói Sem Nome')}</h3>
                <span class="text-[10px] text-slate-500 font-mono">Última ação: ${escaparHtml(p.lastUpdate || 'Conectado')}</span>
              </div>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">Online</span>
            </div>

            <div class="space-y-3">
              <!-- HP -->
              <div>
                <div class="flex justify-between text-xs font-mono mb-1">
                  <span class="text-crimson-400 font-bold flex items-center gap-1"><i class="fa-solid fa-heart-pulse"></i> HP</span>
                  <span class="text-slate-300 font-bold">${v.hp.current}/${v.hp.max} (${hpPct}%)</span>
                </div>
                <div class="w-full bg-dungeon-950 h-2 rounded-full overflow-hidden border border-dungeon-700 mb-1.5">
                  <div class="bg-crimson-600 h-full transition-all duration-300" style="width: ${hpPct}%"></div>
                </div>
                <div class="flex gap-1 justify-end">
                  <button onclick="ajustarVital('${id}', 'hp', -5)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-crimson-900 text-slate-300 rounded border border-dungeon-700 font-mono">-5</button>
                  <button onclick="ajustarVital('${id}', 'hp', -1)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-crimson-900 text-slate-300 rounded border border-dungeon-700 font-mono">-1</button>
                  <button onclick="ajustarVital('${id}', 'hp', 1)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-emerald-900 text-slate-300 rounded border border-dungeon-700 font-mono">+1</button>
                  <button onclick="ajustarVital('${id}', 'hp', 5)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-emerald-900 text-slate-300 rounded border border-dungeon-700 font-mono">+5</button>
                </div>
              </div>

              <!-- VIGOR -->
              <div data-vigor-vital>
                <div class="flex justify-between text-xs font-mono mb-1">
                  <span class="text-vigor-400 font-bold flex items-center gap-1"><i class="fa-solid fa-bolt"></i> Vigor</span>
                  <span class="text-slate-300 font-bold">${v.vigor.current}/${v.vigor.max}</span>
                </div>
                <div class="w-full bg-dungeon-950 h-2 rounded-full overflow-hidden border border-dungeon-700 mb-1.5">
                  <div class="bg-vigor-500 h-full transition-all duration-300" style="width: ${vigorPct}%"></div>
                </div>
                <div class="flex gap-1 justify-end">
                  <button onclick="ajustarVital('${id}', 'vigor', -1)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-vigor-900 text-slate-300 rounded border border-dungeon-700 font-mono">-1</button>
                  <button onclick="ajustarVital('${id}', 'vigor', 1)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-cyan-900 text-slate-300 rounded border border-dungeon-700 font-mono">+1</button>
                </div>
              </div>

              <!-- SANIDADE -->
              <div>
                <div class="flex justify-between text-xs font-mono mb-1">
                  <span class="text-sanity-400 font-bold flex items-center gap-1"><i class="fa-solid fa-brain"></i> Sanidade</span>
                  <span class="text-slate-300 font-bold">${v.sanity.current}/${v.sanity.max}</span>
                </div>
                <div class="w-full bg-dungeon-950 h-2 rounded-full overflow-hidden border border-dungeon-700 mb-1.5">
                  <div class="bg-sanity-500 h-full transition-all duration-300" style="width: ${sanityPct}%"></div>
                </div>
                <div class="flex gap-1 justify-end">
                  <button onclick="ajustarVital('${id}', 'sanity', -1)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-purple-900 text-slate-300 rounded border border-dungeon-700 font-mono">-1</button>
                  <button onclick="ajustarVital('${id}', 'sanity', 1)" class="px-2 py-0.5 text-xs bg-dungeon-800 hover:bg-purple-900 text-slate-300 rounded border border-dungeon-700 font-mono">+1</button>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-3 pt-3 border-t border-dungeon-800">
            <button onclick="alternarFicha('${id}')" class="w-full text-xs font-mono py-1.5 rounded bg-dungeon-800 hover:bg-dungeon-700 text-amberGold-400 border border-dungeon-700 transition">
              <i class="fa-solid ${fichasAbertas.has(id) ? 'fa-chevron-up' : 'fa-scroll'} mr-1"></i>${fichasAbertas.has(id) ? 'Ocultar ficha' : 'Ver ficha'}
            </button>
            ${fichasAbertas.has(id) ? `<div class="mt-3 space-y-3">${htmlFicha(id)}</div>` : ''}
          </div>
        `;
        if (!systemConfig.AtivarMana) {
            card.querySelector('[data-vigor-vital]')?.remove();
        }
        container.appendChild(card);
    });
}

function alternarFicha(charId) {
    if (fichasAbertas.has(charId)) {
        fichasAbertas.delete(charId);
    } else {
        if (!tokenDoMestre()) {
            toast('Informe o token do mestre para abrir a ficha.', 'error');
            return;
        }
        fichasAbertas.add(charId);
        if (!fichas[charId]) pedirFicha(charId);
    }
    renderizarCardsJogadores();
}

/* ---------- Ficha completa (somente leitura) ---------- */
const ATRIBUTOS_ORDEM = ['FOR', 'DES', 'INT', 'SAB', 'PRE', 'VON'];
const SLOTS_ROTULO = { mainHand: 'Mão principal', offHand: 'Mão secundária', back: 'Costas', backpack: 'Mochila' };

const secao = (titulo, corpo) => `
    <div>
      <h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1.5">${titulo}</h4>
      ${corpo}
    </div>`;
const vazio = (txt) => `<p class="text-[11px] text-slate-600 italic">${txt}</p>`;
const num = (v) => Number(v) || 0;

function htmlFicha(id) {
    const f = fichas[id];
    if (!f) return vazio('Carregando ficha...');
    return [
        htmlPerfil(f.perfil),
        htmlAtributos(f.atributos),
        htmlPericias(f),
        htmlInventario(f.inventario),
        htmlCodice('Habilidades', f.habilidades),
        htmlCodice('Magias', f.magias),
    ].join('');
}

function htmlPerfil(perfil) {
    if (!perfil) return '';
    const partes = [perfil.classe, perfil.origem, perfil.idade && `${perfil.idade} anos`, perfil.alinhamento, perfil.divindade]
        .filter(Boolean).map(escaparHtml);
    const nivel = perfil.progressao ? `Nível ${escaparHtml(perfil.progressao.nv)} • XP ${escaparHtml(perfil.progressao.ex)}` : '';
    return secao('Perfil', `<p class="text-xs text-slate-300">${[nivel, ...partes].filter(Boolean).join(' • ') || vazio('Sem dados básicos.')}</p>`);
}

function htmlAtributos(atributos) {
    if (!atributos) return '';
    const celulas = ATRIBUTOS_ORDEM.map(a => `
        <div class="bg-dungeon-950 border border-dungeon-700 rounded p-1.5 text-center">
          <div class="text-[10px] text-slate-500 font-mono">${a}</div>
          <div class="text-sm font-bold text-slate-200 font-mono">${num(atributos[a])}</div>
          <div class="text-[10px] text-amberGold-400 font-mono">${formatarBonus(modificadorDeAtributo(atributos[a]))}</div>
        </div>`).join('');
    return secao('Atributos', `<div class="grid grid-cols-6 gap-1.5">${celulas}</div>`);
}

function htmlPericias(f) {
    const linhas = CATALOGO_PERICIAS.map(p => {
        const bonus = num(f.pericias?.skills?.[p.id]?.mod);
        const modAttr = modificadorDeAtributo(f.atributos?.[p.attr]);
        return `
        <div class="flex justify-between items-baseline gap-2 text-[11px] font-mono">
          <span class="text-slate-300 truncate">${escaparHtml(p.name)} <span class="text-slate-600">${p.attr} ${formatarBonus(modAttr)} • bônus ${formatarBonus(bonus)}</span></span>
          <span class="text-amberGold-400 font-bold">${formatarBonus(modAttr + bonus)}</span>
        </div>`;
    }).join('');
    return secao('Perícias (total)', `<div class="grid grid-cols-1 gap-0.5">${linhas}</div>`);
}

function htmlInventario(inv) {
    if (!inv) return '';
    const itens = Array.isArray(inv.items) ? inv.items : [];
    const carga = calcularCarga(itens, inv.equipped?.backpack);
    const equipados = Object.entries(SLOTS_ROTULO).map(([slot, rotulo]) => `
        <div class="flex justify-between text-[11px] font-mono">
          <span class="text-slate-500">${rotulo}</span>
          <span class="text-slate-300 truncate max-w-[60%]">${inv.equipped?.[slot] ? escaparHtml(inv.equipped[slot].name || 'Item') : '—'}</span>
        </div>`).join('');
    const lista = itens.length ? itens.map(i => `
        <div class="flex justify-between text-[11px] font-mono">
          <span class="text-slate-300 truncate">${escaparHtml(i.name || 'Item')}${num(i.quantity) > 1 ? ` ×${num(i.quantity)}` : ''}</span>
          <span class="text-slate-500">${num(i.weight)}</span>
        </div>`).join('') : vazio('Mochila vazia.');
    return secao(`Inventário (carga ${Math.round(carga * 100) / 100})`,
        `<div class="space-y-0.5 mb-2">${equipados}</div><div class="space-y-0.5 pt-2 border-t border-dungeon-800">${lista}</div>`);
}

function htmlCodice(titulo, dados) {
    const lista = Array.isArray(dados?.items) ? dados.items : [];
    const corpo = lista.length ? lista.map(e => {
        const custo = custoDaEntrada(e);
        const meta = [e.dice && `${e.dice}${e.tipoDano ? ' ' + e.tipoDano : ''}`, custo.definido && `custo ${custo.texto}`]
            .filter(Boolean).map(escaparHtml).join(' • ');
        return `
        <div class="flex justify-between gap-2 text-[11px] font-mono">
          <span class="text-slate-300 truncate">${escaparHtml(e.nome || e.name || titulo)}</span>
          <span class="text-slate-500 text-right">${meta}</span>
        </div>`;
    }).join('') : vazio(`Nenhuma ${titulo === 'Magias' ? 'magia' : 'habilidade'}.`);
    return secao(`${titulo} (${lista.length})`, `<div class="space-y-0.5">${corpo}</div>`);
}

function ajustarVital(charId, type, delta) {
    if (type === 'vigor' && !systemConfig.AtivarMana) return;
    const token = tokenDoMestre();
    socket.emit('master_adjust_vital', {
        token: token,
        charId: charId,
        type: type,
        delta: delta
    });
}

function adicionarRolagemAoFeed(roll) {
    const feed = document.getElementById('rolls-feed-container');
    const hora = new Date(roll.quando || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (feed.innerText.includes('Nenhum dado rolado')) {
        feed.innerHTML = '';
    }

    const card = document.createElement('div');
    card.className = "p-3 bg-dungeon-900 border border-amberGold-600/40 rounded-xl shadow-lg flex items-center justify-between";
    card.innerHTML = `
      <div class="flex-1 min-w-0 pr-3">
        <div class="flex items-center gap-2">
          <span class="font-cinzel font-bold text-amberGold-300 text-xs truncate">${escaparHtml(roll.character)}</span>
          <span class="text-[10px] font-mono text-slate-500">${hora}</span>
        </div>
        <div class="text-[11px] font-mono text-slate-400 truncate mt-0.5">${escaparHtml(roll.details)}</div>
      </div>
      <div class="text-right">
        <div class="font-cinzel font-black text-2xl text-amberGold-400">= ${roll.total}</div>
      </div>
    `;
    feed.prepend(card);
}

function limparFeedRolagens() {
    document.getElementById('rolls-feed-container').innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs italic bg-dungeon-900 rounded-xl border border-dungeon-800">
        Feed de rolagens limpo.
      </div>
    `;
}

/* =========================================================================
   MESA: JOGADORES, STATUS E ROLAGENS
   Script da página principal do painel do mestre (mestre/index.html). Usa o que o comum.js define:
   socket, pedirAoServidor() e toast(). Mostra os cards dos jogadores (vitais com ajuste), a ficha
   completa em somente leitura e o feed de rolagens.
   ========================================================================= */

let players = {};
let systemConfig = { AtivarMana: false };
const MAX_JOGADORES_MESA = 6; // só para o contador do cabeçalho
document.getElementById("max-players").textContent = MAX_JOGADORES_MESA;
let fichas = {}; // charId -> arquivos da ficha (perfil, atributos, ...)
const fichasAbertas = new Set(); // charId com a ficha expandida no painel
const fichasSolicitadas = new Set();
const fichasComErro = new Set();

function pedirFicha(charId) {
  if (!socket.connected || fichasSolicitadas.has(charId)) return;
  fichasSolicitadas.add(charId);
  socket.emit("master_get_personagem", { charId });
}

socket.on("connect", () => {
  // Depois de reconectar o servidor esqueceu a sala dos mestres: recarrega o que está aberto.
  fichas = {};
  fichasSolicitadas.clear();
  fichasComErro.clear();
  Object.keys(players).forEach(pedirFicha);
});

socket.on("sync_all_players", (serverPlayers) => {
  players = serverPlayers || {};
  Object.keys(players).forEach((id) => {
    if (!fichas[id]) pedirFicha(id);
  });
  renderizarCardsJogadores();
});

socket.on("sync_config", (config) => {
  if (!config || typeof config.AtivarMana !== "boolean") return;
  systemConfig = { ...systemConfig, ...config };
  renderizarCardsJogadores();
});

socket.on("player_updated", (playerData) => {
  players[playerData.id] = playerData;
  if (!fichas[playerData.id] && !fichasComErro.has(playerData.id))
    pedirFicha(playerData.id);
  renderizarCardsJogadores();
});

socket.on("vital_adjusted", (data) => {
  if (players[data.charId]) {
    players[data.charId].vitals = data.vitals;
    renderizarCardsJogadores();
  }
});

socket.on("player_removed", ({ charId }) => {
  delete players[charId];
  delete fichas[charId];
  fichasAbertas.delete(charId);
  fichasSolicitadas.delete(charId);
  fichasComErro.delete(charId);
  estadoCartaoMesa.delete(charId);
  renderizarCardsJogadores();
});

// Ficha completa (primeira leitura, vinda do disco)
socket.on("master_personagem", ({ charId, personagem }) => {
  if (!charId || !personagem) return;
  if (!players[charId]) return;
  fichasSolicitadas.delete(charId);
  fichasComErro.delete(charId);
  fichas[charId] = personagem;
  renderizarCardsJogadores();
});

// Alteração salva pelo jogador: atualiza só o arquivo que mudou, em tempo real
socket.on("ficha_arquivo", ({ charId, arquivo, dados }) => {
  if (!fichas[charId] || !arquivo) return;
  fichas[charId][arquivo] = dados;
  renderizarCardsJogadores();
});

socket.on("dice_rolled", (roll) => {
  adicionarRolagemAoFeed(roll);
});

// Feedback das ações do mestre
socket.on("master_feedback", (fb) => {
  if (!fb.success) toast(fb.message, "error");
  if (
    !fb.success &&
    fb.charId &&
    fichasSolicitadas.has(fb.charId) &&
    !fichas[fb.charId]
  ) {
    fichasSolicitadas.delete(fb.charId);
    fichasComErro.add(fb.charId);
    renderizarCardsJogadores();
  }
});

function alternarFicha(charId) {
  if (fichasAbertas.has(charId)) {
    fichasAbertas.delete(charId);
  } else {
    fichasAbertas.add(charId);
    if (!fichas[charId]) pedirFicha(charId);
  }
  renderizarCardsJogadores();
}

/* ---------- Ficha completa (somente leitura) ---------- */
const SLOTS_ROTULO = {
  mainHand: "Mão principal",
  offHand: "Mão secundária",
  back: "Costas",
  backpack: "Mochila",
};

const secao = (titulo, corpo) => `
    <div>
      <h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1.5">${titulo}</h4>
      ${corpo}
    </div>`;
const vazio = (txt) =>
  `<p class="text-[11px] text-slate-600 italic">${txt}</p>`;
const num = (v) => Number(v) || 0;

function htmlFicha(id) {
  const f = fichas[id];
  if (!f) return vazio("Carregando ficha...");
  return [
    htmlPerfil(f.perfil),
    htmlPericias(f),
    htmlInventario(f.inventario),
  ].join("");
}

function htmlPerfil(perfil) {
  if (!perfil) return "";
  const nivel = perfil.progressao
    ? `Lv ${escaparHtml(perfil.progressao.nv)} / XP ${escaparHtml(perfil.progressao.ex)}`
    : "Progressão indisponível";
  return `<p class="mesa-progressao">${nivel}</p>`;
}


function htmlPericias(f) {
  const linhas = CATALOGO_PERICIAS.map((p) => {
    const bonus = num(f.pericias?.skills?.[p.id]?.mod);
    const modAttr = modificadorDeAtributo(f.atributos?.[p.attr]);
    return `
        <div class="mesa-pericia">
          <span>${escaparHtml(p.name)}</span><span>${escaparHtml(p.attr)}</span>
          <strong>${formatarBonus(modAttr + bonus)}</strong>
        </div>`;
  }).join("");
  return secao(
    "Perícias (total)",
    `<div class="mesa-pericias">${linhas}</div>`,
  );
}

function htmlInventario(inv) {
  if (!inv) return "";
  const itens = Array.isArray(inv.items) ? inv.items : [];
  const carga = calcularCarga(itens, inv.equipped?.backpack);
  const equipados = Object.entries(SLOTS_ROTULO)
    .map(
      ([slot, rotulo]) => `
        <div class="flex justify-between text-[11px] font-mono">
          <span class="text-slate-500">${rotulo}</span>
          <span class="text-slate-300 truncate max-w-[60%]">${inv.equipped?.[slot] ? escaparHtml(inv.equipped[slot].name || "Item") : "—"}</span>
        </div>`,
    )
    .join("");
  const lista = itens.length
    ? itens
        .map(
          (i) => `
        <div class="flex justify-between text-[11px] font-mono">
          <span class="text-slate-300 truncate">${escaparHtml(i.name || "Item")}${num(i.quantity) > 1 ? ` ×${num(i.quantity)}` : ""}</span>
          <span class="text-slate-500">${num(i.weight)}</span>
        </div>`,
        )
        .join("")
    : vazio("Mochila vazia.");
  return secao(
    `Inventário (carga ${Math.round(carga * 100) / 100})`,
    `<div class="mesa-equipamentos">${equipados}</div><details class="mesa-mochila-detalhes"><summary>Itens da mochila (${itens.length})</summary><div>${lista}</div></details>`,
  );
}


function ajustarVital(charId, type, delta) {
  if (type === "vigor" && !systemConfig.AtivarMana) return;
  if (!socket.connected)
    return toast("Sem conexão. Reconecte antes de ajustar o vital.", "error");
  socket.emit("master_adjust_vital", {
    charId: charId,
    type: type,
    delta: delta,
  });
}

function abrirAjusteVitalMestre(charId, tipo) {
  const rotulos = { hp: "Vida", vigor: "Vigor", sanity: "Sanidade" };
  RPGUI.ajustarValor({
    titulo: `${players[charId]?.name || "Personagem"} · ${rotulos[tipo]}`,
    ler: () =>
      tipo !== "vigor" || systemConfig.AtivarMana
        ? players[charId]?.vitals?.[tipo]
        : null,
    aplicar: (delta) => {
      if (!socket.connected)
        throw new Error("Sem conexão. Reconecte antes de ajustar o vital.");
      ajustarVital(charId, tipo, delta);
      toast("Ajuste enviado. Aguarde a confirmação do servidor.", "info");
    },
  });
}

function adicionarRolagemAoFeed(roll) {
  const feed = document.getElementById("rolls-feed-container");
  const hora = new Date(roll.quando || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (feed.innerText.includes("Nenhum dado rolado")) {
    feed.innerHTML = "";
  }

  const card = document.createElement("div");
  card.className =
    "p-3 bg-dungeon-900 border border-amberGold-600/40 rounded-xl shadow-lg flex items-center justify-between";
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
  document.getElementById("rolls-feed-container").innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs italic bg-dungeon-900 rounded-xl border border-dungeon-800">
        Feed de rolagens limpo.
      </div>
    `;
}

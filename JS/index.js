/* =========================================================================
       CONEXÃO WEBSOCKET COM O SERVIDOR
       ========================================================================= */
function lerIdentidadePersonagem() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("rpg_character") || "null");
    if (
      saved &&
      typeof saved.player === "string" &&
      typeof saved.nomePasta === "string" &&
      saved.player &&
      saved.nomePasta
    ) {
      return { player: saved.player, nomePasta: saved.nomePasta };
    }
  } catch (error) {
    console.warn("[RPG] Identidade de personagem inválida na sessão.");
  }
  return null;
}

const CHARACTER = lerIdentidadePersonagem();
const AUTH_TOKEN = sessionStorage.getItem("rpg_token");
const CHARACTER_NAME = sessionStorage.getItem("rpg_character_name") || "";
const socket = io({ auth: { token: AUTH_TOKEN } });
let personagemCarregado = false;

function criarIdEstado(identidade) {
  const source = `${identidade.player}/${identidade.nomePasta}`;
  let hash = 2166136261;
  for (const character of source) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `char_${(hash >>> 0).toString(36)}`;
}

// Encaminha alterações importantes ao terminal do servidor para facilitar o diagnóstico.
function registrarNoTerminal(acao, detalhes = {}) {
  const contexto = {
    personagemId: STATE.id,
    personagem: document.getElementById("char-name-input")?.value || STATE.name,
    ...detalhes,
  };

  console.info(`[RPG] ${acao}`, contexto);
  if (socket?.connected) {
    socket.emit("client_log", { action: acao, context: contexto });
  }
}

/* =========================================================================
       ESTADO CENTRAL DA FICHA
   ========================================================================= */
// Mesmos padrões do DEFAULT_CONFIG do servidor; valem só até chegar o sync_config.
const GLOBAL_CONFIG = {
  AtivarRiquezas: false,
  UsarEx: false,
  AtivarSlotMochila: true,
  AtivarMana: false,
};

/* Catálogo FIXO de perícias (dado global do sistema, não da ficha).
   A ficha do personagem guarda apenas o modificador de cada perícia (pericias.json). */
const CATALOGO_PERICIAS = [
  {
    id: "acrobacia",
    name: "Acrobacia",
    icon: "fa-person-running",
    attr: "DES",
  },
  { id: "atletismo", name: "Atletismo", icon: "fa-dumbbell", attr: "FOR" },
  { id: "furtividade", name: "Furtividade", icon: "fa-mask", attr: "DES" },
  {
    id: "investigacao",
    name: "Investigação",
    icon: "fa-magnifying-glass",
    attr: "INT",
  },
  { id: "luta", name: "Luta Corpórea", icon: "fa-hand-fist", attr: "FOR" },
  { id: "medicina", name: "Medicina", icon: "fa-mortar-pestle", attr: "SAB" },
  { id: "ocultismo", name: "Ocultismo", icon: "fa-eye", attr: "INT" },
  { id: "percepcao", name: "Percepção", icon: "fa-binoculars", attr: "SAB" },
  { id: "pontaria", name: "Pontaria", icon: "fa-crosshairs", attr: "DES" },
  {
    id: "sobrevivencia",
    name: "Sobrevivência",
    icon: "fa-campground",
    attr: "SAB",
  },
  { id: "intimidacao", name: "Intimidação", icon: "fa-skull", attr: "PRE" },
  { id: "vontade", name: "Vontade", icon: "fa-shield-heart", attr: "VON" },
];

// Junta o catálogo com os modificadores salvos: { id: { mod } } -> lista para a interface.
function montarPericias(modsSalvos = {}) {
  return CATALOGO_PERICIAS.map((pericia) => ({
    ...pericia,
    mod: Number.isFinite(Number(modsSalvos?.[pericia.id]?.mod))
      ? Number(modsSalvos[pericia.id].mod)
      : 0,
  }));
}

const STATE = {
  id: CHARACTER ? criarIdEstado(CHARACTER) : "character-unselected",
  name: CHARACTER_NAME || "Personagem",
  progressionMode: "ex",
  progressionValues: { ex: "5%", nv: "4" },
  vitals: {
    hp: {
      current: 10,
      max: 10,
    },
    vigor: {
      current: 10,
      max: 10,
    },
    sanity: {
      current: 10,
      max: 10,
    },
  },

  skills: montarPericias(),
  spells: [],

  // Definições de tamanho das mochilas
  backpackConfigs: {
    bolsos: { cols: 3, rows: 3, label: "Bolsos Básicos (3x3)" },
    leve: { cols: 4, rows: 3, label: "Mochila Leve (4x3)" },
    tatica: { cols: 5, rows: 4, label: "Mochila Tática (5x4)" },
    carga: { cols: 6, rows: 5, label: "Mochila de Expedição (6x5)" },
  },

  // ALTERAÇÃO 2: SLOTS DE PRONTIDÃO (Inclui slot dedicado para mochila)
  equipped: {
    mainHand: null,
    offHand: null,
    back: null,
    backpack: {
      id: "mochila-leve",
      name: "Mochila de Couro Leve",
      desc: "Uma mochila confortável que expande seu inventário para 4x3.",
      backpackType: "leve",
      weight: 1.5,
      icon: "fa-backpack",
      isBackpackItem: true,
    },
  },

  // ITENS NA MOCHILA TETRIS
  backpackItems: [
    {
      id: "espada-longa",
      name: "Espada de Cinzas",
      desc: "Uma lâmina bastarda forjada com aço temperado.",
      col: 1,
      row: 1,
      w: 1,
      h: 3,
      weight: 3.5,
      color: "from-amber-950/80 to-stone-900 border-amber-600/70",
      dice: "2d5",
      twoHanded: false,
      type: "Arma Cortante",
      icon: "fa-khanda",
    },
    {
      id: "adaga-sombria",
      name: "Adaga de Obsidiana",
      desc: "Pequena e silenciosa, perfeita para a mão secundária.",
      col: 2,
      row: 1,
      w: 1,
      h: 2,
      weight: 1.0,
      color: "from-purple-950/80 to-slate-900 border-purple-600/70",
      dice: "1d6",
      twoHanded: false,
      type: "Arma Leve",
      icon: "fa-tooth",
    },
    {
      id: "extrato-vida",
      name: "Extrato de Sangue",
      desc: "Frasco rubro de recuperação rápida.",
      col: 3,
      row: 1,
      w: 1,
      h: 1,
      weight: 0.5,
      color: "from-red-950/80 to-stone-900 border-red-500/80",
      dice: "2d4",
      twoHanded: false,
      type: "Consumível",
      icon: "fa-flask-vial",
    },
    {
      id: "mochila-tatica-item",
      name: "Mochila Tática Reforçada",
      desc: "Equipe para expandir sua grade para 5x4 slots!",
      col: 4,
      row: 1,
      w: 1,
      h: 2,
      weight: 2.5,
      color: "from-emerald-950/80 to-stone-900 border-emerald-600/70",
      dice: null,
      twoHanded: false,
      type: "Mochila",
      backpackType: "tatica",
      icon: "fa-shield-halved",
      isBackpackItem: true,
    },
  ],

  combo: [],
  history: [],
};

/* =========================================================================
       SOCKET.IO INTEGRAÇÃO EM TEMPO REAL
       ========================================================================= */
function syncPlayerToServer() {
  if (personagemCarregado && CHARACTER && socket?.connected) {
    socket.emit("player_update", {
      id: STATE.id,
      character: CHARACTER,
      name: document.getElementById("char-name-input")?.value || STATE.name,
      vitals: STATE.vitals,
      equipped: STATE.equipped,
    });
  } else {
    console.warn("[RPG] Ficha não sincronizada: servidor desconectado.");
  }
}

// Envia UM arquivo do personagem ao servidor (que valida, normaliza e grava).
function salvarArquivoPersonagem(arquivo, dados) {
  if (!personagemCarregado || !CHARACTER || !socket?.connected) return;
  socket.emit("salvar_personagem", {
    player: CHARACTER.player,
    nomePasta: CHARACTER.nomePasta,
    arquivo,
    dados: { schemaVersion: 1, ...dados },
  });
}

function salvarStatus() {
  salvarArquivoPersonagem("status", STATE.vitals);
}

function salvarPericias() {
  const skills = Object.fromEntries(
    STATE.skills.map((skill) => [skill.id, { mod: skill.mod }]),
  );
  salvarArquivoPersonagem("pericias", { skills });
}

socket.on("salvamento_personagem_erro", (erro) => {
  console.error(
    `[RPG] Falha ao salvar ${erro?.arquivo || "personagem"}:`,
    erro?.message,
  );
});

socket.on("vital_adjusted", (data) => {
  if (data.charId === STATE.id) {
    STATE.vitals = data.vitals;
    atualizarBarras();
    salvarStatus();
    registrarNoTerminal(
      "Atributos vitais atualizados pelo mestre",
      data.vitals,
    );
    toast("Atributos vitais atualizados pelo Mestre!", "combat");
  }
});

socket.on("sync_config", (config) => {
  aplicarConfiguracaoGlobal(config);
  registrarNoTerminal("Configuração recebida do servidor", config);
});

socket.on("personagem_carregado", (personagem) => {
  if (
    !CHARACTER ||
    personagem?.player !== CHARACTER.player ||
    personagem?.nomePasta !== CHARACTER.nomePasta
  ) {
    socket.emit("client_log", {
      action: "Resposta de personagem ignorada por identidade divergente",
      context: { personagem: CHARACTER?.nomePasta || "sem seleção" },
    });
    return;
  }

  // O servidor entrega todos os arquivos já no formato oficial (ver personagem.js).
  const vital = (v) => ({
    current: Number(v?.current) || 0,
    max: Number(v?.max) || 0,
  });
  const status = personagem.status || {};
  STATE.vitals = {
    hp: vital(status.hp),
    vigor: vital(status.vigor),
    sanity: vital(status.sanity),
  };

  const inventario = personagem.inventario || {};
  STATE.backpackItems = Array.isArray(inventario.items) ? inventario.items : [];
  STATE.equipped = {
    mainHand: null,
    offHand: null,
    back: null,
    backpack: null,
    ...(inventario.equipped || {}),
  };

  STATE.skills = montarPericias(personagem.pericias?.skills);
  STATE.spells = Array.isArray(personagem.magias?.items)
    ? personagem.magias.items
    : [];

  STATE.name =
    CHARACTER_NAME ||
    personagem.perfil?.nome ||
    CHARACTER.nomePasta.replace(/_\d+(?:_\d+)?$/, "");
  const nomeEl = document.getElementById("char-name-input");
  if (nomeEl) nomeEl.value = STATE.name;
  personagemCarregado = true;

  atualizarBarras();
  renderizarPericias();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  registrarNoTerminal("Personagem carregado", {
    player: CHARACTER.player,
    nomePasta: CHARACTER.nomePasta,
  });
  syncPlayerToServer();
});

socket.on("personagem_erro", (erro) => {
  personagemCarregado = false;
  toast(erro?.message || "Não foi possível carregar o personagem.", "error");
  sessionStorage.removeItem("rpg_character");
  setTimeout(() => window.location.replace("/selecao"), 900);
});

function aplicarConfiguracaoGlobal(config) {
  if (!config || typeof config !== "object") return;

  Object.keys(GLOBAL_CONFIG).forEach((key) => {
    if (typeof config[key] === "boolean") GLOBAL_CONFIG[key] = config[key];
  });

  document
    .getElementById("riches-section")
    ?.classList.toggle("hidden", !GLOBAL_CONFIG.AtivarRiquezas);

  const progressionButton = document.getElementById("progression-type-btn");
  const progressionInput = document.getElementById("progression-val-input");

  STATE.progressionMode = GLOBAL_CONFIG.UsarEx ? "ex" : "nv";

  if (progressionButton) {
    progressionButton.innerText = GLOBAL_CONFIG.UsarEx ? "Ex" : "Lv";
  }

  if (progressionInput) {
    progressionInput.value = GLOBAL_CONFIG.UsarEx
      ? STATE.progressionValues.ex
      : STATE.progressionValues.nv;
  }

  const backpackEnabled = GLOBAL_CONFIG.AtivarSlotMochila;
  document
    .getElementById("slot-backpack")
    ?.classList.toggle("hidden", !backpackEnabled);
  const equippedSlots = document.getElementById("equipped-slots-container");
  equippedSlots?.classList.toggle("lg:grid-cols-4", backpackEnabled);
  equippedSlots?.classList.toggle("lg:grid-cols-3", !backpackEnabled);
  document
    .getElementById("popover-equip-backpack")
    ?.classList.toggle("hidden", !backpackEnabled);
  if (!backpackEnabled && itemPopoverAtual?.isBackpackItem) {
    document.getElementById("item-popover")?.classList.add("hidden");
    itemPopoverAtual = null;
  }

  const manaEnabled = GLOBAL_CONFIG.AtivarMana;
  document
    .getElementById("vigor-card")
    ?.classList.toggle("hidden", !manaEnabled);
  const vitalCards = document.getElementById("vital-cards-container");
  vitalCards?.classList.toggle("grid-cols-3", manaEnabled);
  vitalCards?.classList.toggle("grid-cols-2", !manaEnabled);
}

/* =========================================================================
       ALTERAÇÃO 1: ALTERNADOR NÍVEL VS EXPERIÊNCIA COM STOPPROPAGATION
       ========================================================================= */
/* FUNÇÃO ALTERNAR MODO PROGRESSO BLOQUEADA 
function alternarModoProgresso(e) {
  if (e) e.stopPropagation();
  if (!GLOBAL_CONFIG.UsarEx) return;

  const btn = document.getElementById("progression-type-btn");
  const input = document.getElementById("progression-val-input");
  STATE.progressionValues[STATE.progressionMode] = input.value;

  if (STATE.progressionMode === "ex") {
    STATE.progressionMode = "nv";
    btn.innerText = "Nv";
    input.value = "4";
    toast("Modo alterado para Nível de Personagem (Nv)", "info");
  } else {
    STATE.progressionMode = "ex";
    btn.innerText = "Ex";
    input.value = "5%";
    toast("Modo alterado para Exposição / Experiência (Ex %)", "info");
  }
  STATE.progressionValues[STATE.progressionMode] = input.value;
  registrarNoTerminal("Modo de progressão alterado", {
    modo: STATE.progressionMode,
    valor: input.value,
  });
} */

function toggleRiquezas() {
  const body = document.getElementById("riches-body");
  const icon = document.getElementById("riches-icon");
  const isOpen = !body.classList.contains("hidden");

  if (isOpen) {
    body.classList.add("hidden");
    icon.classList.remove("rotate-180");
  } else {
    body.classList.remove("hidden");
    icon.classList.add("rotate-180");
  }
}

function atualizarResumoMoedas() {
  const g = document.getElementById("coin-gold").value || 0;
  const s = document.getElementById("coin-silver").value || 0;
  const c = document.getElementById("coin-copper").value || 0;
  document.getElementById("riches-summary").innerText =
    `${g} PO • ${s} PP • ${c} PC`;
  registrarNoTerminal("Riquezas alteradas", {
    ouro: g,
    prata: s,
    cobre: c,
  });
}

function trocarAba(abaNum) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove(
      "bg-dungeon-800",
      "text-amberGold-400",
      "border",
      "border-amberGold-500/40",
      "shadow",
    );
    btn.classList.add("text-slate-400");
  });

  const abaAtiva = document.getElementById(`aba-${abaNum}`);
  const btnAtivo = document.getElementById(`tab-btn-${abaNum}`);

  if (abaAtiva) abaAtiva.classList.remove("hidden");
  if (btnAtivo) {
    btnAtivo.classList.remove("text-slate-400");
    btnAtivo.classList.add(
      "bg-dungeon-800",
      "text-amberGold-400",
      "border",
      "border-amberGold-500/40",
      "shadow",
    );
  }

  if (abaNum === 3) {
    renderizarSlotsEquipados();
    renderizarMochilaGrid();
  }
}

function alterarVital(tipo, delta) {
  if (tipo === "vigor" && !GLOBAL_CONFIG.AtivarMana) return;

  const vital = STATE.vitals[tipo];
  if (!vital) return;

  const anterior = vital.current;

  vital.current += delta;

  if (vital.current < 0) {
    vital.current = 0;
  }

  if (vital.current > vital.max) {
    vital.current = vital.max;
  }

  atualizarBarras();
  salvarStatus();

  registrarNoTerminal("Atributo vital alterado", {
    atributo: tipo,
    anterior,
    variacao: delta,
    atual: vital.current,
    maximo: vital.max,
  });

  syncPlayerToServer();
}

function atualizarBarras() {
  ["hp", "vigor", "sanity"].forEach((tipo) => {
    const vital = STATE.vitals[tipo];

    const valEl = document.getElementById(`${tipo}-val`);
    const maxEl = document.getElementById(`${tipo}-max`);
    const barEl = document.getElementById(`${tipo}-bar`);

    if (valEl && maxEl && barEl && vital) {
      valEl.innerText = vital.current;
      maxEl.innerText = vital.max;

      const pct = vital.max > 0 ? (vital.current / vital.max) * 100 : 0;

      barEl.style.width = `${pct}%`;
    }
  });
}

function renderizarPericias() {
  const container = document.getElementById("skills-container");
  if (!container) return;
  container.innerHTML = "";

  STATE.skills.forEach((skill) => {
    const div = document.createElement("div");
    div.className =
      "p-3 bg-dungeon-800/70 border border-dungeon-700/80 hover:border-amberGold-600/40 rounded-lg flex items-center justify-between transition";
    div.innerHTML = `
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded bg-dungeon-900 border border-dungeon-700 flex items-center justify-center text-amberGold-400 text-xs">
              <i class="fa-solid ${skill.icon}"></i>
            </div>
            <div>
              <div class="text-xs font-bold text-slate-200 font-cinzel">${skill.name}</div>
              <div class="text-[10px] text-slate-500 font-mono">${skill.attr}</div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex items-center bg-dungeon-900 rounded border border-dungeon-700">
              <button onclick="alterarModPericia('${skill.id}', -1)" class="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white">-</button>
              <span id="skill-mod-${skill.id}" class="px-2 font-mono font-bold text-xs text-amber-300">${skill.mod >= 0 ? "+" + skill.mod : skill.mod}</span>
              <button onclick="alterarModPericia('${skill.id}', 1)" class="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white">+</button>
            </div>
            
            <button onclick="adicionarAoCombo('${skill.name}', '+${skill.mod}', 'skill', 'perícia')" 
                    title="Adicionar bônus ao Combo"
                    class="p-1.5 rounded bg-dungeon-700 hover:bg-amberGold-600 hover:text-black text-amberGold-400 transition text-xs">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        `;
    container.appendChild(div);
  });
}

function alterarModPericia(id, delta) {
  const skill = STATE.skills.find((s) => s.id === id);
  if (skill) {
    const anterior = skill.mod;
    skill.mod += delta;
    const el = document.getElementById(`skill-mod-${id}`);
    if (el) el.innerText = skill.mod >= 0 ? `+${skill.mod}` : skill.mod;
    registrarNoTerminal("Perícia alterada", {
      pericia: skill.name,
      anterior,
      atual: skill.mod,
    });
    salvarPericias();
  }
}

/* =========================================================================
       ALTERAÇÃO 2: RENDERIZAR OS 4 SLOTS (INCLUINDO SLOT MOCHILA)
       ========================================================================= */
function renderizarSlotsEquipados() {
  const slots = ["mainHand", "offHand", "back", "backpack"];
  const isTwoHandedEquipped =
    STATE.equipped.mainHand && STATE.equipped.mainHand.twoHanded;

  slots.forEach((slotKey) => {
    const contentEl = document.getElementById(`content-${slotKey}`);
    const badgeEl = document.getElementById(`badge-${slotKey}`);
    const actionsEl = document.getElementById(`actions-${slotKey}`);
    const item = STATE.equipped[slotKey];

    // Caso Mão Secundária bloqueada
    if (slotKey === "offHand" && isTwoHandedEquipped) {
      badgeEl.innerText = "Bloqueado";
      badgeEl.className =
        "text-[10px] font-mono px-2 py-0.5 rounded bg-crimson-950 text-crimson-400 border border-crimson-800";
      contentEl.innerHTML = `
            <div class="text-center py-2 text-crimson-400/80">
              <i class="fa-solid fa-link-slash text-2xl mb-1"></i>
              <div class="text-[11px] font-cinzel font-bold">Ocupado (2 Mãos)</div>
            </div>
          `;
      actionsEl.classList.add("hidden");
      return;
    }

    // Slot Vazio
    if (!item) {
      badgeEl.innerText = slotKey === "backpack" ? "Bolsos" : "Vazio";
      badgeEl.className =
        "text-[10px] font-mono px-2 py-0.5 rounded bg-dungeon-800 text-slate-400 border border-dungeon-700";

      let emptyIcon = "fa-hand-back-fist";
      let emptyText = "Mão desarmada";
      if (slotKey === "offHand") {
        emptyIcon = "fa-shield-halved";
        emptyText = "Mão livre";
      }
      if (slotKey === "back") {
        emptyIcon = "fa-box";
        emptyText = "Costas vazias";
      }
      if (slotKey === "backpack") {
        emptyIcon = "fa-vest";
        emptyText = "Bolsos Básicos (3x3)";
      }

      contentEl.innerHTML = `
            <i class="fa-solid ${emptyIcon} text-2xl text-slate-700 mb-1"></i>
            <span class="text-xs text-slate-500 italic">${emptyText}</span>
          `;
      actionsEl.classList.add("hidden");
    } else {
      // Slot Preenchido
      badgeEl.innerText = item.backpackType
        ? "Equipada"
        : item.twoHanded
          ? "2 Mãos"
          : "Equipado";
      badgeEl.className =
        "text-[10px] font-mono px-2 py-0.5 rounded bg-amberGold-950 text-amberGold-400 border border-amberGold-700 font-bold";

      contentEl.innerHTML = `
            <div class="flex items-center gap-2 w-full text-left">
              <div class="w-8 h-8 rounded bg-dungeon-900 border border-amberGold-600/50 flex items-center justify-center text-amberGold-400 shrink-0">
                <i class="fa-solid ${item.icon || "fa-shield"} text-xs"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-cinzel font-bold text-amber-200 truncate">${item.name}</div>
                <div class="text-[10px] font-mono text-slate-400">${item.dice ? item.dice + " Dano" : item.backpackType ? "Expansão de Slots" : "Item Tático"}</div>
              </div>
            </div>
          `;

      actionsEl.classList.remove("hidden");
      actionsEl.innerHTML = `
            ${
              item.dice
                ? `
              <button onclick="adicionarAoCombo('${item.name}', '${item.dice}', 'item', 'equipado')" 
                      class="flex-1 py-1 bg-amberGold-600 hover:bg-amberGold-500 text-black font-cinzel font-bold text-[10px] rounded transition flex items-center justify-center gap-1">
                <i class="fa-solid fa-dice-d20"></i> Combo
              </button>
            `
                : ""
            }
            <button onclick="desequiparSlot('${slotKey}')" 
                    class="py-1 px-2.5 bg-dungeon-800 hover:bg-crimson-900/60 text-slate-400 hover:text-crimson-300 text-[10px] font-mono rounded border border-dungeon-700 transition" 
                    title="Guardar item">
              <i class="fa-solid fa-arrow-down"></i> Tirar
            </button>
          `;
    }
  });
}

function desequiparSlot(slotKey) {
  const item = STATE.equipped[slotKey];
  if (!item) return;

  item.col = 1;
  item.row = 1;
  STATE.backpackItems.push(item);
  STATE.equipped[slotKey] = null;

  registrarNoTerminal("Item desequipado", { item: item.name, slot: slotKey });
  toast(`${item.name} guardado.`, "info");
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  syncPlayerToServer();
}

/* =========================================================================
       ALTERAÇÃO 3: RENDERIZAR MOCHILA AJUSTADA AOS SLOTS
       ========================================================================= */
let itemPopoverAtual = null;

function obterTipoMochilaAtiva() {
  if (STATE.equipped.backpack && STATE.equipped.backpack.backpackType) {
    return STATE.equipped.backpack.backpackType;
  }
  return "bolsos"; // Padrão se desequipada
}

function renderizarMochilaGrid() {
  const tipoAtivo = obterTipoMochilaAtiva();
  const config =
    STATE.backpackConfigs[tipoAtivo] || STATE.backpackConfigs.bolsos;
  const gridContainer = document.getElementById("backpack-grid");
  const dimLabel = document.getElementById("grid-dimensions-label");
  const blocksCountEl = document.getElementById("grid-blocks-count");
  if (!gridContainer || !config) return;

  // Tamanho maior para usabilidade confortável
  const cellSize = 60;
  const gap = 3;

  gridContainer.style.width = `${config.cols * cellSize + (config.cols - 1) * gap}px`;
  gridContainer.style.height = `${config.rows * cellSize + (config.rows - 1) * gap}px`;
  gridContainer.innerHTML = "";

  // Grade de fundo
  const gridBg = document.createElement("div");
  gridBg.style.display = "grid";
  gridBg.style.gridTemplateColumns = `repeat(${config.cols}, ${cellSize}px)`;
  gridBg.style.gridTemplateRows = `repeat(${config.rows}, ${cellSize}px)`;
  gridBg.style.gap = `${gap}px`;

  const totalCells = config.cols * config.rows;
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "inventory-cell";
    gridBg.appendChild(cell);
  }
  gridContainer.appendChild(gridBg);

  // Renderização dos Itens na Grade
  let pesoTotal = STATE.equipped.backpack ? STATE.equipped.backpack.weight : 0;
  STATE.backpackItems.forEach((item) => {
    pesoTotal += item.weight || 0;

    if (item.col + item.w - 1 > config.cols)
      item.col = Math.max(1, config.cols - item.w + 1);
    if (item.row + item.h - 1 > config.rows)
      item.row = Math.max(1, config.rows - item.h + 1);

    const itemEl = document.createElement("div");
    itemEl.id = `item-node-${item.id}`;
    itemEl.className = `absolute z-10 p-2 rounded-lg border shadow-lg cursor-pointer bg-gradient-to-br ${item.color} flex flex-col justify-between hover:scale-[1.02] active:scale-95 transition-all`;

    itemEl.style.left = `${(item.col - 1) * (cellSize + gap)}px`;
    itemEl.style.top = `${(item.row - 1) * (cellSize + gap)}px`;
    itemEl.style.width = `${item.w * cellSize + (item.w - 1) * gap}px`;
    itemEl.style.height = `${item.h * cellSize + (item.h - 1) * gap}px`;

    itemEl.innerHTML = `
          <div class="flex justify-between items-start leading-none pointer-events-none">
            <span class="text-[11px] font-cinzel font-bold text-amber-200 truncate pr-1">${item.name}</span>
            <i class="fa-solid ${item.icon} text-xs text-amber-400"></i>
          </div>
          <div class="text-[10px] font-mono text-slate-300 flex justify-between items-end pointer-events-none">
            <span class="text-amberGold-400 font-bold">${item.dice || (item.isBackpackItem ? "Mochila" : "")}</span>
            <span class="text-slate-400">${item.weight}kg</span>
          </div>
        `;

    itemEl.addEventListener("click", (e) => {
      e.stopPropagation();
      abrirItemPopover(item, itemEl);
    });

    gridContainer.appendChild(itemEl);
  });

  dimLabel.innerText = config.label;
  blocksCountEl.innerText = `Grade ativa: ${totalCells} slots disponíveis`;
  document.getElementById("backpack-weight-label").innerHTML =
    `Carga total: <strong class="text-amber-200">${pesoTotal.toFixed(1)} kg</strong>`;
}

/* =========================================================================
       BALÃO DE AÇÕES DO ITEM
       ========================================================================= */
function abrirItemPopover(item, el) {
  itemPopoverAtual = item;
  const popover = document.getElementById("item-popover");

  document.getElementById("popover-title").innerText = item.name;
  document.getElementById("popover-desc").innerText = item.desc;
  document.getElementById("popover-dice-preview").innerText =
    item.dice || "Sem dados";

  // Tags
  const tagsContainer = document.getElementById("popover-tags");
  tagsContainer.innerHTML = `
        <span class="px-1.5 py-0.5 bg-dungeon-800 border border-slate-700 text-slate-300 rounded">${item.type}</span>
        ${item.twoHanded ? '<span class="px-1.5 py-0.5 bg-rose-950 border border-rose-700 text-rose-300 rounded font-bold">Duas Mãos</span>' : ""}
        ${item.dice ? `<span class="px-1.5 py-0.5 bg-crimson-900/60 border border-crimson-600/50 text-crimson-300 rounded">${item.dice}</span>` : ""}
        <span class="px-1.5 py-0.5 bg-dungeon-800 border border-slate-700 text-slate-400 rounded">${item.weight} kg</span>
      `;

  // Se for mochila, mostra o botão de equipar como mochila
  const btnBackpack = document.getElementById("popover-equip-backpack");
  const handBtns = document.getElementById("popover-hand-btns");
  if (item.isBackpackItem) {
    btnBackpack.classList.toggle("hidden", !GLOBAL_CONFIG.AtivarSlotMochila);
    handBtns.classList.add("hidden");
  } else {
    btnBackpack.classList.add("hidden");
    handBtns.classList.remove("hidden");
  }

  // Duas mãos trava secundária
  const btnOff = document.getElementById("popover-equip-off");
  if (item.twoHanded) {
    btnOff.disabled = true;
    btnOff.classList.add("opacity-40", "cursor-not-allowed");
  } else {
    btnOff.disabled = false;
    btnOff.classList.remove("opacity-40", "cursor-not-allowed");
  }

  // Botão combo
  const btnCombo = document.getElementById("popover-add-combo");
  if (item.dice) {
    btnCombo.classList.remove("hidden");
  } else {
    btnCombo.classList.add("hidden");
  }

  popover.classList.remove("hidden");

  // Posicionamento flutuante inteligente
  const itemRect = el.getBoundingClientRect();
  const parentRect = el.parentElement.getBoundingClientRect();

  let topPos = itemRect.top - parentRect.top - popover.offsetHeight - 8;
  let leftPos = itemRect.left - parentRect.left + itemRect.width / 2 - 144;

  if (topPos < 0) topPos = itemRect.bottom - parentRect.top + 8;
  if (leftPos < 4) leftPos = 4;
  if (leftPos + 288 > parentRect.width)
    leftPos = Math.max(4, parentRect.width - 292);

  popover.style.top = `${topPos}px`;
  popover.style.left = `${leftPos}px`;
}

function fecharItemPopover() {
  document.getElementById("item-popover").classList.add("hidden");
  itemPopoverAtual = null;
}

function equiparItemAtual(slotDestino) {
  if (!itemPopoverAtual) return;
  if (slotDestino === "backpack" && !GLOBAL_CONFIG.AtivarSlotMochila) return;
  const item = itemPopoverAtual;

  // Se já houver algo no slot, devolve para a mochila
  if (STATE.equipped[slotDestino]) {
    STATE.backpackItems.push(STATE.equipped[slotDestino]);
    STATE.equipped[slotDestino] = null;
  }

  // Se for arma de 2 mãos na principal, recolhe a secundária
  if (slotDestino === "mainHand" && item.twoHanded && STATE.equipped.offHand) {
    STATE.backpackItems.push(STATE.equipped.offHand);
    STATE.equipped.offHand = null;
    toast(
      "Mão secundária guardada pois a arma requer empunhadura dupla.",
      "info",
    );
  }

  // Remove da mochila e equipa
  STATE.backpackItems = STATE.backpackItems.filter((i) => i.id !== item.id);
  STATE.equipped[slotDestino] = item;

  registrarNoTerminal("Item equipado", { item: item.name, slot: slotDestino });
  fecharItemPopover();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  syncPlayerToServer();
  toast(`${item.name} equipado com sucesso!`, "combat");
}

function enviarItemAtualParaCombo() {
  if (itemPopoverAtual && itemPopoverAtual.dice) {
    adicionarAoCombo(
      itemPopoverAtual.name,
      itemPopoverAtual.dice,
      "item",
      "mochila",
    );
    fecharItemPopover();
  }
}

function descartarItemAtual() {
  if (!itemPopoverAtual) return;
  STATE.backpackItems = STATE.backpackItems.filter(
    (i) => i.id !== itemPopoverAtual.id,
  );
  registrarNoTerminal("Item descartado", { item: itemPopoverAtual.name });
  fecharItemPopover();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  toast("Item descartado.", "info");
}

document.addEventListener("click", (e) => {
  const popover = document.getElementById("item-popover");
  if (popover && !popover.contains(e.target)) {
    fecharItemPopover();
  }
});

/* =========================================================================
       SISTEMA DE COMBOS DE DADOS COM EMISSÃO SOCKET.IO
       ========================================================================= */
function adicionarAoCombo(nome, formula, iconeTipo = "generic", origem = "") {
  STATE.combo.push({
    id: Date.now() + Math.random(),
    nome: nome,
    formula: formula,
    tipo: iconeTipo,
    origem: origem,
  });

  registrarNoTerminal("combo Add+ ", {
    componente: nome,
    formula,
    origem,
  });
  atualizarInterfaceCombo();
  toast(`Combo: ${nome} (${formula})`, "combat");
}

function adicionarDadoAvulso(dado) {
  adicionarAoCombo("Dado", dado, "dice", "manual");
}

function adicionarModificador(valor) {
  const str = valor >= 0 ? `+${valor}` : `${valor}`;
  adicionarAoCombo("Bônus", str, "bonus", "manual");
}

function removerDoCombo(id) {
  const removido = STATE.combo.find((item) => item.id === id);
  STATE.combo = STATE.combo.filter((item) => item.id !== id);
  if (removido)
    registrarNoTerminal("combo rmvd-", {
      componente: removido.nome,
      formula: removido.formula,
    });
  atualizarInterfaceCombo();
}

function limparCombo() {
  const quantidade = STATE.combo.length;
  STATE.combo = [];
  registrarNoTerminal("Combo limpo", { componentesRemovidos: quantidade });
  atualizarInterfaceCombo();
  toast("Fila de combo esvaziada.", "info");
}

function atualizarInterfaceCombo() {
  const container = document.getElementById("combo-chips-container");
  const badge = document.getElementById("combo-badge");
  const formulaDisplay = document.getElementById("combo-formula-display");

  if (!container) return;

  if (STATE.combo.length > 0) {
    badge.innerText = STATE.combo.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  if (STATE.combo.length === 0) {
    container.innerHTML = `
          <span id="combo-empty-msg" class="text-xs text-slate-500 italic">
            Nenhum componente no combo. Adicione armas do inventário, bônus de perícias ou habilidades do grimório.
          </span>
        `;
    formulaDisplay.innerText = "0d0";
    return;
  }

  container.innerHTML = "";
  let formulas = [];

  STATE.combo.forEach((c) => {
    formulas.push(`${c.formula}`);

    const chip = document.createElement("div");
    chip.className =
      "flex items-center gap-1.5 px-2.5 py-1 bg-dungeon-800 border border-amberGold-600/50 rounded-full text-xs text-slate-200";
    chip.innerHTML = `
          <span class="font-bold text-amberGold-400 font-cinzel">${c.nome}</span>
          <span class="text-slate-400 font-mono">(${c.formula})</span>
          <button onclick="removerDoCombo(${c.id})" class="text-slate-400 hover:text-crimson-400 ml-1 text-xs">
            <i class="fa-solid fa-xmark"></i>
          </button>
        `;
    container.appendChild(chip);
  });

  formulaDisplay.innerText = formulas.join(" + ");
}

function tocarSomImpacto() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(35, audioCtx.currentTime + 0.28);

    gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.28);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.28);
  } catch (e) {}
}

function rolarDadoIndividual(lados) {
  return Math.floor(Math.random() * lados) + 1;
}

function rolarCombo() {
  if (STATE.combo.length === 0) {
    toast("Adicione componentes ao combo antes de disparar o ataque!", "error");
    return;
  }

  tocarSomImpacto();

  const btn = document.getElementById("btn-roll-combo");
  btn.classList.add("impact-shake");
  setTimeout(() => btn.classList.remove("impact-shake"), 450);

  let totalFinal = 0;
  let breakdownList = [];

  STATE.combo.forEach((item) => {
    const formula = item.formula.trim();

    // Bônus puro: +5, -3, etc.
    if (
      formula.startsWith("+") ||
      (formula.startsWith("-") && !formula.includes("d"))
    ) {
      const mod = parseInt(formula);
      totalFinal += mod;

      breakdownList.push({
        nome: item.nome,
        detalhe: formula,
        soma: mod,
      });

      return;
    }

    // Dados com bônus: 1d6, 2d8+5, 3d12-2, etc.
    if (formula.includes("d")) {
      const match = formula.match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);

      if (!match) {
        toast(`Fórmula inválida: ${formula}`, "error");
        return;
      }

      const qtd = parseInt(match[1]) || 1;
      const lados = parseInt(match[2]);
      const bonus = match[3] ? parseInt(match[3].replace(/\s/g, "")) : 0;

      let resultados = [];
      let subtotal = 0;

      for (let i = 0; i < qtd; i++) {
        const v = rolarDadoIndividual(lados);
        resultados.push(v);
        subtotal += v;
      }

      const totalComBonus = subtotal + bonus;

      totalFinal += totalComBonus;

      breakdownList.push({
        nome: item.nome,
        detalhe: `${formula} -> [${resultados.join(", ")}]`,
        soma: totalComBonus,
      });
    }
  });

  document.getElementById("total-result-number").innerText = totalFinal;
  document.getElementById("result-summary-text").innerText =
    `${STATE.combo.length} componentes combinados`;

  const breakdownEl = document.getElementById("result-breakdown");
  breakdownEl.innerHTML = "";
  breakdownList.forEach((b) => {
    const itemRow = document.createElement("div");
    itemRow.className =
      "flex justify-between items-center py-1 border-b border-dungeon-800";
    itemRow.innerHTML = `
          <span class="text-slate-300 font-bold">${b.nome}:</span>
          <span class="text-amberGold-400">${b.detalhe} = <strong class="text-slate-100">${b.soma}</strong></span>
        `;
    breakdownEl.appendChild(itemRow);
  });

  adicionarAoHistorico(totalFinal, breakdownList);
  registrarNoTerminal("Combo rolado", {
    total: totalFinal,
    detalhes: breakdownList
      .map((item) => `${item.nome} (${item.soma})`)
      .join(" + "),
  });

  // Envia o lançamento do dado em tempo real para o servidor / tela do mestre
  if (socket && socket.connected) {
    socket.emit("dice_roll", {
      character: document.getElementById("char-name-input").value,
      total: totalFinal,
      details: breakdownList.map((b) => `${b.nome} (${b.soma})`).join(" + "),
    });
  }
}

function adicionarAoHistorico(total, breakdown) {
  const histContainer = document.getElementById("history-container");
  const hora = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const entry = {
    hora: hora,
    total: total,
    detalhes: breakdown.map((b) => `${b.nome} (${b.soma})`).join(" + "),
  };

  STATE.history.unshift(entry);
  if (STATE.history.length > 8) STATE.history.pop();

  histContainer.innerHTML = "";
  STATE.history.forEach((h) => {
    const row = document.createElement("div");
    row.className =
      "p-2 bg-dungeon-800/80 rounded border border-dungeon-700 text-xs font-mono flex justify-between items-center";
    row.innerHTML = `
          <div>
            <div class="text-[10px] text-slate-500">${h.hora}</div>
            <div class="text-slate-300 text-[11px] truncate max-w-[180px]">${h.detalhes}</div>
          </div>
          <div class="font-cinzel font-black text-amberGold-400 text-base">= ${h.total}</div>
        `;
    histContainer.appendChild(row);
  });
}

function limparHistorico() {
  STATE.history = [];
  document.getElementById("history-container").innerHTML =
    '<div class="text-xs text-slate-500 italic text-center py-4">Nenhum lançamento recente.</div>';
}

function toast(mensagem, tipo = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toastEl = document.createElement("div");
  let borderCol = "border-amberGold-500";
  let icon = "fa-circle-info";

  if (tipo === "combat") {
    borderCol = "border-crimson-500 text-amber-200";
    icon = "fa-crosshairs";
  } else if (tipo === "error") {
    borderCol = "border-rose-600 text-rose-300";
    icon = "fa-triangle-exclamation";
  }

  toastEl.className = `p-3 rounded-lg bg-dungeon-950 border-l-4 ${borderCol} shadow-2xl text-xs font-cinzel text-slate-100 flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  toastEl.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${mensagem}</span>`;

  container.appendChild(toastEl);

  setTimeout(() => toastEl.classList.remove("translate-y-2", "opacity-0"), 10);
  setTimeout(() => {
    toastEl.classList.add("opacity-0", "-translate-y-2");
    setTimeout(() => toastEl.remove(), 300);
  }, 2400);
}

function openAvatarModal() {
  document.getElementById("avatar-modal").classList.remove("hidden");
}

function closeAvatarModal() {
  document.getElementById("avatar-modal").classList.add("hidden");
}

function salvarAvatar() {
  const url = document.getElementById("avatar-url-input").value.trim();
  if (url) {
    document.getElementById("char-avatar-img").src = url;
    document.getElementById("char-bio-portrait").src = url;
    registrarNoTerminal("Retrato do personagem alterado", {
      url: new URL(url, window.location.href).origin,
    });
    toast("Retrato atualizado!", "info");
    syncPlayerToServer();
  }
  closeAvatarModal();
}

window.addEventListener("DOMContentLoaded", () => {
  if (!CHARACTER || !AUTH_TOKEN) {
    window.location.replace(AUTH_TOKEN ? "/selecao" : "/login");
    return;
  }

  atualizarBarras();
  renderizarPericias();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  atualizarInterfaceCombo();

  // Envia os dados iniciais ao conectar no servidor
  socket.on("connect", () => {
    registrarNoTerminal("Conexão com o servidor estabelecida", {
      socketId: socket.id,
    });
    socket.emit("carregar_personagem", CHARACTER);
  });

  socket.on("disconnect", (reason) => {
    console.warn(`[RPG] Conexão com o servidor perdida: ${reason}`);
  });

  socket.on("connect_error", (error) => {
    console.error("[RPG] Falha ao conectar ao servidor:", error.message);
  });

  ["char-name-input", "char-class-input", "progression-val-input"].forEach(
    (id) => {
      const input = document.getElementById(id);
      input?.addEventListener("change", () => {
        if (id === "progression-val-input") {
          STATE.progressionValues[STATE.progressionMode] = input.value;
        }
        registrarNoTerminal("Dados do personagem alterados", {
          campo: id,
          valor: input.value,
        });
        if (id === "char-name-input") syncPlayerToServer();
      });
    },
  );

  window.addEventListener("resize", () => {
    renderizarMochilaGrid();
  });
});

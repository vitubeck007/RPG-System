/* =========================================================================
   ESTADO DA FICHA
   Identidade (personagem e sessão), conexão Socket.IO, configuração da mesa e o objeto STATE.
   É o primeiro arquivo do JS da ficha: os demais usam o que é definido aqui.
   ========================================================================= */

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
// Não conecta já: a conexão só começa no fim do DOMContentLoaded (index.js), quando todos os scripts
// carregaram e registraram seus eventos. Conectar aqui perderia o 'connect' numa página lenta
// (o servidor responderia antes de alguém estar ouvindo e a ficha ficaria "Carregando" para sempre).
const socket = io({ autoConnect: false, auth: { token: AUTH_TOKEN } });
let personagemCarregado = false;
let jaCarregouAntes = false; // true depois da 1ª carga: um novo "connect" passa a ser reconexão

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

/* BALANCEAMENTO (valores a definir).
   Peso limite da mochila:  PesoLimite = Força × pesoPorForca + Atletismo
   (Força = atributo FOR; Atletismo = modificador da perícia Atletismo).
   Enquanto `pesoPorForca` for null a fórmula fica desligada: a ficha só mostra a carga
   ("limite: a definir"). Ao definir um número, o limite aparece e a ficha avisa
   quando a carga o ultrapassa. Por enquanto o excesso só é AVISADO, não bloqueia. */
const BALANCEAMENTO = {
  pesoPorForca: null, // kg por ponto de Força
};

// CATALOGO_PERICIAS (catálogo fixo), modificadorDeAtributo e formatarBonus vêm de JS/regras.js,
// compartilhado com o painel do mestre. A ficha guarda só o bônus de cada perícia (pericias.json).
// Junta o catálogo com os modificadores salvos: { id: { mod } } -> lista para a interface.
function montarPericias(modsSalvos = {}) {
  return CATALOGO_PERICIAS.map((pericia) => ({
    ...pericia,
    mod: Number.isFinite(Number(modsSalvos?.[pericia.id]?.mod))
      ? Number(modsSalvos[pericia.id].mod)
      : 0,
  }));
}

/* Perícia = Modificador do Atributo base + Bônus da Perícia (skill.mod, salvo em pericias.json).
   Não altera o que é salvo: o JSON continua guardando só o bônus. */
function calcularPericia(skill) {
  const modAtributo = modificadorDeAtributo(STATE.atributos?.[skill.attr]);
  const bonus = Number(skill.mod) || 0;
  return { modAtributo, bonus, total: modAtributo + bonus };
}

const ATRIBUTOS_PADRAO = {
  FOR: 10,
  DES: 10,
  INT: 10,
  SAB: 10,
  PRE: 10,
  VON: 10,
};

const STATE = {
  id: CHARACTER ? criarIdEstado(CHARACTER) : "character-unselected",
  name: CHARACTER_NAME || "Personagem",
  progressionMode: "ex",
  progressionValues: { ex: "0%", nv: "1" },
  // Valores provisórios até o servidor entregar a ficha (a ficha fica bloqueada até lá).
  vitals: {
    hp: { current: 0, max: 0 },
    vigor: { current: 0, max: 0 },
    sanity: { current: 0, max: 0 },
  },
  atributos: { ...ATRIBUTOS_PADRAO },
  skills: montarPericias(),
  spells: [], // magias.json
  abilities: [], // habilidades.json

  // Definições de tamanho das mochilas
  backpackConfigs: {
    bolsos: { cols: 3, rows: 3, label: "Bolsos Básicos (3x3)" },
    leve: { cols: 4, rows: 3, label: "Mochila Leve (4x3)" },
    tatica: { cols: 5, rows: 4, label: "Mochila Tática (5x4)" },
    carga: { cols: 6, rows: 5, label: "Mochila de Expedição (6x5)" },
  },

  // Slots de prontidão (item equipado em cada um; null = vazio). Preenchido ao carregar.
  equipped: { mainHand: null, offHand: null, back: null, backpack: null },

  // Itens na mochila (grade). Preenchido ao carregar o inventário.
  backpackItems: [],

  combo: [],
  history: [],
};

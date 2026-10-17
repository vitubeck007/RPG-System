/* =========================================================================
   REGRAS COMPARTILHADAS (ficha do jogador e painel do mestre)
   Carregado pela ficha (index.html) e pelas páginas do mestre (mestre/*.html) ANTES dos scripts de cada página.
   Fonte única do catálogo de perícias, das contas de regra e dos pequenos auxiliares usados nos
   dois lados. Também é carregado pelo servidor (personagem.js) via require: no navegador as
   declarações abaixo ficam globais; no Node saem pelo module.exports do final.
   ========================================================================= */
/* global module */
const CATALOGO_PERICIAS = [
  { id: "acrobacia", name: "Acrobacia", icon: "fa-person-running", attr: "DES" },
  { id: "atletismo", name: "Atletismo", icon: "fa-dumbbell", attr: "FOR" },
  { id: "furtividade", name: "Furtividade", icon: "fa-mask", attr: "DES" },
  { id: "investigacao", name: "Investigação", icon: "fa-magnifying-glass", attr: "INT" },
  { id: "luta", name: "Luta", icon: "fa-hand-fist", attr: "FOR" },
  { id: "medicina", name: "Medicina", icon: "fa-mortar-pestle", attr: "SAB" },
  { id: "ocultismo", name: "Ocultismo", icon: "fa-eye", attr: "INT" },
  { id: "percepcao", name: "Percepção", icon: "fa-binoculars", attr: "SAB" },
  { id: "pontaria", name: "Pontaria", icon: "fa-crosshairs", attr: "DES" },
  { id: "sobrevivencia", name: "Sobrevivência", icon: "fa-campground", attr: "SAB" },
  { id: "intimidacao", name: "Intimidação", icon: "fa-skull", attr: "PRE" },
  { id: "vontade", name: "Vontade", icon: "fa-shield-heart", attr: "VON" },
];

/* Modificador de atributo (fonte única): floor((valor - 10) / 2).
   Ex.: 10 -> 0, 12 -> +1, 15 -> +2, 9 -> -1. Sempre inteiro. */
function modificadorDeAtributo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.floor((n - 10) / 2) : 0;
}

function formatarBonus(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

/* ------------------------------ vitais ------------------------------ */
const ROTULO_VITAL = { hp: "HP", vigor: "Vigor", sanity: "Sanidade" };

/* ------------------------------ texto / URL ------------------------------ */
function escaparHtml(valor) {
  return String(valor ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Aceita só http(s):// ou caminho do próprio site, até 2000 caracteres; senão devolve "".
function urlDeImagem(valor) {
  const url = typeof valor === "string" ? valor.trim() : "";
  return url.length <= 2000 && /^(https?:\/\/|\/(?!\/))/i.test(url) ? url : "";
}

/* ------------------------------ inventário ------------------------------ */
function quantidadeDoItem(item) {
  return Math.max(1, Math.floor(Number(item?.quantity)) || 1);
}

function pesoDoItem(item) {
  return (Number(item?.weight) || 0) * quantidadeDoItem(item);
}

// Carga = itens da mochila + a própria mochila equipada (se houver).
function calcularCarga(itens, mochilaEquipada) {
  const lista = Array.isArray(itens) ? itens : [];
  return lista.reduce((soma, item) => soma + pesoDoItem(item), mochilaEquipada ? pesoDoItem(mochilaEquipada) : 0);
}

/* ------------------------------ magias / habilidades ------------------------------ */
// Custo de uma entrada, nos formatos novo (cost: { vital, amount }) e antigos (custo / cost em texto).
// `definido` diz se a entrada tem custo; sem custo, `texto` vale "0".
function custoDaEntrada(entrada) {
  const { custo, cost } = entrada;
  if (custo !== undefined && custo !== null) {
    return { texto: String(custo), vital: "", definido: true };
  }
  if (cost && typeof cost === "object") {
    const rotulo = ROTULO_VITAL[cost.vital] || "";
    return { texto: `${cost.amount ?? 0} ${rotulo}`.trim(), vital: cost.vital || "", definido: true };
  }
  if (cost !== undefined && cost !== null && cost !== "") {
    return { texto: String(cost), vital: "", definido: true };
  }
  return { texto: "0", vital: "", definido: false };
}

/* ----------------------- fórmulas de dados e dano (Sprint 6) -----------------------
   Mesmo leitor e mesma conta na ficha, na página do mestre e no servidor: o que a página mostra na
   prévia é exatamente o que o servidor aplica. */
// Fórmulas aceitas: bônus puro ("+5", "-3") ou dados ("d20", "2d6", "3d12-2"). Limites iguais aos da ficha
// (até 999 dados de até 1000 lados) + bônus limitado a ±100000 (evita números absurdos).
const COMBO_BONUS = /^[+-]\s*\d+$/;
const COMBO_DADOS = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i;
const COMBO_MAX_DADOS = 999;
const COMBO_MAX_LADOS = 1000;
const COMBO_MAX_BONUS = 100000;

function lerFormulaCombo(texto) {
  const formula = String(texto ?? "").trim();
  if (COMBO_BONUS.test(formula)) {
    const bonus = parseInt(formula.replace(/\s/g, ""), 10);
    return Math.abs(bonus) <= COMBO_MAX_BONUS ? { tipo: "bonus", formula, bonus } : null;
  }
  const m = formula.match(COMBO_DADOS);
  if (!m) return null;
  const qtd = m[1] === "" ? 1 : parseInt(m[1], 10);
  const lados = parseInt(m[2], 10);
  if (qtd < 1 || qtd > COMBO_MAX_DADOS || lados < 1 || lados > COMBO_MAX_LADOS) return null;
  const bonus = m[3] ? parseInt(m[3].replace(/\s/g, ""), 10) : 0;
  if (Math.abs(bonus) > COMBO_MAX_BONUS) return null;
  return { tipo: "dados", formula, qtd, lados, bonus };
}

// Multiplicadores de dano permitidos (lista fechada): ×1 (total), ×½ (metade) e ×2 (dobro).
const MULTIPLICADORES_DANO = [0.5, 1, 2];

// Dano aplicado a um alvo: nunca negativo; metade arredonda PARA BAIXO (7 → 3; 1 → 0).
function calcularDano(total, multiplicador) {
  if (!MULTIPLICADORES_DANO.includes(multiplicador)) return null;
  const t = Number(total);
  if (!Number.isFinite(t)) return null;
  return Math.floor(Math.max(0, Math.trunc(t)) * multiplicador);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    lerFormulaCombo,
    calcularDano,
    MULTIPLICADORES_DANO,
    COMBO_MAX_DADOS,
    CATALOGO_PERICIAS,
    modificadorDeAtributo,
    formatarBonus,
    ROTULO_VITAL,
    escaparHtml,
    urlDeImagem,
    quantidadeDoItem,
    pesoDoItem,
    calcularCarga,
    custoDaEntrada,
  };
}

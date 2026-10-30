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
const EXPRESSAO_MAX_TAMANHO = 300;
const EXPRESSAO_MAX_TERMOS = 40;

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

// Expressões do mestre usam apenas soma/subtração: nunca eval ou execução de código.
// O leitor simples da ficha continua intacto; dados subtraídos levam sinal separado.
function lerExpressaoRolagem(texto) {
  if (typeof texto !== "string" || texto.length > EXPRESSAO_MAX_TAMANHO) return null;
  const expressao = texto.replace(/\s/g, "");
  if (!expressao) return null;
  const componentes = [];
  let posicao = 0, totalDados = 0;
  while (posicao < expressao.length) {
    const termo = /^([+-]?)(?:(\d*)d(\d+)|(\d+))/i.exec(expressao.slice(posicao));
    if (!termo || (posicao > 0 && !termo[1])) return null;
    const dados = termo[3] !== undefined;
    const sinal = termo[1] === "-" ? -1 : 1;
    const formula = dados ? `${termo[2] || "1"}d${termo[3]}` : `${sinal < 0 ? "-" : "+"}${termo[4]}`;
    const lido = lerFormulaCombo(formula);
    if (!lido) return null;
    totalDados += dados ? lido.qtd : 0;
    if (totalDados > COMBO_MAX_DADOS || componentes.length >= EXPRESSAO_MAX_TERMOS) return null;
    const canonica = dados ? `${lido.qtd}d${lido.lados}` : `${lido.bonus >= 0 ? "+" : ""}${lido.bonus}`;
    componentes.push({ formula: canonica, ...(dados && sinal < 0 ? { sinal: -1 } : {}) });
    posicao += termo[0].length;
  }
  return componentes;
}

// Poderes mantêm o limite de 30 caracteres e exigem pelo menos um dado.
function dadoDePoderValido(texto) {
  if (typeof texto !== "string" || texto.length > 30) return false;
  const termos = lerExpressaoRolagem(texto);
  return !!termos?.some(termo => /d/i.test(termo.formula));
}

// Atalhos legados; o campo individual também aceita outros números não negativos.
const MULTIPLICADORES_DANO = [0.5, 1, 2];
function validarMultiplicadorDano(valor) {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
}

// Dano aplicado a um alvo: nunca negativo; metade arredonda PARA BAIXO (7 → 3; 1 → 0).
function calcularDano(total, multiplicador) {
  if (!validarMultiplicadorDano(multiplicador)) return null;
  const t = Number(total);
  if (!Number.isFinite(t)) return null;
  const base = Math.max(0, Math.trunc(t));
  if (!Number.isSafeInteger(base)) return null;
  if (base === 0 || multiplicador === 0) return 0;
  // Use o decimal informado, não o produto binário (100 × 0.29 não pode virar 28).
  // Divisão inteira de valores não negativos já arredonda para baixo, sem EPSILON.
  const [mantissa, expoente = "0"] = multiplicador.toString().split("e");
  const [inteira, fracao = ""] = mantissa.split(".");
  const escala = Number(expoente) - fracao.length;
  let numerador = BigInt(base) * BigInt(inteira + fracao);
  let denominador = 1n;
  if (escala >= 0) numerador *= 10n ** BigInt(escala);
  else denominador = 10n ** BigInt(-escala);
  const dano = numerador / denominador;
  return dano <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(dano) : null;
}

function normalizarFormatoItem(valor) {
  if (!Array.isArray(valor) || !valor.length || valor.length > 100) return null;
  if (valor.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isInteger(n) || n < 0 || n >= 10))) return null;
  const unicos = new Map(valor.map(p => [p.join(','), p]));
  const visitar = [valor[0]], vistos = new Set();
  while (visitar.length) {
    const p = visitar.pop(), chave = p.join(',');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const vizinho = [p[0]+dx,p[1]+dy];
      if (unicos.has(vizinho.join(',')) && !vistos.has(vizinho.join(','))) visitar.push(vizinho);
    }
  }
  if (vistos.size !== unicos.size) return null;
  const x = Math.min(...valor.map(p=>p[0])), y = Math.min(...valor.map(p=>p[1]));
  return [...unicos.values()].map(p=>[p[0]-x,p[1]-y]).sort((a,b)=>a[1]-b[1] || a[0]-b[0]);
}
function quadrantesItem(item) {
  const formato = normalizarFormatoItem(item.formato);
  if (formato) return formato;
  const w = Math.max(1, Math.min(10, Math.floor(Number(item.w)) || 1));
  const h = Math.max(1, Math.min(10, Math.floor(Number(item.h)) || 1));
  return Array.from({length:w*h},(_,i)=>[i%w,Math.floor(i/w)]);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizarFormatoItem, quadrantesItem,
    lerFormulaCombo,
    lerExpressaoRolagem,
    dadoDePoderValido,
    calcularDano,
    validarMultiplicadorDano,
    MULTIPLICADORES_DANO,
    COMBO_MAX_DADOS,
    EXPRESSAO_MAX_TAMANHO,
    EXPRESSAO_MAX_TERMOS,
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

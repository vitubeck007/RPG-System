/* =========================================================================
   ROLAGEM DO MESTRE (Sprint 6): feita no SERVIDOR, com o aleatório do sistema (crypto), usando o mesmo
   leitor de fórmulas da ficha (JS/regras.js). O servidor guarda as últimas rolagens; o ataque pode
   referenciar uma delas pelo id (o total vem do servidor, não do navegador).
   ========================================================================= */

const crypto = require("crypto");
const { lerFormulaCombo, COMBO_MAX_DADOS } = require("./JS/regras.js");
const { ErroCampanha } = require("./campanha.js");

const MAX_COMPONENTES = 10;
const MAX_ROLAGENS_GUARDADAS = 100;

const sorteioPadrao = (lados) => crypto.randomInt(1, lados + 1);

// componentes: [{ nome?, formula }]. Valida TUDO antes de rolar (fórmula ruim cancela a rolagem inteira).
function rolar(componentes, sorteio = sorteioPadrao) {
  if (!Array.isArray(componentes) || componentes.length < 1 || componentes.length > MAX_COMPONENTES) {
    throw new ErroCampanha("formato_invalido", `Informe de 1 a ${MAX_COMPONENTES} componentes.`);
  }
  const lidos = componentes.map((c, i) => {
    const formula = typeof c?.formula === "string" ? c.formula : "";
    const leitura = formula.length <= 30 ? lerFormulaCombo(formula) : null;
    if (!leitura) throw new ErroCampanha("formula_invalida", `Fórmula inválida no componente ${i + 1}: ${formula.slice(0, 30)}`);
    const nome = typeof c.nome === "string" ? c.nome.trim().slice(0, 40) : "";
    return { nome, leitura };
  });
  const totalDeDados = lidos.reduce((t, { leitura }) => t + (leitura.tipo === "dados" ? leitura.qtd : 0), 0);
  if (totalDeDados > COMBO_MAX_DADOS) throw new ErroCampanha("dados_demais", `No máximo ${COMBO_MAX_DADOS} dados por rolagem.`);

  let total = 0;
  const saida = lidos.map(({ nome, leitura }) => {
    if (leitura.tipo === "bonus") {
      total += leitura.bonus;
      return { nome, formula: leitura.formula, dados: [], bonus: leitura.bonus, soma: leitura.bonus };
    }
    const dados = Array.from({ length: leitura.qtd }, () => sorteio(leitura.lados));
    const soma = dados.reduce((t, v) => t + v, 0) + leitura.bonus;
    total += soma;
    return { nome, formula: leitura.formula, dados, bonus: leitura.bonus, soma };
  });
  return { total, componentes: saida };
}

// Últimas rolagens do mestre, por id (para "atacar com esta rolagem").
function criarHistoricoDeRolagens(max = MAX_ROLAGENS_GUARDADAS) {
  const mapa = new Map();
  return {
    guardar(rolagem) {
      const id = `rol_${crypto.randomBytes(6).toString("hex")}`;
      mapa.set(id, { ...rolagem, rolagemId: id });
      if (mapa.size > max) mapa.delete(mapa.keys().next().value);
      return mapa.get(id);
    },
    obter: (id) => mapa.get(id) || null,
  };
}

module.exports = { rolar, criarHistoricoDeRolagens };

/* =========================================================================
   ROLAGEM DO MESTRE (Sprint 6): feita no SERVIDOR, com o aleatório do sistema (crypto), usando o mesmo
   leitor de fórmulas da ficha (JS/regras.js). O servidor guarda as últimas rolagens; o ataque pode
   referenciar uma delas pelo id (o total vem do servidor, não do navegador).
   ========================================================================= */

const crypto = require("crypto");
const { lerFormulaCombo, lerExpressaoRolagem, COMBO_MAX_DADOS, EXPRESSAO_MAX_TERMOS } = require("./JS/regras.js");
const { ErroCampanha } = require("./campanha.js");

const MAX_COMPONENTES = 10;
const MAX_ROLAGENS_GUARDADAS = 100;

const sorteioPadrao = (lados) => crypto.randomInt(1, lados + 1);

// componentes: [{ nome?, formula }]. Valida TUDO antes de rolar (fórmula ruim cancela a rolagem inteira).
function rolar(entrada, sorteio = sorteioPadrao) {
  const expressao = typeof entrada === "string";
  const componentes = expressao ? lerExpressaoRolagem(entrada) : entrada;
  if (expressao && !componentes) throw new ErroCampanha("formula_invalida", "Expressão inválida. Use dados e números separados por + ou −, dentro dos limites.");
  if (!Array.isArray(componentes) || componentes.length < 1 || componentes.length > (expressao ? EXPRESSAO_MAX_TERMOS : MAX_COMPONENTES)) {
    throw new ErroCampanha("formato_invalido", `Informe de 1 a ${MAX_COMPONENTES} componentes.`);
  }
  const lidos = componentes.map((c, i) => {
    const formula = typeof c?.formula === "string" ? c.formula : "";
    const leitura = formula.length <= 30 ? lerFormulaCombo(formula) : null;
    if (!leitura) throw new ErroCampanha("formula_invalida", `Fórmula inválida no componente ${i + 1}: ${formula.slice(0, 30)}`);
    const sinal = c.sinal === undefined ? 1 : c.sinal;
    if (sinal !== 1 && sinal !== -1) throw new ErroCampanha("formula_invalida", "Sinal de componente inválido.");
    const nome = typeof c.nome === "string" ? c.nome.trim().slice(0, 40) : "";
    return { nome, leitura, sinal };
  });
  const totalDeDados = lidos.reduce((t, { leitura }) => t + (leitura.tipo === "dados" ? leitura.qtd : 0), 0);
  if (totalDeDados > COMBO_MAX_DADOS) throw new ErroCampanha("dados_demais", `No máximo ${COMBO_MAX_DADOS} dados por rolagem.`);

  let total = 0;
  const saida = lidos.map(({ nome, leitura, sinal }) => {
    if (leitura.tipo === "bonus") {
      const bonus = sinal * leitura.bonus;
      total += bonus;
      return { nome, formula: sinal < 0 ? `-(${leitura.formula})` : leitura.formula, dados: [], bonus, soma: bonus };
    }
    const dados = Array.from({ length: leitura.qtd }, () => sorteio(leitura.lados));
    const soma = (dados.reduce((t, v) => t + v, 0) + leitura.bonus) * sinal;
    total += soma;
    return { nome, formula: sinal < 0 ? `-${leitura.formula}` : leitura.formula, dados, bonus: leitura.bonus, soma, ...(sinal < 0 ? { sinal } : {}) };
  });
  return { total, componentes: saida };
}

// Últimas rolagens do mestre, por id (para "atacar com esta rolagem").
function criarHistoricoDeRolagens(max = MAX_ROLAGENS_GUARDADAS) {
  const mapa = new Map();
  return {
    guardar(rolagem) {
      const id = `rol_${crypto.randomBytes(6).toString("hex")}`;
      mapa.set(id, { rolagem: { ...rolagem, rolagemId: id }, aplicacao: null, assinatura: undefined });
      if (mapa.size > max) mapa.delete(mapa.keys().next().value);
      return mapa.get(id).rolagem;
    },
    obter: (id) => mapa.get(id)?.rolagem || null,
    // A reserva nasce antes do await: outro acaoId/aba não aplica a mesma rolagem outra vez.
    aplicarUmaVez(id, aplicar, assinatura = undefined) {
      const entrada = mapa.get(id);
      if (!entrada) throw new ErroCampanha("rolagem_inexistente", "Essa rolagem não existe mais. Role de novo.");
      if (entrada.aplicacao && entrada.assinatura !== assinatura)
        throw new ErroCampanha("rolagem_ja_aplicada", "Essa rolagem já foi aplicada a outra seleção ou multiplicadores. Faça uma nova rolagem.");
      if (!entrada.aplicacao) {
        entrada.assinatura = assinatura;
        entrada.aplicacao = Promise.resolve().then(() => aplicar(entrada.rolagem.total)).catch(erro => {
          entrada.aplicacao = null;
          entrada.assinatura = undefined;
          throw erro;
        });
      }
      return entrada.aplicacao;
    },
  };
}

module.exports = { rolar, criarHistoricoDeRolagens };

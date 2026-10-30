/* =========================================================================
   BATALHA: REGRAS DO COMBATE DO MESTRE (Sprint 5)
   Funções puras sobre a "visão" da batalha ({ ativa, combatentes }). O servidor as executa dentro de
   campanha.atualizar("batalha", ...), então cada ação é atômica (uma por vez, gravada antes de confirmar).
   - adicionar: cópias numeradas do inimigo ("Goblin 1", "Goblin 2"), HP cheio, com os ataques e habilidades
     COPIADOS (excluir o modelo depois não mexe em quem já está em batalha);
   - HP: por delta ou valor absoluto, sempre entre 0 e o máximo; zero = derrotado, voltou a ter HP = de pé;
   - derrotado manual, remover, limpar. `ativa` = há combatentes.
   ========================================================================= */

const { ErroCampanha, LIMITE_COMBATENTES } = require("./campanha.js");
const { MAX_VITAL } = require("./personagem.js");

const MAX_COPIAS_POR_VEZ = 20;
const clonar = (v) => JSON.parse(JSON.stringify(v));

function achar(batalha, alvoId) {
  const c = batalha.combatentes.find((x) => x.alvoId === alvoId);
  if (!c) throw new ErroCampanha("alvo_inexistente", "Esse combatente não está na batalha.");
  return c;
}

function sincronizar(batalha) {
  batalha.ativa = batalha.combatentes.length > 0;
  return batalha;
}

// Próximo número livre para as cópias de um modelo: continua depois do maior número em uso.
function proximoNumero(batalha, modeloId, base) {
  let maior = 0;
  for (const c of batalha.combatentes) {
    if (c.modeloId !== modeloId) continue;
    const m = /^(.*) (\d+)$/.exec(c.nome);
    if (m && m[1] === base) maior = Math.max(maior, Number(m[2]));
  }
  return maior + 1;
}

function adicionar(batalha, inimigo, quantidade) {
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_COPIAS_POR_VEZ) {
    throw new ErroCampanha("quantidade_invalida", `Escolha de 1 a ${MAX_COPIAS_POR_VEZ} cópias.`);
  }
  if (batalha.combatentes.length + quantidade > LIMITE_COMBATENTES) {
    throw new ErroCampanha("limite_atingido", `A batalha comporta ${LIMITE_COMBATENTES} combatentes.`);
  }
  const base = inimigo.nome.slice(0, 70);
  const primeiro = proximoNumero(batalha, inimigo.id, base);
  const novos = [];
  for (let i = 0; i < quantidade; i++) {
    novos.push({
      tipo: inimigo.tipo === "npc" ? "npc" : "inimigo",
      modeloId: inimigo.id,
      nome: `${base} ${primeiro + i}`,
      imagem: inimigo.imagem || inimigo.retrato,
      hp: { atual: inimigo.hpMax ?? inimigo.hp?.atual ?? 10, max: inimigo.hpMax ?? inimigo.hp?.max ?? 10 },
      energia: clonar(inimigo.energia || { atual: 10, max: 10 }),
      defesa: inimigo.defesa ?? 10,
      arma: inimigo.arma ? clonar(inimigo.arma) : null,
      derrotado: (inimigo.hpMax ?? inimigo.hp?.atual ?? 10) === 0,
      atributos: clonar(inimigo.atributos || {}),
      ataques: clonar(inimigo.ataques || []),
      habilidades: clonar(inimigo.habilidades || []),
      magias: clonar(inimigo.magias || []),
      nota: inimigo.nota || inimigo.notas || "",
      notasCombate: "",
    });
  }
  batalha.combatentes.push(...novos); // alvoId novo é gerado na normalização
  return sincronizar(batalha);
}

// Exatamente um entre `delta` (soma, pode ser negativo) e `atual` (valor absoluto). Inteiros, limitados.
function ajustarHp(batalha, alvoId, { delta, atual }) {
  const temDelta = delta !== undefined;
  const temAtual = atual !== undefined;
  if (temDelta === temAtual) throw new ErroCampanha("formato_invalido", "Informe delta ou atual (um dos dois).");
  const valor = temDelta ? delta : atual;
  if (!Number.isInteger(valor) || Math.abs(valor) > MAX_VITAL) throw new ErroCampanha("formato_invalido", "Valor de HP inválido.");
  const c = achar(batalha, alvoId);
  c.hp.atual = Math.max(0, Math.min(c.hp.max, temDelta ? c.hp.atual + valor : valor));
  c.derrotado = c.hp.atual === 0;
  return batalha;
}

function marcarDerrotado(batalha, alvoId, derrotado) {
  if (typeof derrotado !== "boolean") throw new ErroCampanha("formato_invalido", "Valor inválido.");
  achar(batalha, alvoId).derrotado = derrotado;
  return batalha;
}

function remover(batalha, alvoId) {
  achar(batalha, alvoId);
  batalha.combatentes = batalha.combatentes.filter((c) => c.alvoId !== alvoId);
  return sincronizar(batalha);
}

function limpar(batalha) {
  batalha.combatentes = [];
  return sincronizar(batalha);
}

module.exports = { adicionar, ajustarHp, marcarDerrotado, remover, limpar };

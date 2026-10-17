/* =========================================================================
   DANO (Sprint 6): aplicar dano a vários alvos de uma vez, com multiplicador por alvo, e desfazer.
   - alvos: jogadores online, NPCs e inimigos em batalha, todos por `alvoId` (o mesmo de master_listar_alvos);
   - multiplicador só da lista fechada (×½, ×1, ×2), conta compartilhada com a página (calcularDano);
   - jogadores pelo MESMO caminho do ajuste de vida do mestre (status.json, aviso à ficha, card);
     NPCs pelo registro do NPC; inimigos pelo estado da batalha (atômico, com derrotado automático);
   - alvo ausente (jogador que saiu, NPC excluído) é relatado e não recebe dano; nada passa de 0;
   - desfazer só da ÚLTIMA aplicação e só restaura quem ainda está com o HP que o dano deixou.
   Uma operação por vez (fila): aplicar e desfazer nunca se misturam.
   ========================================================================= */

const crypto = require("crypto");
const { calcularDano, MULTIPLICADORES_DANO } = require("./JS/regras.js");
const { ErroCampanha } = require("./campanha.js");
const regrasDaBatalha = require("./batalha.js");

const MAX_ALVOS_POR_ATAQUE = 100;

/**
 * jogadores: { resolver(alvoId) -> { charId, nome, hp:{atual,max} } | null,
 *              ajustar(charId, delta) -> { antes, depois } (lança se não conseguir) }
 */
function criarDano({ campanha, jogadores }) {
  let fila = Promise.resolve();
  let ultima = null; // última aplicação (desfazer só vale para ela)
  const enfileirar = (tarefa) => {
    const execucao = fila.then(tarefa);
    fila = execucao.catch(() => {});
    return execucao;
  };

  // Procura o alvo nos três lugares. Devolve { tipo, nome, hp, charId? } ou null. (Leitura sem cópia.)
  function resolver(alvoId) {
    const jogador = jogadores.resolver(alvoId);
    if (jogador) return { tipo: "jogador", nome: jogador.nome, hp: jogador.hp, charId: jogador.charId };
    const npc = campanha.ver("npcs").find((n) => n.id === alvoId);
    if (npc) return { tipo: "npc", nome: npc.nome, hp: npc.hp };
    const c = campanha.ver("batalha").combatentes.find((x) => x.alvoId === alvoId);
    if (c) return { tipo: "inimigo", nome: c.nome, hp: c.hp };
    return null;
  }

  // Muda o HP de VÁRIOS alvos do mesmo tipo de uma vez (uma gravação só). `mudar(alvo)` roda dentro da operação
  // atômica e devolve { antes, depois } ou { motivo }. Devolve um Map indice -> resultado.
  async function emLote(tipo, lote, mudar) {
    const saida = new Map();
    try {
      if (tipo === "npc") {
        await campanha.atualizar("npcs", (lista) => {
          const porId = new Map(lista.map((n) => [n.id, n]));
          for (const it of lote) saida.set(it.indice, porId.has(it.alvoId) ? mudar(porId.get(it.alvoId).hp, it) : { motivo: "ausente" });
          return lista;
        });
      } else {
        await campanha.atualizar("batalha", (b) => {
          for (const it of lote) {
            const c = b.combatentes.find((x) => x.alvoId === it.alvoId);
            if (!c) {
              saida.set(it.indice, { motivo: "ausente" });
              continue;
            }
            const r = mudar(c.hp, it);
            if (r.antes !== undefined && r.antes !== r.depois) regrasDaBatalha.ajustarHp(b, it.alvoId, { atual: r.depois }); // derrotado automático
            saida.set(it.indice, r);
          }
          return b;
        });
      }
    } catch {
      for (const it of lote) saida.set(it.indice, { motivo: "erro" });
    }
    return saida;
  }

  function validarAlvos(alvos) {
    if (!Array.isArray(alvos) || alvos.length < 1 || alvos.length > MAX_ALVOS_POR_ATAQUE) {
      throw new ErroCampanha("alvos_invalidos", `Escolha de 1 a ${MAX_ALVOS_POR_ATAQUE} alvos.`);
    }
    const vistos = new Set();
    for (const a of alvos) {
      if (a === null || typeof a !== "object" || typeof a.alvoId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(a.alvoId)) {
        throw new ErroCampanha("alvos_invalidos", "Alvo inválido.");
      }
      if (!MULTIPLICADORES_DANO.includes(a.mult)) throw new ErroCampanha("multiplicador_invalido", "Multiplicador inválido: use ×½, ×1 ou ×2.");
      if (vistos.has(a.alvoId)) throw new ErroCampanha("alvo_repetido", "O mesmo alvo foi escolhido duas vezes.");
      vistos.add(a.alvoId);
    }
  }

  return {
    aplicar: ({ total, alvos }) =>
      enfileirar(async () => {
        if (!Number.isInteger(total)) throw new ErroCampanha("formato_invalido", "Valor de dano inválido.");
        validarAlvos(alvos);
        const resultados = new Array(alvos.length);
        const lotes = { npc: [], inimigo: [] };
        alvos.forEach(({ alvoId, mult }, indice) => {
          const dano = calcularDano(total, mult);
          const alvo = resolver(alvoId);
          if (!alvo) {
            resultados[indice] = { alvoId, ok: false, motivo: "ausente", mult, dano };
          } else if (dano === 0) {
            resultados[indice] = { alvoId, ok: true, tipo: alvo.tipo, nome: alvo.nome, mult, dano, antes: alvo.hp.atual, depois: alvo.hp.atual, derrotado: alvo.hp.atual === 0 };
          } else if (alvo.tipo === "jogador") {
            try {
              const { antes, depois } = jogadores.ajustar(alvo.charId, -dano);
              resultados[indice] = { alvoId, ok: true, tipo: "jogador", nome: alvo.nome, mult, dano, antes, depois, derrotado: depois === 0 };
            } catch {
              resultados[indice] = { alvoId, ok: false, motivo: "erro", nome: alvo.nome, tipo: "jogador", mult, dano };
            }
          } else {
            lotes[alvo.tipo].push({ indice, alvoId, mult, dano, nome: alvo.nome, tipo: alvo.tipo });
          }
        });
        for (const tipo of ["npc", "inimigo"]) {
          if (!lotes[tipo].length) continue;
          const saida = await emLote(tipo, lotes[tipo], (hp, it) => {
            const antes = hp.atual;
            hp.atual = Math.max(0, Math.min(hp.max, antes - it.dano));
            return { antes, depois: hp.atual };
          });
          for (const it of lotes[tipo]) {
            const r = saida.get(it.indice);
            resultados[it.indice] = r.motivo
              ? { alvoId: it.alvoId, ok: false, motivo: r.motivo === "ausente" ? "ausente" : "erro", nome: it.nome, tipo: it.tipo, mult: it.mult, dano: it.dano }
              : { alvoId: it.alvoId, ok: true, tipo: it.tipo, nome: it.nome, mult: it.mult, dano: it.dano, antes: r.antes, depois: r.depois, derrotado: r.depois === 0 };
          }
        }
        const aplicacao = { aplicacaoId: `apl_${crypto.randomBytes(6).toString("hex")}`, total, resultados, desfeita: false };
        ultima = aplicacao;
        return JSON.parse(JSON.stringify(aplicacao));
      }),

    // Restaura quem ainda está com o HP deixado pelo dano; os demais são relatados e não mudam. A checagem do HP e a
    // restauração acontecem juntas, dentro da mesma operação atômica.
    desfazer: (aplicacaoId) =>
      enfileirar(async () => {
        if (!ultima || ultima.aplicacaoId !== aplicacaoId) throw new ErroCampanha("nao_e_a_ultima", "Só a última aplicação pode ser desfeita.");
        if (ultima.desfeita) throw new ErroCampanha("ja_desfeita", "Essa aplicação já foi desfeita.");
        const pendentes = ultima.resultados.map((r, indice) => ({ r, indice })).filter(({ r }) => r.ok && r.antes !== r.depois);
        const restaurados = new Array(pendentes.length);
        const lotes = { npc: [], inimigo: [] };
        pendentes.forEach(({ r }, posicao) => {
          const alvo = resolver(r.alvoId);
          const base = { alvoId: r.alvoId, nome: r.nome };
          if (!alvo) {
            restaurados[posicao] = { ...base, ok: false, motivo: "ausente" };
          } else if (alvo.tipo === "jogador") {
            if (alvo.hp.atual !== r.depois) {
              restaurados[posicao] = { ...base, ok: false, motivo: "hp_mudou", atual: alvo.hp.atual };
              return;
            }
            try {
              const { antes, depois } = jogadores.ajustar(alvo.charId, r.antes - r.depois);
              restaurados[posicao] = { ...base, ok: true, antes, depois };
            } catch {
              restaurados[posicao] = { ...base, ok: false, motivo: "erro" };
            }
          } else {
            lotes[alvo.tipo].push({ indice: posicao, alvoId: r.alvoId, esperado: r.depois, restaurar: r.antes, base });
          }
        });
        for (const tipo of ["npc", "inimigo"]) {
          if (!lotes[tipo].length) continue;
          const saida = await emLote(tipo, lotes[tipo], (hp, it) => {
            if (hp.atual !== it.esperado) return { motivo: "hp_mudou", atual: hp.atual };
            const antes = hp.atual;
            hp.atual = it.restaurar;
            return { antes, depois: hp.atual };
          });
          for (const it of lotes[tipo]) {
            const r = saida.get(it.indice);
            restaurados[it.indice] = r.motivo
              ? { ...it.base, ok: false, motivo: r.motivo === "hp_mudou" ? "hp_mudou" : r.motivo === "ausente" ? "ausente" : "erro", ...(r.motivo === "hp_mudou" ? { atual: r.atual } : {}) }
              : { ...it.base, ok: true, antes: r.antes, depois: r.depois };
          }
        }
        ultima.desfeita = true;
        return { aplicacaoId, restaurados };
      }),
  };
}

module.exports = { criarDano };

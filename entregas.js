/* =========================================================================
   ENTREGAS: CAIXA DE ENTRADA POR PERSONAGEM (Sprint 2 da Fase 2)
   O mestre NUNCA grava na ficha de um jogador (regra R3): ele deixa uma "entrega" na caixa do
   personagem (<pasta do personagem>/entregas.json) e quem aplica é a PRÓPRIA ficha, pelo caminho
   normal de salvamento. Depois de salvar, a ficha confirma e o servidor marca como entregue.

   Entrega: { entregaId, tipo: "habilidades"|"magias", entrada: {...}, status: "pendente"|"entregue",
              criadoEm, entregueEm }
   - idempotente: o entregaId é único; a ficha também não duplica uma entrada que já tem (catalogId);
   - o que ficou pendente (jogador offline, ficha fechada) é reenviado ao abrir a ficha;
   - gravação atômica e uma por arquivo de cada vez (fila).
   ========================================================================= */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ehIdSeguro, ehObjeto, lerJson, gravarJson, trocarArquivo } = require("./personagem.js");

const TIPOS_ENTREGA = ["habilidades", "magias", "itens"];
const MAX_PENDENTES = 100;
const MAX_FINALIZADAS_GUARDADAS = 30; // entregues + canceladas
const TAMANHO_MAX_ENTRADA = 8000; // bytes de JSON

function dataIso(valor) {
  const t = typeof valor === "string" ? Date.parse(valor) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function normalizarEntrega(bruto) {
  if (!ehObjeto(bruto) || !ehIdSeguro(bruto.entregaId)) return null;
  if (!TIPOS_ENTREGA.includes(bruto.tipo) || !ehObjeto(bruto.entrada)) return null;
  if (JSON.stringify(bruto.entrada).length > TAMANHO_MAX_ENTRADA) return null;
  if (!ehIdSeguro(bruto.entrada.catalogId)) return null;
  // Entrega de loot: liga a reserva ao baú de onde saiu o item (para devolver se não for aplicada).
  let origem = null;
  if (ehObjeto(bruto.origem)) {
    const o = bruto.origem;
    if (!ehIdSeguro(o.bauId) || !ehIdSeguro(o.linhaId)) return null;
    const q = Math.floor(Number(o.quantidade));
    if (!Number.isFinite(q) || q < 1 || q > 999) return null;
    origem = { bauId: o.bauId, linhaId: o.linhaId, quantidade: q };
  }
  if (bruto.tipo === "itens" && !origem) return null; // item só chega por baú
  const status = ["entregue", "cancelada"].includes(bruto.status) ? bruto.status : "pendente";
  return {
    entregaId: bruto.entregaId,
    tipo: bruto.tipo,
    entrada: bruto.entrada,
    origem,
    status,
    criadoEm: dataIso(bruto.criadoEm) || new Date().toISOString(),
    entregueEm: status === "pendente" ? null : dataIso(bruto.entregueEm) || new Date().toISOString(),
    motivo: status === "cancelada" && typeof bruto.motivo === "string" ? bruto.motivo.slice(0, 40) : null,
  };
}

class ErroEntrega extends Error {
  constructor(codigo, mensagem) {
    super(mensagem || codigo);
    this.codigo = codigo;
    this.negocio = true;
  }
}

function criarEntregas({ pastaDoPersonagem, log = console }) {
  const filas = new Map(); // caminho -> promessa (uma gravação por arquivo de cada vez)
  const caminhoDe = (player, nomePasta) => path.join(pastaDoPersonagem(player, nomePasta), "entregas.json");

  function ler(caminho) {
    if (!fs.existsSync(caminho)) return [];
    try {
      const bruto = lerJson(caminho);
      if (!Array.isArray(bruto?.items)) throw new Error("formato");
      return bruto.items.map(normalizarEntrega).filter(Boolean);
    } catch {
      // arquivo estragado: guarda à parte (nunca sobrescreve) e começa vazio
      try {
        trocarArquivo(caminho, `${caminho}.corrompido-${Date.now()}`);
      } catch {
        /* sem permissão: segue com a caixa vazia */
      }
      log.warn(`[ENTREGAS] ${caminho} estava corrompido e foi guardado à parte.`);
      return [];
    }
  }

  function gravar(caminho, itens) {
    const pendentes = itens.filter((i) => i.status === "pendente");
    const finalizadas = itens.filter((i) => i.status !== "pendente").slice(-MAX_FINALIZADAS_GUARDADAS);
    gravarJson(caminho, { schemaVersion: 1, items: [...finalizadas, ...pendentes] });
  }

  function naFila(caminho, tarefa) {
    const anterior = filas.get(caminho) || Promise.resolve();
    const execucao = anterior.then(() => tarefa());
    const cauda = execucao.catch(() => {});
    filas.set(caminho, cauda);
    cauda.then(() => {
      if (filas.get(caminho) === cauda) filas.delete(caminho);
    });
    return execucao;
  }

  const entregas = {
    pendentes: (player, nomePasta) => ler(caminhoDe(player, nomePasta)).filter((i) => i.status === "pendente"),

    // Deixa uma entrega na caixa. Recusa repetida (mesma entrada ainda pendente) e caixa cheia.
    adicionar: (player, nomePasta, { tipo, entrada, origem }) => {
      const caminho = caminhoDe(player, nomePasta);
      return naFila(caminho, () => {
        const nova = normalizarEntrega({ entregaId: `ent_${crypto.randomBytes(8).toString("hex")}`, tipo, entrada, origem, status: "pendente" });
        if (!nova) throw new ErroEntrega("entrega_invalida", "Entrega inválida.");
        const itens = ler(caminho);
        const pend = itens.filter((i) => i.status === "pendente");
        if (!origem && pend.some((i) => i.tipo === tipo && i.entrada.catalogId === entrada.catalogId)) {
          throw new ErroEntrega("ja_pendente", "Já há uma entrega pendente desta entrada para este personagem.");
        }
        if (pend.length >= MAX_PENDENTES) throw new ErroEntrega("caixa_cheia", "A caixa de entregas deste personagem está cheia.");
        gravar(caminho, [...itens, nova]);
        return nova;
      });
    },

    // Cancela uma entrega pendente (recusada pela ficha ou reserva expirada). Devolve a entrega ou null.
    cancelar: (player, nomePasta, entregaId, motivo) => {
      if (!ehIdSeguro(entregaId)) return Promise.resolve(null);
      const caminho = caminhoDe(player, nomePasta);
      return naFila(caminho, () => {
        const itens = ler(caminho);
        const alvo = itens.find((i) => i.entregaId === entregaId && i.status === "pendente");
        if (!alvo) return null;
        alvo.status = "cancelada";
        alvo.motivo = String(motivo || "cancelada").slice(0, 40);
        alvo.entregueEm = new Date().toISOString();
        gravar(caminho, itens);
        return alvo;
      });
    },

    // Marca como entregue (só se existir e ainda estiver pendente). Devolve a entrega ou null.
    marcarEntregue: (player, nomePasta, entregaId) => {
      if (!ehIdSeguro(entregaId)) return Promise.resolve(null);
      const caminho = caminhoDe(player, nomePasta);
      return naFila(caminho, () => {
        const itens = ler(caminho);
        const alvo = itens.find((i) => i.entregaId === entregaId && i.status === "pendente");
        if (!alvo) return null;
        alvo.status = "entregue";
        alvo.entregueEm = new Date().toISOString();
        gravar(caminho, itens);
        return alvo;
      });
    },
  };
  return entregas;
}

module.exports = { criarEntregas, MAX_PENDENTES };

/* =========================================================================
   MODELO OFICIAL DO PERSONAGEM (Sprint 0)
   Fonte única de: nomes de arquivo, formato dos JSON, defaults,
   normalização (validação) e migração de formatos antigos.
   Usado por server.js e migrar.js.
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 1;
const MAX_VITAL = 100_000;
const VITAL_TYPES = ["hp", "vigor", "sanity"];
const ATRIBUTOS = ["FOR", "DES", "INT", "SAB", "PRE", "VON"];
const SLOTS_EQUIPADOS = ["mainHand", "offHand", "back", "backpack"];
const MAX_LISTA = 500;

// ------------------------------- utilitários -------------------------------
const ehObjeto = (v) => v && typeof v === "object" && !Array.isArray(v);

function inteiro(valor, min, max, fallback) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.round(n), max));
}

function texto(valor, max, fallback = "") {
  return typeof valor === "string" ? valor.slice(0, max) : fallback;
}

// Corrige textos gravados com codificação corrompida (ex.: "Consumí­vel").
function corrigirTexto(valor) {
  return typeof valor === "string"
    ? valor.replace(/í\u00ad/g, "í").replace(/í\u00aa/g, "ê")
    : valor;
}

function corrigirTextosDeObjeto(obj) {
  const copia = {};
  for (const [k, v] of Object.entries(obj)) copia[k] = corrigirTexto(v);
  return copia;
}

// ------------------------------- defaults ---------------------------------
const DEFAULT_INVENTARIO_EQUIPPED = () => ({
  mainHand: null,
  offHand: null,
  back: null,
  backpack: null,
});

const DEFAULTS = {
  perfil: (ctx = {}) => ({
    schemaVersion: SCHEMA_VERSION,
    id: ctx.id || "",
    nome: ctx.nome || "Personagem",
    classe: "",
    progressao: { ex: "0%", nv: "1" },
    avatar: "",
  }),
  atributos: () => ({
    schemaVersion: SCHEMA_VERSION,
    ...Object.fromEntries(ATRIBUTOS.map((a) => [a, 0])),
  }),
  status: () => ({
    schemaVersion: SCHEMA_VERSION,
    hp: { current: 0, max: 0 },
    vigor: { current: 0, max: 0 },
    sanity: { current: 0, max: 0 },
  }),
  pericias: () => ({ schemaVersion: SCHEMA_VERSION, skills: {} }),
  inventario: () => ({
    schemaVersion: SCHEMA_VERSION,
    items: [],
    equipped: DEFAULT_INVENTARIO_EQUIPPED(),
  }),
  magias: () => ({ schemaVersion: SCHEMA_VERSION, items: [] }),
  habilidades: () => ({ schemaVersion: SCHEMA_VERSION, items: [] }),
  biografia: () => ({
    schemaVersion: SCHEMA_VERSION,
    history: "",
    scars: "",
    notes: "",
  }),
  riquezas: () => ({ schemaVersion: SCHEMA_VERSION, po: 0, pp: 0, pc: 0 }),
};

// ------------------------------ normalizadores -----------------------------
// Cada um recebe o dado (já no formato oficial) e devolve o dado limpo,
// ou null se o formato for inválido.
const NORMALIZADORES = {
  perfil(d) {
    if (!ehObjeto(d)) return null;
    const p = ehObjeto(d.progressao) ? d.progressao : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      id: texto(d.id, 64),
      nome: texto(d.nome, 40).trim() || "Personagem",
      classe: texto(d.classe, 120),
      progressao: { ex: texto(p.ex, 20, "0%"), nv: texto(p.nv, 20, "1") },
      avatar: texto(d.avatar, 2000),
    };
  },

  atributos(d) {
    if (!ehObjeto(d)) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      ...Object.fromEntries(
        ATRIBUTOS.map((a) => [a, inteiro(d[a], 0, 999, 0)]),
      ),
    };
  },

  status(d) {
    if (!ehObjeto(d)) return null;
    const out = { schemaVersion: SCHEMA_VERSION };
    for (const tipo of VITAL_TYPES) {
      const v = d[tipo];
      if (!ehObjeto(v)) return null;
      const max = inteiro(v.max, 0, MAX_VITAL, 0);
      out[tipo] = { current: Math.min(inteiro(v.current, 0, MAX_VITAL, 0), max), max };
    }
    return out;
  },

  pericias(d) {
    if (!ehObjeto(d) || !ehObjeto(d.skills)) return null;
    const skills = {};
    for (const [id, skill] of Object.entries(d.skills)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !ehObjeto(skill)) return null;
      skills[id] = { mod: inteiro(skill.mod, -99, 99, 0) };
    }
    return { schemaVersion: SCHEMA_VERSION, skills };
  },

  inventario(d) {
    if (!ehObjeto(d) || !Array.isArray(d.items) || d.items.length > MAX_LISTA)
      return null;
    if (d.items.some((i) => !ehObjeto(i) || typeof i.id !== "string")) return null;

    const equipped = DEFAULT_INVENTARIO_EQUIPPED();
    const origem = ehObjeto(d.equipped) ? d.equipped : {};
    for (const slot of SLOTS_EQUIPADOS) {
      const item = origem[slot];
      if (item == null) continue;
      if (!ehObjeto(item) || typeof item.id !== "string") return null;
      equipped[slot] = corrigirTextosDeObjeto(item);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      items: d.items.map(corrigirTextosDeObjeto),
      equipped,
    };
  },

  magias: normalizarLista,
  habilidades: normalizarLista,

  biografia(d) {
    if (!ehObjeto(d)) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      history: texto(d.history, 20000),
      scars: texto(d.scars, 20000),
      notes: texto(d.notes, 20000),
    };
  },

  riquezas(d) {
    if (!ehObjeto(d)) return null;
    const max = 1_000_000_000;
    return {
      schemaVersion: SCHEMA_VERSION,
      po: inteiro(d.po, 0, max, 0),
      pp: inteiro(d.pp, 0, max, 0),
      pc: inteiro(d.pc, 0, max, 0),
    };
  },
};

function normalizarLista(d) {
  if (!ehObjeto(d) || !Array.isArray(d.items) || d.items.length > MAX_LISTA)
    return null;
  if (d.items.some((i) => !ehObjeto(i))) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    items: d.items.map(corrigirTextosDeObjeto),
  };
}

const ARQUIVOS = Object.keys(DEFAULTS); // nomes (sem .json) na ordem oficial

// ------------------------- conversão de formatos antigos -------------------
// Cada função recebe o conteúdo lido do JSON antigo e devolve o formato oficial
// (ainda sem passar pelo normalizador). Retornam null se não reconhecerem.
const LEGADO = {
  status(d) {
    if (!ehObjeto(d)) return null;
    const vital = (chave, legado) => {
      const v = d[chave] ?? d[legado];
      if (ehObjeto(v)) return { current: v.current, max: v.max };
      return { current: v, max: d[`${legado}Max`] ?? d[`${chave}Max`] };
    };
    return {
      hp: vital("hp", "hp"),
      vigor: vital("vigor", "mana"),
      sanity: vital("sanity", "stress"),
    };
  },

  pericias(d) {
    let lista = [];
    if (Array.isArray(d)) lista = d;
    else if (ehObjeto(d) && Array.isArray(d.skills)) lista = d.skills;
    else if (ehObjeto(d))
      lista = Object.entries(d).map(([id, s]) => ({ id, ...(ehObjeto(s) ? s : {}) }));
    else return null;

    const skills = {};
    for (const s of lista) {
      if (ehObjeto(s) && typeof s.id === "string") skills[s.id] = { mod: s.mod };
    }
    return { skills };
  },

  inventario(d) {
    if (Array.isArray(d)) return { items: d, equipped: {} };
    if (!ehObjeto(d)) return null;
    return {
      items: Array.isArray(d.items)
        ? d.items
        : Array.isArray(d.backpackItems)
          ? d.backpackItems
          : [],
      equipped: ehObjeto(d.equipped) ? d.equipped : {},
    };
  },

  magias(d) {
    if (Array.isArray(d)) return { items: d };
    if (ehObjeto(d) && Array.isArray(d.spells)) return { items: d.spells };
    return null;
  },

  habilidades(d) {
    if (Array.isArray(d)) return { items: d };
    if (ehObjeto(d) && Array.isArray(d.abilities)) return { items: d.abilities };
    return null;
  },
};

// ------------------------------ leitura/escrita ----------------------------
function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, "utf8").replace(/^\uFEFF/, ""));
}

function gravarJson(caminho, dados) {
  const tmp = `${caminho}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf8");
  fs.renameSync(tmp, caminho); // troca atômica: evita JSON pela metade
}

function extrairNomeEId(nomePasta) {
  const m = /^(.*)_(\d+)(?:_\d+)?$/.exec(nomePasta);
  return m ? { nome: m[1], id: m[2] } : { nome: nomePasta, id: "" };
}

/**
 * Deixa a pasta do personagem 100% no formato oficial. Idempotente:
 * arquivos que já têm schemaVersion são apenas normalizados; ausentes viram
 * default; formatos antigos são convertidos. Antes de mexer em qualquer coisa,
 * copia os arquivos originais para _backup_pre_schema/ (uma única vez).
 * Retorna { alterados: [...], erros: [...] } ; com dryRun não grava nada.
 */
function migrarPasta(dir, { dryRun = false } = {}) {
  const relatorio = { alterados: [], erros: [] };
  const backupDir = path.join(dir, "_backup_pre_schema");
  const contexto = extrairNomeEId(path.basename(dir));

  const fazerBackup = () => {
    if (dryRun || fs.existsSync(backupDir)) return;
    fs.mkdirSync(backupDir);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json")) fs.copyFileSync(path.join(dir, f), path.join(backupDir, f));
    }
  };

  const escrever = (arquivo, dados, motivo) => {
    relatorio.alterados.push(`${arquivo}.json (${motivo})`);
    if (dryRun) return;
    fazerBackup();
    gravarJson(path.join(dir, `${arquivo}.json`), dados);
  };

  for (const arquivo of ARQUIVOS) {
    const caminho = path.join(dir, `${arquivo}.json`);
    const caminhoLegado = path.join(dir, "backpack.json");
    const usaLegadoInventario = arquivo === "inventario" && !fs.existsSync(caminho) && fs.existsSync(caminhoLegado);
    const origem = usaLegadoInventario ? caminhoLegado : caminho;

    if (!fs.existsSync(origem)) {
      escrever(arquivo, DEFAULTS[arquivo](contexto), "criado com padrão");
      continue;
    }

    let bruto;
    try {
      bruto = lerJson(origem);
    } catch (erro) {
      relatorio.erros.push(`${arquivo}.json: JSON inválido (${erro.message})`);
      continue;
    }

    const jaOficial = ehObjeto(bruto) && bruto.schemaVersion === SCHEMA_VERSION;
    const convertido = jaOficial ? bruto : LEGADO[arquivo] ? LEGADO[arquivo](bruto) : bruto;
    const limpo = convertido && NORMALIZADORES[arquivo](convertido);

    if (!limpo) {
      relatorio.erros.push(`${arquivo}.json: formato não reconhecido`);
      continue;
    }

    // perfil legado não existe; se for oficial mas sem id/nome, completa pelo nome da pasta
    if (arquivo === "perfil") {
      limpo.id = limpo.id || contexto.id;
    }

    if (JSON.stringify(limpo) !== JSON.stringify(bruto) || usaLegadoInventario) {
      escrever(arquivo, limpo, usaLegadoInventario ? "migrado de backpack.json" : jaOficial ? "normalizado" : "convertido");
    }
  }

  // backpack.json antigo sai do lugar (o backup em _backup_pre_schema/ o preserva)
  const legado = path.join(dir, "backpack.json");
  if (!dryRun && fs.existsSync(legado) && fs.existsSync(path.join(dir, "inventario.json"))) {
    fs.unlinkSync(legado);
    relatorio.alterados.push("backpack.json (removido após migração)");
  }

  return relatorio;
}

function criarArquivosPadrao(dir, contexto) {
  for (const arquivo of ARQUIVOS) {
    gravarJson(path.join(dir, `${arquivo}.json`), DEFAULTS[arquivo](contexto));
  }
}

function carregarPersonagemDaPasta(dir) {
  const relatorio = migrarPasta(dir);
  if (relatorio.erros.length) return { erros: relatorio.erros };
  const personagem = {};
  for (const arquivo of ARQUIVOS) {
    personagem[arquivo] = lerJson(path.join(dir, `${arquivo}.json`));
  }
  return { personagem };
}

module.exports = {
  SCHEMA_VERSION,
  MAX_VITAL,
  VITAL_TYPES,
  ARQUIVOS,
  DEFAULTS,
  NORMALIZADORES,
  gravarJson,
  criarArquivosPadrao,
  carregarPersonagemDaPasta,
  migrarPasta,
};

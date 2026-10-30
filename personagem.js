/* =========================================================================
   MODELO OFICIAL DO PERSONAGEM (Sprint 0)
   Fonte única de: nomes de arquivo, formato dos JSON, defaults,
   normalização (validação) e migração de formatos antigos.
   Usado por server.js e migrar.js.
   ========================================================================= */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { urlDeImagem } = require("./JS/regras.js"); // compartilhado com a ficha (validação do avatar)

const SCHEMA_VERSION = 1;
const MAX_VITAL = 100_000;
const VITAL_TYPES = ["hp", "vigor", "sanity"];
const ATRIBUTOS = ["FOR", "DES", "INT", "SAB", "PRE", "VON"];
// Valor de um atributo em personagem novo: 10 = modificador +0 (ver modificadorDeAtributo em JS/regras.js).
const ATRIBUTO_INICIAL = 10;
const SLOTS_EQUIPADOS = ["mainHand", "offHand", "back", "backpack"];
const MAX_LISTA = 500;

// Campos de texto do perfil (ficha básica), além de id, nome, progressão e avatar.
// Para criar um campo novo: adicione uma linha aqui e um <input data-campo="perfil.<chave>">
// no index.html. Defaults, validação e salvamento passam a valer sozinhos.
const CAMPOS_PERFIL = [
  { chave: "classe", max: 120 },
  { chave: "origem", max: 80 },
  { chave: "idade", max: 40 },
  { chave: "alinhamento", max: 60 },
  { chave: "divindade", max: 80 }, // Divindade/Pacto
];

// Limites dos itens do inventário (Sprint 3).
const MAX_PILHA = 999; // maxStack e quantity
const MAX_LARGURA_ITEM = 10; // w e h, em células da grade
const MAX_POSICAO_ITEM = 50; // col e row
// Ids "seguros" (perícia, catálogo, personagem no painel): letras, números, _ e -, até 64 caracteres.
const ehIdSeguro = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const UID_VALIDO = /^[A-Za-z0-9_-]{4,64}$/; // uid de instância: mesmo padrão, mínimo de 4

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
    ...Object.fromEntries(CAMPOS_PERFIL.map(({ chave }) => [chave, ""])),
    progressao: { ex: "0%", nv: "1" },
    avatar: "",
  }),
  atributos: () => ({
    schemaVersion: SCHEMA_VERSION,
    ...Object.fromEntries(ATRIBUTOS.map((a) => [a, ATRIBUTO_INICIAL])),
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
    recebidas: [],
  }),
  magias: () => ({ schemaVersion: SCHEMA_VERSION, items: [] }),
  habilidades: () => ({ schemaVersion: SCHEMA_VERSION, items: [] }),
  biografia: () => ({
    schemaVersion: SCHEMA_VERSION,
    history: "",
    scars: "",
    notes: "",
  }),
  riquezas: () => ({ schemaVersion: SCHEMA_VERSION, po: 0, pp: 0, pc: 0, sangue: 0 }),
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
      ...Object.fromEntries(
        CAMPOS_PERFIL.map(({ chave, max }) => [chave, texto(d[chave], max)]),
      ),
      progressao: { ex: texto(p.ex, 20, "0%"), nv: texto(p.nv, 20, "1") },
      avatar: urlDeImagem(d.avatar),
    };
  },

  atributos(d) {
    if (!ehObjeto(d)) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      ...Object.fromEntries(
        ATRIBUTOS.map((a) => [a, inteiro(d[a], 0, 999, ATRIBUTO_INICIAL)]),
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
      if (!ehIdSeguro(id) || !ehObjeto(skill)) return null;
      skills[id] = { mod: inteiro(skill.mod, -99, 99, 0) };
    }
    return { schemaVersion: SCHEMA_VERSION, skills };
  },

  inventario(d) {
    if (!ehObjeto(d) || !Array.isArray(d.items) || d.items.length > MAX_LISTA)
      return null;
    if (d.items.some((i) => !ehObjeto(i) || typeof i.id !== "string")) return null;

    const uidsVistos = new Set();
    const items = d.items.map((item) => normalizarItem(item, uidsVistos, true));

    const equipped = DEFAULT_INVENTARIO_EQUIPPED();
    const origem = ehObjeto(d.equipped) ? d.equipped : {};
    for (const slot of SLOTS_EQUIPADOS) {
      const item = origem[slot];
      if (item == null) continue;
      if (!ehObjeto(item) || typeof item.id !== "string") return null;
      equipped[slot] = normalizarItem(item, uidsVistos, false);
    }
    // Recibo das entregas do mestre já aplicadas (idempotência: a ficha nunca aplica a mesma duas vezes).
    const recebidas = Array.isArray(d.recebidas) ? d.recebidas.filter(ehIdSeguro).slice(-50) : [];
    return { schemaVersion: SCHEMA_VERSION, items, equipped, recebidas };
  },

  magias: normalizarCodice,
  habilidades: normalizarCodice,

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
      sangue: inteiro(d.sangue, 0, max, 0), // Moeda de Sangue
    };
  },
};

// Identificador único de cada INSTÂNCIA de item (o `id` é o TIPO do item: duas adagas
// têm o mesmo `id` e `uid`s diferentes).
function novoUid(prefixo = "it") {
  return `${prefixo}_${crypto.randomBytes(5).toString("hex")}`;
}

/**
 * Normaliza um item do inventário:
 *  - uid: string única entre itens da mochila + equipados (gera se faltar/repetir);
 *  - quantity/maxStack: inteiros; maxStack 1 = não empilha; quantity <= maxStack;
 *  - w/h (e col/row, quando o item está na grade): inteiros positivos.
 * Campos desconhecidos são preservados.
 */
function normalizarItem(item, uidsVistos, naGrade) {
  const base = corrigirTextosDeObjeto(item);

  let uid = typeof base.uid === "string" && UID_VALIDO.test(base.uid) ? base.uid : "";
  while (!uid || uidsVistos.has(uid)) uid = novoUid();
  uidsVistos.add(uid);

  const maxStack = inteiro(base.maxStack, 1, MAX_PILHA, 1);
  const peso = Number(base.weight);
  const normalizado = {
    ...base,
    uid,
    maxStack,
    quantity: Math.min(inteiro(base.quantity, 1, MAX_PILHA, 1), maxStack),
    weight: Number.isFinite(peso) ? Math.max(0, Math.min(Math.round(peso * 100) / 100, 100_000)) : 0,
    w: inteiro(base.w, 1, MAX_LARGURA_ITEM, 1),
    h: inteiro(base.h, 1, MAX_LARGURA_ITEM, 1),
  };
  if (naGrade) {
    const formato = require('./JS/regras.js').normalizarFormatoItem(base.formato);
    if (formato) { normalizado.formato = formato; normalizado.w = Math.max(...formato.map(p=>p[0]))+1; normalizado.h = Math.max(...formato.map(p=>p[1]))+1; }
    else delete normalizado.formato;
    normalizado.col = inteiro(base.col, 1, MAX_POSICAO_ITEM, 1);
    normalizado.row = inteiro(base.row, 1, MAX_POSICAO_ITEM, 1);
  }
  return normalizado;
}

// ------------------------------- códice (Sprint 5) -------------------------------
// Magias e habilidades usam o mesmo modelo de entrada. Campos conhecidos:
//   uid (instância), catalogId (origem no catálogo global), nome, icon, dice, tipoDano,
//   cost { vital: hp|vigor|sanity|"", amount } (ou custo/cost em texto, formato antigo),
//   acao, alcance, desc. Campos desconhecidos são preservados.
// Um campo inválido é corrigido/descartado; a entrada nunca invalida o arquivo inteiro.
const MAX_CODICE_TEXTO = {
  nome: 80,
  name: 80,
  desc: 2000,
  descricao: 2000,
  acao: 60,
  alcance: 60,
  tipoDano: 40,
  custo: 40,
};
const DADO_VALIDO = { test: require("./JS/regras.js").dadoDePoderValido };
const ICONE_VALIDO = /^[a-z0-9-]{1,40}$/i;

function normalizarEntradaCodice(item, uidsVistos) {
  const out = corrigirTextosDeObjeto(item);

  let uid = typeof out.uid === "string" && UID_VALIDO.test(out.uid) ? out.uid : "";
  while (!uid || uidsVistos.has(uid)) uid = novoUid("cx");
  uidsVistos.add(uid);
  out.uid = uid;

  for (const [campo, max] of Object.entries(MAX_CODICE_TEXTO)) {
    if (!(campo in out)) continue;
    const v = out[campo];
    if (typeof v === "string") out[campo] = v.slice(0, max);
    else if (campo === "custo" && Number.isFinite(v)) out[campo] = String(v).slice(0, max);
    else delete out[campo];
  }

  if ("dice" in out) {
    const dado = typeof out.dice === "string" ? out.dice.trim() : "";
    if (DADO_VALIDO.test(dado)) out.dice = dado;
    else delete out.dice;
  }
  if ("icon" in out && !(typeof out.icon === "string" && ICONE_VALIDO.test(out.icon))) {
    delete out.icon;
  }
  if ("catalogId" in out && !ehIdSeguro(out.catalogId)) {
    delete out.catalogId;
  }
  if ("cost" in out) {
    const c = out.cost;
    if (ehObjeto(c)) {
      out.cost = {
        vital: VITAL_TYPES.includes(c.vital) ? c.vital : "",
        amount: inteiro(c.amount, 0, MAX_VITAL, 0),
      };
    } else if (typeof c === "string") out.cost = c.slice(0, 40);
    else if (Number.isFinite(c)) out.cost = inteiro(c, 0, MAX_VITAL, 0);
    else delete out.cost;
  }
  return out;
}

function normalizarCodice(d) {
  if (!ehObjeto(d) || !Array.isArray(d.items) || d.items.length > MAX_LISTA)
    return null;
  if (d.items.some((i) => !ehObjeto(i))) return null;
  const uidsVistos = new Set();
  return {
    schemaVersion: SCHEMA_VERSION,
    items: d.items.map((item) => normalizarEntradaCodice(item, uidsVistos)),
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
    let lista;
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

const ERROS_DE_ARQUIVO_EM_USO = new Set(["EPERM", "EBUSY", "EACCES"]);
const esperarSincrono = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Troca atômica de arquivo (rename por cima). No Windows o rename falha de vez em quando (antivírus ou indexador
// segurando o arquivo): tenta de novo algumas vezes e, em último caso, copia por cima (não atômico, mas não perde o dado).
function trocarArquivo(origem, destino, { tentativas = 6, espera = 25 } = {}) {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(origem, destino);
      return;
    } catch (erro) {
      if (!ERROS_DE_ARQUIVO_EM_USO.has(erro.code)) throw erro;
      if (i >= tentativas) {
        fs.copyFileSync(origem, destino);
        fs.rmSync(origem, { force: true });
        return;
      }
      esperarSincrono(espera * i);
    }
  }
}

function gravarJson(caminho, dados) {
  const tmp = `${caminho}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf8");
  trocarArquivo(tmp, caminho); // troca atômica: evita JSON pela metade
}

// Durante a sessão, esperar um arquivo do Windows não pode bloquear os demais sockets.
// A versão síncrona acima fica para a inicialização e os comandos de migração offline.
async function trocarArquivoAsync(origem, destino, { tentativas = 6, espera = 25 } = {}) {
  for (let i = 1; ; i++) {
    try {
      await fs.promises.rename(origem, destino);
      return;
    } catch (erro) {
      if (!ERROS_DE_ARQUIVO_EM_USO.has(erro.code)) throw erro;
      if (i >= tentativas) {
        await fs.promises.copyFile(origem, destino);
        await fs.promises.rm(origem, { force: true });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, espera * i));
    }
  }
}

const gravacoesPendentes = new Map();
function gravarJsonAsync(caminho, dados) {
  // Captura o valor solicitado antes de aguardar outra gravação desse mesmo arquivo.
  const conteudo = JSON.stringify(dados, null, 2);
  const absoluto = path.resolve(caminho);
  const chave = process.platform === "win32" ? absoluto.toLowerCase() : absoluto;
  const anterior = gravacoesPendentes.get(chave) || Promise.resolve();
  const execucao = anterior.then(async () => {
    const tmp = `${absoluto}.tmp`;
    await fs.promises.writeFile(tmp, conteudo, "utf8");
    await trocarArquivoAsync(tmp, absoluto);
  });
  const cauda = execucao.catch(() => {});
  gravacoesPendentes.set(chave, cauda);
  cauda.then(() => { if (gravacoesPendentes.get(chave) === cauda) gravacoesPendentes.delete(chave); });
  return execucao;
}

function extrairNomeEId(nomePasta) {
  const m = /^(.*?)_(\d+)(?:_\d+)?$/.exec(nomePasta);
  return m ? { nome: m[1], id: m[2] } : { nome: nomePasta, id: "" };
}

/**
 * Deixa a pasta do personagem 100% no formato oficial. Idempotente:
 * arquivos que já têm schemaVersion são apenas normalizados; ausentes viram
 * default; formatos antigos são convertidos. Antes de mexer em qualquer coisa,
 * copia os arquivos originais para _backup_pre_schema/ (uma única vez).
 * Retorna { alterados: [...], erros: [...] } ; com dryRun não grava nada.
 */
function migrarPasta(dir, { dryRun = false, escritas = null } = {}) {
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
    if (escritas) { escritas.push({ arquivo, dados }); return; }
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
  if (!dryRun && !escritas && fs.existsSync(legado) && fs.existsSync(path.join(dir, "inventario.json"))) {
    fs.unlinkSync(legado);
    relatorio.alterados.push("backpack.json (removido após migração)");
  }

  return relatorio;
}

async function migrarPastaAsync(dir) {
  const escritas = [];
  const relatorio = migrarPasta(dir, { escritas });
  const backupDir = path.join(dir, "_backup_pre_schema");
  if (escritas.length && !fs.existsSync(backupDir)) {
    await fs.promises.mkdir(backupDir);
    for (const f of await fs.promises.readdir(dir)) {
      if (f.endsWith(".json")) await fs.promises.copyFile(path.join(dir, f), path.join(backupDir, f));
    }
  }
  for (const { arquivo, dados } of escritas) await gravarJsonAsync(path.join(dir, `${arquivo}.json`), dados);
  const legado = path.join(dir, "backpack.json");
  if (fs.existsSync(legado) && fs.existsSync(path.join(dir, "inventario.json"))) {
    await fs.promises.unlink(legado);
    relatorio.alterados.push("backpack.json (removido após migração)");
  }
  return relatorio;
}

/**
 * Leitura SEM efeitos colaterais (não migra, não faz backup, não grava nada), para o painel do
 * mestre. Arquivo ausente ou inválido vira o padrão, só na memória.
 */
function lerArquivosNormalizados(dir, arquivos) {
  const contexto = extrairNomeEId(path.basename(dir));
  const resultado = {};
  for (const arquivo of arquivos) {
    let dados = null;
    try {
      const caminho = path.join(dir, `${arquivo}.json`);
      if (fs.existsSync(caminho)) {
        const bruto = lerJson(caminho);
        const jaOficial = ehObjeto(bruto) && bruto.schemaVersion === SCHEMA_VERSION;
        const convertido = jaOficial ? bruto : LEGADO[arquivo] ? LEGADO[arquivo](bruto) : bruto;
        dados = convertido && NORMALIZADORES[arquivo](convertido);
      }
    } catch {
      dados = null;
    }
    resultado[arquivo] = dados || DEFAULTS[arquivo](contexto);
  }
  return resultado;
}

function criarArquivosPadrao(dir, contexto) {
  for (const arquivo of ARQUIVOS) {
    gravarJson(path.join(dir, `${arquivo}.json`), DEFAULTS[arquivo](contexto));
  }
}

async function criarArquivosPadraoAsync(dir, contexto) {
  for (const arquivo of ARQUIVOS) await gravarJsonAsync(path.join(dir, `${arquivo}.json`), DEFAULTS[arquivo](contexto));
}

async function carregarPersonagemDaPastaAsync(dir) {
  const relatorio = await migrarPastaAsync(dir);
  if (relatorio.erros.length) return { erros: relatorio.erros };
  const personagem = {};
  for (const arquivo of ARQUIVOS) personagem[arquivo] = lerJson(path.join(dir, `${arquivo}.json`));
  return { personagem };
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
  CAMPOS_PERFIL,
  ARQUIVOS,
  DEFAULTS,
  NORMALIZADORES,
  normalizarEntradaCodice,
  ehIdSeguro,
  extrairNomeEId,
  // auxiliares compartilhados com o armazém do mestre (campanha.js)
  ATRIBUTOS,
  MAX_PILHA,
  DADO_VALIDO,
  ICONE_VALIDO,
  ehObjeto,
  inteiro,
  texto,
  normalizarItem,
  lerJson,
  gravarJson,
  trocarArquivo,
  gravarJsonAsync,
  trocarArquivoAsync,
  criarArquivosPadrao,
  criarArquivosPadraoAsync,
  carregarPersonagemDaPasta,
  carregarPersonagemDaPastaAsync,
  lerArquivosNormalizados,
  migrarPasta,
};

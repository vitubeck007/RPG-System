/* =========================================================================
   CAMPANHA: ARMAZÉM DOS DADOS DO MESTRE
   Guarda o que é do mestre e não da ficha de um jogador: inimigos, NPCs, baús e a batalha em curso.
   Tudo fica em campanha/<tipo>.json (pasta criada pelo servidor, como players/).

   Garantias (regras R6 e R7 do Sprint "Fase 2"):
     - todo dado passa por um normalizador antes de ser aceito ou gravado: tipos, tamanhos e listas
       fechadas validados, ids "seguros", campos desconhecidos descartados;
     - gravação atômica (arquivo temporário + troca) e UMA gravação por vez (fila), então duas
       alterações ao mesmo tempo nunca se perdem nem corrompem o arquivo;
     - o servidor só confirma uma alteração DEPOIS de ela estar no disco;
     - backup datado ao ligar e antes de reescrever um arquivo (mantém os 7 últimos; não repete um
       backup idêntico ao anterior), com restauração;
     - arquivo corrompido nunca é sobrescrito: vai para campanha/_corrompidos/ e o servidor avisa.

   Uso no servidor:
     const campanha = criarCampanha(pasta);  campanha.iniciar();
     campanha.aoMudar = (tipo, dados) => ...;          // avisa a sala dos mestres
     await campanha.salvarItem("npcs", { nome: "Ana" }); await campanha.removerItem("npcs", id);

   Linha de comando (com o servidor PARADO):
     node campanha.js backups              lista os backups
     node campanha.js restaurar <nome>     volta a campanha para aquele backup
   ========================================================================= */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  ATRIBUTOS,
  MAX_PILHA,
  MAX_VITAL,
  DADO_VALIDO,
  ICONE_VALIDO,
  VITAL_TYPES,
  ehIdSeguro,
  ehObjeto,
  inteiro,
  texto,
  normalizarItem,
  lerJson,
  gravarJson,
  trocarArquivo,
} = require("./personagem.js");
const { urlDeImagem } = require("./JS/regras.js");

const SCHEMA_VERSION = 1;
const MAX_BACKUPS = 7;
const TAMANHO_MAX_ITEM = 30_000; // bytes de JSON aceitos para UM item de lista (inimigo, NPC, baú)
const TAMANHO_MAX_LINHA_DE_BAU = 4_000; // bytes de JSON do item de uma linha de baú

// Catálogo de habilidades e magias (Sprint 2): mesmo armazém, mas os arquivos ficam em catalogo/
// (a ficha dos jogadores lê de lá, só as entradas públicas).
const TIPOS_CATALOGO = ["habilidades", "magias"];
// Arquivos que ficam em catalogo/ (os dois primeiros são lidos pela ficha, só os públicos; "itens" só vai
// para o jogador pelo baú, em forma de entrega).
const ARQUIVOS_NO_CATALOGO = [...TIPOS_CATALOGO, "itens"];
const TIPOS_LISTA = ["inimigos", "npcs", "baus", ...ARQUIVOS_NO_CATALOGO];
const TIPOS = [...TIPOS_LISTA, "batalha"];
const LIMITE_DE_ITENS = { inimigos: 300, npcs: 500, baus: 100, habilidades: 2000, magias: 2000, itens: 2000 };

// Erro "esperado": o servidor devolve o código e a mensagem ao mestre (qualquer outro erro vira "erro interno").
class ErroCampanha extends Error {
  constructor(codigo, mensagem) {
    super(mensagem || codigo);
    this.codigo = codigo;
    this.negocio = true;
  }
}

const novoId = (prefixo) => `${prefixo}_${crypto.randomBytes(5).toString("hex")}`;
const clonar = (valor) => JSON.parse(JSON.stringify(valor));

/* ------------------------------ normalizadores ------------------------------ */
// Cada normalizador devolve o dado limpo ou null (dado inválido). Ficam fáceis de ajustar quando
// as páginas ganharem campos (Sprints 3 a 5): campo novo = uma linha aqui.

function dataIso(valor) {
  const t = typeof valor === "string" ? Date.parse(valor) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function vitalDe(valor, maxPadrao) {
  const v = ehObjeto(valor) ? valor : {};
  const max = inteiro(v.max, 0, MAX_VITAL, maxPadrao);
  return { atual: inteiro(v.atual, 0, max, max), max };
}

function atributosOpcionais(valor) {
  const saida = {};
  if (!ehObjeto(valor)) return saida;
  for (const a of ATRIBUTOS) {
    const bruto = valor[a];
    if (bruto === undefined || bruto === null || bruto === "" || !Number.isFinite(Number(bruto))) continue;
    saida[a] = inteiro(bruto, 0, 999, 10);
  }
  return saida;
}

function listaDe(valor, max, normalizar) {
  if (!Array.isArray(valor)) return [];
  const saida = [];
  for (const bruto of valor) {
    const n = normalizar(bruto);
    if (n) saida.push(n);
    if (saida.length >= max) break;
  }
  return saida;
}

function baseDe(bruto, prefixo, nomePadrao) {
  return {
    id: ehIdSeguro(bruto.id) ? bruto.id : novoId(prefixo),
    nome: texto(bruto.nome, 80).trim() || nomePadrao,
  };
}

function datasDe(bruto) {
  return { criadoEm: dataIso(bruto.criadoEm), atualizadoEm: dataIso(bruto.atualizadoEm) };
}

function normalizarNpc(bruto) {
  if (!ehObjeto(bruto)) return null;
  return {
    ...baseDe(bruto, "npc", "NPC"),
    retrato: urlDeImagem(bruto.retrato),
    papel: texto(bruto.papel, 80).trim(),
    lore: texto(bruto.lore, 500), // mini lore
    segredo: texto(bruto.segredo, 2000), // só do mestre: nunca sai para os jogadores
    hp: vitalDe(bruto.hp, 10),
    atributos: atributosOpcionais(bruto.atributos),
    notas: texto(bruto.notas, 2000),
    ...datasDe(bruto),
  };
}

function normalizarAtaque(bruto) {
  if (!ehObjeto(bruto)) return null;
  const dado = texto(bruto.dado, 30).trim();
  return {
    nome: texto(bruto.nome, 60).trim() || "Ataque",
    dado: DADO_VALIDO.test(dado) ? dado : "",
    tipo: texto(bruto.tipo, 40).trim(),
    alcance: texto(bruto.alcance, 40).trim(),
    nota: texto(bruto.nota, 200),
  };
}

function normalizarHabilidadeResumida(bruto) {
  if (!ehObjeto(bruto)) return null;
  return {
    nome: texto(bruto.nome, 60).trim() || "Habilidade",
    nota: texto(bruto.nota, 200),
  };
}

function normalizarInimigo(bruto) {
  if (!ehObjeto(bruto)) return null;
  return {
    ...baseDe(bruto, "ini", "Inimigo"),
    imagem: urlDeImagem(bruto.imagem),
    hpMax: inteiro(bruto.hpMax, 1, MAX_VITAL, 10),
    atributos: atributosOpcionais(bruto.atributos),
    ataques: listaDe(bruto.ataques, 20, normalizarAtaque),
    habilidades: listaDe(bruto.habilidades, 20, normalizarHabilidadeResumida),
    nota: texto(bruto.nota, 2000),
    ...datasDe(bruto),
  };
}

// Item de loot (catálogo de itens e linhas de baú): só campos que a ficha conhece, com limites. O `id` é o
// TIPO do item (duas adagas têm o mesmo id); o uid de cada instância é criado pela ficha ao receber.
const COR_OU_ICONE = /^[a-z0-9-]{1,40}$/i;
function normalizarItemDeLoot(bruto) {
  if (!ehObjeto(bruto)) return null;
  const nome = texto(bruto.name, 80).trim();
  if (!nome) return null;
  const peso = Number(bruto.weight);
  const saida = {
    id: ehIdSeguro(bruto.id) ? bruto.id : novoId("itm"),
    name: nome,
    type: texto(bruto.type, 40).trim() || "Item",
    desc: texto(bruto.desc, 2000),
    weight: Number.isFinite(peso) ? Math.max(0, Math.min(Math.round(peso * 100) / 100, 100_000)) : 0,
    w: inteiro(bruto.w, 1, 10, 1),
    h: inteiro(bruto.h, 1, 10, 1),
    maxStack: inteiro(bruto.maxStack, 1, MAX_PILHA, 1),
    twoHanded: bruto.twoHanded === true,
  };
  const icone = texto(bruto.icon, 40).trim();
  if (COR_OU_ICONE.test(icone)) saida.icon = icone;
  const cor = texto(bruto.color, 40).trim();
  if (COR_OU_ICONE.test(cor)) saida.color = cor;
  const dado = texto(bruto.dice, 30).trim();
  if (DADO_VALIDO.test(dado)) saida.dice = dado;
  return saida;
}

function normalizarEntradaItem(bruto) {
  const item = normalizarItemDeLoot(bruto);
  return item && { ...item, ...datasDe(bruto) };
}

// Linha de um baú: item (cópia do catálogo, não referência) + quantidade disponível. 0 = esgotado.
function normalizarLinhaDeBau(bruto) {
  if (!ehObjeto(bruto)) return null;
  const item = normalizarItemDeLoot(bruto.item);
  if (!item || JSON.stringify(item).length > TAMANHO_MAX_LINHA_DE_BAU) return null;
  return {
    id: ehIdSeguro(bruto.id) ? bruto.id : novoId("lin"),
    item,
    quantidade: inteiro(bruto.quantidade, 0, MAX_PILHA, 1),
  };
}

const RESULTADOS_DO_BAU = ["pegou", "sem_espaco", "expirou"];
function normalizarRegistroDoBau(bruto) {
  if (!ehObjeto(bruto) || !RESULTADOS_DO_BAU.includes(bruto.resultado)) return null;
  return {
    em: dataIso(bruto.em),
    jogador: texto(bruto.jogador, 80),
    item: texto(bruto.item, 80),
    quantidade: inteiro(bruto.quantidade, 1, MAX_PILHA, 1),
    resultado: bruto.resultado,
  };
}

function normalizarBau(bruto) {
  if (!ehObjeto(bruto)) return null;
  const linhas = [];
  const vistas = new Set();
  for (const linha of listaDe(bruto.itens, 100, normalizarLinhaDeBau)) {
    if (vistas.has(linha.id)) continue;
    vistas.add(linha.id);
    linhas.push(linha);
  }
  return {
    ...baseDe(bruto, "bau", "Baú"),
    liberado: bruto.liberado === true,
    itens: linhas,
    historico: listaDe(Array.isArray(bruto.historico) ? bruto.historico.slice(-50) : [], 50, normalizarRegistroDoBau),
    ...datasDe(bruto),
  };
}

const LIMITE_COMBATENTES = 60;

// Combatente = CÓPIA do modelo no momento em que entrou na batalha (excluir ou editar o modelo depois não
// mexe nele). O servidor é a fonte da verdade do HP e do estado (R4).
function normalizarCombatente(bruto) {
  if (!ehObjeto(bruto)) return null;
  return {
    alvoId: ehIdSeguro(bruto.alvoId) ? bruto.alvoId : novoId("cb"),
    tipo: bruto.tipo === "npc" ? "npc" : "inimigo",
    modeloId: ehIdSeguro(bruto.modeloId) ? bruto.modeloId : "",
    nome: texto(bruto.nome, 80).trim() || "Combatente",
    imagem: urlDeImagem(bruto.imagem),
    hp: vitalDe(bruto.hp, 10),
    derrotado: bruto.derrotado === true,
    atributos: atributosOpcionais(bruto.atributos),
    ataques: listaDe(bruto.ataques, 20, normalizarAtaque),
    habilidades: listaDe(bruto.habilidades, 20, normalizarHabilidadeResumida),
    nota: texto(bruto.nota, 2000),
  };
}

// Entrada do catálogo. Campos que a ficha usa (nome, icon, dice, tipoDano, cost, acao, alcance, desc) +
// avançados que a ficha guarda e ignora (duracao, requisitos, descLonga, efeitos). `publico` é estrito:
// só `true` de verdade mostra a entrada aos jogadores.
function normalizarEntradaCatalogo(prefixo) {
  return (bruto) => {
    if (!ehObjeto(bruto)) return null;
    const saida = baseDe(bruto, prefixo, "Sem nome");
    const icone = texto(bruto.icon, 40).trim();
    if (ICONE_VALIDO.test(icone)) saida.icon = icone;
    const dado = texto(bruto.dice, 30).trim();
    if (DADO_VALIDO.test(dado)) saida.dice = dado;
    saida.tipoDano = texto(bruto.tipoDano, 40).trim();
    if (ehObjeto(bruto.cost)) {
      saida.cost = {
        vital: VITAL_TYPES.includes(bruto.cost.vital) ? bruto.cost.vital : "",
        amount: inteiro(bruto.cost.amount, 0, MAX_VITAL, 0),
      };
    }
    saida.acao = texto(bruto.acao, 60).trim();
    saida.alcance = texto(bruto.alcance, 60).trim();
    saida.duracao = texto(bruto.duracao, 60).trim();
    saida.requisitos = texto(bruto.requisitos, 200).trim();
    saida.desc = texto(bruto.desc, 2000);
    saida.descLonga = texto(bruto.descLonga, 4000);
    saida.efeitos = listaDe(bruto.efeitos, 10, (e) => (typeof e === "string" && e.trim() ? e.trim().slice(0, 200) : null));
    saida.publico = bruto.publico === true;
    return { ...saida, ...datasDe(bruto) };
  };
}

const NORMALIZADOR_DE_ITEM = {
  inimigos: normalizarInimigo,
  npcs: normalizarNpc,
  baus: normalizarBau,
  habilidades: normalizarEntradaCatalogo("hab"),
  magias: normalizarEntradaCatalogo("mag"),
  itens: normalizarEntradaItem,
};

// Cópia do item para entregar (sem datas); quem recebe define a quantidade.
function itemParaInventario(item) {
  const { criadoEm, atualizadoEm, ...resto } = item;
  return resto;
}

// O que o jogador vê dos baús LIBERADOS: só nome e itens disponíveis.
function bausPublicos(baus) {
  return baus
    .filter((b) => b.liberado)
    .map((b) => ({
      id: b.id,
      nome: b.nome,
      itens: b.itens
        .filter((l) => l.quantidade > 0)
        .map((l) => ({ id: l.id, nome: l.item.name, tipo: l.item.type, icone: l.item.icon || "", desc: l.item.desc, quantidade: l.quantidade })),
    }));
}

// Cópia dos objetos aninhados de uma entrada de catálogo (custo e efeitos): quem recebe a entrada pode mexer nela
// sem encostar nos dados guardados.
const copiaDosAninhados = (e) => ({
  ...e,
  ...(e.cost ? { cost: { ...e.cost } } : {}),
  ...(Array.isArray(e.efeitos) ? { efeitos: [...e.efeitos] } : {}),
});

// Como a entrada vai para a ficha (copia independente; catalogId liga a cópia à origem).
function entradaParaFicha(item) {
  const { id, publico, criadoEm, atualizadoEm, ...resto } = item;
  return { ...copiaDosAninhados(resto), catalogId: id };
}
// O que a ficha enxerga do catálogo: sem controle do mestre.
function entradaPublica(item) {
  const { publico, criadoEm, atualizadoEm, ...resto } = item;
  return copiaDosAninhados(resto);
}

// Arquivo inteiro: { schemaVersion, items: [...] } (listas) ou { schemaVersion, ativa, combatentes } (batalha).
function normalizarArquivo(tipo, bruto) {
  if (!ehObjeto(bruto)) return null;
  if (tipo === "batalha") {
    const vistos = new Set();
    const combatentes = listaDe(bruto.combatentes, LIMITE_COMBATENTES, normalizarCombatente).filter((c) => {
      if (vistos.has(c.alvoId)) return false;
      vistos.add(c.alvoId);
      return true;
    });
    return { schemaVersion: SCHEMA_VERSION, ativa: bruto.ativa === true, combatentes };
  }
  if (!Array.isArray(bruto.items)) return null;
  const vistos = new Set();
  const itens = [];
  for (const it of bruto.items) {
    const n = NORMALIZADOR_DE_ITEM[tipo](it);
    if (!n || vistos.has(n.id)) continue;
    vistos.add(n.id);
    itens.push(n);
    if (itens.length >= LIMITE_DE_ITENS[tipo]) break;
  }
  return { schemaVersion: SCHEMA_VERSION, items: itens };
}

const arquivoPadrao = (tipo) =>
  tipo === "batalha"
    ? { schemaVersion: SCHEMA_VERSION, ativa: false, combatentes: [] }
    : { schemaVersion: SCHEMA_VERSION, items: [] };

// "Visão" = o que as páginas enxergam: a lista (array) ou o objeto da batalha, sem o schemaVersion.
const visaoDe = (tipo, arquivo) =>
  tipo === "batalha" ? { ativa: arquivo.ativa, combatentes: arquivo.combatentes } : arquivo.items;
const arquivoDe = (tipo, visao) =>
  tipo === "batalha" ? { schemaVersion: SCHEMA_VERSION, ...visao } : { schemaVersion: SCHEMA_VERSION, items: visao };

/* ------------------------------ armazém ------------------------------ */
function criarCampanha(dir, { log = console, agora = () => new Date(), pastaCatalogo = dir } = {}) {
  const pastaBackups = path.join(dir, "_backup");
  const pastaCorrompidos = path.join(dir, "_corrompidos");
  const caminhoDe = (tipo) => path.join(ARQUIVOS_NO_CATALOGO.includes(tipo) ? pastaCatalogo : dir, `${tipo}.json`);

  const cache = {};
  let fila = Promise.resolve();
  const campanha = { avisos: [], aoMudar: null };

  const exigirTipo = (tipo) => {
    if (!TIPOS.includes(tipo)) throw new ErroCampanha("tipo_invalido", "Tipo de dado desconhecido.");
  };
  const exigirLista = (tipo) => {
    if (!TIPOS_LISTA.includes(tipo)) throw new ErroCampanha("tipo_invalido", "Este tipo não é uma lista.");
  };

  // Uma tarefa por vez, na ordem em que chegaram; um erro numa tarefa não trava as seguintes.
  function enfileirar(tarefa) {
    const execucao = fila.then(() => tarefa());
    fila = execucao.catch(() => {});
    return execucao;
  }

  const carimbo = () => {
    const d = agora();
    const p = (n, t = 2) => String(n).padStart(t, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  /* ---- backup ---- */
  const arquivosDeDados = () => TIPOS.filter((t) => fs.existsSync(caminhoDe(t))); // tipos que têm arquivo

  campanha.listarBackups = () => {
    if (!fs.existsSync(pastaBackups)) return [];
    return fs
      .readdirSync(pastaBackups, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse(); // do mais novo para o mais antigo (o nome começa pela data)
  };

  function backupIgualAoAtual(nome, tipos) {
    const pasta = path.join(pastaBackups, nome);
    const guardados = fs.readdirSync(pasta).filter((f) => f.endsWith(".json")).sort();
    if (guardados.join("|") !== tipos.map((t) => `${t}.json`).sort().join("|")) return false;
    return tipos.every((t) => fs.readFileSync(caminhoDe(t), "utf8") === fs.readFileSync(path.join(pasta, `${t}.json`), "utf8"));
  }

  // Devolve o nome do backup criado, ou null (nada para guardar ou idêntico ao último).
  campanha.backup = (motivo = "manual") => {
    const arquivos = arquivosDeDados();
    if (arquivos.length === 0) return null;
    const ultimo = campanha.listarBackups()[0];
    if (ultimo && backupIgualAoAtual(ultimo, arquivos)) return null;

    const base = `${carimbo()}_${String(motivo).replace(/[^\w-]/g, "")}`;
    let nome = base;
    for (let n = 2; fs.existsSync(path.join(pastaBackups, nome)); n++) nome = `${base}_${n}`;
    const destino = path.join(pastaBackups, nome);
    fs.mkdirSync(destino, { recursive: true });
    for (const t of arquivos) fs.copyFileSync(caminhoDe(t), path.join(destino, `${t}.json`));

    for (const antigo of campanha.listarBackups().slice(MAX_BACKUPS)) {
      fs.rmSync(path.join(pastaBackups, antigo), { recursive: true, force: true });
    }
    log.log(`[CAMPANHA] Backup criado: ${nome}`);
    return nome;
  };

  /* ---- carga ---- */
  function carregarArquivo(tipo, { reescrever = true } = {}) {
    const caminho = caminhoDe(tipo);
    if (!fs.existsSync(caminho)) {
      cache[tipo] = arquivoPadrao(tipo);
      return;
    }
    let bruto;
    let normalizado = null;
    try {
      bruto = lerJson(caminho);
      // Catálogo escrito à mão antes do campo `publico` existir: os jogadores já o viam, então segue público.
      if (TIPOS_CATALOGO.includes(tipo) && Array.isArray(bruto?.items)) {
        for (const it of bruto.items) if (ehObjeto(it) && !("publico" in it)) it.publico = true;
        // O id liga a ficha ao catálogo: entrada de arquivo sem id válido é ignorada, como sempre foi.
        bruto.items = bruto.items.filter((it) => ehObjeto(it) && ehIdSeguro(it.id));
      }
      normalizado = normalizarArquivo(tipo, bruto);
    } catch {
      normalizado = null;
    }
    if (!normalizado) {
      // Não sobrescreve: guarda o arquivo estragado à parte e começa vazio, avisando.
      fs.mkdirSync(pastaCorrompidos, { recursive: true });
      const destino = path.join(pastaCorrompidos, `${tipo}_${carimbo()}.json`);
      trocarArquivo(caminho, destino);
      const aviso = `campanha/${tipo}.json estava corrompido e foi movido para campanha/_corrompidos/. Restaure um backup, se precisar.`;
      campanha.avisos.push(aviso);
      log.warn(`[CAMPANHA] ${aviso}`);
      cache[tipo] = arquivoPadrao(tipo);
      return;
    }
    // Arquivo editado à mão ou de versão antiga: guarda o original num backup e grava a versão limpa.
    if (reescrever && JSON.stringify(normalizado) !== JSON.stringify(bruto)) {
      campanha.backup("normalizacao");
      gravarJson(caminho, normalizado);
      log.log(`[CAMPANHA] ${tipo}.json foi normalizado.`);
    }
    cache[tipo] = normalizado;
  }

  campanha.iniciar = () => {
    fs.mkdirSync(dir, { recursive: true });
    campanha.avisos = [];
    for (const tipo of TIPOS) carregarArquivo(tipo);
    // Com arquivo corrompido o estado atual está INCOMPLETO: não vira backup (senão empurraria o backup bom
    // para fora da rotação de 7). Os backups existentes ficam intactos para a restauração.
    if (campanha.avisos.length === 0) campanha.backup("inicio");
    return campanha;
  };

  /* ---- leitura e escrita ---- */
  campanha.ler = (tipo) => {
    exigirTipo(tipo);
    return clonar(visaoDe(tipo, cache[tipo]));
  };

  // Leitura SEM cópia, só para consulta interna do servidor (achar um item, montar uma resposta nova). Quem recebe
  // a referência NÃO pode alterá-la nem guardá-la: para alterar use `atualizar`; para entregar a alguém use `ler`.
  campanha.ver = (tipo) => {
    exigirTipo(tipo);
    return visaoDe(tipo, cache[tipo]);
  };

  campanha.lerTudo = () => Object.fromEntries(TIPOS.map((t) => [t, campanha.ler(t)]));

  /**
   * Lê, altera e grava dentro da fila (ninguém grava no meio). `alterar` recebe a visão atual (lista ou
   * objeto da batalha) e devolve a nova (ou altera a recebida e não devolve nada). O resultado é
   * normalizado; só depois de gravar no disco o cache muda e a promessa se resolve.
   */
  campanha.atualizar = (tipo, alterar) => {
    exigirTipo(tipo);
    return enfileirar(async () => {
      const atual = clonar(visaoDe(tipo, cache[tipo]));
      const nova = await alterar(atual);
      const arquivo = normalizarArquivo(tipo, arquivoDe(tipo, nova === undefined ? atual : nova));
      if (!arquivo) throw new ErroCampanha("dados_invalidos", "Dados inválidos.");
      fs.mkdirSync(path.dirname(caminhoDe(tipo)), { recursive: true });
      gravarJson(caminhoDe(tipo), arquivo);
      cache[tipo] = arquivo;
      const dados = clonar(visaoDe(tipo, arquivo));
      campanha.aoMudar?.(tipo, dados);
      return dados;
    });
  };

  // Cria (sem id, ou id novo) ou substitui (id existente) um item de lista. Devolve o item como ficou.
  campanha.salvarItem = async (tipo, bruto) => {
    exigirLista(tipo);
    if (!ehObjeto(bruto)) throw new ErroCampanha("item_invalido", "Item inválido.");
    if (JSON.stringify(bruto).length > TAMANHO_MAX_ITEM) throw new ErroCampanha("item_grande", "Item grande demais.");
    let idSalvo = null;
    const itens = await campanha.atualizar(tipo, (itens) => {
      // as datas são do servidor: o que o cliente mandar é ignorado
      const item = NORMALIZADOR_DE_ITEM[tipo]({ ...bruto, criadoEm: undefined, atualizadoEm: undefined });
      if (!item) throw new ErroCampanha("item_invalido", "Item inválido (confira o nome).");
      const posicao = itens.findIndex((x) => x.id === item.id);
      const instante = agora().toISOString();
      if (posicao >= 0) {
        item.criadoEm = itens[posicao].criadoEm;
        item.atualizadoEm = instante;
        itens[posicao] = item;
      } else {
        if (itens.length >= LIMITE_DE_ITENS[tipo]) {
          throw new ErroCampanha("limite_atingido", `Limite de ${LIMITE_DE_ITENS[tipo]} itens atingido.`);
        }
        item.criadoEm = item.atualizadoEm = instante;
        itens.push(item);
      }
      idSalvo = item.id;
      return itens;
    });
    return itens.find((x) => x.id === idSalvo); // como ficou gravado
  };

  campanha.removerItem = async (tipo, id) => {
    exigirLista(tipo);
    if (!ehIdSeguro(id)) throw new ErroCampanha("id_invalido", "Id inválido.");
    let removido = false;
    await campanha.atualizar(tipo, (itens) => {
      const restantes = itens.filter((x) => x.id !== id);
      removido = restantes.length !== itens.length;
      return restantes;
    });
    return removido;
  };

  /* ---- baús: reserva, devolução e histórico (tudo atômico, dentro da fila) ---- */
  // Tira `quantidade` da disponibilidade (ninguém mais leva). Só de baú liberado. Devolve a cópia do item.
  campanha.reservarDoBau = async (bauId, linhaId, quantidade) => {
    let item = null;
    await campanha.atualizar("baus", (baus) => {
      const bau = baus.find((b) => b.id === bauId);
      const linha = bau?.liberado ? bau.itens.find((l) => l.id === linhaId) : null;
      if (!linha) throw new ErroCampanha("bau_indisponivel", "Esse baú ou item não está disponível.");
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > linha.quantidade) {
        throw new ErroCampanha("indisponivel", linha.quantidade > 0 ? `Só há ${linha.quantidade} disponível.` : "Esse item acabou.");
      }
      linha.quantidade -= quantidade;
      item = clonar(linha.item);
      return baus;
    });
    return item;
  };

  // Devolve ao baú (reserva recusada/expirada). Se o baú ou a linha sumiram, não faz nada.
  campanha.devolverAoBau = async (bauId, linhaId, quantidade, registro = null) => {
    let devolvido = false;
    await campanha.atualizar("baus", (baus) => {
      const bau = baus.find((b) => b.id === bauId);
      const linha = bau?.itens.find((l) => l.id === linhaId);
      if (linha) {
        linha.quantidade = Math.min(MAX_PILHA, linha.quantidade + quantidade);
        devolvido = true;
      }
      if (bau && registro) bau.historico.push({ em: agora().toISOString(), quantidade, ...registro });
      return baus;
    });
    return devolvido;
  };

  campanha.registrarNoBau = (bauId, registro) =>
    campanha.atualizar("baus", (baus) => {
      baus.find((b) => b.id === bauId)?.historico.push({ em: agora().toISOString(), ...registro });
      return baus;
    });

  /* ---- restauração ---- */
  // Volta a campanha para o estado de um backup. Antes, guarda o estado atual (dá para desfazer).
  campanha.restaurar = (nome) =>
    enfileirar(async () => {
      if (typeof nome !== "string" || !/^[\w-]+$/.test(nome)) throw new ErroCampanha("backup_invalido", "Nome de backup inválido.");
      const origem = path.join(pastaBackups, nome);
      if (!fs.existsSync(origem)) throw new ErroCampanha("backup_inexistente", "Esse backup não existe.");

      campanha.backup("antes-de-restaurar");
      fs.mkdirSync(dir, { recursive: true });
      for (const tipo of TIPOS) {
        const de = path.join(origem, `${tipo}.json`);
        const para = caminhoDe(tipo);
        if (fs.existsSync(de)) {
          fs.copyFileSync(de, `${para}.tmp`);
          trocarArquivo(`${para}.tmp`, para);
        } else if (fs.existsSync(para) && !ARQUIVOS_NO_CATALOGO.includes(tipo)) {
          fs.rmSync(para); // não existia naquele backup (o catálogo nunca é apagado: backups antigos não o tinham)
        }
      }
      for (const tipo of TIPOS) carregarArquivo(tipo, { reescrever: false });
      for (const tipo of TIPOS) campanha.aoMudar?.(tipo, clonar(visaoDe(tipo, cache[tipo])));
      log.log(`[CAMPANHA] Restaurado o backup ${nome}.`);
    });

  for (const tipo of TIPOS) cache[tipo] = arquivoPadrao(tipo);
  return campanha;
}

/* ------------------------------ linha de comando ------------------------------ */
if (require.main === module) {
  const pasta = process.env.CAMPANHA_DIR || path.join(__dirname, "campanha");
  const pastaDoCatalogo = process.env.CATALOGO_DIR || path.join(__dirname, "catalogo"); // habilidades, magias e itens
  const [comando, argumento] = process.argv.slice(2);
  const c = criarCampanha(pasta, { pastaCatalogo: pastaDoCatalogo });
  c.iniciar();
  if (comando === "backups") {
    const lista = c.listarBackups();
    console.log(lista.length ? lista.join("\n") : "Nenhum backup ainda.");
  } else if (comando === "restaurar" && argumento) {
    c.restaurar(argumento).then(
      () => console.log(`Restaurado: ${argumento}. (O estado anterior foi guardado como backup "antes-de-restaurar".)`),
      (erro) => {
        console.error(`Não foi possível restaurar: ${erro.message}`);
        process.exitCode = 1;
      },
    );
  } else {
    console.log("Uso (com o servidor parado):\n  node campanha.js backups\n  node campanha.js restaurar <nome-do-backup>");
  }
}

module.exports = {
  criarCampanha,
  ErroCampanha,
  LIMITE_DE_ITENS,
  SCHEMA_VERSION,
  MAX_BACKUPS,
  normalizarArquivo,
  normalizarNpc,
  normalizarInimigo,
  normalizarBau,
  normalizarEntradaCatalogo,
  TIPOS_CATALOGO,
  entradaParaFicha,
  entradaPublica,
  itemParaInventario,
  LIMITE_COMBATENTES,
  bausPublicos,
  normalizarItemDeLoot,
};

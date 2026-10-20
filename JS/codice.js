/* =========================================================================
   CÓDICE: MAGIAS E HABILIDADES
   Entradas da ficha, modal de criar/editar, catálogo global com busca e remoção.
   ========================================================================= */

/* =========================================================================
   CÓDICE (Sprint 5): magias e habilidades
   Mesmo modelo de entrada para os dois (ver normalizarEntradaCodice em personagem.js).
   - STATE.abilities / STATE.spells guardam as entradas da ficha (habilidades.json / magias.json);
   - o catálogo global fica no servidor (catalogo/*.json) e é consultado em /api/catalogo/:tipo;
   - toda alteração passa pelo salvamento central (salvarHabilidades / salvarMagias).
   ========================================================================= */
const CODICE_MAX = 500; // mesmo limite do servidor (MAX_LISTA)
const CODICE_DADO = /^\d{0,3}d\d{1,4}\s*([+-]\s*\d{1,4})?$/i; // igual ao servidor
const COR_VITAL = {
  hp: "text-crimson-400",
  vigor: "text-vigor-400",
  sanity: "text-sanity-400",
};
const CLASSE_BOTAO_ATIVO =
  "bg-dungeon-800 text-amberGold-400 border-amberGold-500/40 shadow";
const CLASSE_BOTAO_INATIVO =
  "text-slate-400 border-dungeon-700 hover:text-slate-200 hover:bg-dungeon-800";

const CODICE_TIPOS = {
  habilidades: {
    rotulo: "Habilidade",
    plural: "Habilidades",
    novaRotulo: "Nova Habilidade",
    container: "abilities-container",
    vazio: "Nenhuma habilidade cadastrada no códice.",
    origem: "códice",
    tipoCombo: "habilidade",
    iconePadrao: "fa-bolt",
    lista: () => STATE.abilities,
    definir: (lista) => {
      STATE.abilities = lista;
    },
    salvar: () => salvarHabilidades({ imediato: true }),
  },
  magias: {
    rotulo: "Magia",
    plural: "Magias",
    novaRotulo: "Nova Magia",
    container: "spells-container",
    vazio: "Nenhuma magia no grimório.",
    origem: "grimório",
    tipoCombo: "magia",
    iconePadrao: "fa-wand-magic-sparkles",
    lista: () => STATE.spells,
    definir: (lista) => {
      STATE.spells = lista;
    },
    salvar: () => salvarMagias({ imediato: true }),
  },
};

// Estado só da interface (não é salvo).
const CODICE_UI = {
  tipo: "habilidades", // sub-aba aberta
  filtro: "todos", // só apresentação; o tipo de criação continua explícito no editor
  modo: "catalogo", // modo do modal: "catalogo" | "criar"
  catalogo: { habilidades: null, magias: null }, // cache: lista ou null
  carregando: false,
  erroCatalogo: "",
  rascunhos: {}, formularioTipo: null, editando: null,
};
const CAMPOS_RASCUNHO_CODICE = ["nome", "dados", "dano", "acao", "alcance", "desc", "custo-vital", "custo-valor", "icone"];
function guardarRascunhoCodice() {
  if (CODICE_UI.editando || CODICE_UI.modo !== "criar" || !CODICE_UI.formularioTipo) return;
  CODICE_UI.rascunhos[CODICE_UI.formularioTipo] = Object.fromEntries(CAMPOS_RASCUNHO_CODICE.map(nome =>
    [nome, document.getElementById(`codice-f-${nome}`)?.value || ""]));
}
function restaurarRascunhoCodice() {
  limparFormularioCodice();
  const rascunho = CODICE_UI.rascunhos[CODICE_UI.tipo];
  if (rascunho) CAMPOS_RASCUNHO_CODICE.forEach(nome => {
    const campo = document.getElementById(`codice-f-${nome}`);
    if (campo) campo.value = rascunho[nome] ?? "";
  });
  CODICE_UI.formularioTipo = CODICE_UI.tipo;
}
function temRascunhoPoder() {
  if (CODICE_UI.editando && CODICE_UI.editando.assinatura !== assinaturaFormularioCodice()) return true;
  guardarRascunhoCodice();
  return Object.values(CODICE_UI.rascunhos).some(r => r &&
    (["nome", "dados", "dano", "acao", "alcance", "desc", "custo-vital"].some(nome => r[nome]?.trim()) || Number(r["custo-valor"]) > 0));
}

function ehEntradaCodice(entrada) {
  return entrada && typeof entrada === "object" && !Array.isArray(entrada);
}

function listaCodice(tipo) {
  const lista = CODICE_TIPOS[tipo].lista();
  return Array.isArray(lista) ? lista : [];
}

function nomeDaEntradaCodice(entrada, padrao) {
  return entrada.nome || entrada.name || padrao;
}

function novoUidCodice() {
  const aleatorio = (
    globalThis.crypto?.randomUUID?.() ||
    `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  )
    .replace(/-/g, "")
    .slice(0, 10);
  return `cx_${aleatorio}`;
}

// Aceita o formato novo (cost: { vital, amount }) e os antigos (custo / cost em texto).
/* ------------------------------- renderização ------------------------------- */
function renderizarCodice() {
  Object.keys(CODICE_TIPOS).forEach(renderizarCartasCodice);
  atualizarSubAbasCodice();
}

function atualizarSubAbasCodice() {
  Object.entries(CODICE_TIPOS).forEach(([tipo, cfg]) => {
    const ativo = tipo === CODICE_UI.filtro;
    const botao = document.getElementById(`codice-sub-${tipo}`);
    if (botao) {
      const total = listaCodice(tipo).filter(ehEntradaCodice).length;
      botao.textContent = `${cfg.plural} (${total})`;
      botao.className = "rpg-tab";
      botao.setAttribute("aria-pressed", String(ativo));
    }
    const visivel = ativo || CODICE_UI.filtro === "todos";
    document.getElementById(cfg.container)?.classList.toggle("hidden", !visivel);
    document.getElementById(`codice-secao-${tipo}`)?.classList.toggle("hidden", !visivel);
  });
  const todos = document.getElementById("codice-sub-todos");
  if (todos) {
    todos.textContent = `Todos (${listaCodice("habilidades").length + listaCodice("magias").length})`;
    todos.setAttribute("aria-pressed", String(CODICE_UI.filtro === "todos"));
  }
  const rotuloCriar = document.getElementById("codice-btn-criar-rotulo");
  if (rotuloCriar) rotuloCriar.textContent = CODICE_UI.filtro === "todos" ? "Criar poder" : CODICE_TIPOS[CODICE_UI.tipo].novaRotulo;
}

function trocarSubAbaCodice(tipo) {
  if (tipo !== "todos" && !Object.hasOwn(CODICE_TIPOS, tipo)) return;
  CODICE_UI.filtro = tipo;
  if (tipo !== "todos") CODICE_UI.tipo = tipo;
  renderizarCodice();
}

function definirTipoEdicaoCodice(tipo) {
  if (CODICE_UI.editando) return;
  if (!Object.hasOwn(CODICE_TIPOS, tipo)) return;
  guardarRascunhoCodice();
  CODICE_UI.tipo = tipo;
  const seletor = document.getElementById("codice-tipo-entrada");
  if (seletor) seletor.value = tipo;
  if (CODICE_UI.filtro !== "todos") CODICE_UI.filtro = tipo;
  atualizarSubAbasCodice();
  const cfg = CODICE_TIPOS[tipo];
  const titulo = document.querySelector("#codice-modal-titulo span");
  if (titulo) titulo.textContent = CODICE_UI.modo === "catalogo" ? `Catálogo de ${cfg.plural}` : cfg.novaRotulo;
  // Trocar o tipo não limpa o texto que o jogador já digitou.
  if (CODICE_UI.modo === "catalogo") carregarCatalogoCodice(tipo);
  else CODICE_UI.formularioTipo = tipo;
}

function renderizarCartasCodice(tipo) {
  const cfg = CODICE_TIPOS[tipo];
  const container = document.getElementById(cfg.container);
  if (!container) return;

  container.replaceChildren();
  const entradas = listaCodice(tipo).filter(ehEntradaCodice);
  if (entradas.length === 0) {
    container.appendChild(
      elTexto(
        "div",
        "col-span-full py-8 text-center text-slate-500 font-mono text-xs italic",
        cfg.vazio,
      ),
    );
    return;
  }
  entradas.forEach((entrada) =>
    container.appendChild(criarCartaCodice(tipo, entrada)),
  );
}

function criarCartaCodice(tipo, hab) {
  const cfg = CODICE_TIPOS[tipo];
  const nome = nomeDaEntradaCodice(hab, cfg.rotulo);

  const card = elTexto(
    "div",
    "bg-dungeon-800/90 border border-dungeon-700 hover:border-amberGold-500/70 rounded-xl p-4 transition-all duration-200 flex flex-col justify-between shadow-lg group",
  );
  const conteudo = document.createElement("div");
  card.classList.add("sheet-power-card");
  card.dataset.tipo = tipo;
  const identificador = elTexto("span", "sheet-power-tag", cfg.rotulo);
  identificador.dataset.tipo = tipo;
  conteudo.appendChild(identificador);

  const cabecalho = elTexto("div", "flex justify-between items-start gap-2");
  const titulo = elTexto(
    "h3",
    "font-cinzel text-base font-bold text-amberGold-300 group-hover:text-amberGold-400 transition flex items-center gap-2",
  );
  const icone = document.createElement("i");
  icone.setAttribute("aria-hidden", "true");
  const nomeIcone = /^[a-z0-9-]+$/i.test(hab.icon || "")
    ? hab.icon
    : cfg.iconePadrao;
  icone.className = `fa-solid ${nomeIcone} text-amberGold-500`;
  titulo.append(icone, document.createTextNode(nome));
  cabecalho.appendChild(titulo);

  if (hab.dice) {
    cabecalho.appendChild(
      elTexto(
        "span",
        "text-[10px] font-mono font-bold px-2 py-0.5 bg-crimson-950/80 border border-crimson-700/60 text-crimson-400 rounded",
        `${hab.dice}${hab.tipoDano ? ` ${hab.tipoDano}` : ""}`,
      ),
    );
  }
  conteudo.appendChild(cabecalho);

  const custo = custoDaEntrada(hab);
  const linhaInfo = elTexto(
    "div",
    "flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-1",
  );
  const custoTexto = elTexto("span");
  custoTexto.append(
    "Custo: ",
    elTexto("strong", COR_VITAL[custo.vital] || "text-vigor-400", custo.texto),
  );
  linhaInfo.append(
    custoTexto,
    elTexto("span", "", "•"),
    elTexto("span", "", hab.acao || "Ação"),
  );
  conteudo.appendChild(linhaInfo);

  conteudo.appendChild(elTexto("hr", "my-3 border-dungeon-600/60"));
  conteudo.appendChild(
    elTexto(
      "p",
      "text-xs text-slate-300 leading-relaxed",
      hab.desc || hab.descricao || "",
    ),
  );
  card.appendChild(conteudo);

  const rodape = elTexto(
    "div",
    "mt-4 pt-3 border-t border-dungeon-700/50 flex justify-between items-center gap-2",
  );
  rodape.appendChild(
    elTexto(
      "span",
      "text-[10px] text-slate-500 font-mono",
      `Alcance: ${hab.alcance || "Toque"}`,
    ),
  );

  const acoes = elTexto("div", "flex items-center gap-2");
  const editar = elTexto('button', 'rpg-btn rpg-btn--quiet', 'Editar');
  editar.type = 'button';
  editar.setAttribute('aria-label', `Editar ${nome} na sua ficha`);
  editar.addEventListener('click', () => editarEntradaCodice(tipo, hab));
  acoes.append(editar);
  acoes.appendChild(criarBotaoRemoverCodice(tipo, hab));
  if (hab.dice) {
    const botao = elTexto(
      "button",
      "px-3 py-1.5 bg-dungeon-700 hover:bg-amberGold-600 hover:text-black text-amberGold-400 font-cinzel font-bold text-xs rounded transition flex items-center gap-1 shadow",
    );
    botao.type = "button";
    const mais = document.createElement("i");
    mais.setAttribute("aria-hidden", "true");
    mais.className = "fa-solid fa-plus-circle";
    botao.append(mais, document.createTextNode("Adicionar ao Combo"));
    botao.addEventListener("click", () =>
      adicionarAoCombo(nome, String(hab.dice), cfg.tipoCombo, cfg.origem),
    );
    acoes.appendChild(botao);
  }
  rodape.appendChild(acoes);

  card.appendChild(rodape);
  return card;
}

// Remover pede um segundo clique em até 3 s (sem janela de confirmação do navegador).
function criarBotaoRemoverCodice(tipo, hab) {
  const base = "px-2 py-1.5 text-xs rounded transition flex items-center gap-1 border ";
  const normal = `${base}border-dungeon-700 text-slate-500 hover:text-crimson-400 hover:border-crimson-700`;
  const confirmar = `${base}border-crimson-600 bg-crimson-700/30 text-crimson-400`;

  const botao = elTexto("button", normal);
  botao.type = "button";
  botao.title = "Remover";
  botao.setAttribute("aria-label", `Remover ${nomeDaEntradaCodice(hab, CODICE_TIPOS[tipo].rotulo)}`);
  const icone = document.createElement("i");
  icone.className = "fa-solid fa-trash";
  icone.setAttribute("aria-hidden", "true");
  botao.append(icone);

  let timer = null;
  botao.addEventListener("click", () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      removerEntradaCodice(tipo, hab);
      return;
    }
    botao.className = confirmar;
    botao.replaceChildren(icone, document.createTextNode("Confirmar?"));
    timer = setTimeout(() => {
      timer = null;
      botao.className = normal;
      botao.replaceChildren(icone);
    }, 3000);
  });
  return botao;
}

/* ------------------------- adicionar / remover (salvamento central) ------------------------- */
function adicionarEntradaCodice(tipo, entrada, mensagem = null) {
  const cfg = CODICE_TIPOS[tipo];
  cfg.definir([...listaCodice(tipo), entrada]);
  cfg.salvar();
  registrarNoTerminal(`${cfg.rotulo} adicionada`, {
    nome: nomeDaEntradaCodice(entrada, cfg.rotulo),
    origem: entrada.catalogId ? `catálogo (${entrada.catalogId})` : "criada na ficha",
  });
  renderizarCodice();
  renderizarResultadosCatalogo();
  toast(mensagem ?? `${cfg.rotulo} adicionada: ${nomeDaEntradaCodice(entrada, cfg.rotulo)}`, "info");
}

function removerEntradaCodice(tipo, entrada) {
  const cfg = CODICE_TIPOS[tipo];
  const nome = nomeDaEntradaCodice(entrada, cfg.rotulo);
  cfg.definir(listaCodice(tipo).filter((item) => item !== entrada));
  cfg.salvar();
  registrarNoTerminal(`${cfg.rotulo} removida`, { nome });
  renderizarCodice();
  renderizarResultadosCatalogo();
  toast(`${cfg.rotulo} removida: ${nome}`, "info");
}

function codiceCheio(tipo) {
  if (listaCodice(tipo).length < CODICE_MAX) return false;
  toast(`Limite de ${CODICE_MAX} entradas atingido.`, "error");
  return true;
}

function adicionarDoCatalogo(tipo, entrada) {
  const cfg = CODICE_TIPOS[tipo];
  if (listaCodice(tipo).some((item) => item?.catalogId === entrada.id)) {
    toast(`${cfg.rotulo} já está na sua ficha.`, "error");
    return;
  }
  if (codiceCheio(tipo)) return;
  // Cópia independente: editar a ficha não altera o catálogo (e vice-versa).
  const { id, ...resto } = JSON.parse(JSON.stringify(entrada));
  adicionarEntradaCodice(tipo, { ...resto, catalogId: id, uid: novoUidCodice() });
}

function criarEntradaCodice() {
  const tipo = CODICE_UI.tipo;
  const cfg = CODICE_TIPOS[tipo];
  const valor = (id) => document.getElementById(id)?.value.trim() ?? "";
  const mostrarErro = (mensagem) => {
    const el = document.getElementById("codice-f-erro");
    if (!el) return;
    el.textContent = mensagem;
    el.classList.remove("hidden");
  };

  const nome = valor("codice-f-nome");
  if (!nome) return mostrarErro("Informe um nome.");
  const dados = valor("codice-f-dados");
  if (dados && !CODICE_DADO.test(dados)) {
    return mostrarErro("Dados inválidos. Use o formato 2d6 ou 2d6+1.");
  }
  const edicao = CODICE_UI.editando;
  if (!edicao && codiceCheio(tipo)) return;
  const original = edicao && listaCodice(tipo).find(item => item === edicao.original || (item.uid && item.uid === edicao.original.uid));
  if (edicao && !original) return mostrarErro('Esta entrada não está mais na ficha. Feche o editor e atualize.');

  const entrada = {
    ...(original || {}),
    uid: original?.uid || novoUidCodice(),
    nome,
    icon: valor("codice-f-icone") || cfg.iconePadrao,
  };
  // Só os campos expostos são substituídos; efeitos e metadados da cópia permanecem.
  ['dice', 'tipoDano', 'acao', 'alcance', 'desc', 'descricao'].forEach(chave => delete entrada[chave]);
  if (dados) entrada.dice = dados;
  const dano = valor("codice-f-dano");
  if (dano) entrada.tipoDano = dano;
  const vital = valor("codice-f-custo-vital");
  const custoMudou = !edicao || edicao.custoInicial !== JSON.stringify([vital, valor('codice-f-custo-valor')]);
  if (custoMudou) { delete entrada.cost; delete entrada.custo; }
  if (custoMudou && ROTULO_VITAL[vital]) {
    const amount = Math.max(0, Math.min(999, Math.round(Number(valor("codice-f-custo-valor"))) || 0));
    entrada.cost = { vital, amount };
  }
  const acao = valor("codice-f-acao");
  if (acao) entrada.acao = acao;
  const alcance = valor("codice-f-alcance");
  if (alcance) entrada.alcance = alcance;
  const desc = valor("codice-f-desc");
  if (desc) entrada.desc = desc;

  if (edicao) {
    cfg.definir(listaCodice(tipo).map(item => item === original ? entrada : item));
    cfg.salvar(); renderizarCodice();
    registrarNoTerminal(`${cfg.rotulo} editada na ficha`, { nome, uid: entrada.uid });
    toast(`${cfg.rotulo} atualizada na sua ficha.`, 'info');
  } else {
    adicionarEntradaCodice(tipo, entrada);
    delete CODICE_UI.rascunhos[tipo];
  }
  CODICE_UI.editando = null;
  CODICE_UI.formularioTipo = null;
  fecharModalCodice();
}

/* ---------------------------------- modal ---------------------------------- */
function assinaturaFormularioCodice() {
  return JSON.stringify(CAMPOS_RASCUNHO_CODICE.map(nome => document.getElementById(`codice-f-${nome}`)?.value));
}

function editarEntradaCodice(tipo, entrada) {
  if (!personagemCarregado) return;
  guardarRascunhoCodice();
  CODICE_UI.tipo = tipo;
  abrirModalCodice('criar');
  CODICE_UI.editando = { tipo, original: entrada };
  const custo = custoDaEntrada(entrada);
  const valores = { nome: nomeDaEntradaCodice(entrada, ''), dados: entrada.dice, dano: entrada.tipoDano,
    acao: entrada.acao, alcance: entrada.alcance, desc: entrada.desc || entrada.descricao,
    'custo-vital': custo.vital || '', 'custo-valor': entrada.cost?.amount || 0, icone: entrada.icon || CODICE_TIPOS[tipo].iconePadrao };
  Object.entries(valores).forEach(([nome, valor]) => {
    const campo = document.getElementById(`codice-f-${nome}`);
    // Entradas legadas podem ter um ícone que não está entre as opções fixas.
    if (campo.tagName === 'SELECT' && valor && ![...campo.options].some(o => o.value === String(valor))) campo.add(new Option(String(valor), String(valor)));
    campo.value = valor ?? '';
  });
  CODICE_UI.editando.assinatura = assinaturaFormularioCodice();
  CODICE_UI.editando.custoInicial = JSON.stringify([document.getElementById('codice-f-custo-vital').value, document.getElementById('codice-f-custo-valor').value]);
  document.querySelector('#codice-modal-titulo span').textContent = `Editar ${CODICE_TIPOS[tipo].rotulo} da ficha`;
  document.getElementById('codice-confirmar').textContent = 'Salvar alterações';
  ['codice-tipo-entrada', 'codice-modo-catalogo', 'codice-modo-criar'].forEach(id => { document.getElementById(id).disabled = true; });
}

function abrirModalCodice(modo = "catalogo") {
  if (!personagemCarregado) {
    toast("Carregue um personagem antes de editar o grimório.", "error");
    return;
  }
  document.getElementById("codice-modal")?.classList.remove("hidden");
  RPGUI.abrirModal("codice-modal", "codice-tipo-entrada");
  definirModoCodice(modo);
}

function fecharModalCodice() {
  if (CODICE_UI.editando && CODICE_UI.editando.assinatura !== assinaturaFormularioCodice()
    && !window.confirm('Descartar as alterações deste poder? Cancelar mantém a edição.')) return;
  guardarRascunhoCodice();
  if (CODICE_UI.editando) CODICE_UI.formularioTipo = null;
  CODICE_UI.editando = null;
  ['codice-tipo-entrada', 'codice-modo-catalogo', 'codice-modo-criar'].forEach(id => { document.getElementById(id).disabled = false; });
  RPGUI.fecharModal("codice-modal");
  document.getElementById("codice-modal")?.classList.add("hidden");
}

function definirModoCodice(modo) {
  if (CODICE_UI.editando) return;
  guardarRascunhoCodice();
  CODICE_UI.modo = modo === "criar" ? "criar" : "catalogo";
  const cfg = CODICE_TIPOS[CODICE_UI.tipo];
  const noCatalogo = CODICE_UI.modo === "catalogo";
  document.getElementById('codice-confirmar').textContent = 'Adicionar';
  const tipoEntrada = document.getElementById("codice-tipo-entrada");
  if (tipoEntrada) tipoEntrada.value = CODICE_UI.tipo;

  const titulo = document.querySelector("#codice-modal-titulo span");
  if (titulo) {
    titulo.textContent = noCatalogo ? `Catálogo de ${cfg.plural}` : cfg.novaRotulo;
  }
  document.getElementById("codice-painel-catalogo")?.classList.toggle("hidden", !noCatalogo);
  document.getElementById("codice-painel-criar")?.classList.toggle("hidden", noCatalogo);
  [["catalogo", noCatalogo], ["criar", !noCatalogo]].forEach(([nome, ativo]) => {
    const botao = document.getElementById(`codice-modo-${nome}`);
    if (botao) {
      botao.className = `px-3 py-1 text-xs font-cinzel font-bold rounded border transition ${
        ativo ? CLASSE_BOTAO_ATIVO : CLASSE_BOTAO_INATIVO
      }`;
    }
  });

  if (noCatalogo) {
    carregarCatalogoCodice(CODICE_UI.tipo);
    renderizarResultadosCatalogo();
    setTimeout(() => document.getElementById("codice-busca")?.focus(), 0);
  } else {
    restaurarRascunhoCodice();
    setTimeout(() => document.getElementById("codice-f-nome")?.focus(), 0);
  }
}

function limparFormularioCodice() {
  [
    "codice-f-nome",
    "codice-f-dados",
    "codice-f-dano",
    "codice-f-acao",
    "codice-f-alcance",
    "codice-f-desc",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const vital = document.getElementById("codice-f-custo-vital");
  if (vital) vital.value = "";
  const valor = document.getElementById("codice-f-custo-valor");
  if (valor) valor.value = "0";
  const icone = document.getElementById("codice-f-icone");
  if (icone) icone.value = CODICE_TIPOS[CODICE_UI.tipo].iconePadrao;
  document.getElementById("codice-f-erro")?.classList.add("hidden");
}

document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const modal = document.getElementById("codice-modal");
  if (modal && !modal.classList.contains("hidden")) fecharModalCodice();
});

/* ------------------------------ catálogo global ------------------------------ */
// Sempre rebusca ao abrir (o mestre pode ter editado os arquivos); mostra o cache enquanto isso.
async function carregarCatalogoCodice(tipo) {
  CODICE_UI.carregando = true;
  CODICE_UI.erroCatalogo = "";
  renderizarResultadosCatalogo();
  try {
    const resposta = await fetch(`/api/catalogo/${tipo}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const dados = await resposta.json().catch(() => null);
    if (!resposta.ok || !dados?.success || !Array.isArray(dados.items)) {
      throw new Error(dados?.message || `HTTP ${resposta.status}`);
    }
    CODICE_UI.catalogo[tipo] = dados.items.filter(
      (e) => ehEntradaCodice(e) && typeof e.id === "string",
    );
  } catch (erro) {
    console.warn("[RPG] Falha ao carregar o catálogo:", erro);
    CODICE_UI.erroCatalogo = `Não foi possível carregar o catálogo (${erro.message}).`;
  } finally {
    CODICE_UI.carregando = false;
    renderizarResultadosCatalogo();
  }
}

function normalizarBusca(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function textoDeBuscaCodice(entrada) {
  return normalizarBusca(
    [
      entrada.nome,
      entrada.name,
      entrada.desc,
      entrada.descricao,
      entrada.tipoDano,
      entrada.acao,
      entrada.alcance,
    ].join(" "),
  );
}

function renderizarResultadosCatalogo() {
  const lista = document.getElementById("codice-resultados");
  if (!lista) return;
  const tipo = CODICE_UI.tipo;
  const cfg = CODICE_TIPOS[tipo];
  const catalogo = CODICE_UI.catalogo[tipo];
  const aviso = (texto, erro = false) =>
    elTexto(
      "div",
      `py-6 text-center font-mono text-xs italic ${erro ? "text-rose-400" : "text-slate-500"}`,
      texto,
    );

  lista.replaceChildren();
  if (!catalogo) {
    lista.appendChild(
      CODICE_UI.erroCatalogo
        ? aviso(CODICE_UI.erroCatalogo, true)
        : aviso("Carregando catálogo..."),
    );
    return;
  }
  if (catalogo.length === 0) {
    lista.appendChild(
      aviso(
        `O catálogo de ${cfg.plural.toLowerCase()} está vazio. Use "Criar nova" para cadastrar a sua.`,
      ),
    );
    return;
  }

  const termos = normalizarBusca(document.getElementById("codice-busca")?.value)
    .split(/\s+/)
    .filter(Boolean);
  const achados = catalogo.filter((entrada) => {
    const alvo = textoDeBuscaCodice(entrada);
    return termos.every((termo) => alvo.includes(termo));
  });
  if (achados.length === 0) {
    lista.appendChild(aviso("Nada encontrado para essa busca."));
    return;
  }
  achados.forEach((entrada) => lista.appendChild(criarLinhaCatalogo(tipo, entrada)));
}

function criarLinhaCatalogo(tipo, entrada) {
  const cfg = CODICE_TIPOS[tipo];
  const jaTem = listaCodice(tipo).some((item) => item?.catalogId === entrada.id);

  const linha = elTexto(
    "div",
    "p-3 bg-dungeon-800/80 border border-dungeon-700 rounded-lg flex items-start justify-between gap-3",
  );
  const info = elTexto("div", "min-w-0");
  info.appendChild(
    elTexto(
      "div",
      "font-cinzel text-sm font-bold text-amberGold-300",
      nomeDaEntradaCodice(entrada, cfg.rotulo),
    ),
  );

  const custo = custoDaEntrada(entrada);
  const partes = [
    entrada.dice ? `${entrada.dice}${entrada.tipoDano ? ` ${entrada.tipoDano}` : ""}` : "",
    `Custo: ${custo.texto}`,
    entrada.acao || "",
    entrada.alcance ? `Alcance: ${entrada.alcance}` : "",
  ].filter(Boolean);
  info.appendChild(elTexto("div", "text-[11px] font-mono text-slate-400 mt-0.5", partes.join(" • ")));

  const descricao = entrada.desc || entrada.descricao || "";
  if (descricao) {
    info.appendChild(elTexto("p", "text-[11px] text-slate-300 leading-relaxed mt-1", descricao));
  }
  linha.appendChild(info);

  const botao = elTexto(
    "button",
    jaTem
      ? "shrink-0 px-3 py-1.5 text-xs rounded border border-dungeon-700 text-slate-500 cursor-default"
      : "shrink-0 px-3 py-1.5 bg-dungeon-700 hover:bg-amberGold-600 hover:text-black text-amberGold-400 font-cinzel font-bold text-xs rounded transition",
    jaTem ? "Na ficha" : "Adicionar",
  );
  botao.type = "button";
  botao.disabled = jaTem;
  if (!jaTem) botao.addEventListener("click", () => adicionarDoCatalogo(tipo, entrada));
  linha.appendChild(botao);
  return linha;
}

/* ------------------------- entregas do mestre (Sprint 2) -------------------------
   O mestre não grava na ficha: deixa uma "entrega" e ESTA ficha a aplica pelo salvamento central
   (adicionarEntradaCodice). Depois que o servidor confirma o salvamento, a ficha avisa
   (entrega_aplicada) e o servidor marca como entregue. Repetida ou já possuída (catalogId): não duplica.
   Formato inválido é recusado. */
const ENTREGA_ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
const entregasAguardandoSalvar = new Map(); // entregaId -> arquivo ("habilidades" | "magias")

function entregaValida(entrega) {
  return (
    ehEntradaCodice(entrega) &&
    ENTREGA_ID_VALIDO.test(String(entrega.entregaId || "")) &&
    (Object.hasOwn(CODICE_TIPOS, entrega.tipo) || entrega.tipo === "itens") &&
    ehEntradaCodice(entrega.entrada) &&
    ENTREGA_ID_VALIDO.test(String(entrega.entrada.catalogId || "")) &&
    JSON.stringify(entrega.entrada).length <= 8000
  );
}

function aplicarEntrega(entrega) {
  if (!entregaValida(entrega)) {
    registrarNoTerminal("Entrega recusada (formato inválido)", {});
    return false;
  }
  if (entrega.tipo === "itens") return aplicarEntregaDeItem(entrega);
  if (!personagemCarregado || entregasAguardandoSalvar.has(entrega.entregaId)) return false;

  const { entregaId, tipo, entrada } = entrega;
  const cfg = CODICE_TIPOS[tipo];
  if (listaCodice(tipo).some((item) => item?.catalogId === entrada.catalogId)) {
    socket.emit("entrega_aplicada", { entregaId }); // já tem: só confirma, não duplica
    return true;
  }
  if (codiceCheio(tipo)) return false; // fica pendente no servidor
  const copia = JSON.parse(JSON.stringify(entrada));
  delete copia.id;
  entregasAguardandoSalvar.set(entregaId, tipo);
  adicionarEntradaCodice(tipo, { ...copia, uid: novoUidCodice() }, `Você recebeu: ${nomeDaEntradaCodice(copia, cfg.rotulo)}`);
  return true;
}

// Loot de baú: tudo-ou-nada na mochila. Cabendo, grava (com o recibo) e confirma depois do salvamento;
// sem espaço, recusa e o servidor devolve o item ao baú.
function aplicarEntregaDeItem({ entregaId, entrada }) {
  if (!personagemCarregado || entregasAguardandoSalvar.has(entregaId)) return false;
  if (STATE.entregasRecebidas.includes(entregaId)) {
    socket.emit("entrega_aplicada", { entregaId }); // já aplicada antes: só confirma
    return true;
  }
  const quantidade = Number(entrada.quantity);
  if (typeof entrada.name !== "string" || !entrada.name || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 999) {
    registrarNoTerminal("Entrega de item recusada (formato inválido)", {});
    return false;
  }
  const modelo = JSON.parse(JSON.stringify(entrada));
  delete modelo.quantity;
  delete modelo.catalogId;
  STATE.entregasRecebidas.push(entregaId); // o recibo vai junto no mesmo salvamento do item
  if (STATE.entregasRecebidas.length > 50) STATE.entregasRecebidas.shift();
  const resultado = adicionarItemAoInventario(modelo, quantidade, { tudoOuNada: true, silencioso: true });
  if (resultado.adicionado < quantidade) {
    STATE.entregasRecebidas = STATE.entregasRecebidas.filter((id) => id !== entregaId);
    toast(`Sem espaço na mochila para ${quantidade} × ${entrada.name}. O item voltou ao baú.`, "error");
    socket.emit("entrega_recusada", { entregaId, motivo: "sem_espaco" });
    return false;
  }
  entregasAguardandoSalvar.set(entregaId, "inventario");
  toast(`Você pegou: ${quantidade} × ${entrada.name}`, "info");
  return true;
}

socket.on("entrega", aplicarEntrega);

// Salvamento confirmado pelo servidor: agora sim a entrega está no arquivo da ficha.
socket.on("personagem_salvo", ({ arquivo } = {}) => {
  for (const [entregaId, tipo] of [...entregasAguardandoSalvar]) {
    if (tipo !== arquivo) continue;
    entregasAguardandoSalvar.delete(entregaId);
    socket.emit("entrega_aplicada", { entregaId });
  }
});

// Chamado quando a ficha termina de montar a tela (e a cada reconexão): pede as entregas pendentes.
function pedirEntregasPendentes() {
  entregasAguardandoSalvar.clear();
  socket.emit("entregas_pedir");
}

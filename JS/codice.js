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
  modo: "catalogo", // modo do modal: "catalogo" | "criar"
  catalogo: { habilidades: null, magias: null }, // cache: lista ou null
  carregando: false,
  erroCatalogo: "",
};

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
    const ativo = tipo === CODICE_UI.tipo;
    const botao = document.getElementById(`codice-sub-${tipo}`);
    if (botao) {
      const total = listaCodice(tipo).filter(ehEntradaCodice).length;
      botao.textContent = `${cfg.plural} (${total})`;
      botao.className = `px-3 py-1.5 text-xs font-cinzel font-bold rounded-lg border transition ${
        ativo ? CLASSE_BOTAO_ATIVO : CLASSE_BOTAO_INATIVO
      }`;
    }
    document.getElementById(cfg.container)?.classList.toggle("hidden", !ativo);
  });
  const rotuloCriar = document.getElementById("codice-btn-criar-rotulo");
  if (rotuloCriar) rotuloCriar.textContent = CODICE_TIPOS[CODICE_UI.tipo].novaRotulo;
}

function trocarSubAbaCodice(tipo) {
  if (!CODICE_TIPOS[tipo]) return;
  CODICE_UI.tipo = tipo;
  renderizarCodice();
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

  const cabecalho = elTexto("div", "flex justify-between items-start gap-2");
  const titulo = elTexto(
    "h3",
    "font-cinzel text-base font-bold text-amberGold-300 group-hover:text-amberGold-400 transition flex items-center gap-2",
  );
  const icone = document.createElement("i");
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
  acoes.appendChild(criarBotaoRemoverCodice(tipo, hab));
  if (hab.dice) {
    const botao = elTexto(
      "button",
      "px-3 py-1.5 bg-dungeon-700 hover:bg-amberGold-600 hover:text-black text-amberGold-400 font-cinzel font-bold text-xs rounded transition flex items-center gap-1 shadow",
    );
    botao.type = "button";
    const mais = document.createElement("i");
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
  const icone = document.createElement("i");
  icone.className = "fa-solid fa-trash";
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
function adicionarEntradaCodice(tipo, entrada) {
  const cfg = CODICE_TIPOS[tipo];
  cfg.definir([...listaCodice(tipo), entrada]);
  cfg.salvar();
  registrarNoTerminal(`${cfg.rotulo} adicionada`, {
    nome: nomeDaEntradaCodice(entrada, cfg.rotulo),
    origem: entrada.catalogId ? `catálogo (${entrada.catalogId})` : "criada na ficha",
  });
  renderizarCodice();
  renderizarResultadosCatalogo();
  toast(`${cfg.rotulo} adicionada: ${nomeDaEntradaCodice(entrada, cfg.rotulo)}`, "info");
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
  if (codiceCheio(tipo)) return;

  const entrada = {
    uid: novoUidCodice(),
    nome,
    icon: valor("codice-f-icone") || cfg.iconePadrao,
  };
  if (dados) entrada.dice = dados;
  const dano = valor("codice-f-dano");
  if (dano) entrada.tipoDano = dano;
  const vital = valor("codice-f-custo-vital");
  if (ROTULO_VITAL[vital]) {
    const amount = Math.max(0, Math.min(999, Math.round(Number(valor("codice-f-custo-valor"))) || 0));
    entrada.cost = { vital, amount };
  }
  const acao = valor("codice-f-acao");
  if (acao) entrada.acao = acao;
  const alcance = valor("codice-f-alcance");
  if (alcance) entrada.alcance = alcance;
  const desc = valor("codice-f-desc");
  if (desc) entrada.desc = desc;

  adicionarEntradaCodice(tipo, entrada);
  fecharModalCodice();
}

/* ---------------------------------- modal ---------------------------------- */
function abrirModalCodice(modo = "catalogo") {
  if (!personagemCarregado) {
    toast("Carregue um personagem antes de editar o grimório.", "error");
    return;
  }
  document.getElementById("codice-modal")?.classList.remove("hidden");
  definirModoCodice(modo);
}

function fecharModalCodice() {
  document.getElementById("codice-modal")?.classList.add("hidden");
}

function definirModoCodice(modo) {
  CODICE_UI.modo = modo === "criar" ? "criar" : "catalogo";
  const cfg = CODICE_TIPOS[CODICE_UI.tipo];
  const noCatalogo = CODICE_UI.modo === "catalogo";

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
    limparFormularioCodice();
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

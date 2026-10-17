/* =========================================================================
   PÁGINA HABILIDADES E MAGIAS (Sprint 2)
   Catálogo do mestre: criar, editar, duplicar, excluir e adicionar à ficha de um personagem.
   Tudo passa pelo servidor (pedirAoServidor): a página só mostra o que o servidor devolve e recebe
   as mudanças em tempo real (campanha_atualizada). Texto do usuário só entra na tela por textContent.
   ========================================================================= */

const TIPOS_HABMAG = {
  habilidades: { rotulo: "Habilidade", plural: "Habilidades" },
  magias: { rotulo: "Magia", plural: "Magias" },
};
const NOMES_VITAL = { hp: "Vida", vigor: "Vigor", sanity: "Sanidade" };

const habmag = {
  tipo: "habilidades",
  catalogo: { habilidades: [], magias: [] },
  personagens: [],
  editando: null, // null = fechado; { id } = editando; { id: null } = nova
  busca: "",
  carregou: false,
};



/* ------------------------------ lista ------------------------------ */
function resumoDaEntrada(e) {
  const partes = [];
  if (e.dice) partes.push(e.dice);
  if (e.tipoDano) partes.push(e.tipoDano);
  if (e.cost?.vital) partes.push(`${e.cost.amount} ${NOMES_VITAL[e.cost.vital] || e.cost.vital}`);
  if (e.acao) partes.push(e.acao);
  return partes.join(" · ");
}

function criarCartao(entrada) {
  const cartao = criar("div", "bg-dungeon-950 border border-dungeon-700 rounded-lg p-3 space-y-2");
  cartao.dataset.id = entrada.id;
  const topo = criar("div", "flex justify-between items-start gap-2");
  topo.append(criar("h4", "font-cinzel font-bold text-amber-200 text-sm break-words", entrada.nome));
  const selo = criar(
    "span",
    `px-1.5 py-0.5 rounded text-[10px] font-mono border ${entrada.publico ? "border-emerald-600 text-emerald-300" : "border-slate-600 text-slate-400"}`,
    entrada.publico ? "Público" : "Privado",
  );
  selo.dataset.visibilidade = entrada.publico ? "publico" : "privado";
  topo.append(selo);
  cartao.append(topo);
  const resumo = resumoDaEntrada(entrada);
  if (resumo) cartao.append(criar("p", "text-[11px] text-slate-400 font-mono", resumo));
  if (entrada.desc) cartao.append(criar("p", "text-xs text-slate-300 line-clamp-3", entrada.desc));

  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(
    botaoDeAcao("enviar", "Adicionar", "bg-amberGold-600 text-white"),
    botaoDeAcao("editar", "Editar", ""),
    botaoDeAcao("duplicar", "Duplicar", ""),
    botaoDeAcao("excluir", "Excluir", "text-rose-300"),
  );
  cartao.append(acoes);
  return cartao;
}

function renderizarLista() {
  const lista = campo("habmag-lista");
  const termo = semAcento(habmag.busca);
  const itens = habmag.catalogo[habmag.tipo].filter(
    (e) => !termo || semAcento([e.nome, e.tipoDano, e.desc, e.acao].join(" ")).includes(termo),
  );
  lista.replaceChildren();
  if (!itens.length) {
    const vazio = habmag.catalogo[habmag.tipo].length ? "Nada encontrado." : `Nenhuma ${TIPOS_HABMAG[habmag.tipo].rotulo.toLowerCase()} ainda. Use "+ Nova".`;
    lista.append(criar("p", "text-xs text-slate-500 italic col-span-full", vazio));
  } else {
    itens.forEach((e) => lista.append(criarCartao(e)));
  }
  for (const tipo of Object.keys(TIPOS_HABMAG)) {
    const aba = campo(`habmag-aba-${tipo}`);
    const ativa = tipo === habmag.tipo;
    aba.setAttribute("aria-selected", String(ativa));
    aba.className = `px-3 py-1.5 rounded text-xs font-mono border ${ativa ? "border-amberGold-600 text-amberGold-400" : "border-dungeon-700 text-slate-400"}`;
    aba.textContent = `${TIPOS_HABMAG[tipo].plural} (${habmag.catalogo[tipo].length})`;
  }
}

/* ------------------------------ personagens ------------------------------ */
function renderizarPersonagens() {
  const select = campo("habmag-personagem");
  const anterior = select.value;
  select.replaceChildren();
  if (!habmag.personagens.length) {
    select.append(new Option("Nenhum personagem", ""));
    return;
  }
  habmag.personagens.forEach((p, i) => select.append(new Option(`${p.online ? "● " : "○ "}${p.nome} (${p.player})`, String(i))));
  if (anterior && [...select.options].some((o) => o.value === anterior)) select.value = anterior;
}

async function carregarPersonagens() {
  try {
    habmag.personagens = await pedirAoServidor("master_listar_personagens", {}, { silencioso: true });
  } catch {
    habmag.personagens = [];
  }
  renderizarPersonagens();
}

/* ------------------------------ editor ------------------------------ */
function abrirEditor(entrada) {
  habmag.editando = { id: entrada?.id ?? null };
  const e = entrada || {};
  campo("hm-titulo").textContent = entrada ? `Editar ${TIPOS_HABMAG[habmag.tipo].rotulo.toLowerCase()}` : `Nova ${TIPOS_HABMAG[habmag.tipo].rotulo.toLowerCase()}`;
  campo("hm-nome").value = e.nome || "";
  campo("hm-icon").value = e.icon || "";
  campo("hm-dice").value = e.dice || "";
  campo("hm-tipoDano").value = e.tipoDano || "";
  campo("hm-custo-vital").value = e.cost?.vital || "";
  campo("hm-custo-valor").value = e.cost?.amount ?? 0;
  for (const c of ["acao", "alcance", "duracao", "requisitos", "desc", "descLonga"]) campo(`hm-${c}`).value = e[c] || "";
  campo("hm-efeitos").value = (e.efeitos || []).join("\n");
  campo("hm-publico").checked = Boolean(e.publico); // nova entrada nasce privada
  campo("habmag-editor").classList.remove("hidden");
  campo("hm-nome").focus();
}

function fecharEditor() {
  habmag.editando = null;
  campo("habmag-editor").classList.add("hidden");
}

function lerEditor() {
  const item = {
    nome: campo("hm-nome").value.trim(),
    icon: campo("hm-icon").value.trim(),
    dice: campo("hm-dice").value.trim(),
    tipoDano: campo("hm-tipoDano").value.trim(),
    acao: campo("hm-acao").value,
    alcance: campo("hm-alcance").value,
    duracao: campo("hm-duracao").value,
    requisitos: campo("hm-requisitos").value,
    desc: campo("hm-desc").value,
    descLonga: campo("hm-descLonga").value,
    efeitos: campo("hm-efeitos").value.split("\n").map((l) => l.trim()).filter(Boolean),
    publico: campo("hm-publico").checked,
  };
  const vital = campo("hm-custo-vital").value;
  if (vital) item.cost = { vital, amount: Number(campo("hm-custo-valor").value) || 0 };
  if (habmag.editando?.id) item.id = habmag.editando.id;
  return item;
}

async function salvarEditor() {
  const item = lerEditor();
  if (!item.nome) {
    toast("Dê um nome.", "error");
    campo("hm-nome").focus();
    return;
  }
  if (item.dice && !/^\d{0,3}d\d{1,4}\s*([+-]\s*\d{1,4})?$/i.test(item.dice)) {
    toast("Dado inválido. Exemplos: 1d6, 2d8+3.", "error");
    return;
  }
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: habmag.tipo, item }, { muda: true });
    toast(`${TIPOS_HABMAG[habmag.tipo].rotulo} salva: ${salvo.nome}`, "success");
    fecharEditor();
  } catch {
    /* o erro já virou aviso na tela; o editor continua aberto para corrigir */
  }
}

/* ------------------------------ ações dos cartões ------------------------------ */
async function duplicarEntrada(entrada) {
  const copia = { ...entrada, nome: `${entrada.nome} (cópia)`.slice(0, 80), publico: false };
  delete copia.id; // o servidor gera um id novo
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: habmag.tipo, item: copia }, { muda: true });
    toast("Duplicada (privada).", "success");
  } catch { /* aviso já mostrado */ }
}

function excluirEntrada(entrada, botao) {
  confirmarNoBotao(botao, () =>
    pedirAoServidor("master_campanha_remover", { tipo: habmag.tipo, id: entrada.id }, { muda: true })
      .then(() => toast("Excluída do catálogo (as fichas que já a receberam a mantêm).", "success"))
      .catch(() => {}));
}

async function enviarParaFicha(entrada) {
  const escolhido = campo("habmag-personagem").value;
  const alvo = escolhido === "" ? undefined : habmag.personagens[Number(escolhido)];
  if (!alvo) {
    toast("Escolha o personagem.", "error");
    return;
  }
  try {
    const r = await pedirAoServidor(
      "master_entregar",
      { tipo: habmag.tipo, catalogId: entrada.id, player: alvo.player, nomePasta: alvo.nomePasta },
      { muda: true },
    );
    toast(r.online ? `${entrada.nome}: entregue a ${alvo.nome}.` : `${entrada.nome}: na caixa de ${alvo.nome} (entra ao abrir a ficha).`, "success");
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ carga e tempo real ------------------------------ */
async function carregarCatalogo() {
  if (!tokenDoMestre()) return;
  try {
    for (const tipo of Object.keys(TIPOS_HABMAG)) {
      habmag.catalogo[tipo] = await pedirAoServidor("master_campanha_ler", { tipo }, { silencioso: true });
    }
    habmag.carregou = true;
  } catch (erro) {
    if (erro.codigo === "nao_autorizado") toast("Token/Senha do mestre incorreta!", "error");
  }
  renderizarLista();
  carregarPersonagens();
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if (!Object.hasOwn(TIPOS_HABMAG, tipo) || !Array.isArray(dados)) return;
  habmag.catalogo[tipo] = dados;
  renderizarLista();
});
socket.on("connect", () => setTimeout(carregarCatalogo, 0));

document.addEventListener("DOMContentLoaded", () => {
  for (const tipo of Object.keys(TIPOS_HABMAG)) {
    campo(`habmag-aba-${tipo}`).addEventListener("click", () => {
      habmag.tipo = tipo;
      fecharEditor();
      renderizarLista();
    });
  }
  campo("habmag-busca").addEventListener("input", (ev) => {
    habmag.busca = ev.target.value;
    renderizarLista();
  });
  campo("habmag-novo").addEventListener("click", () => abrirEditor(null));
  campo("hm-salvar").addEventListener("click", salvarEditor);
  campo("hm-cancelar").addEventListener("click", fecharEditor);
  campo("habmag-atualizar-personagens").addEventListener("click", carregarPersonagens);
  campo("habmag-lista").addEventListener("click", (ev) => {
    const botao = ev.target.closest("button[data-acao]");
    const cartao = ev.target.closest("[data-id]");
    if (!botao || !cartao) return;
    const entrada = habmag.catalogo[habmag.tipo].find((e) => e.id === cartao.dataset.id);
    if (!entrada) return;
    ({ enviar: () => enviarParaFicha(entrada), editar: () => abrirEditor(entrada), duplicar: () => duplicarEntrada(entrada), excluir: () => excluirEntrada(entrada, botao) })[botao.dataset.acao]?.();
  });
  // token digitado/colado depois de abrir a página: recarrega
  document.getElementById("master-token-input")?.addEventListener("change", () => setTimeout(carregarCatalogo, 50));
  renderizarLista();
  renderizarPersonagens();
});

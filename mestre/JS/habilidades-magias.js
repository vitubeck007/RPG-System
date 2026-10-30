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
  carregando: false, erro: "", carregandoPersonagens: false, erroPersonagens: "",
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

const descricoesAbertas = new Set();
function criarCartao(entrada) {
  const cartao = criar("article", "master-catalog-card bg-dungeon-950 border border-dungeon-700 rounded-lg");
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
  if (entrada.desc && entrada.desc.length <= 140 && !entrada.desc.includes('\n')) {
    cartao.append(criar('p', 'rpg-power-description', entrada.desc));
  } else if (entrada.desc) {
    const descricao = criar('details', 'rpg-power-description');
    const resumo = criar('summary');
    resumo.append(criar('span', 'rpg-power-excerpt', entrada.desc), criar('span', 'rpg-power-read', 'Ler descrição completa'));
    descricao.append(resumo, criar('p', '', entrada.desc));
    descricao.dataset.detalhe = `descricao-${entrada.id}`;
    descricao.open = descricoesAbertas.has(entrada.id);
    resumo.querySelector('.rpg-power-read').textContent = descricao.open ? 'Recolher descrição' : 'Ler descrição completa';
    descricao.addEventListener('toggle', () => {
      if (!descricao.isConnected) return;
      if (descricao.open) descricoesAbertas.add(entrada.id); else descricoesAbertas.delete(entrada.id);
      resumo.querySelector('.rpg-power-read').textContent = descricao.open ? 'Recolher descrição' : 'Ler descrição completa';
    });
    cartao.append(descricao);
  }

  const acoes = criar("div", "master-power-actions");
  acoes.append(
    botaoDeAcao("enviar", "Entregar", "bg-amberGold-600 text-white"),
    botaoDeAcao("editar", "Editar", ""),
  );
  const menu = criar("details", "master-catalog-menu");
  menu.append(criar("summary", "", "Mais ações"));
  const opcoes = criar("div", "master-catalog-menu-opcoes");
  opcoes.append(
    botaoDeAcao("duplicar", "Duplicar", ""),
    botaoDeAcao("excluir", "Excluir", "text-rose-300"),
  );
  menu.append(opcoes); acoes.append(menu);
  cartao.append(acoes);
  return cartao;
}

function renderizarLista() {
  campo('habmag-novo').textContent = habmag.tipo === 'magias' ? '+ Nova magia' : '+ Nova habilidade';
  const lista = campo("habmag-lista");
  const termo = semAcento(habmag.busca);
  const itens = habmag.catalogo[habmag.tipo].filter(
    (e) => !termo || semAcento([e.nome, e.tipoDano, e.desc, e.acao].join(" ")).includes(termo),
  );
  lista.replaceChildren();
  if (!itens.length) {
    const vazio = habmag.catalogo[habmag.tipo].length ? "Nenhum poder corresponde à busca. Limpe o campo ou tente outro nome." : `Nenhuma ${TIPOS_HABMAG[habmag.tipo].rotulo.toLowerCase()} ainda. Crie a primeira pelo botão acima.`;
    lista.append(criar("p", "master-empty", vazio));
  } else {
    itens.forEach((e) => lista.append(criarCartao(e)));
  }
  mostrarEstadoLeituraMestre(lista, habmag, carregarCatalogo);
  atualizarDestinatarioVisual();
  for (const tipo of Object.keys(TIPOS_HABMAG)) {
    const aba = campo(`habmag-aba-${tipo}`);
    const ativa = tipo === habmag.tipo;
    aba.setAttribute("aria-selected", String(ativa));
    aba.tabIndex = ativa ? 0 : -1;
    aba.className = `px-3 py-1.5 rounded text-xs font-mono border ${ativa ? "border-amberGold-600 text-amberGold-400" : "border-dungeon-700 text-slate-400"}`;
    aba.textContent = `${TIPOS_HABMAG[tipo].plural} (${habmag.catalogo[tipo].length})`;
  }
  campo("habmag-catalogo").setAttribute("aria-labelledby", `habmag-aba-${habmag.tipo}`);
}

/* ------------------------------ personagens ------------------------------ */
function renderizarPersonagens() {
  const select = campo("habmag-personagem");
  const anterior = select.value;
  select.replaceChildren();
  select.append(new Option(habmag.carregandoPersonagens ? "Atualizando personagens…" : "Escolha um personagem", ""));
  habmag.personagens.forEach(p => select.append(new Option(`${p.online ? "● " : "○ "}${p.nome} (${p.player})`, identidadeDestinatario(p))));
  select.value = [...select.options].some(o => o.value === anterior) ? anterior : "";
  atualizarDestinatarioVisual();
}

function identidadeDestinatario(p) { return JSON.stringify([p.player, p.nomePasta]); }
function destinatarioSelecionado() {
  return habmag.personagens.find(p => identidadeDestinatario(p) === campo("habmag-personagem").value);
}

function atualizarDestinatarioVisual() {
  const alvo = destinatarioSelecionado();
  const aviso = campo("habmag-destinatario");
  if (aviso) aviso.textContent = alvo
    ? `Destinatário: ${alvo.nome} · ${alvo.player} · ${alvo.online ? "online" : "entrega ao abrir a ficha"}`
    : habmag.erroPersonagens || (habmag.carregandoPersonagens ? "Atualizando personagens…" : "Escolha explicitamente o personagem que receberá o poder.");
  campo("habmag-lista").querySelectorAll('[data-acao="enviar"]').forEach(botao => {
    botao.disabled = !alvo || habmag.carregandoPersonagens || Boolean(habmag.erroPersonagens) || botao.dataset.enviando === "1";
    if (botao.dataset.enviando !== "1") botao.textContent = "Entregar";
    botao.title = alvo ? `Entregar a ${alvo.nome}` : "Escolha o destinatário na barra acima do catálogo.";
    botao.setAttribute("aria-label", alvo ? `Entregar poder a ${alvo.nome}` : "Entregar poder: escolha o destinatário");
  });
}

async function carregarPersonagens() {
  if (habmag.carregandoPersonagens) return;
  habmag.carregandoPersonagens = true;
  habmag.erroPersonagens = "";
  renderizarPersonagens();
  try {
    habmag.personagens = await pedirAoServidor("master_listar_personagens", {}, { silencioso: true });
  } catch (erro) { habmag.erroPersonagens = `Não foi possível atualizar os personagens: ${erro.message} Use Atualizar lista.`; }
  finally { habmag.carregandoPersonagens = false; }
  renderizarPersonagens();
}

/* ------------------------------ editor ------------------------------ */
async function abrirEditor(entrada) {
  if (campo("hm-salvar").disabled) return;
  if ((editorMestreAlterado("habmag-editor") && !await podeDescartarEditorMestre("habmag-editor"))) return;
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
  RPGUI.abrirModal('habmag-editor-modal', 'hm-nome');
  atualizarAparenciaMestre('hm');
  protegerEditorMestre("habmag-editor", () => null, { chave: `${habmag.tipo}:${entrada?.id || "novo"}`, aposRestaurar: () => atualizarAparenciaMestre('hm') });
  campo("hm-nome").focus();
}

async function fecharEditor(salvo = false) {
  if (campo("hm-salvar").disabled && !salvo) return false;
  if (!salvo && (editorMestreAlterado("habmag-editor") && !await podeDescartarEditorMestre("habmag-editor"))) return false;
  const estavaAberto = !campo("habmag-editor").classList.contains("hidden");
  habmag.editando = null;
  campo("habmag-editor").classList.add("hidden");
  RPGUI.fecharModal('habmag-editor-modal');
  limparProtecaoEditorMestre("habmag-editor", salvo);
  if (estavaAberto) campo("habmag-novo").focus();
  return true;
}

function lerEditor() {
  const item = {
    ...habmag.catalogo[habmag.tipo].find((e) => e.id === habmag.editando?.id),
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
  else delete item.cost;
  if (habmag.editando?.id) item.id = habmag.editando.id;
  return item;
}

async function salvarEditor() {
  if (!validarCamposMestre('habmag-editor', {
    'hm-nome': valor => !valor ? 'Dê um nome ao poder.' : '',
    'hm-dice': valor => valor && !dadoDePoderValido(valor) ? 'Dado inválido. Use 2d6+1 ou 1d6+1d4+2 (até 30 caracteres).' : '',
  })) return;
  const item = lerEditor();
  if (!item.nome) {
    toast("Dê um nome.", "error");
    campo("hm-nome").focus();
    return;
  }
  if (item.dice && !dadoDePoderValido(item.dice)) {
    toast("Dado inválido. Exemplos: 2d6+1, 1d6+1d4+2.", "error");
    return;
  }
  marcarEnvioMestre("hm-salvar", true);
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: habmag.tipo, item }, { muda: true });
    toast(`${TIPOS_HABMAG[habmag.tipo].rotulo} salva: ${salvo.nome}`, "success");
    fecharEditor(true);
  } catch {
    /* o erro já virou aviso na tela; o editor continua aberto para corrigir */
  } finally { marcarEnvioMestre("hm-salvar", false); }
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
      .catch(() => {}), `Excluir ${entrada.nome} do catálogo?`);
}

async function enviarParaFicha(entrada) {
  const alvo = destinatarioSelecionado();
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
  if (habmag.carregando) return;
  habmag.carregando = true; habmag.erro = "";
  renderizarLista();
  try {
    const recebidos = {};
    for (const tipo of Object.keys(TIPOS_HABMAG)) {
      recebidos[tipo] = await pedirAoServidor("master_campanha_ler", { tipo }, { silencioso: true });
    }
    habmag.catalogo = recebidos;
    habmag.carregou = true;
  } catch (erro) {
    habmag.erro = `Não foi possível carregar os poderes: ${erro.message}`;
  } finally { habmag.carregando = false; }
  renderizarLista();
  carregarPersonagens();
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if (!Object.hasOwn(TIPOS_HABMAG, tipo) || !Array.isArray(dados)) return;
  habmag.catalogo[tipo] = dados;
  habmag.carregou = true;
  renderizarLista();
});
socket.on("connect", () => setTimeout(carregarCatalogo, 0));

document.addEventListener("DOMContentLoaded", () => {
  const contexto = lerContextoMestre("poderes");
  if (["habilidades", "magias"].includes(contexto.tipo)) habmag.tipo = contexto.tipo;
  if (typeof contexto.busca === "string") habmag.busca = campo("habmag-busca").value = contexto.busca;
  window.addEventListener("pagehide", () => guardarContextoMestre("poderes", { tipo: habmag.tipo, busca: habmag.busca }));
  for (const tipo of Object.keys(TIPOS_HABMAG)) {
    campo(`habmag-aba-${tipo}`).addEventListener("click", async () => {
      if (!await fecharEditor()) return;
      habmag.tipo = tipo;
      renderizarLista();
    });
  }
  campo("habmag-busca").addEventListener("input", (ev) => {
    habmag.busca = ev.target.value;
    renderizarLista();
  });
  campo("habmag-novo").addEventListener("click", () => abrirEditor(null));
  campo("hm-salvar").addEventListener("click", salvarEditor);
  campo("hm-cancelar").addEventListener("click", () => fecharEditor());
  campo("habmag-atualizar-personagens").addEventListener("click", carregarPersonagens);
  campo("habmag-personagem").addEventListener("change", atualizarDestinatarioVisual);
  campo("habmag-lista").addEventListener("click", (ev) => {
    const botao = ev.target.closest("button[data-acao]");
    const cartao = ev.target.closest("[data-id]");
    if (!botao || !cartao) return;
    const entrada = habmag.catalogo[habmag.tipo].find((e) => e.id === cartao.dataset.id);
    if (!entrada) return;
    ({ enviar: () => executarAcaoMestre(botao, "Entregando…", () => enviarParaFicha(entrada)).finally(atualizarDestinatarioVisual),
      editar: () => abrirEditor(entrada), duplicar: () => executarAcaoMestre(botao, "Duplicando…", () => duplicarEntrada(entrada)),
      excluir: () => excluirEntrada(entrada, botao) })[botao.dataset.acao]?.();
  });
  campo("habmag-lista").addEventListener("keydown", ev => {
    const menu = ev.target.closest(".master-catalog-menu");
    if (ev.key === "Escape" && menu?.open) {
      ev.preventDefault(); menu.open = false; menu.querySelector("summary").focus();
    }
  });
  renderizarLista();
  renderizarPersonagens();
});

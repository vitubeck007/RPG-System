/* =========================================================================
   PÁGINA NPCs (Sprint 4)
   Criar, editar, duplicar e excluir NPCs com mini lore, status básicos e segredo do mestre.
   Tudo passa pelo servidor (pedirAoServidor); tempo real por campanha_atualizada. O segredo só aparece
   no editor (nunca no cartão). Texto do usuário só entra na tela por textContent (R8); o retrato só é
   exibido se a URL passa por urlDeImagem (http/https ou caminho do próprio servidor).
   ========================================================================= */

const ATRIBUTOS_NPC = ["FOR", "DES", "INT", "SAB", "PRE", "VON"];
const MAX_CARTOES_NPC = 100; // tela leve mesmo com centenas: o resto aparece ao refinar a busca

const npcs = { lista: [], busca: "", editando: null, carregou: false };


/* ------------------------------ lista ------------------------------ */
function criarCartaoNpc(npc) {
  const c = criar("div", "bg-dungeon-950 border border-dungeon-700 rounded-lg p-3 space-y-2");
  c.dataset.id = npc.id;

  const topo = criar("div", "flex gap-2 items-start");
  const retrato = miniaturaDeImagem(npc.retrato);
  if (retrato) topo.append(retrato);
  const titulo = criar("div", "min-w-0 flex-1");
  titulo.append(criar("h4", "font-cinzel font-bold text-amber-200 text-sm break-words", npc.nome));
  if (npc.papel) titulo.append(criar("p", "text-[11px] text-slate-400 font-mono break-words", npc.papel));
  topo.append(titulo);
  if (npc.segredo) {
    const cadeado = criar("span", "text-rose-300 text-xs", "🔒");
    cadeado.title = "Tem segredo do mestre";
    cadeado.dataset.segredo = "1";
    topo.append(cadeado);
  }
  c.append(topo);

  if (npc.lore) c.append(criar("p", "text-xs text-slate-300 line-clamp-3", npc.lore));

  // HP com ajuste rápido (mexer no HP não abre o editor)
  const hp = criar("div", "flex items-center gap-1.5 text-[11px] font-mono");
  hp.append(botaoDeAcao("hp-5", "−5"), botaoDeAcao("hp-1", "−1"));
  const valor = criar("span", "flex-1 text-center text-rose-300", `HP ${npc.hp.atual}/${npc.hp.max}`);
  valor.dataset.hp = "1";
  hp.append(valor, botaoDeAcao("hp+1", "+1"), botaoDeAcao("hp+5", "+5"));
  c.append(hp);

  const attrs = ATRIBUTOS_NPC.filter((a) => npc.atributos?.[a] !== undefined).map((a) => `${a} ${npc.atributos[a]}`);
  if (attrs.length) c.append(criar("p", "text-[10px] text-slate-500 font-mono", attrs.join(" · ")));

  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(botaoDeAcao("editar", "Editar"), botaoDeAcao("duplicar", "Duplicar"), botaoDeAcao("excluir", "Excluir", "text-rose-300"));
  c.append(acoes);
  return c;
}

function renderizarNpcs() {
  const termo = semAcento(npcs.busca);
  const filtrados = npcs.lista
    .filter((n) => !termo || semAcento(`${n.nome} ${n.papel} ${n.lore} ${n.notas}`).includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const area = campo("npc-cartoes");
  area.replaceChildren();
  if (!filtrados.length) {
    area.append(criar("p", "text-xs text-slate-500 italic col-span-full", npcs.lista.length ? "Nada encontrado." : 'Nenhum NPC ainda. Use "+ Novo NPC".'));
  }
  filtrados.slice(0, MAX_CARTOES_NPC).forEach((n) => area.append(criarCartaoNpc(n)));
  if (filtrados.length > MAX_CARTOES_NPC) {
    area.append(criar("p", "text-xs text-slate-500 italic col-span-full", `Mostrando ${MAX_CARTOES_NPC} de ${filtrados.length}. Refine a busca.`));
  }
  campo("npc-contagem").textContent = termo ? `${filtrados.length} de ${npcs.lista.length} NPCs` : `${npcs.lista.length} NPCs`;
}

/* ------------------------------ editor ------------------------------ */
function atualizarContadorDeLore() {
  campo("np-lore-contador").textContent = `(${campo("np-lore").value.length}/500)`;
}

function abrirEditorNpc(npc) {
  npcs.editando = { id: npc?.id ?? null, hp: npc?.hp ? { ...npc.hp } : null }; // HP original: só vai ao servidor se mudar
  const n = npc || {};
  campo("np-titulo").textContent = npc ? "Editar NPC" : "Novo NPC";
  campo("np-nome").value = n.nome || "";
  campo("np-papel").value = n.papel || "";
  campo("np-retrato").value = n.retrato || "";
  campo("np-lore").value = n.lore || "";
  campo("np-hp-atual").value = n.hp?.atual ?? 10;
  campo("np-hp-max").value = n.hp?.max ?? 10;
  for (const a of ATRIBUTOS_NPC) campo(`np-attr-${a}`).value = n.atributos?.[a] ?? "";
  campo("np-notas").value = n.notas || "";
  campo("np-segredo").value = n.segredo || "";
  atualizarContadorDeLore();
  campo("npc-editor").classList.remove("hidden");
  campo("np-nome").focus();
}

function fecharEditorNpc() {
  npcs.editando = null;
  campo("npc-editor").classList.add("hidden");
}

function lerEditorNpc() {
  const max = Math.max(0, Math.floor(Number(campo("np-hp-max").value)) || 0);
  const atual = Math.max(0, Math.min(max, Math.floor(Number(campo("np-hp-atual").value)) || 0));
  const atributos = {};
  for (const a of ATRIBUTOS_NPC) {
    const v = campo(`np-attr-${a}`).value;
    if (v !== "") atributos[a] = Number(v);
  }
  const item = {
    nome: campo("np-nome").value.trim(),
    papel: campo("np-papel").value.trim(),
    retrato: campo("np-retrato").value.trim(),
    lore: campo("np-lore").value.slice(0, 500),
    hp: { atual, max },
    atributos,
    notas: campo("np-notas").value,
    segredo: campo("np-segredo").value,
  };
  if (npcs.editando?.id) {
    item.id = npcs.editando.id;
    const original = npcs.editando.hp;
    if (original && original.atual === atual && original.max === max) delete item.hp; // não mexeu: o servidor mantém o dele
  }
  return item;
}

async function salvarNpc() {
  const item = lerEditorNpc();
  if (!item.nome) {
    toast("Dê um nome ao NPC.", "error");
    campo("np-nome").focus();
    return;
  }
  if (item.retrato && !urlDeImagem(item.retrato)) {
    toast("Retrato inválido: use uma URL http/https ou um caminho que comece com /.", "error");
    return;
  }
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: "npcs", item }, { muda: true });
    toast(`NPC salvo: ${salvo.nome}`, "success");
    fecharEditorNpc();
  } catch {
    /* erro já virou aviso; o editor continua aberto */
  }
}

/* ------------------------------ ações dos cartões ------------------------------ */
// HP por delta no servidor (atômico): cliques rápidos e duas abas do mestre somam, nunca se sobrescrevem.
async function ajustarHp(npc, delta) {
  try {
    await pedirAoServidor("master_npc_hp", { id: npc.id, delta }, { muda: true });
  } catch { /* aviso já mostrado */ }
}

async function duplicarNpc(npc) {
  const copia = { ...npc, nome: `${npc.nome} (cópia)`.slice(0, 80) };
  delete copia.id;
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: "npcs", item: copia }, { muda: true });
    toast("NPC duplicado.", "success");
  } catch { /* aviso já mostrado */ }
}

function excluirNpc(npc, botao) {
  confirmarNoBotao(botao, () =>
    pedirAoServidor("master_campanha_remover", { tipo: "npcs", id: npc.id }, { muda: true })
      .then(() => toast("NPC excluído.", "success"))
      .catch(() => {}));
}

/* ------------------------------ carga e eventos ------------------------------ */
async function carregarNpcs() {
  if (!tokenDoMestre()) return;
  try {
    npcs.lista = await pedirAoServidor("master_campanha_ler", { tipo: "npcs" }, { silencioso: true });
    npcs.carregou = true;
  } catch (erro) {
    if (erro.codigo === "nao_autorizado") toast("Token/Senha do mestre incorreta!", "error");
  }
  renderizarNpcs();
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if (tipo !== "npcs" || !Array.isArray(dados)) return;
  npcs.lista = dados;
  renderizarNpcs();
});
socket.on("connect", () => setTimeout(carregarNpcs, 0));

document.addEventListener("DOMContentLoaded", () => {
  campo("npc-busca").addEventListener("input", (ev) => {
    npcs.busca = ev.target.value;
    renderizarNpcs();
  });
  campo("npc-novo").addEventListener("click", () => abrirEditorNpc(null));
  campo("np-salvar").addEventListener("click", salvarNpc);
  campo("np-cancelar").addEventListener("click", fecharEditorNpc);
  campo("np-lore").addEventListener("input", atualizarContadorDeLore);
  campo("npc-cartoes").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const npc = b && npcs.lista.find((n) => n.id === ev.target.closest("[data-id]")?.dataset.id);
    if (!npc) return;
    const acao = b.dataset.acao;
    if (acao === "editar") abrirEditorNpc(npc);
    else if (acao === "duplicar") duplicarNpc(npc);
    else if (acao === "excluir") excluirNpc(npc, b);
    else if (acao.startsWith("hp")) ajustarHp(npc, { "hp-5": -5, "hp-1": -1, "hp+1": 1, "hp+5": 5 }[acao]);
  });
  campo("master-token-input")?.addEventListener("change", () => setTimeout(carregarNpcs, 50));
  renderizarNpcs();
});

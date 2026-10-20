/* =========================================================================
   PÁGINA LOOT (Sprint 3): catálogo de itens e baús
   Itens: criar, editar, duplicar, excluir, busca e filtro por tipo.
   Baús: montar com itens do catálogo (cópia) e quantidade, liberar/recolher com 1 clique, ver quem pegou o quê.
   Tudo passa pelo servidor (pedirAoServidor); tempo real por campanha_atualizada.
   ========================================================================= */

const loot = {
  aba: "itens",
  itens: [],
  baus: [],
  busca: "",
  filtroTipo: "",
  editandoItem: null, // null = fechado; { id } ou { id: null } (novo)
  editandoBau: null, // null = fechado; { id, linhas: [{ id?, item, quantidade }] }
  carregou: false,
  carregando: false, erro: "",
};

/* ------------------------------ abas ------------------------------ */
function renderizarAbas() {
  for (const aba of ["itens", "baus"]) {
    const ativa = aba === loot.aba;
    const b = campo(`loot-aba-${aba}`);
    b.setAttribute("aria-selected", String(ativa));
    b.tabIndex = ativa ? 0 : -1;
    b.className = `px-3 py-1.5 rounded text-xs font-mono border ${ativa ? "border-amberGold-600 text-amberGold-400" : "border-dungeon-700 text-slate-400"}`;
    b.textContent = `${aba === "itens" ? "Itens" : "Baús"} (${loot[aba].length})`;
    campo(`loot-${aba}`).classList.toggle("hidden", !ativa);
  }
}

/* ------------------------------ itens ------------------------------ */
function renderizarFiltroDeTipos() {
  const select = campo("loot-filtro-tipo");
  const atual = loot.filtroTipo;
  select.replaceChildren(new Option("Todos os tipos", ""));
  [...new Set(loot.itens.map((i) => i.type))].sort().forEach((t) => select.append(new Option(t, t)));
  select.value = [...select.options].some((o) => o.value === atual) ? atual : "";
  loot.filtroTipo = select.value;
}

function criarCartaoItem(item) {
  const c = criar("article", "master-catalog-card bg-dungeon-950 border border-dungeon-700 rounded-lg");
  c.dataset.id = item.id;
  const topo = criar("div", "flex justify-between items-start gap-2");
  topo.append(criar("h4", "font-cinzel font-bold text-amber-200 text-sm break-words", item.name), criar("span", "px-1.5 py-0.5 rounded text-[10px] font-mono border border-slate-600 text-slate-400", item.type));
  c.append(topo);
  const info = [`${item.weight} kg`, `${item.w}×${item.h}`, item.maxStack > 1 ? `pilha ${item.maxStack}` : "", item.dice || ""].filter(Boolean).join(" · ");
  c.append(criar("p", "text-[11px] text-slate-400 font-mono", info));
  if (item.desc) c.append(criar("p", "text-xs text-slate-300 line-clamp-3", item.desc));
  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(botaoDeAcao("editar", "Editar"), botaoDeAcao("duplicar", "Duplicar"), botaoDeAcao("excluir", "Excluir", "text-rose-300"));
  c.append(acoes);
  return c;
}

function renderizarItens() {
  renderizarFiltroDeTipos();
  const termo = semAcento(loot.busca);
  const lista = campo("loot-lista-itens");
  const visiveis = loot.itens.filter((i) => (!loot.filtroTipo || i.type === loot.filtroTipo) && (!termo || semAcento(`${i.name} ${i.type} ${i.desc}`).includes(termo)));
  lista.replaceChildren();
  if (!visiveis.length) lista.append(criar("p", "master-empty", loot.itens.length ? "Nenhum item corresponde aos filtros. Tente outro nome ou tipo." : 'Nenhum item ainda. Use "+ Novo" para começar o catálogo.'));
  visiveis.forEach((i) => lista.append(criarCartaoItem(i)));
  mostrarEstadoLeituraMestre(lista, loot, carregarLoot);
  renderizarSeletorDeItens();
}

function abrirEditorItem(item) {
  if (campo("li-salvar").disabled || !podeDescartarEditorMestre("loot-editor-item")) return;
  loot.editandoItem = { id: item?.id ?? null };
  const e = item || {};
  campo("li-titulo").textContent = item ? "Editar item" : "Novo item";
  campo("li-name").value = e.name || "";
  campo("li-type").value = e.type || "";
  campo("li-icon").value = e.icon || "";
  campo("li-dice").value = e.dice || "";
  campo("li-color").value = e.color || "";
  campo("li-weight").value = e.weight ?? 0;
  campo("li-maxStack").value = e.maxStack ?? 1;
  campo("li-w").value = e.w ?? 1;
  campo("li-h").value = e.h ?? 1;
  campo("li-desc").value = e.desc || "";
  campo("li-twoHanded").checked = Boolean(e.twoHanded);
  campo("loot-editor-item").classList.remove("hidden");
  atualizarAparenciaMestre('li');
  protegerEditorMestre("loot-editor-item");
  campo("li-name").focus();
}
function fecharEditorItem(salvo = false) {
  if (!salvo && (campo("li-salvar").disabled || !podeDescartarEditorMestre("loot-editor-item"))) return false;
  loot.editandoItem = null;
  campo("loot-editor-item").classList.add("hidden");
  limparProtecaoEditorMestre("loot-editor-item");
  campo("loot-novo-item").focus();
  return true;
}

async function salvarItem() {
  if (!validarCamposMestre('loot-editor-item', {
    'li-name': valor => !valor ? 'Dê um nome ao item.' : '',
    'li-dice': valor => valor && !/^\d{0,3}d\d{1,4}\s*([+-]\s*\d{1,4})?$/i.test(valor) ? 'Dado inválido. Use 1d6 ou 2d8+3.' : '',
  })) return;
  const item = {
    name: campo("li-name").value.trim(),
    type: campo("li-type").value.trim(),
    icon: campo("li-icon").value.trim(),
    dice: campo("li-dice").value.trim(),
    color: campo("li-color").value.trim(),
    weight: Number(campo("li-weight").value) || 0,
    maxStack: Number(campo("li-maxStack").value) || 1,
    w: Number(campo("li-w").value) || 1,
    h: Number(campo("li-h").value) || 1,
    desc: campo("li-desc").value,
    twoHanded: campo("li-twoHanded").checked,
  };
  if (loot.editandoItem?.id) item.id = loot.editandoItem.id;
  if (!item.name) return toast("Dê um nome ao item.", "error");
  if (item.dice && !/^\d{0,3}d\d{1,4}\s*([+-]\s*\d{1,4})?$/i.test(item.dice)) return toast("Dado inválido. Exemplos: 1d6, 2d8+3.", "error");
  marcarEnvioMestre("li-salvar", true);
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: "itens", item }, { muda: true });
    toast(`Item salvo: ${salvo.name}`, "success");
    fecharEditorItem(true);
  } catch {
    /* erro já mostrado; o editor continua aberto */
  } finally {
    marcarEnvioMestre("li-salvar", false);
  }
}

async function duplicarItem(item) {
  const copia = { ...item, name: `${item.name} (cópia)`.slice(0, 80) };
  delete copia.id;
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: "itens", item: copia }, { muda: true });
    toast("Item duplicado.", "success");
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ baús ------------------------------ */
function criarCartaoBau(bau) {
  const c = criar("article", "master-catalog-card bg-dungeon-950 border border-dungeon-700 rounded-lg");
  c.dataset.id = bau.id;
  const topo = criar("div", "flex justify-between items-start gap-2");
  topo.append(criar("h4", "font-cinzel font-bold text-amber-200 text-sm break-words", bau.nome));
  const selo = criar("span", `px-1.5 py-0.5 rounded text-[10px] font-mono border ${bau.liberado ? "border-emerald-600 text-emerald-300" : "border-slate-600 text-slate-400"}`, bau.liberado ? "Liberado" : "Preparado");
  selo.dataset.estado = bau.liberado ? "liberado" : "preparado";
  topo.append(selo);
  c.append(topo);
  const lista = criar("ul", "text-[11px] text-slate-300 font-mono space-y-0.5");
  if (!bau.itens.length) lista.append(criar("li", "text-slate-500 italic", "Vazio."));
  for (const l of bau.itens) lista.append(criar("li", l.quantidade ? "" : "text-slate-500 line-through", `${l.quantidade} × ${l.item.name}`));
  c.append(lista);
  if (bau.historico.length) {
    const hist = criar("ul", "text-[10px] text-slate-500 font-mono border-t border-dungeon-800 pt-1 space-y-0.5");
    hist.dataset.historico = "1";
    const rotulo = { pegou: "pegou", sem_espaco: "sem espaço para", expirou: "não pegou (expirou):" };
    for (const h of bau.historico.slice(-5).reverse()) hist.append(criar("li", "", `${h.jogador || "?"} ${rotulo[h.resultado]} ${h.quantidade} × ${h.item}`));
    c.append(hist);
  }
  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(
    botaoDeAcao("liberar", bau.liberado ? "Recolher" : "Liberar", bau.liberado ? "" : "bg-amberGold-600 text-white"),
    botaoDeAcao("editar", "Editar"),
    botaoDeAcao("duplicar", "Duplicar"),
    botaoDeAcao("excluir", "Excluir", "text-rose-300"),
  );
  c.append(acoes);
  return c;
}

function renderizarBaus() {
  const lista = campo("loot-lista-baus");
  lista.replaceChildren();
  if (!loot.baus.length) lista.append(criar("p", "master-empty", 'Nenhum baú preparado. Use "+ Novo baú" e escolha os itens do catálogo.'));
  loot.baus.forEach((b) => lista.append(criarCartaoBau(b)));
  mostrarEstadoLeituraMestre(lista, loot, carregarLoot);
}

function renderizarSeletorDeItens() {
  const select = campo("lb-item");
  const atual = select.value;
  select.replaceChildren();
  if (!loot.itens.length) select.append(new Option("Crie itens primeiro", ""));
  loot.itens.forEach((i) => select.append(new Option(`${i.name} (${i.type})`, i.id)));
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
}

function renderizarLinhasDoEditor() {
  const area = campo("lb-linhas");
  area.replaceChildren();
  loot.editandoBau.linhas.forEach((linha, indice) => {
    const l = criar("div", "flex items-center gap-2 text-xs font-mono");
    l.dataset.indice = String(indice);
    l.append(criar("span", "flex-1 break-words", linha.item.name));
    const qtd = criar("input", "w-16 bg-dungeon-950 border border-dungeon-700 rounded px-1 py-0.5");
    qtd.id = `lb-linha-${indice}-quantidade`;
    qtd.type = "number";
    qtd.min = "0";
    qtd.max = "999";
    qtd.value = String(linha.quantidade);
    qtd.setAttribute("aria-label", `Quantidade de ${linha.item.name}`);
    qtd.addEventListener("input", () => {
      linha.quantidade = Math.max(0, Math.min(999, Math.floor(Number(qtd.value)) || 0));
    });
    const remover = botaoDeAcao("remover-linha", "✕", "text-rose-300");
    remover.setAttribute("aria-label", `Remover ${linha.item.name} do baú`);
    remover.addEventListener("click", () => {
      loot.editandoBau.linhas.splice(indice, 1);
      renderizarLinhasDoEditor();
    });
    l.append(qtd, remover);
    area.append(l);
  });
}

function abrirEditorBau(bau) {
  if (campo("lb-salvar").disabled || !podeDescartarEditorMestre("loot-editor-bau")) return;
  loot.editandoBau = { id: bau?.id ?? null, linhas: (bau?.itens || []).map((l) => ({ id: l.id, item: l.item, quantidade: l.quantidade })) };
  campo("lb-titulo").textContent = bau ? "Editar baú" : "Novo baú";
  campo("lb-nome").value = bau?.nome || "";
  campo("loot-editor-bau").classList.remove("hidden");
  renderizarSeletorDeItens();
  renderizarLinhasDoEditor();
  protegerEditorMestre("loot-editor-bau", () => loot.editandoBau?.linhas);
  campo("lb-nome").focus();
}
function fecharEditorBau(salvo = false) {
  if (!salvo && (campo("lb-salvar").disabled || !podeDescartarEditorMestre("loot-editor-bau"))) return false;
  loot.editandoBau = null;
  campo("loot-editor-bau").classList.add("hidden");
  limparProtecaoEditorMestre("loot-editor-bau");
  campo("loot-novo-bau").focus();
  return true;
}

function adicionarLinhaAoBau() {
  if (!validarCamposMestre('loot-editor-bau', {
    'lb-qtd': valor => !valor ? 'Informe a quantidade.' : '',
  })) return;
  const item = loot.itens.find((i) => i.id === campo("lb-item").value);
  if (!item) return toast("Escolha um item do catálogo.", "error");
  const quantidade = Math.max(1, Math.min(999, Math.floor(Number(campo("lb-qtd").value)) || 1));
  const { criadoEm, atualizadoEm, ...copia } = item; // cópia do catálogo: mudar o catálogo depois não muda o baú
  loot.editandoBau.linhas.push({ item: copia, quantidade });
  renderizarLinhasDoEditor();
}

async function salvarBau() {
  if (!validarCamposMestre('loot-editor-bau', {
    'lb-nome': valor => !valor ? 'Dê um nome ao baú.' : '',
  })) return;
  const nome = campo("lb-nome").value.trim();
  if (!nome) return toast("Dê um nome ao baú.", "error");
  const item = { nome, itens: loot.editandoBau.linhas };
  if (loot.editandoBau.id) item.id = loot.editandoBau.id;
  marcarEnvioMestre("lb-salvar", true);
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: "baus", item }, { muda: true });
    toast(`Baú salvo: ${salvo.nome}`, "success");
    fecharEditorBau(true);
  } catch { /* erro já mostrado (ex.: baú liberado não se edita) */ }
  finally { marcarEnvioMestre("lb-salvar", false); }
}

async function alternarLiberacao(bau) {
  try {
    await pedirAoServidor("master_bau_liberar", { id: bau.id, liberado: !bau.liberado }, { muda: true });
    toast(bau.liberado ? `Baú recolhido: ${bau.nome}` : `Baú liberado: ${bau.nome}`, "success");
  } catch { /* aviso já mostrado */ }
}

async function duplicarBau(bau) {
  const copia = { nome: `${bau.nome} (cópia)`.slice(0, 80), itens: bau.itens.map((l) => ({ item: l.item, quantidade: l.quantidade })) };
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: "baus", item: copia }, { muda: true });
    toast("Baú duplicado (preparado, não liberado).", "success");
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ carga e eventos ------------------------------ */
function renderizarTudo() {
  renderizarAbas();
  renderizarItens();
  renderizarBaus();
}

async function carregarLoot() {
  if (!tokenDoMestre() || loot.carregando) return;
  loot.carregando = true; loot.erro = "";
  renderizarTudo();
  try {
    const itens = await pedirAoServidor("master_campanha_ler", { tipo: "itens" }, { silencioso: true });
    const baus = await pedirAoServidor("master_campanha_ler", { tipo: "baus" }, { silencioso: true });
    loot.itens = itens; loot.baus = baus;
    loot.carregou = true;
  } catch (erro) {
    loot.erro = `Não foi possível carregar o loot: ${erro.message}`;
  } finally { loot.carregando = false; }
  renderizarTudo();
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if ((tipo !== "itens" && tipo !== "baus") || !Array.isArray(dados)) return;
  loot[tipo] = dados;
  loot.carregou = true;
  renderizarTudo();
});
socket.on("connect", () => setTimeout(carregarLoot, 0));

function achar(lista, cartao) {
  return lista.find((x) => x.id === cartao?.dataset.id);
}

document.addEventListener("DOMContentLoaded", () => {
  for (const aba of ["itens", "baus"]) {
    campo(`loot-aba-${aba}`).addEventListener("click", () => {
      loot.aba = aba;
      renderizarAbas();
    });
  }
  campo("loot-busca-item").addEventListener("input", (ev) => {
    loot.busca = ev.target.value;
    renderizarItens();
  });
  campo("loot-filtro-tipo").addEventListener("change", (ev) => {
    loot.filtroTipo = ev.target.value;
    renderizarItens();
  });
  campo("loot-novo-item").addEventListener("click", () => abrirEditorItem(null));
  campo("li-salvar").addEventListener("click", salvarItem);
  campo("li-cancelar").addEventListener("click", () => fecharEditorItem());
  campo("loot-lista-itens").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const item = b && achar(loot.itens, ev.target.closest("[data-id]"));
    if (!item) return;
    if (b.dataset.acao === "editar") abrirEditorItem(item);
    else if (b.dataset.acao === "duplicar") duplicarItem(item);
    else if (b.dataset.acao === "excluir") {
      confirmarNoBotao(b, () =>
        pedirAoServidor("master_campanha_remover", { tipo: "itens", id: item.id }, { muda: true })
          .then(() => toast("Item excluído (os baús que já o têm o mantêm).", "success"))
          .catch(() => {}));
    }
  });

  campo("loot-novo-bau").addEventListener("click", () => abrirEditorBau(null));
  campo("lb-add").addEventListener("click", adicionarLinhaAoBau);
  campo("lb-salvar").addEventListener("click", salvarBau);
  campo("lb-cancelar").addEventListener("click", () => fecharEditorBau());
  campo("loot-lista-baus").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const bau = b && achar(loot.baus, ev.target.closest("[data-id]"));
    if (!bau) return;
    if (b.dataset.acao === "liberar") alternarLiberacao(bau);
    else if (b.dataset.acao === "editar") {
      if (bau.liberado) toast("Recolha o baú antes de editar.", "error");
      else abrirEditorBau(bau);
    } else if (b.dataset.acao === "duplicar") duplicarBau(bau);
    else if (b.dataset.acao === "excluir") {
      confirmarNoBotao(b, () =>
        pedirAoServidor("master_campanha_remover", { tipo: "baus", id: bau.id }, { muda: true })
          .then(() => toast("Baú excluído.", "success"))
          .catch(() => {}));
    }
  });
  document.getElementById("master-token-input")?.addEventListener("change", () => setTimeout(carregarLoot, 50));
  renderizarTudo();
});

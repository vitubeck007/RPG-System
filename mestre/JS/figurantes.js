/* Biblioteca unificada. Dados do mestre passam somente pelos comandos autenticados existentes. */
const figurantes = {
  tipo: location.pathname.endsWith("/npc") ? "npcs" : "inimigos", aba: "biblioteca",
  inimigos: [], npcs: [], habilidades: [], magias: [], batalha: { ativa: false, combatentes: [] },
  editando: null, poderes: { habilidades: [], magias: [] }, ocupada: false, carregou: false,
};
const DADO_FIGURANTE = /^\d{0,3}d\d{1,4}\s*([+-]\s*\d{1,4})?$/i;
const copiarFigurante = (v) => JSON.parse(JSON.stringify(v));
const rotuloFigurante = (tipo = figurantes.tipo) => tipo === "npcs" ? "NPC" : "inimigo";
const janelasFig = [];

function abrirJanelaFig(id) {
  if (janelasFig.some((j) => j.id === id)) return;
  const anterior = janelasFig.at(-1);
  if (anterior) campo(anterior.id).inert = true;
  else { document.querySelector("main").inert = true; campo("mestre-cabecalho").inert = true; }
  janelasFig.push({ id, foco: document.activeElement });
  campo(id).classList.remove("hidden");
  document.body.classList.add("fig-modal-aberto");
  campo(id).querySelector("input, select, button")?.focus();
}

function fecharJanelaFig(id, salvo = false) {
  if (figurantes.ocupada || janelasFig.at(-1)?.id !== id) return;
  if (!salvo && !podeDescartarEditorMestre(id)) return;
  limparProtecaoEditorMestre(id);
  const janela = janelasFig.pop();
  campo(id).classList.add("hidden");
  if (id === "fig-editor") figurantes.editando = null;
  const anterior = janelasFig.at(-1);
  if (anterior) campo(anterior.id).inert = false;
  else {
    document.querySelector("main").inert = false;
    campo("mestre-cabecalho").inert = false;
    document.body.classList.remove("fig-modal-aberto");
  }
  janela.foco?.focus();
}

function previaFigurante() {
  const previa = campo("fig-retrato-previa");
  previa.replaceChildren();
  const img = miniaturaDeImagem(campo("fig-imagem").value);
  if (img) previa.append(img); else previa.textContent = "✦";
}

let validandoAberturaFig = false;
async function abrirFichaFigurante(item = null) {
  if (figurantes.ocupada || validandoAberturaFig || janelasFig.length) return;
  const chave = tokenDoMestre();
  if (!chave) {
    definirAvisoMestre('Informe a chave do mestre antes de criar ou editar um figurante.', 'error');
    focarChaveMestre(); return;
  }
  const tipo = figurantes.tipo;
  validandoAberturaFig = true;
  campo('fig-novo').disabled = true;
  campo('fig-novo').setAttribute('aria-busy', 'true');
  definirAvisoMestre('Validando acesso antes de abrir a ficha…');
  let autorizado = false;
  try { autorizado = Boolean(await entrarNaSalaDoMestre({ silencioso: false })); }
  finally {
    validandoAberturaFig = false; campo('fig-novo').disabled = false;
    campo('fig-novo').removeAttribute('aria-busy');
  }
  if (!autorizado) { focarChaveMestre(); return; }
  // Uma resposta atrasada não deve abrir o editor em outro contexto.
  if (chave !== tokenDoMestre() || tipo !== figurantes.tipo || figurantes.aba !== 'biblioteca') return;
  if (!podeDescartarEditorMestre('fig-editor')) return;
  figurantes.editando = { tipo, original: item ? copiarFigurante(item) : null };
  figurantes.poderes = { habilidades: copiarFigurante(item?.habilidades || []), magias: copiarFigurante(item?.magias || []) };
  campo("fig-form").reset();
  campo("fig-editor-titulo").textContent = `${item ? "Editar" : "Novo"} ${rotuloFigurante(tipo)}`;
  campo("fig-editor-tipo").textContent = tipo === "npcs" ? "PERSONAGEM NÃO JOGÁVEL" : "INIMIGO";
  for (const [id, valor] of Object.entries({ nome: item?.nome, imagem: item?.imagem || item?.retrato, descricao: item?.descricao, lore: item?.lore, notas: item?.notas || item?.nota, papel: item?.papel, segredo: item?.segredo })) campo(`fig-${id}`).value = valor || "";
  const hp = item?.hp || { atual: item?.hpMax ?? 10, max: item?.hpMax ?? 10 };
  campo("fig-hp-atual").value = hp.atual;
  campo("fig-hp-max").value = hp.max;
  campo("fig-hp-max").min = tipo === "npcs" ? "0" : "1";
  campo("fig-hp-atual-label").classList.toggle("hidden", tipo !== "npcs");
  campo("fig-vida-ajuda").textContent = tipo === "npcs" ? "A vida atual acompanha o NPC na mesa." : "Cópias entram em batalha com a vida cheia.";
  campo("fig-energia-atual").value = item?.energia?.atual ?? 10;
  campo("fig-energia-max").value = item?.energia?.max ?? 10;
  for (const attr of ["FOR", "DES", "INT", "SAB", "PRE", "VON"]) campo(`fig-attr-${attr}`).value = item?.atributos?.[attr] ?? "";
  campo("fig-papel-label").classList.toggle("hidden", tipo !== "npcs");
  campo("fig-segredo-label").classList.toggle("hidden", tipo !== "npcs");
  const legados = campo("fig-ataques-legados");
  legados.replaceChildren();
  if (item?.ataques?.length) {
    legados.append(criar("p", "fig-discreto", "Ataques anteriores preservados:"));
    for (const a of item.ataques) legados.append(criar("p", "fig-discreto", `${a.nome} · ${a.dado} · ${a.tipo || ""}`));
  }
  renderizarPoderesFig();
  previaFigurante();
  abrirJanelaFig("fig-editor");
  protegerEditorMestre("fig-editor", () => figurantes.poderes);
  campo("fig-nome").focus();
}

function lerVitalFig(prefixo) {
  const max = Number(campo(`fig-${prefixo}-max`).value);
  const atual = Number(campo(`fig-${prefixo}-atual`).value);
  return { atual: Math.max(0, Math.min(max, atual)), max };
}

async function salvarFichaFigurante(event) {
  event?.preventDefault();
  if (figurantes.ocupada || !figurantes.editando || !campo("fig-form").reportValidity()) return;
  const { tipo, original } = figurantes.editando;
  const nome = campo("fig-nome").value.trim();
  if (!nome) return toast("Dê um nome ao figurante.", "error");
  const imagem = campo("fig-imagem").value.trim();
  if (imagem && !urlDeImagem(imagem)) return toast("Retrato inválido. Use http/https ou um caminho /…", "error");
  const atributos = {};
  for (const attr of ["FOR", "DES", "INT", "SAB", "PRE", "VON"]) {
    const valor = campo(`fig-attr-${attr}`).value;
    if (valor !== "") atributos[attr] = Number(valor);
  }
  const item = {
    ...(original?.id ? { id: original.id } : {}), nome, descricao: campo("fig-descricao").value,
    lore: campo("fig-lore").value, energia: lerVitalFig("energia"), atributos,
    habilidades: figurantes.poderes.habilidades, magias: figurantes.poderes.magias,
  };
  if (original && JSON.stringify(item.energia) === JSON.stringify(original.energia)) delete item.energia;
  if (tipo === "npcs") {
    Object.assign(item, { retrato: imagem, hp: lerVitalFig("hp"), notas: campo("fig-notas").value, papel: campo("fig-papel").value, segredo: campo("fig-segredo").value });
    if (original && JSON.stringify(item.hp) === JSON.stringify(original.hp)) delete item.hp;
  } else Object.assign(item, { imagem, hpMax: Number(campo("fig-hp-max").value), nota: campo("fig-notas").value, ataques: original?.ataques || [] });
  bloquearCamposEnvioMestre("fig-form", true);
  figurantes.ocupada = true;
  campo("fig-salvar").disabled = true;
  campo("fig-salvamento").textContent = "Gravando no servidor…";
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo, item }, { muda: true });
    atualizarItemFig(tipo, salvo);
    figurantes.ocupada = false;
    fecharJanelaFig("fig-editor", true);
    toast(`${salvo.nome} salvo em Figurante/${tipo === "npcs" ? "NPCs" : "Inimigos"}/.`, "success");
  } catch { /* o aviso do servidor preserva a ficha aberta */ }
  finally { bloquearCamposEnvioMestre("fig-form", false); figurantes.ocupada = false; campo("fig-salvar").disabled = false; campo("fig-salvamento").textContent = "Alterações são salvas ao confirmar."; }
}

function atualizarItemFig(tipo, item) {
  const indice = figurantes[tipo].findIndex((x) => x.id === item.id);
  if (indice < 0) figurantes[tipo].push(item); else figurantes[tipo][indice] = item;
  renderizarFigurantes();
}

function textoPoderFig(p) {
  return [p.dice, p.cost?.amount ? `${p.cost.amount} ${p.cost.vital === "vigor" ? "energia" : p.cost.vital}` : "Sem custo", p.alcance, p.duracao, p.canalizacao ? `Conjuração: ${p.canalizacao}` : ""].filter(Boolean).join(" · ");
}

function renderizarPoderesFig() {
  const area = campo("fig-poderes-lista");
  area.replaceChildren();
  for (const tipo of ["habilidades", "magias"]) figurantes.poderes[tipo].forEach((p, indice) => {
    const linha = criar("div", "fig-poder-linha");
    const topo = criar("div", "fig-topo");
    topo.append(criar("strong", "", `${tipo === "magias" ? "✧ Magia" : "✦ Habilidade"} · ${p.nome}`));
    const acoes = criar("div", "fig-acoes");
    const editar = botaoDeAcao("editar-poder", "Editar");
    editar.addEventListener("click", () => abrirCriacaoPoderFig({ tipo, indice, poder: p }));
    const remover = botaoDeAcao("remover-poder", "Remover", "fig-perigo");
    remover.addEventListener("click", () => { figurantes.poderes[tipo].splice(indice, 1); renderizarPoderesFig(); });
    acoes.append(editar, remover); topo.append(acoes); linha.append(topo);
    linha.append(criar("p", "fig-discreto", textoPoderFig(p)));
    if (p.desc || p.nota) linha.append(criar("p", "fig-discreto", p.desc || p.nota));
    if (p.efeito) linha.append(criar("p", "fig-discreto", `Efeito: ${p.efeito}`));
    if (p.danosExtras?.length) linha.append(criar("p", "fig-discreto", p.danosExtras.map((d) => [d.tipo, d.dado, d.efeito].filter(Boolean).join(" · ")).join("\n")));
    area.append(linha);
  });
  if (!area.children.length) area.append(criar("p", "fig-discreto", "Nenhum poder adicionado. Escolha no catálogo ou crie um novo."));
}

async function abrirCatalogoFig() {
  abrirJanelaFig("fig-catalogo");
  campo("fig-catalogo-lista").textContent = "Carregando catálogo…";
  try {
    const dados = await pedirAoServidor("master_campanha_ler");
    figurantes.habilidades = dados.habilidades; figurantes.magias = dados.magias;
    renderizarCatalogoFig();
  } catch { campo("fig-catalogo-lista").textContent = "Não foi possível carregar o catálogo. Feche e tente novamente."; }
}

function renderizarCatalogoFig() {
  const tipo = campo("fig-catalogo-tipo").value;
  const busca = semAcento(campo("fig-catalogo-busca").value);
  const area = campo("fig-catalogo-lista"); area.replaceChildren();
  const lista = figurantes[tipo].filter((p) => !busca || semAcento(`${p.nome} ${p.desc} ${p.efeito || ""}`).includes(busca));
  for (const p of lista) {
    const linha = criar("div", "fig-catalogo-item");
    linha.append(criar("strong", "", p.nome), criar("p", "fig-discreto", textoPoderFig(p)), criar("p", "fig-discreto", p.desc));
    const adicionado = figurantes.poderes[tipo].some((x) => x.catalogId === p.id);
    const botao = botaoDeAcao("adicionar-catalogo", adicionado ? "Adicionado" : "Adicionar");
    botao.disabled = adicionado;
    botao.addEventListener("click", () => {
      if (figurantes.poderes[tipo].length >= 20) return toast("Limite de 20 por tipo.", "error");
      const { id, publico, criadoEm, atualizadoEm, ...copia } = copiarFigurante(p);
      figurantes.poderes[tipo].push({ ...copia, catalogId: id });
      renderizarPoderesFig(); renderizarCatalogoFig();
    });
    linha.append(botao); area.append(linha);
  }
  if (!lista.length) area.append(criar("p", "fig-vazio", "Nenhuma entrada encontrada. Crie um poder para começar."));
}

let poderEditandoFig = null;
function abrirCriacaoPoderFig(edicao = null) {
  poderEditandoFig = edicao;
  campo("fig-poder-form").reset();
  campo("fig-extras").replaceChildren();
  campo("fig-poder-titulo").textContent = edicao ? "Editar cópia do poder" : "Criar poder";
  campo("fig-poder-salvar").textContent = edicao ? "Aplicar na ficha" : "Criar e adicionar";
  campo("fig-poder-tipo").disabled = Boolean(edicao);
  campo("fig-poder-catalogar").checked = !edicao;
  campo("fig-poder-catalogar").disabled = Boolean(edicao);
  const p = edicao?.poder || {};
  campo("fig-poder-tipo").value = edicao?.tipo || "habilidades";
  for (const [id, valor] of Object.entries({ nome: p.nome, descricao: p.desc || p.nota, efeito: p.efeito, dano: p.dice, alcance: p.alcance, duracao: p.duracao, canalizacao: p.canalizacao })) campo(`fig-poder-${id}`).value = valor || "";
  campo("fig-poder-custo").value = p.cost?.amount ?? 0;
  const vital = p.cost?.vital || "vigor";
  campo("fig-poder-custo").parentElement.firstChild.textContent = `Custo em ${{ hp: "vida", vigor: "energia", sanity: "sanidade" }[vital] || vital}`;
  (p.danosExtras || []).forEach(adicionarDanoExtraFig);
  abrirJanelaFig("fig-poder-editor");
  protegerEditorMestre("fig-poder-editor");
}

function adicionarDanoExtraFig(valor = {}) {
  if (campo("fig-extras").children.length >= 10) return toast("Limite de 10 danos extras.", "error");
  const linha = criar("div", "fig-extra");
  for (const [id, texto, max] of [["tipo", "Tipo", 40], ["dado", "Dano (ex.: 1d6)", 30], ["efeito", "Efeito / condição", 200]]) {
    const label = criar("label", "", texto);
    const input = criar("input"); input.dataset.campo = id; input.maxLength = max; input.value = valor[id] || "";
    label.append(input); linha.append(label);
  }
  const excluir = botaoDeAcao("remover-extra", "✕", "fig-perigo");
  excluir.setAttribute("aria-label", "Remover dano extra");
  excluir.addEventListener("click", () => linha.remove()); linha.append(excluir); campo("fig-extras").append(linha);
}

async function salvarPoderFig(event) {
  event?.preventDefault();
  if (figurantes.ocupada || !campo("fig-poder-form").reportValidity()) return;
  const tipo = campo("fig-poder-tipo").value;
  if (!poderEditandoFig && figurantes.poderes[tipo].length >= 20) return toast("Limite de 20 por tipo.", "error");
  let item = {
    ...(poderEditandoFig?.poder || {}), nome: campo("fig-poder-nome").value.trim(), desc: campo("fig-poder-descricao").value,
    efeito: campo("fig-poder-efeito").value, dice: campo("fig-poder-dano").value.trim(),
    cost: { vital: poderEditandoFig?.poder?.cost?.vital || "vigor", amount: Number(campo("fig-poder-custo").value) },
    alcance: campo("fig-poder-alcance").value, duracao: campo("fig-poder-duracao").value, canalizacao: campo("fig-poder-canalizacao").value,
    danosExtras: [...campo("fig-extras").children].map((linha) => Object.fromEntries([...linha.querySelectorAll("input")].map((i) => [i.dataset.campo, i.value.trim()]))),
  };
  if (!item.nome) return toast("Dê um nome ao poder.", "error");
  if ([item.dice, ...item.danosExtras.map((d) => d.dado)].some((d) => d && !DADO_FIGURANTE.test(d))) return toast("Dado inválido. Use, por exemplo, 1d20+5 ou 2d6.", "error");
  bloquearCamposEnvioMestre("fig-poder-form", true);
  figurantes.ocupada = true; campo("fig-poder-salvar").disabled = true;
  try {
    if (!poderEditandoFig && campo("fig-poder-catalogar").checked) {
      const salvo = await pedirAoServidor("master_campanha_salvar", { tipo, item: { ...item, publico: false } }, { muda: true });
      item = { ...salvo, catalogId: salvo.id }; delete item.id;
      atualizarItemFig(tipo, salvo);
    }
    if (poderEditandoFig) figurantes.poderes[tipo][poderEditandoFig.indice] = item;
    else figurantes.poderes[tipo].push(item);
    renderizarPoderesFig(); figurantes.ocupada = false; fecharJanelaFig("fig-poder-editor", true);
  } catch { /* conserva os campos em caso de erro */ }
  finally { bloquearCamposEnvioMestre("fig-poder-form", false); figurantes.ocupada = false; campo("fig-poder-salvar").disabled = false; }
}

function medidoresFig(item, tipo) {
  const linha = criar("div", "fig-medidores");
  const hp = item.hp || { atual: item.hpMax, max: item.hpMax };
  linha.append(criar("span", "", `Vida ${hp.atual}/${hp.max}`), criar("span", "", `Energia ${item.energia?.atual ?? 10}/${item.energia?.max ?? 10}`));
  return linha;
}

function cartaoFigurante(item, tipo, batalha = false) {
  const card = criar("article", "fig-cartao"); card.dataset.id = batalha ? item.alvoId : item.id;
  card.dataset.uiChave = JSON.stringify([tipo, card.dataset.id]);
  const topo = criar("div", "fig-topo"); const imagem = miniaturaDeImagem(item.imagem || item.retrato);
  topo.append(criar("h3", "", item.nome)); if (imagem) topo.append(imagem); card.append(topo, medidoresFig(item, tipo));
  if (item.descricao) card.append(criar("p", "fig-discreto", item.descricao.slice(0, 200)));
  if (batalha && item.derrotado) card.append(criar("p", "fig-discreto", "Derrotado"));
  const qtdPoderes = (item.habilidades?.length || 0) + (item.magias?.length || 0);
  card.append(criar("p", "fig-discreto", `${qtdPoderes} poder(es) · ${(item.ataques || []).length} ataque(s) anterior(es)`));
  const acao = (rotulo, tratar, classe = "") => { const b = botaoDeAcao(rotulo, rotulo, classe); b.addEventListener("click", () => tratar(b)); return b; };
  const acoes = criar("div", "fig-acoes");
  if (!batalha) {
    acoes.append(acao("Abrir ficha", () => abrirFichaFigurante(item)), acao("Duplicar", async () => {
      const copia = copiarFigurante(item); delete copia.id; copia.nome = `${copia.nome} (cópia)`.slice(0, 80);
      try { atualizarItemFig(tipo, await pedirAoServidor("master_campanha_salvar", { tipo, item: copia }, { muda: true })); } catch { /* aviso comum */ }
    }), acao("Excluir", (b) => confirmarNoBotao(b, async () => {
      try { await pedirAoServidor("master_campanha_remover", { tipo, id: item.id }, { muda: true }); } catch { /* aviso comum */ }
    }), "fig-perigo"));
    if (tipo === "inimigos") {
      const quantidade = criar("input"); quantidade.type = "number"; quantidade.value = "1"; quantidade.min = "1"; quantidade.max = "20"; quantidade.style.width = "65px"; quantidade.setAttribute("aria-label", "Cópias na batalha");
      quantidade.dataset.preservar = 'copias';
      acoes.append(quantidade, acao("Colocar em batalha", async () => { if (!quantidade.reportValidity()) return; try { await pedirAoServidor("master_batalha_adicionar", { modeloId: item.id, quantidade: Number(quantidade.value) }, { muda: true }); toast("Inimigo adicionado à batalha.", "success"); } catch { /* aviso comum */ } }));
    }
  }
  if (batalha || tipo === "npcs") {
    for (const delta of [-5, -1, 1, 5]) acoes.append(acao(`${delta > 0 ? "+" : ""}${delta} vida`, async () => {
      try { await pedirAoServidor(batalha ? "master_batalha_hp" : "master_npc_hp", batalha ? { alvoId: item.alvoId, delta } : { id: item.id, delta }, { muda: true }); } catch { /* aviso comum */ }
    }));
  }
  for (const delta of [-1, 1]) acoes.append(acao(`${delta > 0 ? "+" : ""}${delta} energia`, () => ajustarEnergiaFig(tipo, item, delta, batalha)));
  for (const recurso of (batalha || tipo === 'npcs' ? ['hp', 'energia'] : ['energia'])) {
    const atual = () => {
      const lista = batalha ? figurantes.batalha.combatentes : figurantes[tipo];
      const vivo = lista.find(x => (batalha ? x.alvoId : x.id) === (batalha ? item.alvoId : item.id));
      const v = vivo?.[recurso];
      return v ? { current: v.atual, max: v.max } : null;
    };
    acoes.append(acao(`Ajustar ${recurso === 'hp' ? 'vida' : 'energia'}…`, () => RPGUI.ajustarValor({
      titulo: `${item.nome} · ${recurso === 'hp' ? 'Vida' : 'Energia'}`, ler: atual,
      aplicar: delta => recurso === 'energia'
        ? pedirAoServidor('master_figurante_energia', { tipo: batalha ? 'batalha' : tipo, id: item.alvoId || item.id, delta }, { muda: true })
        : pedirAoServidor(batalha ? 'master_batalha_hp' : 'master_npc_hp', batalha ? { alvoId: item.alvoId, delta } : { id: item.id, delta }, { muda: true }),
    })));
  }
  for (const lista of ["habilidades", "magias"]) (item[lista] || []).forEach((p, indice) => {
    const linha = criar("details", "fig-poder-linha"); linha.append(criar("summary", "fig-discreto", p.nome), criar("p", "fig-discreto", textoPoderFig(p)), criar("p", "fig-discreto", p.desc || p.nota || ""), criar("p", "fig-discreto", p.efeito || ""));
    linha.dataset.detalhe = JSON.stringify([lista, p.uid || p.id || `${p.catalogId || p.nome}:${indice}`]);
    for (const d of p.danosExtras || []) linha.append(criar("p", "fig-discreto", `${d.tipo} · ${d.dado} · ${d.efeito}`));
    if (p.cost?.vital === "vigor" && p.cost.amount > 0) linha.append(acao(`Usar (${p.cost.amount} energia)`, async () => {
      try { await pedirAoServidor("master_figurante_usar_poder", { tipo: batalha ? "batalha" : tipo, id: item.alvoId || item.id, lista, indice, nome: p.nome }, { muda: true }); toast("Energia consumida. Aplique o efeito conforme as regras da mesa.", "success"); } catch { /* aviso comum */ }
    }));
    card.append(linha);
  });
  if (batalha) acoes.append(acao(item.derrotado ? "Reerguer" : "Derrotado", async () => {
    try { await pedirAoServidor("master_batalha_derrotado", { alvoId: item.alvoId, derrotado: !item.derrotado }, { muda: true }); } catch { /* aviso comum */ }
  }), acao("Remover da batalha", async () => { try { await pedirAoServidor("master_batalha_remover", { alvoId: item.alvoId }, { muda: true }); } catch { /* aviso comum */ } }, "fig-perigo"));
  card.append(acoes); return card;
}

async function ajustarEnergiaFig(tipo, item, delta, batalha = false) {
  try { await pedirAoServidor("master_figurante_energia", { tipo: batalha ? "batalha" : tipo, id: item.alvoId || item.id, delta }, { muda: true }); } catch { /* aviso comum */ }
}

function renderizarFigurantes() {
  const tipo = figurantes.tipo;
  const termo = semAcento(campo("fig-busca").value);
  campo("fig-novo").textContent = `+ Novo ${rotuloFigurante()}`;
  for (const aba of ["biblioteca", "batalha"]) {
    campo(`fig-${aba}`).classList.toggle("hidden", figurantes.aba !== aba);
    campo(`fig-aba-${aba}`).setAttribute("aria-selected", String(figurantes.aba === aba));
    campo(`fig-aba-${aba}`).tabIndex = figurantes.aba === aba ? 0 : -1;
    campo(`fig-aba-${aba}`).setAttribute("aria-controls", `fig-${aba}`);
    campo(`fig-${aba}`).setAttribute("role", "tabpanel");
    campo(`fig-${aba}`).setAttribute("aria-labelledby", `fig-aba-${aba}`);
  }
  campo("fig-busca").disabled = figurantes.aba !== "biblioteca";
  campo("fig-novo").classList.toggle("hidden", figurantes.aba !== "biblioteca");
  const area = campo("fig-cartoes");
  const lista = figurantes[tipo].filter((x) => !termo || semAcento(`${x.nome} ${x.descricao} ${x.lore} ${x.papel || ""} ${x.notas || x.nota || ""}`).includes(termo)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  campo("fig-contagem").textContent = `${lista.length} de ${figurantes[tipo].length} figurante(s)${lista.length > 100 ? " · Exibindo os 100 primeiros. Refine a busca." : ""}`;
  RPGUI.preservarInteracao(area, () => {
    area.replaceChildren();
    lista.slice(0, 100).forEach((x) => area.append(cartaoFigurante(x, tipo)));
    if (!lista.length) area.append(criar("p", "fig-vazio", figurantes.carregou ? "Nenhum figurante encontrado. Crie o primeiro para dar vida à sua história." : "Digite o token do mestre para carregar a biblioteca."));
  });
  const batalha = campo("fig-combatentes");
  RPGUI.preservarInteracao(batalha, () => {
    batalha.replaceChildren();
    figurantes.batalha.combatentes.forEach((x) => batalha.append(cartaoFigurante(x, "batalha", true)));
    if (!batalha.children.length) batalha.append(criar("p", "fig-vazio", "A batalha está vazia. Adicione cópias de um inimigo da biblioteca."));
  });
  campo("fig-batalha-resumo").textContent = `${figurantes.batalha.combatentes.filter((x) => !x.derrotado).length} em pé / ${figurantes.batalha.combatentes.length} combatentes`;
}

async function carregarFigurantes() {
  if (!tokenDoMestre()) return;
  try {
    const dados = await pedirAoServidor("master_campanha_ler", {}, { silencioso: true });
    for (const tipo of ["npcs", "inimigos", "habilidades", "magias", "batalha"]) figurantes[tipo] = dados[tipo];
    figurantes.carregou = true; renderizarFigurantes();
  } catch { toast("Não foi possível carregar. Confira a conexão e o token do mestre.", "error"); }
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if (!["npcs", "inimigos", "habilidades", "magias", "batalha"].includes(tipo)) return;
  figurantes[tipo] = dados;
  renderizarFigurantes();
  if (!campo("fig-catalogo").classList.contains("hidden")) renderizarCatalogoFig();
});
socket.on("connect", () => setTimeout(carregarFigurantes, 0));

document.addEventListener("DOMContentLoaded", () => {
  for (const id of ["fig-hp-atual", "fig-hp-max", "fig-energia-atual", "fig-energia-max", "fig-poder-custo"]) campo(id).max = "100000";
  campo("fig-tipo").value = figurantes.tipo;
  campo("fig-tipo").addEventListener("change", (ev) => { figurantes.tipo = ev.target.value; figurantes.aba = "biblioteca"; renderizarFigurantes(); });
  for (const a of ["FOR", "DES", "INT", "SAB", "PRE", "VON"]) {
    const label = criar("label", "", a); const input = criar("input"); input.id = `fig-attr-${a}`; input.type = "number"; input.min = "0"; input.max = "999"; input.placeholder = "—"; label.append(input); campo("fig-atributos").append(label);
  }
  for (const aba of ["biblioteca", "batalha"]) campo(`fig-aba-${aba}`).addEventListener("click", () => { figurantes.aba = aba; renderizarFigurantes(); });
  campo("fig-busca").addEventListener("input", renderizarFigurantes);
  campo("fig-novo").addEventListener("click", () => abrirFichaFigurante());
  campo("fig-imagem").addEventListener("input", previaFigurante);
  campo("fig-form").addEventListener("submit", salvarFichaFigurante);
  campo("fig-adicionar-poder").addEventListener("click", abrirCatalogoFig);
  campo("fig-criar-poder").addEventListener("click", () => abrirCriacaoPoderFig());
  campo("fig-catalogo-tipo").addEventListener("change", renderizarCatalogoFig);
  campo("fig-catalogo-busca").addEventListener("input", renderizarCatalogoFig);
  campo("fig-extra-adicionar").addEventListener("click", () => adicionarDanoExtraFig());
  campo("fig-poder-form").addEventListener("submit", salvarPoderFig);
  campo("fig-limpar").addEventListener("click", (ev) => confirmarNoBotao(ev.currentTarget, async () => { try { await pedirAoServidor("master_batalha_limpar", {}, { muda: true }); } catch { /* aviso comum */ } }));
  document.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", () => fecharJanelaFig(b.dataset.fechar)));
  document.addEventListener("keydown", (ev) => {
    const janela = janelasFig.at(-1); if (!janela) return;
    if (ev.key === "Escape") { ev.preventDefault(); fecharJanelaFig(janela.id); }
    if (ev.key === "Tab") {
      const foco = [...campo(janela.id).querySelectorAll("button, input, select, textarea, summary")].filter((e) => !e.disabled && !e.closest(".hidden") && (!e.closest("details:not([open])") || e.tagName === "SUMMARY"));
      const primeiro = foco[0], ultimo = foco.at(-1);
      if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo?.focus(); }
      else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro?.focus(); }
    }
  });
  campo("master-token-input")?.addEventListener("change", () => setTimeout(carregarFigurantes, 50));
  renderizarFigurantes();
});

/* =========================================================================
   PÁGINA INIMIGOS (Sprint 5): biblioteca e batalha
   Biblioteca: criar, editar, duplicar, excluir inimigos (com ataques e habilidades resumidos).
   Batalha: colocar cópias numeradas, ajustar HP, derrotado, remover, limpar. A batalha mora no servidor
   (fonte da verdade): esta página só mostra o que ele devolve e manda ações; as ações de HP são deltas
   atômicos no servidor, então cliques rápidos ou duas abas do mestre nunca se perdem.
   Texto do usuário só entra na tela por textContent (R8).
   ========================================================================= */

const ATRIBUTOS_INI = ["FOR", "DES", "INT", "SAB", "PRE", "VON"];
const ini = { aba: "biblioteca", inimigos: [], batalha: { ativa: false, combatentes: [] }, busca: "", editando: null, carregou: false };

function resumoDeAtaque(a) {
  return [a.nome, a.dado, a.tipo, a.alcance].filter(Boolean).join(" · ");
}

/* ------------------------------ abas ------------------------------ */
function renderizarAbas() {
  for (const aba of ["biblioteca", "batalha"]) {
    const ativa = aba === ini.aba;
    const b = campo(`ini-aba-${aba}`);
    b.setAttribute("aria-selected", String(ativa));
    b.className = `px-3 py-1.5 rounded text-xs font-mono border ${ativa ? "border-amberGold-600 text-amberGold-400" : "border-dungeon-700 text-slate-400"}`;
    b.textContent = aba === "biblioteca" ? `Biblioteca (${ini.inimigos.length})` : `Batalha (${ini.batalha.combatentes.length})`;
    campo(`ini-${aba}`).classList.toggle("hidden", !ativa);
  }
}

/* ------------------------------ biblioteca ------------------------------ */
function criarCartaoInimigo(m) {
  const c = criar("div", "bg-dungeon-950 border border-dungeon-700 rounded-lg p-3 space-y-2");
  c.dataset.id = m.id;
  const topo = criar("div", "flex gap-2 items-start");
  const img = miniaturaDeImagem(m.imagem);
  if (img) topo.append(img);
  const titulo = criar("div", "min-w-0 flex-1");
  titulo.append(criar("h4", "font-cinzel font-bold text-amber-200 text-sm break-words", m.nome));
  titulo.append(criar("p", "text-[11px] text-rose-300 font-mono", `HP ${m.hpMax}`));
  topo.append(titulo);
  c.append(topo);
  const lista = criar("ul", "text-[11px] text-slate-300 font-mono space-y-0.5");
  m.ataques.slice(0, 4).forEach((a) => lista.append(criar("li", "", resumoDeAtaque(a))));
  if (m.ataques.length > 4) lista.append(criar("li", "text-slate-500", `+${m.ataques.length - 4} ataques`));
  m.habilidades.slice(0, 3).forEach((h) => lista.append(criar("li", "text-slate-400", `✦ ${h.nome}`)));
  c.append(lista);

  const batalhar = criar("div", "flex gap-1.5 items-center");
  const qtd = criar("input", "w-14 bg-dungeon-900 border border-dungeon-700 rounded px-1 py-0.5 text-xs");
  qtd.type = "number";
  qtd.min = "1";
  qtd.max = "20";
  qtd.value = "1";
  qtd.dataset.campo = "copias";
  batalhar.append(qtd, botaoDeAcao("batalhar", "Colocar em batalha", "bg-amberGold-600 text-white"));
  c.append(batalhar);
  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(botaoDeAcao("editar", "Editar"), botaoDeAcao("duplicar", "Duplicar"), botaoDeAcao("excluir", "Excluir", "text-rose-300"));
  c.append(acoes);
  return c;
}

function renderizarBiblioteca() {
  const termo = semAcento(ini.busca);
  const area = campo("ini-cartoes");
  area.replaceChildren();
  const lista = ini.inimigos
    .filter((m) => !termo || semAcento(`${m.nome} ${m.nota}`).includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!lista.length) area.append(criar("p", "text-xs text-slate-500 italic col-span-full", ini.inimigos.length ? "Nada encontrado." : 'Nenhum inimigo ainda. Use "+ Novo inimigo".'));
  lista.forEach((m) => area.append(criarCartaoInimigo(m)));
}

/* ------------------------------ editor ------------------------------ */
function criarLinha(contenedor, campos, valores = {}) {
  const linha = criar("div", "grid gap-1 items-center border border-dungeon-800 rounded p-1");
  linha.style.gridTemplateColumns = `repeat(${campos.length}, minmax(0, 1fr)) auto`;
  for (const [nome, rotulo, max] of campos) {
    const input = criar("input", "w-full bg-dungeon-950 border border-dungeon-700 rounded px-1 py-0.5");
    input.placeholder = rotulo;
    input.maxLength = max;
    input.dataset.campo = nome;
    input.value = valores[nome] || "";
    linha.append(input);
  }
  const remover = botaoDeAcao("remover-linha", "✕", "text-rose-300");
  remover.addEventListener("click", () => linha.remove());
  linha.append(remover);
  contenedor.append(linha);
}

const CAMPOS_ATAQUE = [["nome", "Nome", 60], ["dado", "Dado (1d6+2)", 30], ["tipo", "Tipo", 40], ["alcance", "Alcance", 40], ["nota", "Nota", 200]];
const CAMPOS_HABILIDADE = [["nome", "Nome", 60], ["nota", "Nota", 200]];

function lerLinhas(id) {
  return [...campo(id).children].map((l) => Object.fromEntries([...l.querySelectorAll("input")].map((i) => [i.dataset.campo, i.value.trim()])));
}

function abrirEditorInimigo(m) {
  ini.editando = { id: m?.id ?? null };
  const e = m || {};
  campo("in-titulo").textContent = m ? "Editar inimigo" : "Novo inimigo";
  campo("in-nome").value = e.nome || "";
  campo("in-imagem").value = e.imagem || "";
  campo("in-hpMax").value = e.hpMax ?? 10;
  for (const a of ATRIBUTOS_INI) campo(`in-attr-${a}`).value = e.atributos?.[a] ?? "";
  campo("in-ataques").replaceChildren();
  campo("in-habilidades").replaceChildren();
  (e.ataques || []).forEach((a) => criarLinha(campo("in-ataques"), CAMPOS_ATAQUE, a));
  (e.habilidades || []).forEach((h) => criarLinha(campo("in-habilidades"), CAMPOS_HABILIDADE, h));
  campo("in-nota").value = e.nota || "";
  campo("ini-editor").classList.remove("hidden");
  campo("in-nome").focus();
}
function fecharEditorInimigo() {
  ini.editando = null;
  campo("ini-editor").classList.add("hidden");
}

async function salvarInimigo() {
  const atributos = {};
  for (const a of ATRIBUTOS_INI) if (campo(`in-attr-${a}`).value !== "") atributos[a] = Number(campo(`in-attr-${a}`).value);
  const ataques = lerLinhas("in-ataques").filter((a) => a.nome || a.dado);
  const item = {
    nome: campo("in-nome").value.trim(),
    imagem: campo("in-imagem").value.trim(),
    hpMax: Math.max(1, Math.floor(Number(campo("in-hpMax").value)) || 1),
    atributos,
    ataques,
    habilidades: lerLinhas("in-habilidades").filter((h) => h.nome),
    nota: campo("in-nota").value,
  };
  if (ini.editando?.id) item.id = ini.editando.id;
  if (!item.nome) return toast("Dê um nome ao inimigo.", "error");
  if (item.imagem && !urlDeImagem(item.imagem)) return toast("Imagem inválida: use uma URL http/https ou um caminho que comece com /.", "error");
  const dadoRuim = ataques.find((a) => a.dado && !/^\d{0,3}d\d{1,4}\s*([+-]\s*\d{1,4})?$/i.test(a.dado));
  if (dadoRuim) return toast(`Dado inválido em "${dadoRuim.nome || "ataque"}". Exemplos: 1d6, 2d8+3.`, "error");
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: "inimigos", item }, { muda: true });
    toast(`Inimigo salvo: ${salvo.nome}`, "success");
    fecharEditorInimigo();
  } catch { /* erro já mostrado; o editor continua aberto */ }
}

async function duplicarInimigo(m) {
  const copia = { ...m, nome: `${m.nome} (cópia)`.slice(0, 80) };
  delete copia.id;
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: "inimigos", item: copia }, { muda: true });
    toast("Inimigo duplicado.", "success");
  } catch { /* aviso já mostrado */ }
}

async function colocarEmBatalha(m, quantidade) {
  const q = Math.floor(Number(quantidade));
  if (!Number.isInteger(q) || q < 1 || q > 20) return toast("Escolha de 1 a 20 cópias.", "error");
  try {
    const r = await pedirAoServidor("master_batalha_adicionar", { modeloId: m.id, quantidade: q }, { muda: true });
    toast(`Em batalha: ${r.adicionados.map((a) => a.nome).join(", ")}`, "success");
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ batalha ------------------------------ */
function criarCartaoCombatente(c) {
  const el = criar("div", `bg-dungeon-950 border rounded-lg p-3 space-y-2 ${c.derrotado ? "border-slate-700 opacity-60" : "border-dungeon-700"}`);
  el.dataset.alvoId = c.alvoId;
  el.dataset.derrotado = c.derrotado ? "1" : "0";
  const topo = criar("div", "flex gap-2 items-start");
  const img = miniaturaDeImagem(c.imagem);
  if (img) topo.append(img);
  const titulo = criar("div", "min-w-0 flex-1");
  titulo.append(criar("h4", `font-cinzel font-bold text-sm break-words ${c.derrotado ? "line-through text-slate-500" : "text-amber-200"}`, c.nome));
  if (c.derrotado) titulo.append(criar("p", "text-[10px] font-mono text-slate-500", "Derrotado"));
  topo.append(titulo);
  el.append(topo);

  const pct = c.hp.max ? Math.round((c.hp.atual / c.hp.max) * 100) : 0;
  const barra = criar("div", "h-1.5 bg-dungeon-800 rounded overflow-hidden");
  const enche = criar("div", "h-full bg-rose-500");
  enche.style.width = `${pct}%`;
  barra.append(enche);
  el.append(barra);

  const hp = criar("div", "flex items-center gap-1.5 text-[11px] font-mono");
  hp.append(botaoDeAcao("hp-5", "−5"), botaoDeAcao("hp-1", "−1"));
  const valor = criar("span", "flex-1 text-center text-rose-300", `HP ${c.hp.atual}/${c.hp.max}`);
  valor.dataset.hp = "1";
  hp.append(valor, botaoDeAcao("hp+1", "+1"), botaoDeAcao("hp+5", "+5"));
  el.append(hp);

  if (c.ataques.length || c.habilidades.length) {
    const lista = criar("ul", "text-[10px] text-slate-400 font-mono space-y-0.5");
    c.ataques.forEach((a) => lista.append(criar("li", "", resumoDeAtaque(a))));
    c.habilidades.forEach((h) => lista.append(criar("li", "text-slate-500", `✦ ${h.nome}${h.nota ? ` — ${h.nota}` : ""}`)));
    el.append(lista);
  }
  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(botaoDeAcao("derrotado", c.derrotado ? "Reerguer" : "Derrotado"), botaoDeAcao("remover", "Remover", "text-rose-300"));
  el.append(acoes);
  return el;
}

function renderizarBatalha() {
  const area = campo("ini-combatentes");
  area.replaceChildren();
  const cs = ini.batalha.combatentes;
  if (!cs.length) area.append(criar("p", "text-xs text-slate-500 italic col-span-full", 'Nenhuma batalha. Use "Colocar em batalha" na biblioteca.'));
  cs.forEach((c) => area.append(criarCartaoCombatente(c)));
  const vivos = cs.filter((c) => !c.derrotado).length;
  campo("ini-batalha-resumo").textContent = cs.length ? `${vivos} de ${cs.length} em pé` : "";
}

async function agirNaBatalha(evento, dados) {
  try {
    await pedirAoServidor(evento, dados, { muda: true });
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ carga e eventos ------------------------------ */
function renderizarTudo() {
  renderizarAbas();
  renderizarBiblioteca();
  renderizarBatalha();
}

async function carregarInimigos() {
  if (!tokenDoMestre()) return;
  try {
    ini.inimigos = await pedirAoServidor("master_campanha_ler", { tipo: "inimigos" }, { silencioso: true });
    ini.batalha = await pedirAoServidor("master_campanha_ler", { tipo: "batalha" }, { silencioso: true });
    ini.carregou = true;
  } catch (erro) {
    if (erro.codigo === "nao_autorizado") toast("Token/Senha do mestre incorreta!", "error");
  }
  renderizarTudo();
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if (tipo === "inimigos" && Array.isArray(dados)) ini.inimigos = dados;
  else if (tipo === "batalha" && dados && Array.isArray(dados.combatentes)) ini.batalha = dados;
  else return;
  renderizarTudo();
});
socket.on("connect", () => setTimeout(carregarInimigos, 0));

document.addEventListener("DOMContentLoaded", () => {
  for (const aba of ["biblioteca", "batalha"]) {
    campo(`ini-aba-${aba}`).addEventListener("click", () => {
      ini.aba = aba;
      renderizarAbas();
    });
  }
  campo("ini-busca").addEventListener("input", (ev) => {
    ini.busca = ev.target.value;
    renderizarBiblioteca();
  });
  campo("ini-novo").addEventListener("click", () => abrirEditorInimigo(null));
  campo("in-add-ataque").addEventListener("click", () => {
    if (campo("in-ataques").children.length < 20) criarLinha(campo("in-ataques"), CAMPOS_ATAQUE);
  });
  campo("in-add-habilidade").addEventListener("click", () => {
    if (campo("in-habilidades").children.length < 20) criarLinha(campo("in-habilidades"), CAMPOS_HABILIDADE);
  });
  campo("in-salvar").addEventListener("click", salvarInimigo);
  campo("in-cancelar").addEventListener("click", fecharEditorInimigo);

  campo("ini-cartoes").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const cartao = ev.target.closest("[data-id]");
    const m = b && ini.inimigos.find((x) => x.id === cartao?.dataset.id);
    if (!m) return;
    const acao = b.dataset.acao;
    if (acao === "editar") abrirEditorInimigo(m);
    else if (acao === "duplicar") duplicarInimigo(m);
    else if (acao === "batalhar") colocarEmBatalha(m, cartao.querySelector('[data-campo="copias"]').value);
    else if (acao === "excluir") {
      confirmarNoBotao(b, () =>
        pedirAoServidor("master_campanha_remover", { tipo: "inimigos", id: m.id }, { muda: true })
          .then(() => toast("Inimigo excluído (quem já está em batalha continua).", "success"))
          .catch(() => {}));
    }
  });

  campo("ini-combatentes").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const alvoId = ev.target.closest("[data-alvo-id]")?.dataset.alvoId;
    const c = b && ini.batalha.combatentes.find((x) => x.alvoId === alvoId);
    if (!c) return;
    const acao = b.dataset.acao;
    if (acao.startsWith("hp")) agirNaBatalha("master_batalha_hp", { alvoId, delta: { "hp-5": -5, "hp-1": -1, "hp+1": 1, "hp+5": 5 }[acao] });
    else if (acao === "derrotado") agirNaBatalha("master_batalha_derrotado", { alvoId, derrotado: !c.derrotado });
    else if (acao === "remover") agirNaBatalha("master_batalha_remover", { alvoId });
  });
  campo("ini-limpar").addEventListener("click", (ev) => {
    confirmarNoBotao(ev.currentTarget, () => agirNaBatalha("master_batalha_limpar", {}));
  });

  campo("master-token-input")?.addEventListener("change", () => setTimeout(carregarInimigos, 50));
  renderizarTudo();
});

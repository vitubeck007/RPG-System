/* =========================================================================
   PÁGINA ROLAGEM E DANO (Sprint 6)
   Rolar dados (a rolagem acontece no SERVIDOR) e atacar: escolher os alvos (jogadores online, NPCs e
   inimigos em batalha), um multiplicador por alvo (×1, ×½, ×2), ver a prévia e aplicar. A prévia usa a
   MESMA conta do servidor (calcularDano, de JS/regras.js). Texto só por textContent (R8).
   ========================================================================= */

const MULT_ROTULO = { 1: "×1", 0.5: "×½", 2: "×2" };
const MAX_HISTORICO = 30;

const rol = { historico: [], alvos: [], marcados: new Map(), ultimaAplicacao: null, carregou: false };

const estiloInput = "bg-dungeon-950 border border-dungeon-700 rounded px-2 py-1 text-xs font-mono";

/* ------------------------------ rolar ------------------------------ */
function criarLinhaDeComponente(nome = "", formula = "") {
  const linha = criar("div", "flex gap-1 items-center");
  const n = criar("input", `flex-1 ${estiloInput}`);
  n.placeholder = "Nome (opcional)";
  n.maxLength = 40;
  n.dataset.campo = "nome";
  n.value = nome;
  const f = criar("input", `w-28 ${estiloInput}`);
  f.placeholder = "2d6+3";
  f.maxLength = 30;
  f.dataset.campo = "formula";
  f.value = formula;
  const x = criar("button", "px-2 py-1 rounded text-xs border border-dungeon-700 text-rose-300", "✕");
  x.type = "button";
  x.dataset.acao = "remover-componente";
  x.addEventListener("click", () => {
    if (campo("rol-componentes").children.length > 1) linha.remove();
  });
  linha.append(n, f, x);
  campo("rol-componentes").append(linha);
}

function lerComponentes() {
  return [...campo("rol-componentes").children]
    .map((l) => ({ nome: l.querySelector('[data-campo="nome"]').value.trim(), formula: l.querySelector('[data-campo="formula"]').value.trim() }))
    .filter((c) => c.formula);
}

function descreverComponente(c) {
  const dados = c.dados.length ? `[${c.dados.join(", ")}]${c.bonus ? ` ${c.bonus > 0 ? "+" : ""}${c.bonus}` : ""}` : "";
  return `${c.nome ? `${c.nome}: ` : ""}${c.formula}${dados ? ` → ${dados}` : ""} = ${c.soma}`;
}

function resumoDaRolagem(r) {
  return r.componentes.map((c) => c.formula).join(" + ");
}

function renderizarResultadoDaRolagem(r) {
  const area = campo("rol-resultado");
  area.replaceChildren();
  area.classList.remove("hidden");
  const total = criar("div", "text-amber-200 text-base font-bold", `Total: ${r.total}`);
  total.dataset.total = String(r.total);
  area.append(total);
  r.componentes.forEach((c) => area.append(criar("div", "text-slate-300", descreverComponente(c))));
}

function renderizarHistorico() {
  const lista = campo("rol-historico");
  lista.replaceChildren();
  if (!rol.historico.length) lista.append(criar("li", "text-slate-500 italic", "Nenhuma rolagem ainda."));
  for (const r of rol.historico) {
    const li = criar("li", "flex justify-between gap-2 border-b border-dungeon-800 pb-1");
    li.dataset.rolagemId = r.rolagemId;
    li.append(criar("span", "break-words", `${r.total} · ${resumoDaRolagem(r)}`));
    const usar = criar("button", "px-2 border border-dungeon-700 rounded text-[11px] whitespace-nowrap", "Usar no ataque");
    usar.type = "button";
    usar.dataset.acao = "usar";
    li.append(usar);
    lista.append(li);
  }
}

async function rolar() {
  const componentes = lerComponentes();
  if (!componentes.length) return toast("Informe ao menos uma fórmula.", "error");
  const ruim = componentes.find((c) => !lerFormulaCombo(c.formula));
  if (ruim) return toast(`Fórmula inválida: ${ruim.formula}. Exemplos: 2d6+3, d20, +5.`, "error");
  try {
    const r = await pedirAoServidor("master_rolar", { componentes }, { muda: true });
    rol.historico.unshift(r);
    rol.historico.length = Math.min(rol.historico.length, MAX_HISTORICO);
    renderizarResultadoDaRolagem(r);
    renderizarHistorico();
    renderizarFontes(r.rolagemId);
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ atacar: fonte do dano ------------------------------ */
function renderizarFontes(selecionar) {
  const select = campo("atk-fonte");
  const atual = selecionar ?? select.value;
  select.replaceChildren();
  rol.historico.forEach((r) => select.append(new Option(`${r.total} · ${resumoDaRolagem(r)}`, r.rolagemId)));
  select.append(new Option("Valor manual…", "manual"));
  select.value = [...select.options].some((o) => o.value === atual) ? atual : select.options[0].value;
  campo("atk-valor").classList.toggle("hidden", select.value !== "manual");
  atualizarPrevias();
}

// Total do dano escolhido (ou null se ainda não há).
function totalDoDano() {
  const fonte = campo("atk-fonte").value;
  if (fonte === "manual") {
    const v = campo("atk-valor").value;
    return v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  }
  return rol.historico.find((r) => r.rolagemId === fonte)?.total ?? null;
}

/* ------------------------------ atacar: alvos ------------------------------ */
const ROTULO_TIPO = { jogador: "Jogador", npc: "NPC", inimigo: "Inimigo" };

function criarLinhaDeAlvo(a) {
  const estado = rol.marcados.get(a.alvoId) || { marcado: false, mult: 1 };
  const linha = criar("div", `flex items-center gap-2 text-xs font-mono border border-dungeon-800 rounded px-2 py-1 ${a.derrotado ? "opacity-50" : ""}`);
  linha.dataset.alvoId = a.alvoId;
  const caixa = criar("input");
  caixa.type = "checkbox";
  caixa.checked = estado.marcado;
  caixa.dataset.campo = "marcado";
  const nome = criar("span", "flex-1 min-w-0 break-words", a.nome);
  const tipo = criar("span", "px-1 rounded border border-slate-600 text-[10px] text-slate-400", ROTULO_TIPO[a.tipo] || a.tipo);
  const hp = criar("span", "text-rose-300 whitespace-nowrap", `HP ${a.hp.atual}/${a.hp.max}`);
  const mult = criar("select", estiloInput);
  mult.dataset.campo = "mult";
  [1, 0.5, 2].forEach((m) => mult.append(new Option(MULT_ROTULO[m], String(m))));
  mult.value = String(estado.mult);
  const previa = criar("span", "text-amber-200 whitespace-nowrap");
  previa.dataset.previa = "1";
  const mudou = () => {
    rol.marcados.set(a.alvoId, { marcado: caixa.checked, mult: Number(mult.value) });
    atualizarPrevias();
  };
  caixa.addEventListener("change", mudou);
  mult.addEventListener("change", mudou);
  linha.append(caixa, nome, tipo, hp, mult, previa);
  return linha;
}

// Prévia por alvo: "Goblin 2: 8 → 4 (HP 10 → 6)". Mesma conta do servidor.
function atualizarPrevias() {
  const total = totalDoDano();
  for (const linha of campo("atk-alvos").children) {
    const previa = linha.querySelector("[data-previa]");
    if (!previa) continue;
    const alvo = rol.alvos.find((a) => a.alvoId === linha.dataset.alvoId);
    const mult = Number(linha.querySelector('[data-campo="mult"]').value);
    if (total === null || !alvo) {
      previa.textContent = "—";
      continue;
    }
    const dano = calcularDano(total, mult);
    previa.textContent = `${alvo.nome}: ${total} → ${dano} (HP ${alvo.hp.atual} → ${Math.max(0, alvo.hp.atual - dano)})`;
  }
}

function renderizarAlvos() {
  const area = campo("atk-alvos");
  area.replaceChildren();
  if (!rol.alvos.length) area.append(criar("p", "text-xs text-slate-500 italic", "Nenhum alvo: abra fichas, crie NPCs ou ponha inimigos em batalha."));
  rol.alvos.forEach((a) => area.append(criarLinhaDeAlvo(a)));
  atualizarPrevias();
}

async function carregarAlvos() {
  if (!tokenDoMestre()) return;
  try {
    const r = await pedirAoServidor("master_listar_alvos", {}, { silencioso: true });
    rol.alvos = r.alvos;
    for (const id of [...rol.marcados.keys()]) if (!rol.alvos.some((a) => a.alvoId === id)) rol.marcados.delete(id);
    rol.carregou = true;
  } catch (erro) {
    if (erro.codigo === "nao_autorizado") toast("Token/Senha do mestre incorreta!", "error");
  }
  renderizarAlvos();
}

function marcarTodos(valor) {
  for (const a of rol.alvos) rol.marcados.set(a.alvoId, { marcado: valor, mult: rol.marcados.get(a.alvoId)?.mult ?? 1 });
  renderizarAlvos();
}

/* ------------------------------ aplicar e desfazer ------------------------------ */
function linhaDeResultado(r) {
  if (!r.ok) return `${r.nome || r.alvoId}: ${r.motivo === "ausente" ? "ausente (não recebeu dano)" : "não foi possível aplicar"}`;
  return `${r.nome}: ${r.dano} de dano (${MULT_ROTULO[r.mult]}) · HP ${r.antes} → ${r.depois}${r.derrotado ? " · DERROTADO" : ""}`;
}

function renderizarResultadoDoAtaque(aplicacao) {
  const area = campo("atk-resultado");
  area.replaceChildren();
  area.classList.remove("hidden");
  area.append(criar("div", "text-amber-200 font-bold", `Dano base: ${aplicacao.total}`));
  for (const r of aplicacao.resultados) {
    const l = criar("div", r.ok ? "text-slate-300" : "text-rose-300", linhaDeResultado(r));
    l.dataset.alvoId = r.alvoId;
    l.dataset.ok = r.ok ? "1" : "0";
    area.append(l);
  }
}

async function aplicarDano() {
  const marcados = [...campo("atk-alvos").children].filter((l) => l.querySelector('[data-campo="marcado"]')?.checked);
  if (!marcados.length) return toast("Marque ao menos um alvo.", "error");
  const total = totalDoDano();
  if (total === null) return toast("Escolha uma rolagem ou informe o valor do dano.", "error");
  const fonte = campo("atk-fonte").value;
  const dados = { alvos: marcados.map((l) => ({ alvoId: l.dataset.alvoId, mult: Number(l.querySelector('[data-campo="mult"]').value) })) };
  if (fonte === "manual") dados.valor = total;
  else dados.rolagemId = fonte;
  try {
    const aplicacao = await pedirAoServidor("master_aplicar_dano", dados, { muda: true });
    rol.ultimaAplicacao = aplicacao;
    renderizarResultadoDoAtaque(aplicacao);
    const desfazer = campo("atk-desfazer");
    desfazer.classList.remove("hidden");
    desfazer.dataset.aplicacaoId = aplicacao.aplicacaoId;
    await carregarAlvos();
  } catch { /* aviso já mostrado */ }
}

async function desfazerDano() {
  const id = campo("atk-desfazer").dataset.aplicacaoId;
  if (!id) return;
  try {
    const r = await pedirAoServidor("master_desfazer_dano", { aplicacaoId: id }, { muda: true });
    const area = campo("atk-resultado");
    area.replaceChildren(criar("div", "text-amber-200 font-bold", "Dano desfeito"));
    if (!r.restaurados.length) area.append(criar("div", "text-slate-400", "Nada a restaurar."));
    for (const x of r.restaurados) {
      const texto = x.ok ? `${x.nome}: HP ${x.antes} → ${x.depois}` : `${x.nome || x.alvoId}: não restaurado (${x.motivo === "hp_mudou" ? "o HP mudou desde então" : "ausente"})`;
      const l = criar("div", x.ok ? "text-slate-300" : "text-rose-300", texto);
      l.dataset.ok = x.ok ? "1" : "0";
      area.append(l);
    }
    campo("atk-desfazer").classList.add("hidden");
    await carregarAlvos();
  } catch (erro) {
    if (erro.codigo === "nao_e_a_ultima" || erro.codigo === "ja_desfeita") campo("atk-desfazer").classList.add("hidden");
  }
}

/* ------------------------------ eventos ------------------------------ */
let recarregar = null;
const recarregarAlvos = () => {
  clearTimeout(recarregar);
  recarregar = setTimeout(carregarAlvos, 150);
};
socket.on("campanha_atualizada", ({ tipo } = {}) => {
  if (tipo === "npcs" || tipo === "batalha") recarregarAlvos();
});
socket.on("player_updated", recarregarAlvos);
socket.on("player_removed", recarregarAlvos);
socket.on("connect", () => setTimeout(carregarAlvos, 0));

document.addEventListener("DOMContentLoaded", () => {
  criarLinhaDeComponente("", "d20");
  campo("rol-add").addEventListener("click", () => {
    if (campo("rol-componentes").children.length < 10) criarLinhaDeComponente();
  });
  campo("rol-rolar").addEventListener("click", rolar);
  campo("rol-historico").addEventListener("click", (ev) => {
    const b = ev.target.closest('button[data-acao="usar"]');
    if (b) renderizarFontes(b.closest("[data-rolagem-id]").dataset.rolagemId);
  });
  campo("atk-fonte").addEventListener("change", () => {
    campo("atk-valor").classList.toggle("hidden", campo("atk-fonte").value !== "manual");
    atualizarPrevias();
  });
  campo("atk-valor").addEventListener("input", atualizarPrevias);
  campo("atk-todos").addEventListener("click", () => marcarTodos(true));
  campo("atk-nenhum").addEventListener("click", () => marcarTodos(false));
  campo("atk-atualizar").addEventListener("click", carregarAlvos);
  campo("atk-aplicar").addEventListener("click", aplicarDano);
  campo("atk-desfazer").addEventListener("click", desfazerDano);
  campo("master-token-input")?.addEventListener("change", () => setTimeout(carregarAlvos, 50));
  renderizarHistorico();
  renderizarFontes();
  renderizarAlvos();
});

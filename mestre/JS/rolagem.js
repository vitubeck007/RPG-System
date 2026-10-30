/* Rolagem no servidor; Atacar é opt-in e usa a seleção das duas categorias. */
const MAX_HISTORICO = 30;
const rol = {
  historico: [], alvos: [], marcados: new Map(), ultimaAplicacao: null, ultimaRolagem: null, carregou: false,
  categoria: "jogadores", atacar: false, ocupada: false, carregando: false, erroCarga: "", ausentes: [],
};
const ROTULO_TIPO = { jogador: "Jogador", npc: "NPC", inimigo: "Inimigo" };
let leituraAlvosRol = 0;
let consultaAlvosRol = null;
let atualizacaoAlvosPendente = false;
let timerAlvosRol = null;

function erroRolagem(texto = "") {
  campo("rol-erro").textContent = texto;
  campo("rol-erro").hidden = !texto;
}
function iconeRolagem(nome) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "rpg-icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "/CSS/icones.svg#" + nome); svg.append(use); return svg;
}
function atualizarEstadoAtaque() {
  campo("atk-atacar").checked = rol.atacar;
  campo("atk-atacar").disabled = rol.ocupada;
  campo("atk-secao").dataset.atacar = String(rol.atacar);
  const selecionados = [...rol.marcados.values()].filter(x => x.marcado).length;
  campo("atk-status").textContent = (selecionados === 1 ? "1 alvo selecionado" : selecionados ? selecionados + " alvos selecionados" : "Nenhum alvo selecionado") +
    " · " + (rol.atacar ? "ataque ativado" : "ataque desativado");
  const botao = campo("atk-aplicar-ultimo"), registro = rol.ultimaRolagem;
  if (botao) {
    botao.hidden = !registro;
    botao.disabled = rol.ocupada || !registro || registro.aplicada || !selecionados;
    botao.querySelector("span").textContent = registro?.aplicada ? "Dano aplicado" : "Aplicar dano";
    botao.title = registro?.aplicada ? "Esta rolagem já aplicou dano. Faça uma nova rolagem para outro ataque."
      : !selecionados ? "Selecione os alvos para aplicar o último resultado."
      : "Aplicar o último resultado aos alvos selecionados, mesmo com Atacar desligado.";
  }
  renderizarResumoSelecao();
}
function renderizarResumoSelecao() {
  const lista = campo("atk-selecao-resumo");
  if (!lista) return;
  lista.replaceChildren();
  for (const [alvoId, estado] of rol.marcados) {
    if (!estado.marcado) continue;
    const alvo = [...rol.alvos, ...rol.ausentes].find(a => a.alvoId === alvoId);
    const linha = criar("li");
    const dano = rol.ultimaRolagem && !rol.ultimaRolagem.aplicada ? calcularDano(rol.ultimaRolagem.dados.total, estado.mult) : null;
    const nome = alvo?.nome || "Alvo indisponível";
    linha.append(criar("span", "", `${nome} · ${ROTULO_TIPO[alvo?.tipo] || "Indisponível"} · ×${estado.mult ?? "?"}${dano !== null ? ` → ${dano} de dano` : ""}`));
    const remover = criar("button", "", "×");
    remover.type = "button"; remover.disabled = rol.ocupada;
    remover.setAttribute("aria-label", `Desmarcar ${nome}`);
    remover.addEventListener("click", () => {
      if (rol.ocupada) return;
      rol.marcados.set(alvoId, { ...estado, marcado: false });
      renderizarAlvos(); campo("atk-status").focus();
    });
    linha.append(remover); lista.append(linha);
  }
}

function definirOcupadaRolagem(valor) {
  rol.ocupada = valor;
  document.querySelectorAll("[data-rol-controle]").forEach(el => { el.disabled = valor; });
  campo("rol-secao").setAttribute("aria-busy", String(valor));
  campo("atk-secao").setAttribute("aria-busy", String(valor));
  atualizarEstadoAtaque();
  campo("atk-alvos")?.querySelectorAll("button, input").forEach(el => { el.disabled = valor; });
}
function atualizarDadosInstantaneos() {
  const qtd = campo("rol-quantidade").value || "1";
  document.querySelectorAll("[data-dado]").forEach(b => {
    b.querySelector("span").textContent = qtd + "d" + b.dataset.dado;
    b.title = "Rolar " + qtd + "d" + b.dataset.dado;
  });
}
function resumoDaRolagem(r) {
  return r.expressao || r.componentes.map(c => c.formula).join(" + ");
}
function renderizarResultadoDaRolagem(r) {
  campo("rol-total").textContent = String(r.total);
  campo("rol-total").dataset.total = String(r.total);
  campo("rol-formula").textContent = resumoDaRolagem(r);
  campo("rol-espera").hidden = true;
  campo("rol-detalhes-painel").hidden = false;
  campo("rol-detalhes-painel").open = false;
  const lista = campo("rol-detalhes"); lista.replaceChildren();
  for (const c of r.componentes) {
    const dados = c.dados.length ? "[" + c.dados.join(", ") + "]" +
      (c.bonus ? " " + (c.bonus > 0 ? "+" : "") + c.bonus : "") : "valor fixo";
    lista.append(criar("li", "", c.formula + " → " + dados + " = " + c.soma));
  }
}
function renderizarHistorico() {
  campo("rol-historico-painel").hidden = !rol.historico.length;
  const lista = campo("rol-historico"); lista.replaceChildren();
  for (const r of rol.historico) {
    const item = criar("li");
    item.append(criar("strong", "", String(r.total)), document.createTextNode(" · " + resumoDaRolagem(r)));
    lista.append(item);
  }
}
function selecaoDoAtaque() {
  return [...rol.marcados].filter(([, x]) => x.marcado).map(([alvoId, x]) => ({ alvoId, mult: x.mult }));
}

async function aplicarDanoDaRolagem(registro, alvos) {
  if (registro.aplicada) return;
  if (!alvos.length) throw new Error("Selecione ao menos um alvo para aplicar o último resultado.");
  if (alvos.some(a => !validarMultiplicadorDano(a.mult))) throw new Error("Corrija o multiplicador dos alvos selecionados: use um número maior ou igual a zero.");
  if (alvos.some(a => calcularDano(registro.dados.total, a.mult) === null)) throw new Error("O dano com esse multiplicador é grande demais. Nenhum dano foi enviado.");
  let aplicacao;
  try {
    aplicacao = await pedirAoServidor("master_aplicar_dano", { rolagemId: registro.dados.rolagemId, alvos }, { muda: true });
  } catch (erro) {
    if (erro.codigo === "rolagem_ja_aplicada") registro.aplicada = true;
    throw erro;
  }
  registro.aplicada = true;
  rol.ultimaAplicacao = aplicacao;
  renderizarResultadoDoAtaque(aplicacao);
  campo("atk-desfazer").hidden = false;
  campo("atk-desfazer").dataset.aplicacaoId = aplicacao.aplicacaoId;
  await carregarAlvos();
}

async function aplicarUltimoDano() {
  if (rol.ocupada || !rol.ultimaRolagem || rol.ultimaRolagem.aplicada) return;
  erroRolagem();
  const registro = rol.ultimaRolagem, alvos = selecaoDoAtaque();
  definirOcupadaRolagem(true);
  try { await aplicarDanoDaRolagem(registro, alvos); }
  catch (erro) { erroRolagem(erro.message || "Não foi possível confirmar o dano. Confira os dados antes de repetir."); }
  finally { definirOcupadaRolagem(false); }
}

async function rolar(expressao) {
  if (rol.ocupada) return;
  erroRolagem();
  const formula = typeof expressao === "string" ? expressao.trim() : campo("rol-expressao").value.trim();
  if (!lerExpressaoRolagem(formula)) {
    campo("rol-expressao").setAttribute("aria-invalid", "true");
    return erroRolagem("Expressão inválida. Use somas/subtrações como 2d20+5+3d6+1, com no máximo 999 dados.");
  }
  campo("rol-expressao").removeAttribute("aria-invalid");
  const atacar = rol.atacar, alvos = selecaoDoAtaque();
  if (atacar && !alvos.length) return erroRolagem("Selecione ao menos um alvo ou desligue Atacar para apenas rolar.");
  if (atacar && alvos.some(a => !validarMultiplicadorDano(a.mult))) {
    return erroRolagem("Corrija o multiplicador dos alvos selecionados: use um número maior ou igual a zero.");
  }
  definirOcupadaRolagem(true);
  try {
    const r = await pedirAoServidor("master_rolar", { expressao: formula }, { muda: true });
    r.expressao = formula;
    const registro = { dados: r, aplicada: false };
    rol.ultimaRolagem = registro;
    rol.historico.unshift(r); rol.historico.length = Math.min(rol.historico.length, MAX_HISTORICO);
    renderizarResultadoDaRolagem(r); renderizarHistorico();
    if (atacar && rol.atacar) {
      await aplicarDanoDaRolagem(registro, alvos);
    }
  } catch (erro) {
    // Sem reenvio automático: após timeout, a rolagem/dano pode ter sido confirmada no servidor.
    erroRolagem(erro.message || "Não foi possível concluir. Confira os dados antes de repetir.");
  } finally { definirOcupadaRolagem(false); }
}

function retratoAlvoRolagem(a) {
  const img = criar("img", "fig-retrato-imagem");
  img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
  const padrao = "/CSS/retrato-padrao.svg";
  img.src = urlDeImagem(a.imagem) || padrao;
  img.addEventListener("error", () => {
    if (img.getAttribute("src") === padrao) img.hidden = true;
    else img.src = padrao;
  });
  return img;
}
function recursoAlvoRolagem(nome, vital, classe) {
  const v = vital || { atual: 0, max: 0 };
  const painel = criar("div", "fig-tatica-recurso fig-tatica-" + classe);
  painel.append(criar("span", "", nome));
  const valor = criar("span", "rol-alvo-valor");
  valor.append(criar("strong", "", String(v.atual)), document.createTextNode(" / " + v.max));
  const barra = criar("div", "fig-tatica-barra"), dentro = criar("span");
  barra.setAttribute("aria-hidden", "true");
  dentro.style.width = (v.max ? Math.max(0, Math.min(100, v.atual / v.max * 100)) : 0) + "%";
  barra.append(dentro); painel.append(valor, barra); return painel;
}
function criarLinhaDeAlvo(a) {
  const estado = rol.marcados.get(a.alvoId) || { marcado: false, mult: 1 };
  const { card, escolher, recursos } = criarResumoTatico({
    id: a.alvoId, nome: a.nome, selecionado: estado.marcado,
    rotulo: "Selecionar " + a.nome + " como alvo", retrato: retratoAlvoRolagem(a),
    aoSelecionar: () => {
      if (rol.ocupada) return;
      const atual = rol.marcados.get(a.alvoId) || { marcado: false, mult: 1 };
      rol.marcados.set(a.alvoId, { ...atual, marcado: !atual.marcado }); renderizarAlvos();
    },
  });
  card.classList.add("rol-alvo");
  card.dataset.alvoId = a.alvoId; card.dataset.marcado = String(estado.marcado);
  escolher.dataset.acao = "selecionar-alvo"; escolher.disabled = rol.ocupada;
  recursos.append(recursoAlvoRolagem("Vida", a.hp, "hp"), recursoAlvoRolagem("Energia", a.energia, "energia"));
  card.dataset.indisponivel = String(!!a.indisponivel);
  card.append(criar("span", "rol-alvo-tipo", (ROTULO_TIPO[a.tipo] || a.tipo) + (a.indisponivel ? " · Indisponível" : a.derrotado ? " · Caído" : "")));
  if (estado.marcado) {
    const espada = iconeRolagem("sword"); espada.classList.add("rol-alvo-espada"); card.append(espada);
  }
  const label = criar("label", "rol-alvo-multiplicador", "Dano ×");
  label.hidden = !estado.marcado;
  const mult = criar("input");
  mult.type = "number"; mult.min = "0"; mult.step = "any"; mult.required = true;
  mult.value = estado.mult === null ? "" : String(estado.mult);
  mult.disabled = rol.ocupada; mult.inputMode = "decimal"; mult.dataset.campo = "mult";
  mult.setAttribute("aria-label", "Multiplicador de dano para " + a.nome);
  const mudou = () => {
    const valor = mult.value === "" ? null : mult.valueAsNumber;
    const atual = rol.marcados.get(a.alvoId) || estado;
    rol.marcados.set(a.alvoId, { ...atual, mult: valor });
    mult.setAttribute("aria-invalid", String(!validarMultiplicadorDano(valor)));
    atualizarEstadoAtaque();
  };
  mult.addEventListener("input", mudou); mult.addEventListener("change", mudou);
  label.append(mult); card.append(label); return card;
}
function renderizarAlvos() {
  const area = campo("atk-alvos");
  if (!area) return;
  atualizarEstadoAtaque();
  for (const categoria of ["jogadores", "inimigos"]) {
    campo("atk-" + categoria).setAttribute("aria-selected", String(rol.categoria === categoria));
    campo("atk-" + categoria).tabIndex = rol.categoria === categoria ? 0 : -1;
  }
  const lista = [...rol.alvos, ...rol.ausentes.filter(a => rol.marcados.get(a.alvoId)?.marcado)]
    .filter(a => (a.tipo === "jogador" ? "jogadores" : "inimigos") === rol.categoria);
  RPGUI.preservarInteracao(area, () => {
    area.replaceChildren();
    lista.forEach(a => area.append(criarLinhaDeAlvo(a)));
    if (!lista.length) area.append(criar("li", "rol-vazio", rol.carregando ? "Carregando alvos…" :
      !rol.carregou ? "Aguardando os alvos do servidor." :
      rol.categoria === "jogadores" ? "Nenhuma ficha de jogador conectada." : "Nenhum inimigo em batalha ou NPC na mesa."));
  });
  const aviso = campo("atk-aviso");
  aviso.textContent = rol.erroCarga || (rol.categoria === "inimigos" ? "Inclui inimigos em batalha e NPCs da mesa." : "");
  aviso.hidden = !aviso.textContent;
  campo("atk-atualizar").hidden = !rol.erroCarga;
}
function carregarAlvos() {
  clearTimeout(timerAlvosRol); timerAlvosRol = null;
  // Pedidos simultâneos compartilham a consulta. Eventos que chegam durante a leitura
  // marcam uma nova consulta para depois, pois a resposta em voo pode anteceder a alteração.
  if (consultaAlvosRol) {
    return consultaAlvosRol.promessa;
  }
  atualizacaoAlvosPendente = false;
  const leitura = ++leituraAlvosRol;
  const consulta = { promessa: null };
  consultaAlvosRol = consulta;
  rol.carregando = true;
  campo("atk-alvos")?.setAttribute("aria-busy", "true");
  if (!rol.carregou && !rol.alvos.length) renderizarAlvos();
  consulta.promessa = (async () => {
    try {
      const r = await pedirAoServidor("master_listar_alvos", {}, { silencioso: true });
      if (leitura !== leituraAlvosRol) return;
      const presentes = new Set(r.alvos.map(a => a.alvoId));
      // Uma ficha fechada/alvo removido continua desmarcável, sem perder a seleção silenciosamente.
      rol.ausentes = [...new Map([...rol.alvos, ...rol.ausentes]
        .filter(a => !presentes.has(a.alvoId) && rol.marcados.get(a.alvoId)?.marcado)
        .map(a => [a.alvoId, { ...a, indisponivel: true }])).values()];
      rol.alvos = r.alvos; rol.carregou = true; rol.erroCarga = "";
    } catch (erro) {
      if (leitura !== leituraAlvosRol) return;
      rol.erroCarga = "Não foi possível sincronizar. Os dados anteriores podem estar desatualizados.";
    } finally {
      if (consultaAlvosRol === consulta) {
        consultaAlvosRol = null;
        rol.carregando = false;
        campo("atk-alvos")?.setAttribute("aria-busy", "false");
        renderizarAlvos();
        if (atualizacaoAlvosPendente) return carregarAlvos();
      }
    }
  })();
  return consulta.promessa;
}

function renderizarResultadoDoAtaque(aplicacao) {
  const area = campo("atk-resultado"); area.replaceChildren(); area.hidden = false;
  area.append(criar("strong", "", "Última aplicação · Dano base: " + aplicacao.total));
  for (const r of aplicacao.resultados) {
    const linha = criar("p", "", r.ok ? r.nome + ": " + r.dano + " de dano (×" + r.mult + ") · Vida " +
      r.antes + " → " + r.depois + (r.derrotado ? " · Caído" : "") :
      (r.nome || r.alvoId) + ": " + (r.motivo === "ausente" ? "indisponível; não recebeu dano." : "não foi possível aplicar."));
    linha.dataset.alvoId = r.alvoId; linha.dataset.ok = r.ok ? "1" : "0"; area.append(linha);
  }
}
async function desfazerDano() {
  const id = campo("atk-desfazer").dataset.aplicacaoId;
  if (!id || rol.ocupada) return;
  definirOcupadaRolagem(true); erroRolagem();
  try {
    const r = await pedirAoServidor("master_desfazer_dano", { aplicacaoId: id }, { muda: true });
    const area = campo("atk-resultado"); area.replaceChildren(); area.hidden = false;
    area.append(criar("strong", "", "Dano desfeito"));
    for (const x of r.restaurados) {
      const linha = criar("p", "", x.ok ? x.nome + ": Vida " + x.antes + " → " + x.depois :
        (x.nome || x.alvoId) + ": não restaurado (" + (x.motivo === "hp_mudou" ? "a vida já mudou" : "indisponível") + ").");
      linha.dataset.ok = x.ok ? "1" : "0"; area.append(linha);
    }
    campo("atk-desfazer").hidden = true;
    await carregarAlvos();
  } catch (erro) {
    erroRolagem(erro.message);
    if (["nao_e_a_ultima", "ja_desfeita"].includes(erro.codigo)) campo("atk-desfazer").hidden = true;
  } finally { definirOcupadaRolagem(false); }
}

const recarregarAlvos = () => {
  clearTimeout(timerAlvosRol); timerAlvosRol = null;
  if (consultaAlvosRol) { atualizacaoAlvosPendente = true; return; }
  timerAlvosRol = setTimeout(carregarAlvos, 100);
};
socket.on("campanha_atualizada", ({ tipo } = {}) => {
  if (["npcs", "batalha"].includes(tipo)) recarregarAlvos();
});
for (const evento of ["player_updated", "player_removed", "vital_adjusted"]) socket.on(evento, recarregarAlvos);
socket.on("connect", () => setTimeout(carregarAlvos, 0));
document.addEventListener("DOMContentLoaded", () => {
  const contexto = lerContextoMestre("rolagem");
  if (["jogadores", "inimigos"].includes(contexto.categoria)) rol.categoria = contexto.categoria;
  if (typeof contexto.expressao === "string") campo("rol-expressao").value = contexto.expressao;
  if (Number.isInteger(contexto.quantidade) && contexto.quantidade >= 1 && contexto.quantidade <= 999) campo("rol-quantidade").value = contexto.quantidade;
  window.addEventListener("pagehide", () => guardarContextoMestre("rolagem", {
    categoria: rol.categoria, expressao: campo("rol-expressao").value, quantidade: Number(campo("rol-quantidade").value),
  }));
  campo("rol-form").addEventListener("submit", ev => { ev.preventDefault(); rolar(); });
  document.querySelectorAll("[data-dado]").forEach(b => b.addEventListener("click", ev => {
    if (ev.detail > 1) return; // O segundo clique físico não inicia outro ataque após uma resposta rápida.
    const quantidade = campo("rol-quantidade");
    if (!RPGUI.validarFormulario(quantidade)) return erroRolagem("Quantidade inválida: escolha um inteiro de 1 a 999.");
    rolar(quantidade.value + "d" + b.dataset.dado);
  }));
  campo("rol-rolar").addEventListener("click", ev => { if (ev.detail > 1) ev.preventDefault(); });
  campo("rol-quantidade").addEventListener("input", atualizarDadosInstantaneos);
  campo("rol-expressao").addEventListener("input", () => { campo("rol-expressao").removeAttribute("aria-invalid"); erroRolagem(); });
  campo("atk-atacar").addEventListener("change", ev => {
    if (rol.ocupada) { ev.target.checked = rol.atacar; return; }
    rol.atacar = ev.target.checked; atualizarEstadoAtaque();
  });
  for (const categoria of ["jogadores", "inimigos"]) campo("atk-" + categoria).addEventListener("click", () => {
    rol.categoria = categoria; renderizarAlvos();
  });
  document.querySelector(".rol-segmentado").addEventListener("keydown", ev => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    rol.categoria = ev.key === "Home" ? "jogadores" : ev.key === "End" ? "inimigos" :
      rol.categoria === "jogadores" ? "inimigos" : "jogadores";
    renderizarAlvos(); campo("atk-" + rol.categoria).focus();
  });
  campo("atk-atualizar").addEventListener("click", carregarAlvos);
  campo("atk-aplicar-ultimo").addEventListener("click", aplicarUltimoDano);
  campo("atk-desfazer").addEventListener("click", desfazerDano);
  renderizarAlvos(); atualizarDadosInstantaneos();
});

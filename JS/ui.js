/* Interface da ficha: navegação, avisos e acessibilidade. Sem persistência de dados do personagem. */
function trocarAba(abaNum, voltarAoTopo = true) {
  const abaAtiva = document.getElementById(`aba-${abaNum}`);
  const btnAtivo = document.getElementById(`tab-btn-${abaNum}`);
  if (!abaAtiva || !btnAtivo) return;
  document.querySelectorAll(".tab-content").forEach((el) => {
    const ativa = el === abaAtiva;
    el.classList.toggle("hidden", !ativa);
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const ativa = btn === btnAtivo;
    btn.setAttribute("aria-selected", String(ativa));
    btn.tabIndex = ativa ? 0 : -1;
  });
  if (CHARACTER) sessionStorage.setItem(`rpg_ficha_aba:${CHARACTER.player}/${CHARACTER.nomePasta}`, String(abaNum));
  if (abaNum === 3) {
    renderizarSlotsEquipados();
    renderizarMochilaGrid();
  }
  if (abaNum === 4) renderizarCodice();
  if (voltarAoTopo) document.querySelector(".sheet-header")?.scrollIntoView({ block: "start" });
}

function atualizarIdentidadeVisual() {
  const titulo = document.getElementById("sheet-character-name");
  const nome = document.getElementById("char-name-input")?.value.trim() || STATE.name;
  if (titulo) { titulo.textContent = nome; titulo.title = nome; }
  if (nome) document.title = nome;
}

function elTexto(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

const temporizadoresToastFicha = new WeakMap();
function toast(mensagem, tipo = "info") {
  if (tipo !== 'error' && tipo !== 'evento') return;
  const container = document.getElementById("toast-container");
  if (!container) return;
  const existente = [...container.children].find(el => el.dataset.tipo === tipo && el.querySelector('span')?.textContent === String(mensagem));
  if (existente) {
    clearTimeout(temporizadoresToastFicha.get(existente));
    if (tipo !== 'error') temporizadoresToastFicha.set(existente, setTimeout(() => existente.remove(), 5000));
    return;
  }
  const aviso = document.createElement("div");
  aviso.className = "sheet-toast";
  aviso.dataset.tipo = tipo;
  aviso.setAttribute("role", tipo === "error" ? "alert" : "status");
  const texto = elTexto("span", "", mensagem);
  const fechar = elTexto("button", "", "×");
  fechar.type = "button";
  fechar.setAttribute("aria-label", "Dispensar notificação");
  fechar.addEventListener("click", () => aviso.remove());
  aviso.append(texto, fechar);
  container.appendChild(aviso);
  while (container.children.length > 4) container.firstElementChild.remove();
  // Erros exigem leitura/decisão: permanecem até serem dispensados.
  if (tipo !== "error") temporizadoresToastFicha.set(aviso, setTimeout(() => aviso.remove(), 5000));
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("i.fa-solid").forEach((icone) => icone.setAttribute("aria-hidden", "true"));
  atualizarIdentidadeVisual();
  const faixa = document.getElementById("estado-ficha");
  if (faixa) {
    const ajustarFaixa = () => document.body.style.setProperty("--sheet-notice-height", `${faixa.getBoundingClientRect().height}px`);
    new MutationObserver(ajustarFaixa).observe(faixa, { attributes: true, childList: true, subtree: true });
    window.addEventListener("resize", ajustarFaixa);
    ajustarFaixa();
  }
  const atributos = document.getElementById("sheet-attributes-details");
  if (atributos && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 660px)").matches) atributos.open = false;
  const salva = CHARACTER && Number(sessionStorage.getItem(`rpg_ficha_aba:${CHARACTER.player}/${CHARACTER.nomePasta}`));
  trocarAba(salva >= 1 && salva <= 5 ? salva : 1, false);
  document.querySelectorAll(".tab-btn").forEach((btn, indice, botoes) => {
    btn.addEventListener("keydown", (evento) => {
      let destino;
      if (evento.key === "ArrowRight") destino = (indice + 1) % botoes.length;
      if (evento.key === "ArrowLeft") destino = (indice + botoes.length - 1) % botoes.length;
      if (evento.key === "Home") destino = 0;
      if (evento.key === "End") destino = botoes.length - 1;
      if (destino === undefined) return;
      evento.preventDefault();
      trocarAba(destino + 1);
      botoes[destino].focus();
    });
  });
  document.getElementById("skills-search")?.addEventListener("input", filtrarPericias);
  document.querySelector('.sheet-session a[href="/selecao"]')?.addEventListener("click", (evento) => {
    if (!arquivosSujos.size && totalEmVoo() === 0 && !arquivosComErro.size) return;
    evento.preventDefault();
    enviarSalvamentosPendentes();
    const mensagem = !socket.connected ? "Sem conexão. Aguarde salvar suas alterações antes de trocar de personagem."
      : arquivosComErro.size ? "Há um erro de salvamento. Confira a mensagem antes de trocar de personagem."
        : "Aguarde a confirmação do salvamento antes de trocar de personagem.";
    toast(mensagem, !socket.connected || arquivosComErro.size ? "error" : "info");
  });
  document.getElementById("avatar-modal")?.addEventListener("rpg:cancelar", closeAvatarModal);
  document.getElementById("codice-modal")?.addEventListener("rpg:cancelar", fecharModalCodice);
  document.getElementById("item-popover")?.addEventListener("rpg:cancelar", fecharItemPopover);
});

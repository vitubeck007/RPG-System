/* =========================================================================
   INTERFACE COMUM
   Pequenos auxiliares de tela usados por vários arquivos: aviso (toast), troca de aba e elTexto().
   ========================================================================= */

function trocarAba(abaNum) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove(
      "bg-dungeon-800",
      "text-amberGold-400",
      "border",
      "border-amberGold-500/40",
      "shadow",
    );
    btn.classList.add("text-slate-400");
  });

  const abaAtiva = document.getElementById(`aba-${abaNum}`);
  const btnAtivo = document.getElementById(`tab-btn-${abaNum}`);

  if (abaAtiva) abaAtiva.classList.remove("hidden");
  if (btnAtivo) {
    btnAtivo.classList.remove("text-slate-400");
    btnAtivo.classList.add(
      "bg-dungeon-800",
      "text-amberGold-400",
      "border",
      "border-amberGold-500/40",
      "shadow",
    );
  }

  if (abaNum === 3) {
    renderizarSlotsEquipados();
    renderizarMochilaGrid();
  }

  if (abaNum === 4) {
    renderizarCodice();
  }
}

function elTexto(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function toast(mensagem, tipo = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toastEl = document.createElement("div");
  let borderCol = "border-amberGold-500";
  let icon = "fa-circle-info";

  if (tipo === "combat") {
    borderCol = "border-crimson-500 text-amber-200";
    icon = "fa-crosshairs";
  } else if (tipo === "error") {
    borderCol = "border-rose-600 text-rose-300";
    icon = "fa-triangle-exclamation";
  }

  toastEl.className = `p-3 rounded-lg bg-dungeon-950 border-l-4 ${borderCol} shadow-2xl text-xs font-cinzel text-slate-100 flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  const iconeEl = document.createElement("i");
  iconeEl.className = `fa-solid ${icon}`;
  const textoEl = document.createElement("span");
  textoEl.textContent = mensagem;
  toastEl.append(iconeEl, " ", textoEl);

  container.appendChild(toastEl);

  setTimeout(() => toastEl.classList.remove("translate-y-2", "opacity-0"), 10);
  setTimeout(() => {
    toastEl.classList.add("opacity-0", "-translate-y-2");
    setTimeout(() => toastEl.remove(), 300);
  }, 2400);
}

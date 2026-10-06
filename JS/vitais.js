/* =========================================================================
   VITAIS: HP, VIGOR E SANIDADE
   Ajuste dos valores, edição do máximo e desenho das barras.
   ========================================================================= */

function alterarVital(tipo, delta) {
  if (!personagemCarregado) return;
  if (tipo === "vigor" && !GLOBAL_CONFIG.AtivarMana) return;

  const vital = STATE.vitals[tipo];
  if (!vital) return;

  const anterior = vital.current;

  vital.current += delta;

  if (vital.current < 0) {
    vital.current = 0;
  }

  if (vital.current > vital.max) {
    vital.current = vital.max;
  }

  atualizarBarras();
  salvarStatus();

  registrarNoTerminal("Atributo vital alterado", {
    atributo: tipo,
    anterior,
    variacao: delta,
    atual: vital.current,
    maximo: vital.max,
  });

  syncPlayerToServer();
}

/* Máximo de HP / Vigor / Sanidade: clique no número do máximo para editar (Enter confirma,
   Esc cancela). Se o vital estava cheio, continua cheio; senão o atual só é cortado no novo teto. */
const MAX_VITAL_FICHA = 100000; // mesmo limite do servidor (MAX_VITAL)

function definirMaximoVital(tipo, valorBruto) {
  const vital = STATE.vitals[tipo];
  const texto = String(valorBruto ?? "").trim();
  if (!personagemCarregado || !vital || texto === "" || !Number.isFinite(Number(texto))) {
    atualizarBarras();
    return;
  }
  const novo = Math.max(0, Math.min(MAX_VITAL_FICHA, Math.round(Number(texto))));
  const anterior = vital.max;
  if (novo === anterior) {
    atualizarBarras();
    return;
  }
  const estavaCheio = vital.current >= anterior;
  vital.max = novo;
  vital.current = estavaCheio ? novo : Math.min(vital.current, novo);
  atualizarBarras();
  salvarStatus();
  registrarNoTerminal("Máximo vital alterado", { atributo: tipo, anterior, atual: novo });
  syncPlayerToServer();
}

function editarMaximoVital(tipo) {
  if (!personagemCarregado) return;
  if (tipo === "vigor" && !GLOBAL_CONFIG.AtivarMana) return;
  const vital = STATE.vitals[tipo];
  const botao = document.getElementById(`${tipo}-max`);
  if (!vital || !botao || botao.dataset.editando) return;

  botao.dataset.editando = "1";
  const campo = document.createElement("input");
  campo.type = "number";
  campo.min = "0";
  campo.max = String(MAX_VITAL_FICHA);
  campo.value = vital.max;
  campo.title = "Novo máximo (Enter confirma, Esc cancela)";
  campo.className =
    "w-14 bg-dungeon-950 border border-amberGold-500 rounded text-center text-[11px] font-mono text-slate-100 focus:outline-none";
  botao.replaceWith(campo);
  campo.focus();
  campo.select();

  let concluido = false;
  const concluir = (confirmar) => {
    if (concluido) return;
    concluido = true;
    const valor = campo.value;
    campo.replaceWith(botao);
    delete botao.dataset.editando;
    if (confirmar) definirMaximoVital(tipo, valor);
    else atualizarBarras();
  };
  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") concluir(true);
    else if (evento.key === "Escape") concluir(false);
  });
  campo.addEventListener("blur", () => concluir(true));
}

function atualizarBarras() {
  ["hp", "vigor", "sanity"].forEach((tipo) => {
    const vital = STATE.vitals[tipo];

    const valEl = document.getElementById(`${tipo}-val`);
    const maxEl = document.getElementById(`${tipo}-max`);
    const barEl = document.getElementById(`${tipo}-bar`);

    if (valEl && maxEl && barEl && vital) {
      valEl.innerText = vital.current;
      maxEl.innerText = vital.max;

      const pct = vital.max > 0 ? (vital.current / vital.max) * 100 : 0;

      barEl.style.width = `${pct}%`;
    }
  });
}

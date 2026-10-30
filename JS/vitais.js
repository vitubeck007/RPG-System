/* =========================================================================
   VITAIS: HP, VIGOR E SANIDADE
   Ajuste dos valores, edição do máximo e desenho das barras.
   ========================================================================= */

function alterarVital(tipo, delta, origem = null) {
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
  window.numeroFlutuante?.(origem, vital.current - anterior);

  atualizarBarras();
  salvarStatus();

  registrarNoTerminal("Atributo vital alterado", {
    atributo: tipo,
    anterior,
    variacao: delta,
    atual: vital.current,
    maximo: vital.max,
  });

  // O salvamento confirmado já publica os vitais no painel do mestre.
}

function abrirAjusteVital(tipo) {
  if (!personagemCarregado || (tipo === 'vigor' && !GLOBAL_CONFIG.AtivarMana)) return;
  RPGUI.ajustarValor({
    titulo: `Ajustar ${ROTULO_VITAL[tipo] || tipo}`,
    ler: () => personagemCarregado && (tipo !== 'vigor' || GLOBAL_CONFIG.AtivarMana) ? STATE.vitals[tipo] : null,
    aplicar: delta => alterarVital(tipo, delta),
  });
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
  campo.setAttribute("aria-label", `Novo máximo de ${ROTULO_VITAL[tipo] || tipo}`);
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
    botao.focus();
  };
  campo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== "Escape") return;
    // O foco volta ao botão: não deixar o Enter ativá-lo e reabrir o editor.
    evento.preventDefault();
    evento.stopPropagation();
    concluir(evento.key === "Enter");
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
      maxEl.setAttribute("aria-label", `Editar máximo de ${ROTULO_VITAL[tipo] || tipo}: ${vital.max}`);

      const pct = vital.max > 0 ? (vital.current / vital.max) * 100 : 0;

      barEl.style.width = `${pct}%`;
    }
  });
}

/* =========================================================================
   CONEXÃO E CARGA DO PERSONAGEM
   Eventos do servidor: personagem carregado, vida ajustada pelo mestre, configuração da mesa,
   faixa de estado (conectando, sem conexão, sessão expirada) e erros de carga.
   ========================================================================= */

socket.on("vital_adjusted", (data) => {
  if (data.charId === STATE.id) {
    const vital = STATE.vitals?.[data.type];
    if (vital && Number.isFinite(data.delta)) {
      // Soma o ajuste ao valor ATUAL do jogador (não troca tudo pelo valor do servidor),
      // para não apagar uma edição feita ao mesmo tempo.
      vital.current = Math.max(0, Math.min(vital.current + data.delta, vital.max));
    } else {
      STATE.vitals = data.vitals;
    }
    atualizarBarras();
    salvarStatus();
    syncPlayerToServer(); // reconcilia o painel do mestre com o valor final do jogador
    registrarNoTerminal(
      "Atributos vitais atualizados pelo mestre",
      data.vitals,
    );
    toast("Atributos vitais atualizados pelo Mestre!", "combat");
  }
});

// O servidor pede o estado quando outra aba da mesma ficha fecha (o card do mestre passa para esta aba).
socket.on("sincronizar_ficha", syncPlayerToServer);

socket.on("sync_config", (config) => {
  aplicarConfiguracaoGlobal(config);
  registrarNoTerminal("Configuração recebida do servidor", config);
});

socket.on("personagem_carregado", (personagem) => {
  jaCarregouAntes = true;
  if (
    !CHARACTER ||
    personagem?.player !== CHARACTER.player ||
    personagem?.nomePasta !== CHARACTER.nomePasta
  ) {
    socket.emit("client_log", {
      action: "Resposta de personagem ignorada por identidade divergente",
      context: { personagem: CHARACTER?.nomePasta || "sem seleção" },
    });
    return;
  }

  // O servidor entrega todos os arquivos já no formato oficial (ver personagem.js).
  // Arquivo com alteração local ainda não enviada (ex.: reconexão) mantém a versão
  // local em vez de ser sobrescrito pelo que está no servidor.
  const vital = (v) => ({
    current: Number(v?.current) || 0,
    max: Number(v?.max) || 0,
  });
  if (!arquivoProtegido("status")) {
    const status = personagem.status || {};
    STATE.vitals = {
      hp: vital(status.hp),
      vigor: vital(status.vigor),
      sanity: vital(status.sanity),
    };
  }

  if (!arquivoProtegido("inventario")) {
    const inventario = personagem.inventario || {};
    STATE.backpackItems = Array.isArray(inventario.items)
      ? inventario.items
      : [];
    STATE.equipped = {
      mainHand: null,
      offHand: null,
      back: null,
      backpack: null,
      ...(inventario.equipped || {}),
    };
  }

  if (!arquivoProtegido("pericias")) {
    STATE.skills = montarPericias(personagem.pericias?.skills);
  }
  // Atributos
  if (!arquivoProtegido("atributos")) {
    const salvos = personagem.atributos || {};
    STATE.atributos = {
      FOR: Number(salvos.FOR) || 0,
      DES: Number(salvos.DES) || 0,
      INT: Number(salvos.INT) || 0,
      SAB: Number(salvos.SAB) || 0,
      PRE: Number(salvos.PRE) || 0,
      VON: Number(salvos.VON) || 0,
    };
    FICHA.atributos = { ...STATE.atributos };
  }

  // Magias
  if (!arquivoProtegido("magias")) {
    STATE.spells = Array.isArray(personagem.magias?.items)
      ? personagem.magias.items
      : [];
  }

  // Habilidades
  if (!arquivoProtegido("habilidades")) {
    STATE.abilities = Array.isArray(personagem.habilidades?.items)
      ? personagem.habilidades.items
      : [];
  }

  if (!arquivoProtegido("riquezas")) preencherMoedas(personagem.riquezas);

  ["perfil", "biografia"].forEach((arquivo) => {
    if (!arquivoProtegido(arquivo) || !FICHA[arquivo]) {
      FICHA[arquivo] = { ...(personagem[arquivo] || {}) };
    }
  });

  STATE.name =
    String(FICHA.perfil?.nome || "").trim() ||
    CHARACTER_NAME ||
    CHARACTER.nomePasta.replace(/_\d+(?:_\d+)?$/, "");
  sessionStorage.setItem("rpg_character_name", STATE.name);

  // Progressão (Ex/Nv) e avatar vêm do perfil.
  STATE.progressionValues = {
    ex: FICHA.perfil?.progressao?.ex ?? "0%",
    nv: FICHA.perfil?.progressao?.nv ?? "1",
  };
  const campoProgressao = document.getElementById("progression-val-input");
  if (campoProgressao) {
    campoProgressao.value = STATE.progressionValues[STATE.progressionMode];
  }
  aplicarAvatar(FICHA.perfil?.avatar);
  personagemCarregado = true;
  definirFichaEditavel(true);
  preencherCamposFicha();
  repararInventarioAoCarregar();

  atualizarBarras();
  renderizarPericias();
  renderizarCodice();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  registrarNoTerminal("Personagem carregado", {
    player: CHARACTER.player,
    nomePasta: CHARACTER.nomePasta,
  });
  syncPlayerToServer();
  enviarSalvamentosPendentes();
  enviarRolagensPendentes();
  atualizarEstadoFicha();
});

/* Faixa no topo que explica o que está acontecendo: conectando, carregando, sem conexão, sessão expirada. */
let erroDeConexao = false;
let sessaoExpirada = false;
let falhaDeInicializacao = ""; // erro ao montar a tela (index.js): a ficha ainda conecta, mas avisa
let naoIniciou = false; // em 6 s a ficha nem tentou conectar: a inicialização (index.js) não rodou

function atualizarEstadoFicha() {
  const el = document.getElementById("estado-ficha");
  if (!el) return;

  let texto = "";
  let cor = "bg-dungeon-900 text-slate-300 border-dungeon-700";
  if (sessaoExpirada) {
    texto = "Sessão expirada. Redirecionando para o login…";
    cor = "bg-rose-950 text-rose-200 border-rose-800";
  } else if (falhaDeInicializacao) {
    texto = `Erro ao iniciar a ficha: ${falhaDeInicializacao}. Veja o console (F12).`;
    cor = "bg-rose-950 text-rose-200 border-rose-800";
  } else if (naoIniciou && !socket?.connected && !socket?.active) {
    texto = "A ficha não iniciou. Atualize TODOS os arquivos de JS/ (inclusive index.js) e recarregue com Ctrl+F5. Veja o console (F12).";
    cor = "bg-rose-950 text-rose-200 border-rose-800";
  } else if (!socket?.connected) {
    if (!personagemCarregado) {
      texto = erroDeConexao
        ? "Não foi possível conectar ao servidor. Verifique se ele está ligado."
        : "Conectando ao servidor…";
      if (erroDeConexao) cor = "bg-rose-950 text-rose-200 border-rose-800";
    } else {
      texto = "Sem conexão com o servidor — tentando reconectar. Suas alterações serão enviadas ao voltar.";
      cor = "bg-amber-950 text-amber-200 border-amber-800";
    }
  } else if (!personagemCarregado) {
    texto = "Carregando ficha…";
  }

  el.textContent = texto;
  el.className = `${texto ? "" : "hidden "}fixed top-0 inset-x-0 z-[60] pointer-events-none text-center text-xs font-mono py-1.5 border-b ${cor}`;
}

socket.on("connect", () => {
  erroDeConexao = false;
  atualizarEstadoFicha();
});
socket.on("disconnect", atualizarEstadoFicha);

// Vigia: o index.js conecta o socket no fim da inicialização. Se em 6 s nada tentou conectar, ele não
// rodou (arquivo faltando ou de versão antiga, ou erro de sintaxe): diz isso em vez de ficar "Conectando…".
setTimeout(() => {
  if (socket.connected || socket.active || !CHARACTER || !AUTH_TOKEN) return;
  naoIniciou = true;
  atualizarEstadoFicha();
}, 6000);
socket.on("connect_error", () => {
  erroDeConexao = true;
  atualizarEstadoFicha();
});

socket.on("personagem_erro", (erro) => {
  personagemCarregado = false;
  sessionStorage.removeItem("rpg_character");

  if (erro?.code === "sessao_invalida") {
    // O servidor foi reiniciado (ou a sessão caiu): é preciso entrar de novo.
    sessaoExpirada = true;
    sessionStorage.removeItem("rpg_token");
    toast("Sessão expirada. Entre novamente.", "error");
    atualizarEstadoFicha();
    setTimeout(() => window.location.replace("/login"), 1500);
    return;
  }

  toast(erro?.message || "Não foi possível carregar o personagem.", "error");
  atualizarEstadoFicha();
  // "ja_carregado": este personagem já está aberto em outra aba; volta para a seleção.
  setTimeout(() => window.location.replace("/selecao"), erro?.code === "ja_carregado" ? 1500 : 900);
});

function aplicarConfiguracaoGlobal(config) {
  if (!config || typeof config !== "object") return;

  Object.keys(GLOBAL_CONFIG).forEach((key) => {
    if (typeof config[key] === "boolean") GLOBAL_CONFIG[key] = config[key];
  });

  document
    .getElementById("riches-section")
    ?.classList.toggle("hidden", !GLOBAL_CONFIG.AtivarRiquezas);

  const progressionButton = document.getElementById("progression-type-btn");
  const progressionInput = document.getElementById("progression-val-input");

  STATE.progressionMode = GLOBAL_CONFIG.UsarEx ? "ex" : "nv";

  if (progressionButton) {
    progressionButton.innerText = GLOBAL_CONFIG.UsarEx ? "Ex" : "Lv";
  }

  if (progressionInput) {
    progressionInput.value = GLOBAL_CONFIG.UsarEx
      ? STATE.progressionValues.ex
      : STATE.progressionValues.nv;
  }

  const backpackEnabled = GLOBAL_CONFIG.AtivarSlotMochila;
  document
    .getElementById("slot-backpack")
    ?.classList.toggle("hidden", !backpackEnabled);
  const equippedSlots = document.getElementById("equipped-slots-container");
  equippedSlots?.classList.toggle("lg:grid-cols-4", backpackEnabled);
  equippedSlots?.classList.toggle("lg:grid-cols-3", !backpackEnabled);
  document
    .getElementById("popover-equip-backpack")
    ?.classList.toggle("hidden", !backpackEnabled);
  if (!backpackEnabled && itemPopoverAtual?.isBackpackItem) {
    document.getElementById("item-popover")?.classList.add("hidden");
    itemPopoverAtual = null;
  }

  const manaEnabled = GLOBAL_CONFIG.AtivarMana;
  document
    .getElementById("vigor-card")
    ?.classList.toggle("hidden", !manaEnabled);
  const vitalCards = document.getElementById("vital-cards-container");
  vitalCards?.classList.toggle("grid-cols-3", manaEnabled);
  vitalCards?.classList.toggle("grid-cols-2", !manaEnabled);
}

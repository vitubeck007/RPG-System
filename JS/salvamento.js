/* =========================================================================
   SALVAMENTO CENTRAL E CONFERÊNCIA COM O SERVIDOR
   Toda alteração passa por marcarAlterado(arquivo). Aqui também: envio do estado ao painel do mestre,
   fila de reenvio, indicador "Salvo", tratamento de erro e a conferência de vida/mochila com o servidor.
   ========================================================================= */

/* =========================================================================
       SOCKET.IO INTEGRAÇÃO EM TEMPO REAL
       ========================================================================= */
function syncPlayerToServer() {
  if (personagemCarregado && CHARACTER && socket?.connected) {
    socket.emit("player_update", {
      id: STATE.id,
      character: CHARACTER,
      name: document.getElementById("char-name-input")?.value || STATE.name,
      vitals: STATE.vitals,
      equipped: STATE.equipped,
    });
  } else {
    console.warn("[RPG] Ficha não sincronizada: servidor desconectado.");
  }
}

// Envia UM arquivo do personagem ao servidor (que valida, normaliza e grava).
function salvarArquivoPersonagem(arquivo, dados) {
  if (!personagemCarregado || !CHARACTER || !socket?.connected) return;
  emVoo[arquivo] = (emVoo[arquivo] || 0) + 1;
  houveSalvamento = true;
  socket.emit("salvar_personagem", {
    player: CHARACTER.player,
    nomePasta: CHARACTER.nomePasta,
    arquivo,
    dados: { schemaVersion: 1, ...dados },
  });
  atualizarIndicadorSalvamento();
}

/* =========================================================================
   SALVAMENTO CENTRAL
   Toda alteração da ficha passa por marcarAlterado("arquivo"):
     - o arquivo fica "sujo" até ser enviado (e é reenviado se a conexão cair);
     - o servidor confirma cada gravação (indicador "Salvo ✓");
     - ao reconectar, o que ainda não foi salvo NÃO é sobrescrito pelo servidor.
   Arquivos: perfil, biografia, status, pericias, inventario, riquezas.
   ========================================================================= */
const ARQUIVOS_SALVAVEIS = [
  "perfil",
  "biografia",
  "status",
  "pericias",
  "inventario",
  "riquezas",
  "atributos",
  "magias",
  "habilidades",
];
// Cópia local de perfil.json e biografia.json, como o servidor os entregou. Campos
// que a tela não edita diretamente (id...) são reenviados intactos.
const FICHA = { perfil: null, biografia: null, atributos: null };
const SALVAMENTO_ATRASO_MS = 800; // textos: espera o jogador parar de digitar
const MOEDAS = {
  po: "coin-gold",
  pp: "coin-silver",
  pc: "coin-copper",
  sangue: "coin-blood",
};

const arquivosSujos = new Set(); // alterados aqui e ainda não enviados
const timersSalvamento = {};
const emVoo = {}; // arquivo -> envios sem resposta do servidor
const arquivosComErro = new Set();
let houveSalvamento = false;

function dadosParaSalvar(arquivo) {
  switch (arquivo) {
    case "perfil": {
      if (!FICHA.perfil) return null;
      const dados = { ...FICHA.perfil };
      dados.nome = String(dados.nome || "").trim() || STATE.name;
      return dados;
    }
    case "biografia":
      return FICHA.biografia ? { ...FICHA.biografia } : null;
    case "atributos": {
      const fonte = FICHA.atributos || STATE.atributos || {};
      const chaves = ["FOR", "DES", "INT", "SAB", "PRE", "VON"];
      return Object.fromEntries(
        chaves.map((k) => [
          k,
          Math.max(0, Math.min(999, Math.round(Number(fonte[k])) || 0)),
        ]),
      );
    }
    case "magias":
      return {
        items: Array.isArray(STATE.spells) ? STATE.spells : [],
      };
    case "habilidades":
      return {
        items: Array.isArray(STATE.abilities) ? STATE.abilities : [],
      };
    case "status":
      return { ...STATE.vitals };
    case "pericias":
      return {
        skills: Object.fromEntries(
          STATE.skills.map((skill) => [skill.id, { mod: skill.mod }]),
        ),
      };
    case "inventario":
      return { items: STATE.backpackItems, equipped: STATE.equipped, recebidas: STATE.entregasRecebidas };
    case "riquezas":
      return Object.fromEntries(
        Object.entries(MOEDAS).map(([chave, id]) => [
          chave,
          Math.max(
            0,
            Math.round(Number(document.getElementById(id)?.value)) || 0,
          ),
        ]),
      );
    default:
      return null;
  }
}

function marcarAlterado(arquivo, { imediato = false } = {}) {
  // Antes de o servidor entregar a ficha, o STATE só tem valores provisórios: marcar um arquivo
  // como "sujo" agora faria esses valores sobrescreverem os dados salvos (ver arquivoProtegido).
  if (!personagemCarregado) return;
  arquivosSujos.add(arquivo);
  clearTimeout(timersSalvamento[arquivo]);
  if (imediato) {
    enviarSalvamento(arquivo);
  } else {
    timersSalvamento[arquivo] = setTimeout(
      () => enviarSalvamento(arquivo),
      SALVAMENTO_ATRASO_MS,
    );
    atualizarIndicadorSalvamento();
  }
}

function enviarSalvamento(arquivo) {
  clearTimeout(timersSalvamento[arquivo]);
  delete timersSalvamento[arquivo];
  if (!arquivosSujos.has(arquivo)) return;

  // Sem conexão (ou personagem ainda não carregado): continua "sujo" e vai depois.
  if (!personagemCarregado || !socket?.connected) {
    atualizarIndicadorSalvamento();
    return;
  }

  const dados = dadosParaSalvar(arquivo);
  if (!dados) return;
  arquivosSujos.delete(arquivo);
  salvarArquivoPersonagem(arquivo, dados);
  if (arquivo === "perfil") syncPlayerToServer();
}

function enviarSalvamentosPendentes() {
  [...arquivosSujos].forEach(enviarSalvamento);
}

function salvarStatus() {
  marcarAlterado("status", { imediato: true });
}

function salvarPericias() {
  marcarAlterado("pericias", { imediato: true });
}

function salvarInventario() {
  marcarAlterado("inventario", { imediato: true });
}

function salvarRiquezas() {
  marcarAlterado("riquezas", { imediato: true });
}

function salvarMagias({ imediato = false } = {}) {
  marcarAlterado("magias", { imediato });
}

function salvarHabilidades({ imediato = false } = {}) {
  marcarAlterado("habilidades", { imediato });
}

// Arquivo com alteração local ainda não enviada, ou enviada e ainda sem confirmação:
// uma resposta de carregamento (possivelmente antiga) não pode sobrescrevê-lo.
function arquivoProtegido(arquivo) {
  return arquivosSujos.has(arquivo) || emVoo[arquivo] > 0;
}

function totalEmVoo() {
  return Object.values(emVoo).reduce((soma, n) => soma + n, 0);
}

function atualizarIndicadorSalvamento() {
  const el = document.getElementById("save-status");
  if (!el) return;

  let texto = "";
  let cor = "text-slate-500";
  if (arquivosComErro.size) {
    texto = "Erro ao salvar";
    cor = "text-rose-400";
  } else if (arquivosSujos.size && !socket?.connected) {
    texto = "Sem conexão — salva ao reconectar";
    cor = "text-amber-400";
  } else if (arquivosSujos.size || totalEmVoo()) {
    texto = "Salvando…";
    cor = "text-slate-400";
  } else if (houveSalvamento) {
    texto = "Salvo ✓";
    cor = "text-emerald-400";
  }
  el.textContent = texto;
  el.className = `text-[10px] font-mono whitespace-nowrap ${cor}`;
}

function aoDesconectarFicha() {
  ARQUIVOS_SALVAVEIS.forEach((arquivo) => {
    if (emVoo[arquivo] > 0) arquivosSujos.add(arquivo);
  });
  Object.keys(emVoo).forEach((arquivo) => delete emVoo[arquivo]);
  atualizarIndicadorSalvamento();
}

socket.on("personagem_salvo", ({ arquivo, dados } = {}) => {
  if (emVoo[arquivo] > 0) emVoo[arquivo]--;
  arquivosComErro.delete(arquivo);
  atualizarIndicadorSalvamento();
  conferirComServidor(arquivo, dados);
});

/* Vida e mochila têm que ficar IGUAIS no servidor e na ficha. O aviso de salvamento traz a versão que o
   servidor guardou (já corrigida: máximos, pilhas, tamanhos, posições). Se, sem nenhuma alteração mais
   nova a caminho, ela for diferente da ficha local, a ficha adota a do servidor (recarrega o personagem). */
const SLOTS_CONFERIDOS = ["mainHand", "offHand", "back", "backpack"];
const conferenciaFeitaEm = {};

function assinaturaConferida(arquivo, dados) {
  if (arquivo === "status") {
    return JSON.stringify(
      ["hp", "vigor", "sanity"].map((tipo) => [
        Number(dados?.[tipo]?.current) || 0,
        Number(dados?.[tipo]?.max) || 0,
      ]),
    );
  }
  const itens = (Array.isArray(dados?.items) ? dados.items : []).map((item) => [
    item?.uid ?? null,
    item?.id ?? null,
    quantidadeDoItem(item),
    item?.w || 1,
    item?.h || 1,
    item?.col || 1,
    item?.row || 1,
    Math.max(0, Math.min(Math.round((Number(item?.weight) || 0) * 100) / 100, 100000)),
  ]);
  const equipados = SLOTS_CONFERIDOS.map((slot) => dados?.equipped?.[slot]?.uid ?? null);
  return JSON.stringify([itens, equipados]);
}

function conferirComServidor(arquivo, dadosServidor) {
  if (!dadosServidor || !personagemCarregado) return;
  if (arquivosSujos.has(arquivo) || emVoo[arquivo] > 0) return; // há uma alteração mais nova a caminho
  const local = dadosParaSalvar(arquivo);
  if (!local || assinaturaConferida(arquivo, local) === assinaturaConferida(arquivo, dadosServidor)) return;

  // Trava contra laço: no máximo uma correção do mesmo arquivo a cada 3 s.
  const agora = Date.now();
  if (agora - (conferenciaFeitaEm[arquivo] || 0) < 3000) {
    console.warn(`[RPG] ${arquivo}: servidor e ficha continuam diferentes.`);
    return;
  }
  conferenciaFeitaEm[arquivo] = agora;
  registrarNoTerminal("Ficha corrigida pelo servidor", { arquivo });
  toast("O servidor ajustou a ficha (havia valores fora do permitido).", "info");
  socket.emit("carregar_personagem", { ...CHARACTER, reconexao: true });
}

socket.on("salvamento_personagem_erro", (erro) => {
  console.error(
    `[RPG] Falha ao salvar ${erro?.arquivo || "personagem"}:`,
    erro?.message,
  );
  const arquivo = erro?.arquivo;
  if (emVoo[arquivo] > 0) emVoo[arquivo]--;
  // Os reenvios automáticos (reconexão, aba escondida) não repetem o aviso: só a 1ª falha de cada arquivo.
  const primeiraFalha = !arquivosComErro.has(arquivo);
  if (ARQUIVOS_SALVAVEIS.includes(arquivo)) {
    arquivosComErro.add(arquivo);
    arquivosSujos.add(arquivo); // não perde o que foi alterado; a próxima alteração tenta de novo
  }
  atualizarIndicadorSalvamento();
  if (primeiraFalha || !ARQUIVOS_SALVAVEIS.includes(arquivo)) {
    toast(erro?.message || "Não foi possível salvar a ficha.", "error");
  }
});

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

const NOMES_ARQUIVOS_FICHA = { perfil: "Perfil", biografia: "Biografia", status: "Vitais", pericias: "Perícias", inventario: "Mochila", riquezas: "Riquezas", atributos: "Atributos", magias: "Magias", habilidades: "Habilidades" };
let rascunhoRecuperavel = null;
let servidorParaRecuperacao = null;
let recuperacaoVerificada = false;
let copiaLocalDisponivel = true;
let copiaLocalAvisada = false;
let chaveRecuperada = null;
const fundosRecuperacao = [];
// Uma cópia por aba evita que a confirmação de uma aba apague o rascunho de outra.
const PREFIXO_RASCUNHO = CHARACTER ? `rpg_pendente_v1:${JSON.stringify([CHARACTER.player, CHARACTER.nomePasta])}:` : null;
let chaveRascunho = null;
try {
  const aba = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  if (PREFIXO_RASCUNHO) chaveRascunho = PREFIXO_RASCUNHO + aba;
} catch { copiaLocalDisponivel = false; }

function guardarRascunhoFicha() {
  if (!personagemCarregado || !chaveRascunho) return;
  const pendentes = ARQUIVOS_SALVAVEIS.filter(arquivo => arquivoProtegido(arquivo));
  try {
    if (pendentes.length) {
      const arquivos = Object.fromEntries(pendentes.map(arquivo => [arquivo, dadosParaSalvar(arquivo)]).filter(([, dados]) => dados));
      localStorage.setItem(chaveRascunho, JSON.stringify({ versao: 1, personagem: CHARACTER, atualizadoEm: Date.now(), arquivos }));
    } else if (!rascunhoRecuperavel) {
      localStorage.removeItem(chaveRascunho);
      if (chaveRecuperada) localStorage.removeItem(chaveRecuperada);
      chaveRecuperada = null;
    }
    copiaLocalDisponivel = true;
  } catch {
    copiaLocalDisponivel = false;
    if (!copiaLocalAvisada) {
      copiaLocalAvisada = true;
      toast("O navegador não conseguiu guardar o rascunho. Não feche a ficha antes da confirmação do servidor.", "error");
    }
  }
}

function exibirRecuperacaoFicha(visivel) {
  const aviso = document.getElementById("draft-recovery");
  if (aviso) aviso.hidden = !visivel;
  if (visivel && !fundosRecuperacao.length) {
    document.querySelectorAll("#ficha-conteudo, .sheet-header, .sheet-navigation").forEach(el => {
      fundosRecuperacao.push([el, el.inert]); el.inert = true;
    });
  } else if (!visivel) fundosRecuperacao.splice(0).forEach(([el, anterior]) => { el.inert = anterior; });
}

function oferecerRecuperacaoFicha(personagem) {
  servidorParaRecuperacao = JSON.parse(JSON.stringify(personagem));
  if (recuperacaoVerificada || !PREFIXO_RASCUNHO) return;
  recuperacaoVerificada = true;
  try {
    const candidatos = [];
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (!chave?.startsWith(PREFIXO_RASCUNHO)) continue;
      const dados = JSON.parse(localStorage.getItem(chave));
      if (dados?.versao !== 1 || dados.personagem?.player !== CHARACTER.player || dados.personagem?.nomePasta !== CHARACTER.nomePasta) continue;
      const arquivos = Object.fromEntries(Object.entries(dados.arquivos || {}).filter(([nome, valor]) =>
        ARQUIVOS_SALVAVEIS.includes(nome) && valor && typeof valor === "object" && !Array.isArray(valor)));
      if (Object.keys(arquivos).length) candidatos.push({ ...dados, arquivos, chave });
    }
    candidatos.sort((a, b) => Number(b.atualizadoEm) - Number(a.atualizadoEm));
    rascunhoRecuperavel = candidatos.find(c => c.chave === chaveRascunho) || candidatos[0] || null;
    if (!rascunhoRecuperavel) return;
    const texto = document.getElementById("draft-recovery-message");
    if (texto) texto.textContent = `A versão do servidor foi carregada. Há também uma cópia local de ${Object.keys(rascunhoRecuperavel.arquivos).map(a => NOMES_ARQUIVOS_FICHA[a]).join(", ")}. Restaurar envia esses valores ao servidor; manter descarta esta cópia local. Escolha antes de continuar editando.`;
    exibirRecuperacaoFicha(true);
  } catch { toast("Não foi possível ler a cópia local. Os dados do servidor foram mantidos.", "error"); }
}

function restaurarRascunhoFicha() {
  if (!rascunhoRecuperavel || !servidorParaRecuperacao) return;
  if (arquivosSujos.size || totalEmVoo()) {
    toast("Aguarde a confirmação dos envios pendentes antes de restaurar o rascunho.", "error");
    return;
  }
  const dados = rascunhoRecuperavel;
  chaveRecuperada = dados.chave;
  rascunhoRecuperavel = null;
  exibirRecuperacaoFicha(false);
  aplicarPersonagemCarregado({ ...servidorParaRecuperacao, ...dados.arquivos }, Object.keys(dados.arquivos));
  toast("Rascunho restaurado. Aguarde a confirmação do salvamento.", "info");
}

function descartarRascunhoFicha() {
  if (!rascunhoRecuperavel || !window.confirm("Manter a versão do servidor e descartar esta cópia local de alterações?")) return;
  try { localStorage.removeItem(rascunhoRecuperavel.chave); }
  catch { toast("Não foi possível remover a cópia local. Tente novamente.", "error"); return; }
  rascunhoRecuperavel = null;
  exibirRecuperacaoFicha(false);
}

function tentarSalvarNovamente() {
  if (!socket?.connected) { toast("Sem conexão. A cópia local será reenviada ao reconectar.", "error"); return; }
  arquivosComErro.forEach(arquivo => arquivosSujos.add(arquivo));
  enviarSalvamentosPendentes();
}

window.addEventListener("beforeunload", evento => {
  guardarRascunhoFicha();
  if (!arquivosSujos.size && !totalEmVoo() && !rascunhoRecuperavel && !(typeof temRascunhoPoder === "function" && temRascunhoPoder())) return;
  evento.preventDefault();
  evento.returnValue = "";
});

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
  guardarRascunhoFicha();
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
  guardarRascunhoFicha();
  const el = document.getElementById("save-status");
  if (!el) return;

  let texto = "";
  let cor = "text-slate-500";
  if (arquivosComErro.size) {
    texto = `Erro ao salvar: ${[...arquivosComErro].map(a => NOMES_ARQUIVOS_FICHA[a] || a).join(", ")}`;
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
  if ((arquivosSujos.size || totalEmVoo()) && !copiaLocalDisponivel) el.textContent += " · sem cópia local";
  const tentar = document.getElementById("save-retry");
  if (tentar) {
    tentar.hidden = !arquivosComErro.size;
    tentar.disabled = !socket?.connected || totalEmVoo() > 0;
  }
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

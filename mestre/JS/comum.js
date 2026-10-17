/* =========================================================================
   PAINEL DO MESTRE: PARTE COMUM
   Carregado por TODAS as páginas de /mestre. Cuida de: menu entre as páginas, token do mestre,
   conexão com o servidor (socket), indicador de conexão e avisos (toast).

   Como cada página usa:
     - no HTML:  <header id="mestre-cabecalho" data-pagina="rolagem"></header>
     - se tiver lógica própria, carrega o seu script DEPOIS deste (usa `socket`, `tokenDoMestre()`
       e `toast()`).
   O socket só conecta no fim do DOMContentLoaded, quando os scripts da página já registraram os
   seus eventos (conectar antes faria a página perder o 'connect').

   Para criar uma página nova: acrescente uma linha em PAGINAS_MESTRE, a rota em server.js
   (PAGINAS_MESTRE) e o arquivo HTML em mestre/.
   ========================================================================= */

// `pronta: false` mostra o aviso "em breve" no menu; troque para true quando a página existir de verdade.
const PAGINAS_MESTRE = [
  {
    id: "index", href: "/mestre", rotulo: "Mesa", icone: "fa-users", pronta: true,
    descricao: "Jogadores, status e rolagens da mesa",
  },
  {
    id: "rolagem", href: "/mestre/rolagem", rotulo: "Rolagem", icone: "fa-dice-d20", pronta: true,
    descricao: "Rolar dados e aplicar dano nos alvos",
  },
  {
    id: "inimigos", href: "/mestre/inimigos", rotulo: "Inimigos", icone: "fa-skull", pronta: true,
    descricao: "Inimigos em batalha e criação de novos",
  },
  {
    id: "npc", href: "/mestre/npc", rotulo: "NPCs", icone: "fa-masks-theater", pronta: true,
    descricao: "NPCs com mini lore e status básicos",
  },
  {
    id: "loot", href: "/mestre/loot", rotulo: "Loot", icone: "fa-gem", pronta: true,
    descricao: "Catálogo de itens e baús para os jogadores",
  },
  {
    id: "habilidades-magias", href: "/mestre/habilidades-magias", rotulo: "Habilidades e Magias", icone: "fa-wand-sparkles", pronta: true,
    descricao: "Criar habilidades e magias e enviar às fichas",
  },
];

const CHAVE_TOKEN_MESTRE = "rpg_mestre_token"; // o token digitado vale para todas as páginas da mesma aba

// Não conecta já: ver o comentário no topo do arquivo.
const socket = io({ autoConnect: false });

/* ------------------------------ token do mestre ------------------------------ */
function tokenDoMestre() {
  return (document.getElementById("master-token-input")?.value || "").trim();
}

function lembrarToken(valor) {
  try {
    sessionStorage.setItem(CHAVE_TOKEN_MESTRE, valor);
  } catch {
    /* sem sessionStorage: o token só vale nesta página */
  }
}

function tokenLembrado() {
  try {
    return sessionStorage.getItem(CHAVE_TOKEN_MESTRE) || "";
  } catch {
    return "";
  }
}

/* ------------------------------ cabeçalho e menu ------------------------------ */
function montarCabecalho() {
  const cabecalho = document.getElementById("mestre-cabecalho");
  if (!cabecalho) return;

  const atual = PAGINAS_MESTRE.find((p) => p.id === cabecalho.dataset.pagina) || PAGINAS_MESTRE[0];

  const links = PAGINAS_MESTRE.map((p) => {
    const ativa = p.id === atual.id;
    const classes = ativa
      ? "bg-dungeon-800 text-amberGold-400 border-amberGold-600/60"
      : "text-slate-400 border-transparent hover:text-amber-200 hover:bg-dungeon-900";
    const emBreve = p.pronta
      ? ""
      : '<span class="ml-1 text-[9px] uppercase tracking-wider text-slate-500">em breve</span>';
    return `<a href="${p.href}" data-pagina-link="${p.id}" ${ativa ? 'aria-current="page"' : ""}
        class="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition ${classes}">
        <i class="fa-solid ${p.icone}"></i>${escaparHtml(p.rotulo)}${emBreve}
      </a>`;
  }).join("");

  cabecalho.className =
    "w-full bg-dungeon-950 border-b border-dungeon-700/80 sticky top-0 z-40 backdrop-blur-md shadow-2xl px-6 pt-4 pb-3";
  cabecalho.innerHTML = `
    <div class="max-w-7xl mx-auto space-y-3">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <i class="fa-solid fa-crown text-2xl text-amberGold-400"></i>
          <div>
            <h1 class="font-cinzel font-black text-xl text-amber-100 tracking-wider">PAINEL DE CONTROLE DO MESTRE</h1>
            <p class="text-xs text-slate-400 font-mono">${escaparHtml(atual.descricao)}</p>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 bg-dungeon-900 border border-dungeon-700 px-3 py-1.5 rounded-lg text-xs font-mono">
            <i class="fa-solid fa-key text-amberGold-500"></i>
            <span class="text-slate-400">Token:</span>
            <input type="password" id="master-token-input" autocomplete="current-password"
              class="bg-transparent text-amber-200 focus:outline-none w-20 text-center border-b border-transparent focus:border-amberGold-500 font-bold"
              title="Informe a chave configurada no servidor">
          </div>
          <div id="connection-status"></div>
        </div>
      </div>

      <nav class="flex gap-2 overflow-x-auto pb-1" aria-label="Páginas do painel do mestre">${links}</nav>
    </div>`;

  const campoToken = document.getElementById("master-token-input");
  campoToken.value = tokenLembrado();
  campoToken.addEventListener("input", () => lembrarToken(campoToken.value.trim()));
  // Ao terminar de digitar/colar o token: entra na sala dos mestres (e avisa se estiver errado).
  campoToken.addEventListener("change", () => entrarNaSalaDoMestre({ silencioso: false }));
  definirStatusConexao("conectando");
}

/* ------------------------------ indicador de conexão ------------------------------ */
const STATUS_CONEXAO = {
  conectando: {
    classes: "bg-amber-950/80 border-amber-600/60 text-amber-400",
    ponto: "bg-amber-400 animate-pulse",
    texto: "Conectando…",
  },
  online: {
    classes: "bg-emerald-950/80 border-emerald-600/60 text-emerald-400",
    ponto: "bg-emerald-400 animate-pulse",
    texto: "Servidor Online",
  },
  offline: {
    classes: "bg-rose-950/80 border-rose-600/60 text-rose-400",
    ponto: "bg-rose-400",
    texto: "Desconectado",
  },
};

function definirStatusConexao(estado) {
  const el = document.getElementById("connection-status");
  if (!el) return;
  const s = STATUS_CONEXAO[estado];
  el.className = `flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border ${s.classes}`;
  el.innerHTML = `<span class="w-2 h-2 rounded-full ${s.ponto}"></span> ${s.texto}`;
}

socket.on("connect", () => {
  definirStatusConexao("online");
  entrarNaSalaDoMestre(); // reconexão também: a sala se perde quando a conexão cai
});
socket.on("disconnect", () => definirStatusConexao("offline"));
socket.on("connect_error", () => definirStatusConexao("offline"));

/* ------------------------------ pedidos ao servidor ------------------------------ */
// Convenção dos eventos master_* (ver comandos.js): o servidor responde { ok, erro, mensagem, dados }.
// pedirAoServidor devolve uma promessa com os `dados` ou rejeita com um Error (.codigo, .acaoId) e,
// por padrão, já mostra o erro num toast: as páginas só precisam do try/catch se quiserem reagir.
//   muda: true  -> o pedido altera algo: ganha um `acaoId`. Se o servidor demorar e a página reenviar,
//                  passe o MESMO acaoId (vem em erro.acaoId): o servidor não executa duas vezes.
const TEMPO_LIMITE_PEDIDO_MS = 8000;

function novoAcaoId() {
  return `acao_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function pedirAoServidor(evento, dados = {}, { muda = false, acaoId = null, silencioso = false, tempoLimiteMs = TEMPO_LIMITE_PEDIDO_MS } = {}) {
  const corpo = { ...dados, token: tokenDoMestre() };
  const id = muda ? acaoId || novoAcaoId() : null;
  if (id) corpo.acaoId = id;

  return new Promise((resolver, rejeitar) => {
    const falhar = (codigo, mensagem) => {
      if (!silencioso) toast(mensagem, "error");
      const erro = new Error(mensagem);
      erro.codigo = codigo;
      erro.acaoId = id;
      rejeitar(erro);
    };
    if (!socket.connected) {
      falhar("sem_conexao", "Sem conexão com o servidor.");
      return;
    }
    socket.timeout(tempoLimiteMs).emit(evento, corpo, (erro, resposta) => {
      if (erro) return falhar("tempo_esgotado", "O servidor não respondeu a tempo.");
      if (!resposta?.ok) return falhar(resposta?.erro || "erro", resposta?.mensagem || "O servidor recusou o pedido.");
      resolver(resposta.dados);
    });
  });
}

// Entra na sala que recebe os dados do mestre em tempo real. Devolve a resposta, ou null se não deu.
async function entrarNaSalaDoMestre({ silencioso = true } = {}) {
  if (!tokenDoMestre()) return null;
  try {
    const resposta = await pedirAoServidor("master_entrar", {}, { silencioso });
    (resposta?.avisos || []).forEach((aviso) => toast(aviso, "error"));
    return resposta;
  } catch {
    return null;
  }
}

/* ------------------------------ ajudantes de tela (compartilhados pelas páginas) ------------------------------ */
// Cria um elemento. O texto entra por textContent (nunca HTML): é assim que todo texto de usuário vai para a tela.
function criar(tag, classes = "", texto = "") {
  const el = document.createElement(tag);
  if (classes) el.className = classes;
  if (texto) el.textContent = texto;
  return el;
}
const campo = (id) => document.getElementById(id);
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Botão de ação de um cartão (<button type="button" data-acao="...">) no estilo padrão do painel.
function botaoDeAcao(acao, texto, classes = "") {
  const b = criar("button", `px-2 py-1 rounded text-[11px] font-mono border border-dungeon-700 ${classes}`, texto);
  b.type = "button";
  b.dataset.acao = acao;
  return b;
}

// Ação destrutiva com confirmação no próprio botão: o 1º clique vira "Confirmar?" (volta ao normal em 4 s); o 2º executa.
function confirmarNoBotao(botao, aoConfirmar) {
  if (botao.dataset.confirmar !== "1") {
    const rotulo = botao.textContent;
    botao.dataset.confirmar = "1";
    botao.textContent = "Confirmar?";
    setTimeout(() => {
      botao.dataset.confirmar = "";
      botao.textContent = rotulo;
    }, 4000);
    return;
  }
  aoConfirmar();
}

// Miniatura de imagem (retrato/ilustração) só se a URL passa por urlDeImagem; sem referrer; some se não carregar.
function miniaturaDeImagem(url) {
  const src = urlDeImagem(url);
  if (!src) return null;
  const img = criar("img", "w-12 h-12 rounded object-cover border border-dungeon-700 shrink-0");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.remove());
  return img;
}

/* ------------------------------ aviso (toast) ------------------------------ */
function toast(mensagem, tipo = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "fixed top-5 right-5 z-50 flex flex-col gap-2 pointer-events-none";
    document.body.appendChild(container);
  }
  const toastEl = document.createElement("div");
  const borderCol = tipo === "success" ? "border-emerald-500 text-emerald-300" : "border-rose-600 text-rose-300";
  toastEl.className = `p-3 rounded-lg bg-dungeon-950 border-l-4 ${borderCol} shadow-2xl text-xs font-mono flex items-center gap-2 transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  const texto = document.createElement("span");
  texto.textContent = mensagem;
  toastEl.appendChild(texto);
  container.appendChild(toastEl);
  setTimeout(() => toastEl.classList.remove("translate-y-2", "opacity-0"), 10);
  setTimeout(() => {
    toastEl.classList.add("opacity-0", "-translate-y-2");
    setTimeout(() => toastEl.remove(), 300);
  }, 2400);
}

/* ------------------------------ início ------------------------------ */
window.addEventListener("DOMContentLoaded", () => {
  montarCabecalho();
  socket.connect(); // por último: a página (e o seu script) já registraram os eventos
});

/* =========================================================================
   PAINEL DO MESTRE: PARTE COMUM
   Carregado por TODAS as páginas de /mestre. Cuida de: menu entre as páginas,
   conexão com o servidor (socket), indicador de conexão e avisos (toast).

   Como cada página usa:
     - no HTML:  <header id="mestre-cabecalho" data-pagina="rolagem"></header>
     - se tiver lógica própria, carrega o seu script DEPOIS deste (usa `socket`, `pedirAoServidor()`
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
    id: "figurantes", href: "/mestre/figurantes", rotulo: "Inimigos / NPCs", icone: "fa-masks-theater", pronta: true,
    descricao: "Figurantes, histórias, poderes e batalha",
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


// Não conecta já: ver o comentário no topo do arquivo.
const socket = io({ autoConnect: false });

/* ------------------------------ cabeçalho e menu ------------------------------ */
function montarCabecalho() {
  const cabecalho = document.getElementById("mestre-cabecalho");
  if (!cabecalho) return;

  const atual = PAGINAS_MESTRE.find((p) => p.id === cabecalho.dataset.pagina) || PAGINAS_MESTRE[0];

  const links = PAGINAS_MESTRE.map((p) => {
    const ativa = p.id === atual.id;
    const icones = { index: "shield", rolagem: "dice", figurantes: "book", loot: "bag", "habilidades-magias": "spark" };
    const rotulosCurtos = { index: "Mesa", rolagem: "Rolagem", figurantes: "Figurantes", loot: "Loot", "habilidades-magias": "Poderes" };
    const emBreve = p.pronta
      ? ""
      : '<span class="ml-1 text-[9px] uppercase tracking-wider text-slate-500">em breve</span>';
    return `<a href="${p.href}" data-pagina-link="${p.id}" ${ativa ? 'aria-current="page"' : ""}
        class="master-nav-link" aria-label="${escaparHtml(p.rotulo)}" title="${escaparHtml(p.descricao)}">
        <svg class="rpg-icon" aria-hidden="true"><use href="/CSS/icones.svg#${icones[p.id]}"></use></svg>
        <span class="master-nav-full">${escaparHtml(p.rotulo)}${emBreve}</span>
        <span class="master-nav-short" aria-hidden="true">${rotulosCurtos[p.id]}</span>
      </a>`;
  }).join("");

  cabecalho.className = "master-header";
  cabecalho.innerHTML = `
    <div class="master-header-inner">
      <div class="master-heading">
        <span class="rpg-sigil" aria-hidden="true"><svg class="rpg-icon"><use href="/CSS/icones.svg#shield"></use></svg></span>
        <h1>${escaparHtml(atual.rotulo)}</h1>
      </div>
      <div class="master-tools">
        <div id="connection-status" role="status" aria-live="polite"></div>
      </div>
      <nav class="master-nav" aria-label="Páginas do painel do mestre">${links}</nav>
      <p id="master-context-notice" class="master-notice" role="status">Conectando ao servidor…</p>
    </div>`;

  definirStatusConexao("conectando");
}

// Feedback de acesso é distinto do transporte Socket.IO; não muda autenticação.
function definirAvisoMestre(texto, estado = "info") {
  const aviso = document.getElementById("master-context-notice");
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.dataset.estado = estado;
}


// Os editores não são forms: valide antes de converter números ou aplicar valores padrão.
function validarCamposMestre(id, regras = {}) {
  const area = document.getElementById(id);
  let primeiro = null;
  for (const input of area.querySelectorAll('input, select, textarea')) {
    if (input.matches(':disabled')) continue;
    const texto = regras[input.id]?.(input.value.trim()) || (!input.validity.valid ? input.validationMessage : '');
    const erroId = `${input.id}-erro`;
    let erro = document.getElementById(erroId);
    if (texto && !erro) {
      erro = criar('span', 'master-field-error'); erro.id = erroId; erro.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', erro);
    }
    if (erro) { erro.textContent = texto; erro.hidden = !texto; }
    input.setAttribute('aria-invalid', String(Boolean(texto)));
    const descricoes = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    if (texto) descricoes.add(erroId); else descricoes.delete(erroId);
    if (descricoes.size) input.setAttribute('aria-describedby', [...descricoes].join(' '));
    else input.removeAttribute('aria-describedby');
    if (texto && !primeiro) primeiro = input;
  }
  primeiro?.focus();
  return !primeiro;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#mestre-cabecalho, #mestre-conteudo').forEach(el => { el.dataset.modalBackground = ''; });
  document.addEventListener('input', evento => {
    const input = evento.target;
    if (input.getAttribute('aria-invalid') !== 'true') return;
    // Um novo envio valida novamente. Ao digitar, retire a mensagem antiga, não a nova entrada.
    const erro = document.getElementById(`${input.id}-erro`);
    if (erro) { erro.textContent = ''; erro.hidden = true; }
    input.removeAttribute('aria-invalid');
  });
});

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
  el.className = "master-connection";
  el.dataset.estado = estado;
  el.innerHTML = `<span class="master-connection-dot" aria-hidden="true"></span> ${s.texto}`;
  if (estado === "offline") definirAvisoMestre("Sem conexão. As ações não serão enviadas até o servidor reconectar.", "error");
}

socket.on("connect", () => {
  definirStatusConexao("online");
  entrarNaSalaDoMestre(); // reconexão também: a sala se perde quando a conexão cai
});
socket.on("disconnect", () => { definirStatusConexao("offline"); toast("Servidor desconectado.", "evento"); });
socket.on("bau_item_retirado", ({ jogador, item, quantidade } = {}) => {
  if (jogador && item && quantidade) toast(`${jogador} pegou ${quantidade} × ${item}.`, "evento");
});
socket.on("connect_error", () => definirStatusConexao("offline"));

/* ------------------------------ pedidos ao servidor ------------------------------ */
// Convenção dos eventos master_* (ver comandos.js): o servidor responde { ok, erro, mensagem, dados }.
// pedirAoServidor devolve uma promessa com os `dados` ou rejeita com um Error (.codigo, .acaoId) e,
// por padrão, já mostra o erro num toast: as páginas só precisam do try/catch se quiserem reagir.
//   muda: true  -> o pedido altera algo: ganha um `acaoId`. Se o servidor demorar e a página reenviar,
//                  passe o MESMO acaoId (vem em erro.acaoId): o servidor não executa duas vezes.
const TEMPO_LIMITE_PEDIDO_MS = 8000;
const mutacoesEmAndamento = new Map();
const editoresProtegidos = new Map();
const camposBloqueadosEmEnvio = new Map();

function bloquearCamposEnvioMestre(id, enviando) {
  const area = document.getElementById(id);
  if (!area) return;
  if (enviando && !camposBloqueadosEmEnvio.has(id)) {
    const controles = [...area.querySelectorAll("input, select, textarea, button")];
    camposBloqueadosEmEnvio.set(id, controles.map(el => [el, el.disabled]));
    controles.forEach(el => { el.disabled = true; });
    area.setAttribute("aria-busy", "true");
  } else if (!enviando) {
    (camposBloqueadosEmEnvio.get(id) || []).forEach(([el, anterior]) => { el.disabled = anterior; });
    camposBloqueadosEmEnvio.delete(id);
    area.removeAttribute("aria-busy");
  }
}

function assinaturaEditorMestre(id, extra = () => null) {
  const area = document.getElementById(id);
  return JSON.stringify([
    [...(area?.querySelectorAll("input, select, textarea") || [])].map(el =>
      [el.id || el.name, el.type === "checkbox" ? el.checked : el.value]),
    extra(),
  ]);
}

function protegerEditorMestre(id, extra = () => null, opcoes = {}) {
  const anterior = editoresProtegidos.get(id);
  clearTimeout(anterior?.timer); anterior?.observador?.disconnect();
  const area = document.getElementById(id);
  area?.querySelectorAll('.master-field-error').forEach(el => { el.textContent = ''; el.hidden = true; });
  area?.querySelectorAll('[aria-invalid]').forEach(input => {
    input.removeAttribute('aria-invalid');
    const descricoes = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(valor => valor && valor !== `${input.id}-erro`);
    if (descricoes.length) input.setAttribute('aria-describedby', descricoes.join(' '));
    else input.removeAttribute('aria-describedby');
  });
  const registro = { extra, inicial: assinaturaEditorMestre(id, extra), opcoes,
    chave: `rpg_mestre_rascunho:${location.pathname}:${id}:${opcoes.chave || "novo"}`, pendente: false };
  editoresProtegidos.set(id, registro);
  area?.querySelector('.master-draft-notice')?.remove();
  try {
    const salvo = JSON.parse(localStorage.getItem(registro.chave));
    if (salvo && Array.isArray(salvo.campos)) {
      registro.pendente = true;
      registro.bloqueados = [...area.querySelectorAll('input, select, textarea, button')]
        .filter(el => !el.matches('[data-fechar], [id$="cancelar"]'))
        .map(el => [el, el.disabled]);
      registro.bloqueados.forEach(([el]) => { el.disabled = true; });
      const liberar = () => { registro.bloqueados.forEach(([el, desabilitado]) => { el.disabled = desabilitado; }); registro.bloqueados = []; };
      const aviso = criar('div', 'master-draft-notice rpg-message');
      aviso.setAttribute('role', 'status');
      aviso.append(criar('p', '', `Há um rascunho de ${new Date(salvo.quando).toLocaleString('pt-BR')}. Escolha restaurar ou descartar para continuar. Restaurar preenche o editor; só será enviado ao confirmar o salvamento.`));
      const restaurar = botaoDeAcao('restaurar-rascunho', 'Restaurar rascunho');
      const descartar = botaoDeAcao('descartar-rascunho', 'Descartar rascunho');
      restaurar.addEventListener('click', () => {
        liberar();
        opcoes.restaurarExtra?.(salvo.extra);
        const controles = [...area.querySelectorAll('input, select, textarea')];
        for (const [chave, valor] of salvo.campos) {
          const input = controles.find((el, indice) => (el.id || `campo-${indice}`) === chave);
          if (!input || input.type === 'password' || input.type === 'file') continue;
          if (input.type === 'checkbox') input.checked = Boolean(valor); else input.value = valor;
        }
        opcoes.aposRestaurar?.();
        registro.pendente = false; aviso.remove();
        guardarRascunhoEditorMestre(id);
        area.querySelector('input:not(:disabled), textarea:not(:disabled)')?.focus();
      });
      descartar.addEventListener('click', () => {
        try { localStorage.removeItem(registro.chave); } catch { toast('Não foi possível descartar o rascunho.', 'error'); return; }
        liberar();
        registro.pendente = false; aviso.remove(); guardarRascunhoEditorMestre(id);
      });
      aviso.append(restaurar, descartar);
      (area.querySelector('form') || area).prepend(aviso);
    }
  } catch { toast('Não foi possível ler o rascunho local deste editor.', 'error'); }
  if (area) {
    area.oninputRascunhoMestre && area.removeEventListener('input', area.oninputRascunhoMestre);
    area.oninputRascunhoMestre && area.removeEventListener('change', area.oninputRascunhoMestre);
    area.oninputRascunhoMestre = () => {
      clearTimeout(registro.timer);
      registro.timer = setTimeout(() => guardarRascunhoEditorMestre(id), 350);
    };
    area.addEventListener('input', area.oninputRascunhoMestre);
    area.addEventListener('change', area.oninputRascunhoMestre);
    // Alterações estruturais (adicionar/remover poderes ou linhas) também precisam de cópia.
    registro.observador = new MutationObserver(() => area.oninputRascunhoMestre());
    registro.observador.observe(area, { childList: true, subtree: true });
  }
}

function guardarRascunhoEditorMestre(id) {
  const registro = editoresProtegidos.get(id), area = document.getElementById(id);
  if (!registro || !area || registro.pendente) return;
  try {
    if (!editorMestreAlterado(id)) { localStorage.removeItem(registro.chave); return; }
    const campos = [...area.querySelectorAll('input, select, textarea')]
      .map((el, indice) => [el.id || `campo-${indice}`, el.type === 'checkbox' ? el.checked : el.value, el.type])
      .filter(([, , tipo]) => !['password', 'file'].includes(tipo)).map(([chave, valor]) => [chave, valor]);
    localStorage.setItem(registro.chave, JSON.stringify({ quando: Date.now(), campos, extra: registro.extra() }));
  } catch {
    if (!registro.avisouErro) toast('Não foi possível guardar o rascunho local. Mantenha o editor aberto até salvar.', 'error');
    registro.avisouErro = true;
  }
}

function editorMestreAlterado(id) {
  const registro = editoresProtegidos.get(id);
  return Boolean(registro && registro.inicial !== assinaturaEditorMestre(id, registro.extra));
}

async function podeDescartarEditorMestre(id) {
  return !editorMestreAlterado(id) || RPGUI.confirmar({ titulo: 'Descartar alterações?', mensagem: 'As alterações deste editor ainda não foram salvas. Cancelar mantém os campos preenchidos.', acao: 'Descartar alterações' });
}

function limparProtecaoEditorMestre(id, salvo = false) {
  const registro = editoresProtegidos.get(id);
  clearTimeout(registro?.timer); registro?.observador?.disconnect();
  registro?.bloqueados?.forEach(([el, desabilitado]) => { el.disabled = desabilitado; });
  const area = document.getElementById(id);
  if (area?.oninputRascunhoMestre) {
    area.removeEventListener('input', area.oninputRascunhoMestre);
    area.removeEventListener('change', area.oninputRascunhoMestre);
  }
  // Fechamento explícito significa salvar ou descartar; uma oferta ainda não respondida é mantida.
  if (registro && (salvo || !registro.pendente)) {
    try { localStorage.removeItem(registro.chave); } catch { /* o próximo acesso permite descartar */ }
  }
  editoresProtegidos.delete(id);
}

async function executarAcaoMestre(botao, rotulo, acao) {
  if (botao?.dataset.enviando === "1") return;
  const texto = botao?.textContent;
  const desabilitado = botao?.disabled;
  if (botao) {
    botao.dataset.enviando = "1";
    botao.disabled = true;
    botao.setAttribute("aria-busy", "true");
    botao.textContent = rotulo;
  }
  try { return await acao(); }
  finally {
    if (botao) {
      delete botao.dataset.enviando;
      botao.disabled = desabilitado;
      botao.removeAttribute("aria-busy");
      botao.textContent = texto;
    }
  }
}

// Falha de leitura não é uma lista vazia. Preserva os últimos dados, quando existirem.
function mostrarEstadoLeituraMestre(area, { carregando, erro, carregou }, repetir) {
  area.querySelector(":scope > .master-load-notice")?.remove();
  if (!carregando && !erro && carregou) return true;
  const aviso = criar("div", "master-empty master-load-notice");
  aviso.setAttribute("role", erro ? "alert" : "status");
  aviso.append(criar("p", "", carregando ? "Carregando dados…" : erro || "Aguardando dados do servidor…"));
  if (erro && repetir) {
    const botao = botaoDeAcao("recarregar", "Tentar novamente");
    botao.addEventListener("click", repetir);
    aviso.append(botao);
  }
  if (!carregou) area.replaceChildren(aviso);
  else {
    aviso.append(criar("p", "rpg-hint", "Os dados anteriores continuam visíveis."));
    area.prepend(aviso);
  }
  return carregou;
}

window.addEventListener("beforeunload", (evento) => {
  for (const id of editoresProtegidos.keys()) guardarRascunhoEditorMestre(id);
  if (![...editoresProtegidos.keys()].some(editorMestreAlterado) && !mutacoesEmAndamento.size) return;
  evento.preventDefault();
  evento.returnValue = "";
});
window.addEventListener("pagehide", () => {
  for (const id of editoresProtegidos.keys()) guardarRascunhoEditorMestre(id);
});

function novoAcaoId() {
  return `acao_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function pedirAoServidor(evento, dados = {}, { muda = false, acaoId = null, silencioso = false, tempoLimiteMs = TEMPO_LIMITE_PEDIDO_MS } = {}) {
  const chave = JSON.stringify([evento, dados]);
  if (muda && mutacoesEmAndamento.has(chave)) return mutacoesEmAndamento.get(chave);
  const corpo = { ...dados };
  const id = muda ? acaoId || novoAcaoId() : null;
  if (id) corpo.acaoId = id;

  const pedido = new Promise((resolver, rejeitar) => {
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
      if (erro) return falhar("tempo_esgotado", muda
        ? "Resultado ainda não confirmado. Atualize os dados antes de repetir: a ação pode ter sido concluída."
        : "O servidor não respondeu a tempo.");
      if (!resposta?.ok) return falhar(resposta?.erro || "erro", resposta?.mensagem || "O servidor recusou o pedido.");
      resolver(resposta.dados);
    });
  });
  if (!muda) return pedido;
  const protegido = pedido.finally(() => mutacoesEmAndamento.delete(chave));
  mutacoesEmAndamento.set(chave, protegido);
  return protegido;
}

// Entra na sala que recebe os dados do mestre em tempo real. Devolve a resposta, ou null se não deu.
async function entrarNaSalaDoMestre({ silencioso = true } = {}) {
  definirAvisoMestre("Sincronizando campanha…");
  try {
    const resposta = await pedirAoServidor("master_entrar", {}, { silencioso });
    definirAvisoMestre("Dados da campanha sincronizados em tempo real.", "success");
    (resposta?.avisos || []).forEach((aviso) => toast(aviso, "error"));
    return resposta;
  } catch (erro) {
    definirAvisoMestre(erro.message || "Não foi possível acessar a campanha. Confira a conexão.", "error");
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
  const b = criar("button", `master-action px-2 py-1 rounded text-[11px] font-mono border border-dungeon-700 ${classes}`, texto);
  b.type = "button";
  b.dataset.acao = acao;
  return b;
}

// Só apresentação: mantém o formulário e a resposta do servidor sob os mesmos contratos.
function marcarEnvioMestre(id, enviando) {
  const botao = campo(id);
  if (!botao) return;
  const editor = botao.closest("#habmag-editor, #loot-editor-item, #loot-editor-bau");
  if (editor) bloquearCamposEnvioMestre(editor.id, enviando);
  if (enviando) botao.dataset.rotuloOriginal = botao.textContent;
  botao.disabled = enviando;
  botao.setAttribute("aria-busy", String(enviando));
  botao.textContent = enviando ? "Salvando…" : botao.dataset.rotuloOriginal || "Salvar";
}

// Ação destrutiva com confirmação no próprio botão: o 1º clique vira "Confirmar?" (volta ao normal em 4 s); o 2º executa.
async function confirmarNoBotao(botao, aoConfirmar, mensagem = `Confirmar ${botao.textContent.trim().toLowerCase()}?`, ampla = false) {
  if (botao.disabled || botao.dataset.enviando === '1') return;
  const acao = ampla ? 'Limpar batalha' : botao.textContent.trim();
  if (!await RPGUI.confirmar({ titulo: ampla ? 'Limpar batalha inteira?' : 'Confirmar exclusão', mensagem, acao })) return;
  try { return await executarAcaoMestre(botao, 'Aguarde…', aoConfirmar); }
  catch (erro) { toast(erro.message || 'Não foi possível concluir a ação.', 'error'); }
}

// Somente preferências de apresentação; nunca restaura ataque ou valores do jogo.
function lerContextoMestre(pagina) {
  try { return JSON.parse(sessionStorage.getItem(`rpg_mestre_contexto:${pagina}`)) || {}; }
  catch { return {}; }
}
function guardarContextoMestre(pagina, contexto) {
  try { sessionStorage.setItem(`rpg_mestre_contexto:${pagina}`, JSON.stringify(contexto)); } catch { /* navegação continua sem armazenamento */ }
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
const temporizadoresToastMestre = new WeakMap();
function toast(mensagem, tipo = "info") {
  if (!['error', 'evento', 'info', 'success'].includes(tipo)) tipo = 'info';
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "master-toasts";
    document.body.appendChild(container);
  }
  const existente = [...container.children].find(el => el.dataset.tipo === tipo && el.querySelector('span')?.textContent === String(mensagem));
  if (existente) {
    clearTimeout(temporizadoresToastMestre.get(existente));
    if (tipo !== 'error') temporizadoresToastMestre.set(existente, setTimeout(() => existente.remove(), 6000));
    return;
  }
  const toastEl = document.createElement("div");
  toastEl.className = "master-toast";
  toastEl.dataset.tipo = tipo;
  toastEl.setAttribute("role", tipo === "error" ? "alert" : "status");
  const texto = document.createElement("span");
  texto.textContent = mensagem;
  toastEl.appendChild(texto);
  const fechar = criar("button", "master-toast-close", "×");
  fechar.type = "button";
  fechar.setAttribute("aria-label", "Dispensar aviso");
  fechar.addEventListener("click", () => toastEl.remove());
  toastEl.appendChild(fechar);
  container.appendChild(toastEl);
  while (container.children.length > 4) container.firstElementChild.remove();
  if (tipo !== "error") temporizadoresToastMestre.set(toastEl, setTimeout(() => toastEl.remove(), 6000));
}

/* Resumo somente de leitura: os mesmos estados públicos usados pela Mesa. */
const resumoJogadoresMestre = { jogadores: {}, recentes: {}, energia: false, sincronizado: false, timer: null };
function atualizarJogadoresRecentesMestre() {
  clearTimeout(resumoJogadoresMestre.timer);
  const agora = Date.now();
  for (const [id, registro] of Object.entries(resumoJogadoresMestre.recentes)) {
    if (registro.expiraEm <= agora || resumoJogadoresMestre.jogadores[id]) delete resumoJogadoresMestre.recentes[id];
  }
  const proximos = Object.values(resumoJogadoresMestre.recentes).map(r => r.expiraEm);
  if (proximos.length) resumoJogadoresMestre.timer = setTimeout(() => {
    atualizarJogadoresRecentesMestre(); renderizarResumoJogadoresMestre();
  }, Math.max(1, Math.min(...proximos) - agora));
}
function renderizarResumoJogadoresMestre() {
  const area = document.getElementById("master-resumo-jogadores");
  if (!area) return;
  const lista = area.querySelector(".master-resumo-lista"), aviso = area.querySelector(".master-resumo-status");
  const jogadores = [...Object.values(resumoJogadoresMestre.jogadores).map(jogador => ({ jogador, offline: false })),
    ...Object.values(resumoJogadoresMestre.recentes).map(({ jogador }) => ({ jogador, offline: true }))];
  aviso.textContent = !resumoJogadoresMestre.sincronizado ? "Aguardando sincronização dos jogadores…" : jogadores.length ? "Jogadores" : "Nenhum jogador conectado.";
  lista.replaceChildren();
  for (const { jogador, offline } of jogadores) {
    const nome = typeof jogador.name === "string" && jogador.name.trim() ? jogador.name : "Personagem";
    const card = criar("li", "master-resumo-jogador");
    card.dataset.offline = String(offline);
    const foto = criar("span", "master-resumo-foto");
    foto.setAttribute("aria-hidden", "true");
    foto.append(criar("span", "", nome.trim().charAt(0).toLocaleUpperCase("pt-BR")));
    const imagem = miniaturaDeImagem(jogador.avatar);
    if (imagem) foto.append(imagem);
    const dados = criar("div", "master-resumo-dados");
    const titulo = criar("strong", "master-resumo-nome", nome); titulo.title = `${nome} · ${offline ? "Desconectado" : "Conectado"}`;
    titulo.append(criar("span", "rpg-sr-only", offline ? " · Desconectado" : " · Conectado"));
    const vitais = criar("div", "master-resumo-vitais");
    const formatar = vital => Number.isFinite(vital?.current) && Number.isFinite(vital?.max) ? `${vital.current}/${vital.max}` : "—";
    const vitalResumo = (nomeVital, vital, classe, simbolo) => {
      const linha = criar("div", `master-resumo-vital ${classe}`);
      const icone = criar("span", "master-resumo-icone", simbolo); icone.setAttribute("aria-hidden", "true");
      const rotulo = criar("span", "rpg-sr-only", `${nomeVital} `);
      const trilho = criar("span", "master-resumo-trilho"); trilho.setAttribute("aria-hidden", "true");
      const barra = criar("span", "master-resumo-barra");
      const atual = Number.isFinite(vital?.current) ? vital.current : 0;
      const maximo = Number.isFinite(vital?.max) ? vital.max : 0;
      barra.style.width = `${maximo > 0 ? Math.max(0, Math.min(100, atual / maximo * 100)) : 0}%`;
      trilho.append(barra);
      linha.append(icone, rotulo, trilho, criar("span", "master-resumo-valor", formatar(vital)));
      return linha;
    };
    vitais.append(vitalResumo("Vida", jogador.vitals?.hp, "master-resumo-vida", "♥"));
    if (resumoJogadoresMestre.energia) vitais.append(vitalResumo("Energia", jogador.vitals?.vigor, "master-resumo-energia", "⚡"));
    dados.append(titulo, vitais); card.append(foto, dados); lista.append(card);
  }
}
function montarResumoJogadoresMestre() {
  const pagina = document.getElementById("mestre-cabecalho")?.dataset.pagina;
  if (!pagina || pagina === "index" || pagina === "rolagem") return;
  let area = document.getElementById("master-resumo-jogadores");
  if (!area) {
    area = criar("section", "master-resumo-jogadores"); area.id = "master-resumo-jogadores";
    document.getElementById("mestre-conteudo")?.prepend(area);
  }
  area.classList.add("master-resumo-jogadores");
  area.setAttribute("aria-label", "Resumo dos jogadores conectados");
  const status = criar("span", "master-resumo-status"); status.setAttribute("role", "status");
  const lista = criar("ul", "master-resumo-lista"); lista.setAttribute("aria-label", "Personagens conectados");
  area.replaceChildren(status, lista); renderizarResumoJogadoresMestre();
}
socket.on("sync_all_players", jogadores => {
  resumoJogadoresMestre.jogadores = jogadores && typeof jogadores === "object" ? jogadores : {};
  atualizarJogadoresRecentesMestre();
  resumoJogadoresMestre.sincronizado = true; renderizarResumoJogadoresMestre();
});
socket.on("sync_recent_players", registros => {
  resumoJogadoresMestre.recentes = {};
  if (Array.isArray(registros)) for (const registro of registros) {
    if (registro?.jogador?.id && Number.isFinite(registro.expiraEm)) resumoJogadoresMestre.recentes[registro.jogador.id] = registro;
  }
  atualizarJogadoresRecentesMestre(); renderizarResumoJogadoresMestre();
});
socket.on("player_recently_disconnected", registro => {
  if (!registro?.jogador?.id || !Number.isFinite(registro.expiraEm)) return;
  resumoJogadoresMestre.recentes[registro.jogador.id] = registro;
  atualizarJogadoresRecentesMestre(); renderizarResumoJogadoresMestre();
});
socket.on("sync_config", config => {
  if (typeof config?.AtivarMana !== "boolean") return;
  resumoJogadoresMestre.energia = config.AtivarMana; renderizarResumoJogadoresMestre();
});
socket.on("player_updated", jogador => {
  if (!jogador?.id) return;
  resumoJogadoresMestre.jogadores[jogador.id] = jogador;
  atualizarJogadoresRecentesMestre(); renderizarResumoJogadoresMestre();
});
socket.on("vital_adjusted", dados => {
  const jogador = resumoJogadoresMestre.jogadores[dados?.charId];
  if (!jogador || !dados.vitals) return;
  jogador.vitals = dados.vitals; renderizarResumoJogadoresMestre();
});
socket.on("player_removed", dados => {
  if (!dados?.charId) return;
  delete resumoJogadoresMestre.jogadores[dados.charId]; renderizarResumoJogadoresMestre();
});
socket.on("disconnect", () => {
  resumoJogadoresMestre.jogadores = {}; resumoJogadoresMestre.sincronizado = false; renderizarResumoJogadoresMestre();
});

/* ------------------------------ início ------------------------------ */
window.addEventListener("DOMContentLoaded", () => {
  montarCabecalho();
  montarResumoJogadoresMestre();
  document.querySelectorAll('[role="tablist"]').forEach((lista) => {
    const abas = [...lista.querySelectorAll("button")];
    abas.forEach((aba) => aba.setAttribute("role", "tab"));
    lista.addEventListener("keydown", (ev) => {
      const indice = abas.indexOf(document.activeElement);
      if (indice < 0 || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(ev.key)) return;
      ev.preventDefault();
      const proximo = ev.key === "Home" ? 0 : ev.key === "End" ? abas.length - 1
        : (indice + (ev.key === "ArrowRight" ? 1 : -1) + abas.length) % abas.length;
      abas[proximo].focus();
      abas[proximo].click();
    });
  });
  document.querySelectorAll("i.fa-solid").forEach((icone) => icone.setAttribute("aria-hidden", "true"));
  socket.connect(); // por último: a página (e o seu script) já registraram os eventos
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { lerCookie } = require("./acesso.js");
// Rede de segurança de último recurso: um erro inesperado é registrado e a mesa continua (cada evento de
// socket também é protegido por `ouvir`, e as entradas são validadas; isto só existe para nada derrubar a mesa).
process.on("uncaughtException", (erro) =>
  console.error("[FALHA NÃO TRATADA]", erro),
);
process.on("unhandledRejection", (erro) =>
  console.error("[FALHA NÃO TRATADA]", erro),
);

const personagemModelo = require("./personagem");
const {
  criarCampanha,
  TIPOS_CATALOGO,
  entradaParaFicha,
  entradaPublica,
  itemParaInventario,
  bausPublicos,
  ErroCampanha,
} = require("./campanha.js");
const { criarEntregas } = require("./entregas.js");
const regrasDaBatalha = require("./batalha.js");
const rolagemDoMestre = require("./rolagem.js");
const { criarDano } = require("./dano.js");
const { criarComandos } = require("./comandos.js");
const {
  MAX_VITAL,
  VITAL_TYPES,
  NORMALIZADORES,
  ehIdSeguro,
  extrairNomeEId,
  criarArquivosPadraoAsync,
  carregarPersonagemDaPastaAsync,
  lerArquivosNormalizados,
  gravarJsonAsync,
} = personagemModelo;

const CONFIG_PATH = path.join(__dirname, "config.json");
// Fonte única dos padrões da mesa (o cliente usa os mesmos valores até receber sync_config).
const DEFAULT_CONFIG = {
  AtivarRiquezas: false,
  UsarEx: false,
  AtivarSlotMochila: true,
  AtivarMana: false,
};
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const SESSIONS = new Map();

const COOKIE_SESSAO = "rpg_sessao";

// Abre a sessão. Com `res`, o token vai também num cookie: é ele que permite ao servidor exigir
// login para abrir as páginas (a ficha continua usando o token do sessionStorage nos sockets).
const MAX_SESSOES = 2000; // teto: passou disso, a sessão mais antiga é descartada (a memória não cresce sem limite)
function criarSessao(player, res) {
  const token = crypto.randomUUID();
  SESSIONS.set(token, player);
  if (SESSIONS.size > MAX_SESSOES)
    SESSIONS.delete(SESSIONS.keys().next().value);
  if (res)
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_SESSAO}=${token}; Path=/; HttpOnly; SameSite=Lax`,
    );
  return token;
}

function obterPlayerAutenticado(req) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  return SESSIONS.get(token) || null;
}

// Pasta raiz das contas/personagens.
const PLAYERS_PATH = path.join(__dirname, "players");
if (!fs.existsSync(PLAYERS_PATH)) {
  fs.mkdirSync(PLAYERS_PATH);
}

// Dados do mestre (inimigos, NPCs, baús, batalha): pasta campanha/, com backup ao ligar.
const campanha = criarCampanha(path.join(__dirname, "campanha"), {
  pastaCatalogo: path.join(__dirname, "catalogo"),
  pastaFigurantes: path.join(__dirname, "Figurante"),
});
campanha.iniciar();
// Convenção dos eventos master_* novos (formato, acaoId, resposta {ok, erro, dados}).
const comandos = criarComandos();
// Caixa de entregas por personagem (o mestre entrega, a própria ficha aplica).
const entregas = criarEntregas({
  pastaDoPersonagem: (player, nomePasta) =>
    path.join(PLAYERS_PATH, player, nomePasta),
});

const app = express();
const PASTA_IMAGENS_ITENS = path.join(__dirname, "imagens", "itens");
app.post("/mestre/imagens-itens", express.raw({ type: "image/png", limit: "2mb" }), async (req, res, next) => {
  try {
    const dados = req.body;
    const assinatura = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!Buffer.isBuffer(dados) || dados.length < 33 || !dados.subarray(0, 8).equals(assinatura) || dados.readUInt32BE(8) !== 13 || dados.toString('ascii', 12, 16) !== 'IHDR' || dados.readUInt32BE(16) !== 256 || dados.readUInt32BE(20) !== 256) return res.status(400).json({ error: "Imagem PNG inválida." });
    const nome = crypto.createHash("sha256").update(dados).digest("hex") + ".png";
    await fs.promises.mkdir(PASTA_IMAGENS_ITENS, { recursive: true });
    try { await fs.promises.writeFile(path.join(PASTA_IMAGENS_ITENS, nome), dados, { flag: "wx" }); }
    catch (erro) { if (erro.code !== "EEXIST") throw erro; }
    return res.json({ imagem: `/imagens-itens/${nome}` });
  } catch (erro) { next(erro); }
});
app.use("/imagens-itens", express.static(PASTA_IMAGENS_ITENS, { index: false, fallthrough: false, setHeaders: res => res.setHeader("X-Content-Type-Options", "nosniff") }));
app.disable("x-powered-by"); // não anuncia o framework
app.use(express.json());

//=============================== LOGIN ==================================//
// Nomes que o Windows não aceita como pasta (e que não valem em nenhum sistema para uma conta).
const NOME_RESERVADO = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

app.post("/api/login", (req, res) => {
  const corpo =
    req.body !== null &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
      ? req.body
      : {};
  const { nome, senha, criarSeNaoExistir } = corpo;

  if (!nome || typeof nome !== "string") {
    return res.status(400).json({ success: false, message: "Nome inválido." });
  }

  // Sanitiza o nome para evitar caracteres perigosos de pastas
  const safeNome = nome.trim().replace(/[/\\?%*:|"<>]/g, "");
  const pastaJogador = path.join(PLAYERS_PATH, safeNome);
  if (
    !safeNome ||
    safeNome === "." ||
    safeNome === ".." ||
    safeNome.length > 40 ||
    // eslint-disable-next-line no-control-regex -- recusar caractere de controle é justamente o objetivo
    /[\u0000-\u001f\u007f]/.test(safeNome) || // caractere de controle (ex.: NUL) não vira pasta
    /[. ]$/.test(safeNome) || // o Windows descarta ponto/espaço no fim e a conta "mudaria de nome"
    NOME_RESERVADO.test(safeNome)
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Nome de usuário inválido." });
  }

  const caminhoLogin = path.join(pastaJogador, "login.json");
  const senhaDigitada = String(senha || "");

  // Cria a pasta (se preciso), grava a senha digitada e já abre a sessão.
  const cadastrar = (mensagemOk, mensagemErro) => {
    try {
      fs.mkdirSync(pastaJogador, { recursive: true });
      fs.writeFileSync(
        caminhoLogin,
        JSON.stringify({ senha: senhaDigitada }, null, 2),
        "utf8",
      );
      return res.json({
        success: true,
        message: mensagemOk,
        player: safeNome,
        token: criarSessao(safeNome, res),
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: mensagemErro });
    }
  };

  // 1. A pasta da conta NÃO existe: cria a conta, ou avisa para o cliente abrir o popup
  if (!fs.existsSync(pastaJogador)) {
    if (criarSeNaoExistir) {
      return cadastrar(
        "Conta criada com sucesso!",
        "Erro ao criar a conta no servidor.",
      );
    }
    return res.json({ exists: false, message: "A conta não existe." });
  }

  // 2. A pasta existe mas não tem login.json: cadastra a senha digitada
  if (!fs.existsSync(caminhoLogin)) {
    return cadastrar(
      "Senha cadastrada com sucesso!",
      "Erro ao gravar login.json.",
    );
  }

  // 3. Já existe login.json: confere a senha
  try {
    const dadosLogin = JSON.parse(fs.readFileSync(caminhoLogin, "utf8"));
    if (dadosLogin.senha === senhaDigitada) {
      return res.json({
        success: true,
        player: safeNome,
        token: criarSessao(safeNome, res),
      });
    } else {
      return res.json({ success: false, message: "Senha incorreta!" });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Erro ao ler credenciais." });
  }
});

//=============================== ARQUIVOS DE PERSONAGEM ==================================//
// O formato de cada arquivo (nomes, defaults, validação, migração) vive em personagem.js.

function gerarIdPersonagem(player, nome) {
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    const id = Math.floor(1000 + Math.random() * 9000).toString();
    const pasta = path.join(PLAYERS_PATH, player, `${nome}_${id}`);

    if (!fs.existsSync(pasta)) {
      return id;
    }
  }

  throw new Error("Não foi possível gerar um ID único para o personagem.");
}

// Mantém carga, salvamento, ajuste do mestre e exclusão na ordem de cada personagem.
const operacoesPersonagem = new Map();
function naFilaPersonagem(player, nomePasta, tarefa) {
  const identidade = JSON.stringify([player, nomePasta]);
  const chave = process.platform === "win32" ? identidade.toLowerCase() : identidade;
  const anterior = operacoesPersonagem.get(chave) || Promise.resolve();
  const execucao = anterior.then(tarefa);
  const cauda = execucao.catch(() => {});
  operacoesPersonagem.set(chave, cauda);
  cauda.then(() => { if (operacoesPersonagem.get(chave) === cauda) operacoesPersonagem.delete(chave); });
  return execucao;
}

async function criarPersonagem(player, nome) {
  const id = gerarIdPersonagem(player, nome);
  const nomePasta = `${nome}_${id}`;
  const personagemPath = path.join(PLAYERS_PATH, player, nomePasta);

  fs.mkdirSync(personagemPath, { recursive: true });
  await criarArquivosPadraoAsync(personagemPath, { id, nome });

  return {
    id,
    nome,
    pasta: nomePasta,
    path: personagemPath,
  };
}

// Devolve { personagem } ou { motivo: "nao_encontrado" | "invalido" } (para a ficha mostrar a mensagem certa).
async function carregarPersonagem(player, nomePasta) {
  const personagemPath = path.join(PLAYERS_PATH, player, nomePasta);

  if (!fs.existsSync(personagemPath)) {
    return { motivo: "nao_encontrado" };
  }

  try {
    const { personagem, erros } = await carregarPersonagemDaPastaAsync(personagemPath);
    if (erros) {
      console.error(
        `Personagem com arquivos inválidos em ${personagemPath}:`,
        erros,
      );
      return { motivo: "invalido" };
    }
    return { personagem };
  } catch (error) {
    console.error(`Falha ao carregar ${personagemPath}:`, error);
    return { motivo: "invalido" };
  }
}

// Só grava arquivos da lista oficial, depois de validar/normalizar com o modelo.
async function salvarArquivoPersonagem(player, nomePasta, arquivo, dados) {
  const normalizar = Object.hasOwn(NORMALIZADORES, arquivo)
    ? NORMALIZADORES[arquivo]
    : null;
  if (!normalizar)
    return { ok: false, message: "Arquivo de personagem desconhecido." };

  const limpo = normalizar(dados);
  if (!limpo)
    return { ok: false, message: `Formato inválido para ${arquivo}.` };

  const caminho = path.join(PLAYERS_PATH, player, nomePasta, `${arquivo}.json`);
  await gravarJsonAsync(caminho, limpo);
  return { ok: true, dados: limpo };
}

// O nome exibido vem de perfil.json (editável na ficha); a pasta nome_id nunca é renomeada.
function lerNomeDoPerfil(pastaJogador, nomePasta) {
  const nomeDaPasta = extrairNomeEId(nomePasta).nome;
  try {
    const perfil = JSON.parse(
      fs
        .readFileSync(path.join(pastaJogador, nomePasta, "perfil.json"), "utf8")
        .replace(/^\uFEFF/, ""),
    );
    const nome = typeof perfil?.nome === "string" ? perfil.nome.trim() : "";
    return nome ? nome.slice(0, 40) : nomeDaPasta;
  } catch {
    return nomeDaPasta;
  }
}

app.get("/api/personagens", (req, res) => {
  const player = obterPlayerAutenticado(req);
  if (!player) {
    return res
      .status(401)
      .json({ success: false, message: "Sessão inválida." });
  }

  const pastaJogador = path.join(PLAYERS_PATH, player);
  if (!fs.existsSync(pastaJogador)) {
    return res.json({ success: true, personagens: [] });
  }

  try {
    const personagens = fs
      .readdirSync(pastaJogador, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        nome: lerNomeDoPerfil(pastaJogador, entry.name),
        nomePasta: entry.name,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    return res.json({ success: true, personagens });
  } catch (error) {
    console.error(`Erro ao listar personagens de ${player}:`, error);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao listar personagens." });
  }
});

app.post("/api/personagens", async (req, res) => {
  const player = obterPlayerAutenticado(req);
  if (!player) {
    return res
      .status(401)
      .json({ success: false, message: "Sessão inválida." });
  }

  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  if (
    !nome ||
    nome === "." ||
    nome === ".." ||
    nome.length > 40 ||
    // eslint-disable-next-line no-control-regex -- NUL não pode aparecer em nome de arquivo
    /[/\\?%*:|"<>\u0000]/.test(nome)
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Nome de personagem inválido." });
  }

  try {
    const personagem = await criarPersonagem(player, nome);
    return res.status(201).json({
      success: true,
      personagem: { nome: personagem.nome, nomePasta: personagem.pasta },
    });
  } catch (error) {
    console.error(`Erro ao criar personagem para ${player}:`, error);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao criar personagem." });
  }
});

app.delete("/api/personagens/:nomePasta", (req, res) => {
  const player = obterPlayerAutenticado(req);
  if (!player)
    return res
      .status(401)
      .json({ success: false, message: "Sessão inválida." });
  const { nomePasta } = req.params;
  if (!nomePastaValido(nomePasta)) {
    return res
      .status(400)
      .json({ success: false, message: "Pasta de personagem inválida." });
  }
  return naFilaPersonagem(player, nomePasta, async () => {
    try {
      // Resolve e confere o destino antes da remoção recursiva, inclusive links/junções no Windows.
      const raiz = fs.realpathSync(PLAYERS_PATH);
      const pastaJogador = path.resolve(raiz, player);
      const alvo = path.resolve(pastaJogador, nomePasta);
      if (
        path.dirname(pastaJogador) !== raiz ||
        path.dirname(alvo) !== pastaJogador ||
        fs.realpathSync(pastaJogador) !== pastaJogador ||
        !fs.lstatSync(alvo).isDirectory() ||
        fs.realpathSync(alvo) !== alvo
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Pasta de personagem inválida." });
      }
      await fs.promises.rm(alvo, { recursive: true, maxRetries: 3, retryDelay: 100 });
      for (const socket of io.sockets.sockets.values()) {
        if (
          socket.data.personagem?.player === player &&
          socket.data.personagem.nomePasta === nomePasta
        ) {
          delete socket.data.personagem;
          socket.emit("personagem_erro", {
            message: "Este personagem foi excluído.",
          });
          socket.disconnect(true);
        }
      }
      console.log(
        `[PERSONAGEM] ${player} | Excluído: ${nomePasta} | Pasta removida.`,
      );
      return res.json({ success: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return res
          .status(404)
          .json({ success: false, message: "Personagem não encontrado." });
      }
      console.error(`Erro ao excluir personagem de ${player}:`, error);
      return res
        .status(500)
        .json({ success: false, message: "Erro ao excluir personagem." });
    }
  });
});

//=============================== CATÁLOGO GLOBAL (Sprint 5) ==================================//
// Arquivos catalogo/magias.json e catalogo/habilidades.json: { schemaVersion, items: [{ id, nome, ... }] }.
// O catálogo é editado pelo mestre (Sprint 2) e vive no armazém (campanha.js). A ficha só enxerga as
// entradas PÚBLICAS; as privadas só chegam por entrega.
app.get("/api/catalogo/:tipo", (req, res) => {
  const player = obterPlayerAutenticado(req);
  if (!player) {
    return res
      .status(401)
      .json({ success: false, message: "Sessão inválida." });
  }

  const tipo = req.params.tipo;
  if (!TIPOS_CATALOGO.includes(tipo)) {
    return res
      .status(404)
      .json({ success: false, message: "Catálogo desconhecido." });
  }

  try {
    const items = campanha
      .ver(tipo)
      .filter((entrada) => entrada.publico)
      .map(entradaPublica);
    return res.json({ success: true, tipo, items });
  } catch (error) {
    console.error(`Erro ao ler o catálogo de ${tipo}:`, error);
    return res
      .status(500)
      .json({ success: false, message: "Erro ao ler o catálogo." });
  }
});

//================================== SERVIDOR ==================================//
function normalizarConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  return Object.fromEntries(
    Object.keys(DEFAULT_CONFIG).map((key) => [
      key,
      typeof source[key] === "boolean" ? source[key] : DEFAULT_CONFIG[key],
    ]),
  );
}

function carregarConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      return { ...DEFAULT_CONFIG };
    }

    return normalizarConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  } catch (error) {
    console.error(
      "Erro ao ler config.json; usando a configuração padrão.",
      error,
    );
    return { ...DEFAULT_CONFIG };
  }
}

function salvarConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Vitais para broadcast (sem schemaVersion): { hp, vigor, sanity } com { current, max }.
function normalizarVitais(vitais) {
  const status = NORMALIZADORES.status(vitais);
  if (!status) return null;
  const vitaisLimpos = { ...status };
  delete vitaisLimpos.schemaVersion;
  return vitaisLimpos;
}

function normalizarId(value, fallback) {
  return ehIdSeguro(value) ? value : fallback;
}

// A pasta do personagem é só um nome (sem caminho), para ninguém sair de players/<jogador>/.
function nomePastaValido(nomePasta) {
  return (
    typeof nomePasta === "string" &&
    nomePasta !== "" &&
    nomePasta !== "." &&
    nomePasta !== ".." &&
    path.basename(nomePasta) === nomePasta &&
    // eslint-disable-next-line no-control-regex -- NUL não pode aparecer em nome de arquivo
    !/[/\\\u0000]/.test(nomePasta)
  );
}

function normalizarTexto(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

let systemConfig = carregarConfig();
const server = http.createServer(app);
const io = new Server(server);
const playersState = {};
const jogadoresRecentes = new Map();
const TEMPO_JOGADOR_RECENTE_MS = 10 * 60 * 1000;
function limparJogadoresRecentes() {
  const agora = Date.now();
  for (const [id, registro] of jogadoresRecentes) if (registro.expiraEm <= agora) jogadoresRecentes.delete(id);
}

// Arquivos da ficha que o mestre pode ver (a biografia é privada do jogador).
const ARQUIVOS_DO_MESTRE = [
  "perfil",
  "atributos",
  "pericias",
  "inventario",
  "magias",
  "habilidades",
];
const SALA_MESTRES = "mestres";
const SALA_BAUS = "baus"; // jogadores com ficha pronta: recebem o estado dos baús liberados
// Dado do mestre só vai para a sala dos mestres, nunca por io.emit geral.
campanha.aoMudar = (tipo, dados) => {
  io.to(SALA_MESTRES).emit("campanha_atualizada", { tipo, dados });
  // Os jogadores com ficha aberta veem só os baús LIBERADOS, com nome e itens disponíveis.
  if (tipo === "baus")
    io.to(SALA_BAUS).emit("baus_estado", { baus: bausPublicos(dados) });
};
const rolagensVistas = new Set(); // ids das últimas rolagens (evita duplicar um reenvio)
// Arquivos cuja versão normalizada (a do servidor) volta no aviso de salvamento, para a ficha conferir.
const ARQUIVOS_CONFERIDOS = ["status", "inventario"];
const ESPERA_OUTRA_ABA_MS = 600; // folga para uma aba que está fechando/recarregando

// Estado enviado a todos os clientes: sem a identidade (player/pasta) do personagem no disco.
function estadoPublico(estado) {
  const publico = { ...estado }; // sem os dados internos (conta e pasta)
  delete publico.player;
  delete publico.nomePasta;
  return publico;
}

function todosEstadosPublicos() {
  return Object.fromEntries(
    Object.entries(playersState).map(([id, e]) => [id, estadoPublico(e)]),
  );
}

// O card do mestre mostra o que o SERVIDOR tem salvo: vida vem do status.json e o nome do perfil.json
// (nunca do que o cliente diz). Chamado depois de cada salvamento bem-sucedido.
function atualizarCardPeloSalvo(socket, arquivo, dados) {
  if (arquivo === "perfil") {
    socket.data.nomePersonagem = dados.nome;
    socket.data.avatarPersonagem = dados.avatar || "";
  }
  const charId = socket.data.charId;
  const card = charId && playersState[charId];
  if (!card || (arquivo !== "status" && arquivo !== "perfil")) return;

  if (arquivo === "status")
    card.vitals = normalizarVitais(dados) ?? card.vitals;
  else {
    card.name = dados.nome;
    card.avatar = socket.data.avatarPersonagem;
  }
  card.lastUpdate = new Date().toLocaleTimeString();
  io.emit("player_updated", estadoPublico(card));
}

function charIdDoSocket(socketId) {
  return Object.keys(playersState).find(
    (id) => playersState[id].socketId === socketId,
  );
}

// As páginas são servidas explicitamente para não expor server.js e config.json.
app.use("/JS", express.static(path.join(__dirname, "JS")));
app.use("/CSS", express.static(path.join(__dirname, "CSS")));

// Ficha e seleção só abrem com login: sem sessão válida, volta para /login.
function exigirLogin(req, res, next) {
  if (SESSIONS.has(lerCookie(req.headers.cookie, COOKIE_SESSAO))) {
    next();
    return;
  }
  res.redirect("/login");
}

app.get(["/", "/index.html"], exigirLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Rota -> arquivo. Atenção aos nomes: "login/entrar.html" é a tela de LOGIN e "login/login.html" é a de
// SELEÇÃO de personagem. Ao renomear os arquivos (ex.: login.html -> selecao.html), mude só aqui.
const PAGINAS = {
  "/login": {
    arquivo: path.join(__dirname, "login", "entrar.html"),
    protegida: false,
  },
  "/selecao": {
    arquivo: path.join(__dirname, "login", "login.html"),
    protegida: true,
  },
};
for (const [rota, { arquivo, protegida }] of Object.entries(PAGINAS)) {
  app.get(rota, ...(protegida ? [exigirLogin] : []), (req, res) =>
    res.sendFile(arquivo),
  );
}

// Painel do mestre: uma pasta (mestre/) com uma página por assunto. TUDO sob /mestre (páginas, scripts e
// estilos) usa as rotas explícitas abaixo. Rota -> arquivo; ao criar uma página nova, acrescente aqui e em
// PAGINAS_MESTRE no mestre/JS/comum.js (o menu).
const PAGINAS_MESTRE = {
  "/mestre": "index.html",
  "/mestre/rolagem": "rolagem.html",
  "/mestre/figurantes": "figurantes.html",
  "/mestre/inimigos": "figurantes.html",
  "/mestre/npc": "figurantes.html",
  "/mestre/loot": "loot.html",
  "/mestre/habilidades-magias": "habilidades-magias.html",
};
app.get(["/mestre/inimigos.html", "/mestre/npc.html"], (req, res) =>
  res.redirect(
    req.path.endsWith("/npc.html") ? "/mestre/npc" : "/mestre/figurantes",
  ),
);
for (const [rota, arquivo] of Object.entries(PAGINAS_MESTRE)) {
  app.get(rota, (req, res) =>
    res.sendFile(path.join(__dirname, "mestre", arquivo)),
  );
}
app.use(
  "/mestre",
  express.static(path.join(__dirname, "mestre"), {
    index: false,
    redirect: false,
  }),
);
// Endereço antigo do painel (quando era um arquivo só)
app.get("/mestre.html", (req, res) =>
  res.redirect("/mestre"),
);

/* ---------------- Entregas e baús (Sprints 2 e 3) ---------------- */
const RESERVA_EXPIRA_MS =
  Number(process.env.RESERVA_EXPIRA_MS) > 0
    ? Number(process.env.RESERVA_EXPIRA_MS)
    : 30_000;
const reservas = new Map(); // entregaId -> { player, nomePasta, nomePersonagem, bauId, linhaId, quantidade, itemNome, desde }

const enviarEntrega = (alvo, e) =>
  alvo.emit("entrega", {
    entregaId: e.entregaId,
    tipo: e.tipo,
    entrada: e.entrada,
  });
const abaDoPersonagem = (player, nomePasta) =>
  [...io.sockets.sockets.values()].find(
    (s) =>
      s.data.recebeEntregas &&
      s.data.personagem?.player === player &&
      s.data.personagem?.nomePasta === nomePasta,
  );

function nomeDoPersonagem(player, nomePasta) {
  try {
    return String(
      personagemModelo.lerJson(
        path.join(PLAYERS_PATH, player, nomePasta, "perfil.json"),
      )?.nome || "",
    ).slice(0, 80);
  } catch {
    return "";
  }
}

// O servidor só acredita no arquivo do personagem: a entrega vale se o recibo/entrada está lá.
function entregaEstaNoArquivo(player, nomePasta, e) {
  try {
    const dir = path.join(PLAYERS_PATH, player, nomePasta);
    if (e.tipo === "itens") {
      const inv = personagemModelo.lerJson(path.join(dir, "inventario.json"));
      return (
        Array.isArray(inv?.recebidas) && inv.recebidas.includes(e.entregaId)
      );
    }
    const arquivo = personagemModelo.lerJson(path.join(dir, `${e.tipo}.json`));
    return (
      Array.isArray(arquivo?.items) &&
      arquivo.items.some((i) => i?.catalogId === e.entrada.catalogId)
    );
  } catch {
    return false;
  }
}

// Fecha uma reserva de baú (uma vez só): "pegou" registra no histórico; qualquer outro resultado cancela
// a entrega e DEVOLVE o item ao baú.
async function finalizarReserva(entregaId, resultado) {
  const r = reservas.get(entregaId);
  if (!r) return;
  reservas.delete(entregaId);
  const registro = {
    jogador: r.nomePersonagem,
    item: r.itemNome,
    quantidade: r.quantidade,
    resultado,
  };
  try {
    if (resultado === "pegou") {
      await campanha.registrarNoBau(r.bauId, registro);
      io.to(SALA_BAUS).to(SALA_MESTRES).emit("bau_item_retirado", registro);
    } else {
      await entregas.cancelar(r.player, r.nomePasta, entregaId, resultado);
      await campanha.devolverAoBau(r.bauId, r.linhaId, r.quantidade, registro);
    }
  } catch (erro) {
    console.error("[BAÚ] Falha ao fechar reserva:", erro.message);
  }
}

// Depois de um reinício: entregas de loot ainda pendentes voltam a ser reservas (o jogador tem o tempo de
// expiração para abrir a ficha; senão o item volta ao baú).
function reconstruirReservas() {
  for (const conta of fs.readdirSync(PLAYERS_PATH, { withFileTypes: true })) {
    if (!conta.isDirectory() || !nomePastaValido(conta.name)) continue;
    for (const pasta of fs.readdirSync(path.join(PLAYERS_PATH, conta.name), {
      withFileTypes: true,
    })) {
      if (!pasta.isDirectory() || !nomePastaValido(pasta.name)) continue;
      for (const e of entregas.pendentes(conta.name, pasta.name)) {
        if (!e.origem) continue;
        reservas.set(e.entregaId, {
          player: conta.name,
          nomePasta: pasta.name,
          nomePersonagem: nomeDoPersonagem(conta.name, pasta.name),
          ...e.origem,
          itemNome: String(e.entrada.name || "").slice(0, 80),
          desde: Date.now(),
        });
      }
    }
  }
}
reconstruirReservas();

// Reserva que passou do prazo com o jogador FORA (desconectou no meio): confere o arquivo; se o item já
// entrou, conta como pego; senão volta ao baú. Jogador online nunca expira (a ficha responde logo).
let verificandoReservas = false;
setInterval(
  async () => {
    if (verificandoReservas) return;
    verificandoReservas = true;
    try {
      for (const [id, r] of [...reservas]) {
        if (
          Date.now() - r.desde < RESERVA_EXPIRA_MS ||
          abaDoPersonagem(r.player, r.nomePasta)
        )
          continue;
        try {
          const pendente = (await entregas.pendentesAsync(r.player, r.nomePasta))
            .find((e) => e.entregaId === id);
          if (pendente && entregaEstaNoArquivo(r.player, r.nomePasta, pendente)) {
            await entregas.marcarEntregue(r.player, r.nomePasta, id);
            await finalizarReserva(id, "pegou");
          } else {
            await finalizarReserva(id, "expirou");
          }
        } catch (erro) {
          console.error("[BAÚ] Falha ao conferir reserva; será tentada novamente:", erro.message);
        }
      }
    } finally { verificandoReservas = false; }
  },
  Math.max(50, Math.min(5000, Math.floor(RESERVA_EXPIRA_MS / 3))),
).unref();

/* ---------------- Ajuste de vida do jogador pelo mestre (usado pelo painel e pelo dano) ---------------- */
// O servidor é a fonte da verdade: grava no status.json mesmo com a aba do jogador em segundo plano e envia o
// delta para a ficha somar ao valor DELA (uma edição simultânea do jogador não se perde).
async function ajustarVitalDoJogador(charId, type, deltaBruto, esperado = null) {
  const identidade = playersState[charId];
  if (!identidade?.vitals) return { ok: false, message: "Personagem ainda não registrado no servidor!" };
  return naFilaPersonagem(identidade.player || charId, identidade.nomePasta || "", async () => {
    const delta = Number(deltaBruto);
    const player = playersState[charId];
    if (
      !VITAL_TYPES.includes(type) ||
      !Number.isFinite(delta) ||
      Math.abs(delta) > MAX_VITAL
    ) {
      return { ok: false, message: "Ajuste de atributo inválido." };
    }
    // Enquanto o recurso "Vigor" for controlado por AtivarMana (regra atual da mesa).
    if (type === "vigor" && !systemConfig.AtivarMana)
      return { ok: false, message: "Vigor está desativado nas regras da mesa." };
    if (!player?.vitals)
      return {
        ok: false,
        message: "Personagem ainda não registrado no servidor!",
      };
    const vital = player.vitals[type];
    if (!vital) return { ok: false, message: "Atributo vital inválido." };
    if (esperado !== null && vital.current !== esperado) return { ok: false, codigo: "hp_mudou", atual: vital.current, message: "A vida já mudou." };

    const antes = vital.current;
    const depois = Math.max(
      0,
      Math.min(vital.current + Math.round(delta), vital.max),
    );
    const novosVitais = { ...player.vitals, [type]: { ...vital, current: depois } };

    if (player.player && player.nomePasta) {
      try {
        const salvo = await salvarArquivoPersonagem(
          player.player,
          player.nomePasta,
          "status",
          novosVitais,
        );
        if (!salvo.ok) return salvo;
      } catch (error) {
        console.error("[MESTRE] Falha ao gravar status.json:", error);
        return { ok: false, message: "Não foi possível salvar o ajuste vital." };
      }
    }
    player.vitals = novosVitais;
    console.log(`[MESTRE] ${player.name}: ${type.toUpperCase()} ${delta > 0 ? "+" : ""}${Math.round(delta)} => ${depois}/${vital.max}`);
    io.emit("vital_adjusted", {
      charId,
      vitals: player.vitals,
      type,
      delta: Math.round(delta),
      variacao: depois - antes,
    });
    return { ok: true, antes, depois, delta: Math.round(delta) };
  });
}

const idDoJogador = (player, nomePasta) =>
  `jog_${crypto.createHash("sha1").update(`${player}/${nomePasta}`).digest("hex").slice(0, 16)}`;

// Rolagens do mestre (no servidor) e aplicação de dano nos alvos (jogadores, NPCs e inimigos em batalha).
const historicoDeRolagens = rolagemDoMestre.criarHistoricoDeRolagens();
const danoDoMestre = criarDano({
  campanha,
  jogadores: {
    resolver(alvoId) {
      for (const [charId, p] of Object.entries(playersState)) {
        if (
          p.player &&
          p.nomePasta &&
          p.vitals?.hp &&
          idDoJogador(p.player, p.nomePasta) === alvoId
        ) {
          return {
            charId,
            nome: p.name,
            hp: { atual: p.vitals.hp.current, max: p.vitals.hp.max },
          };
        }
      }
      return null;
    },
    async ajustar(charId, delta, esperado = null) {
      const r = await ajustarVitalDoJogador(charId, "hp", delta, esperado);
      if (!r.ok) throw Object.assign(new ErroCampanha(r.codigo || "erro", r.message), { atual: r.atual });
      return { antes: r.antes, depois: r.depois };
    },
  },
});

io.on("connection", (socket) => {
  const peer = socket.handshake.address || "IP desconhecido";
  console.log(`[CONEXÃO] Cliente conectado: ${socket.id} (${peer})`);
  socket.emit("sync_all_players", todosEstadosPublicos());
  limparJogadoresRecentes();
  socket.emit("sync_recent_players", [...jogadoresRecentes.values()]);
  socket.emit("sync_config", systemConfig);

  // Todo evento do cliente passa por aqui: um erro inesperado num tratador (entrada estranha, bug) é registrado e
  // NUNCA derruba o servidor. Os tratadores continuam validando a entrada; isto é a segunda camada.
  const ouvir = (evento, tratar) =>
    socket.on(evento, (...args) => {
      const registrar = (erro) =>
        console.error(`[FALHA EM EVENTO] ${evento}:`, erro);
      try {
        const retorno = tratar(...args);
        if (retorno && typeof retorno.catch === "function")
          retorno.catch(registrar);
      } catch (erro) {
        registrar(erro);
      }
    });

  ouvir("carregar_personagem", (identidade) => {
    if (!personagemModelo.ehObjeto(identidade)) {
      socket.emit("personagem_erro", {
        message: "Pedido inválido para carregar o personagem.",
      });
      return;
    }
    const { player, nomePasta, reconexao } = identidade;
    const playerAutenticado = SESSIONS.get(socket.handshake.auth?.token);
    if (!playerAutenticado) {
      // As sessões ficam só na memória: reiniciar o servidor expira todas.
      socket.emit("personagem_erro", {
        code: "sessao_invalida",
        message: "Sessão expirada. Entre novamente.",
      });
      return;
    }
    if (playerAutenticado !== player || !nomePastaValido(nomePasta)) {
      socket.emit("personagem_erro", {
        message: "Sessão inválida para carregar este personagem.",
      });
      return;
    }

    console.log("Solicitação para carregar:", player, nomePasta);

    const entregar = () => naFilaPersonagem(player, nomePasta, async () => {
      if (!socket.connected) return;
      if (!reconexao && outraAba()) {
        socket.emit("personagem_erro", { code: "ja_carregado", message: "Personagem já carregado em outra aba." });
        return;
      }
      const { personagem, motivo } = await carregarPersonagem(player, nomePasta);
      if (!socket.connected) return;

      if (!personagem) {
        socket.emit("personagem_erro", {
          message:
            motivo === "invalido"
              ? "Os arquivos deste personagem estão inválidos. Veja o log do servidor."
              : "Personagem não encontrado.",
        });
        return;
      }

      console.log("Personagem carregado:", nomePasta);

      socket.data.personagem = { player, nomePasta }; // identidade confiável (vem da sessão)
      socket.data.nomePersonagem =
        personagem.perfil?.nome || extrairNomeEId(nomePasta).nome;
      socket.data.avatarPersonagem = personagem.perfil?.avatar || "";
      socket.emit("personagem_carregado", { ...personagem, player, nomePasta });
    });

    // Cada personagem fica aberto em UMA aba só (duas abas se sobrescreveriam). A nova aba é
    // recusada e a ficha volta para a seleção. Exceções: reconexão da própria aba (o socket antigo
    // pode demorar a sumir) e aba que está fechando/recarregando (por isso a pequena espera).
    const outraAba = () =>
      [...io.sockets.sockets.values()].find(
        (s) =>
          s.id !== socket.id &&
          s.data.personagem?.player === player &&
          s.data.personagem?.nomePasta === nomePasta,
      );

    if (!reconexao && outraAba()) {
      setTimeout(() => {
        if (!socket.connected) return;
        if (outraAba()) {
          socket.emit("personagem_erro", {
            code: "ja_carregado",
            message: "Personagem já carregado em outra aba.",
          });
          return;
        }
        entregar().catch(erro => console.error("[FALHA EM EVENTO] carregar_personagem:", erro));
      }, ESPERA_OUTRA_ABA_MS);
      return;
    }
    return entregar();
  });

  // Só grava no personagem que ESTA aba abriu (carregar_personagem): nada de escrever em outro
  // personagem da conta, nem numa aba que foi recusada por "já carregado".
  function identidadeValidaParaSalvar(data) {
    const playerAutenticado = SESSIONS.get(socket.handshake.auth?.token);
    const aberto = socket.data.personagem;
    return Boolean(
      playerAutenticado &&
      data?.player === playerAutenticado &&
      nomePastaValido(data.nomePasta) &&
      aberto?.player === data.player &&
      aberto?.nomePasta === data.nomePasta,
    );
  }

  ouvir("salvar_personagem", (bruto) => {
    const data = personagemModelo.ehObjeto(bruto) ? bruto : {}; // null, texto ou lista não derrubam nem passam
    const arquivo = typeof data.arquivo === "string" ? data.arquivo : "";

    if (!identidadeValidaParaSalvar(data)) {
      socket.emit("salvamento_personagem_erro", {
        arquivo,
        message:
          "Este personagem não está aberto nesta aba (ou a sessão é inválida).",
      });
      return;
    }

    return naFilaPersonagem(data.player, data.nomePasta, async () => {
      // A aba pode ter sido encerrada/excluída enquanto aguardava uma gravação anterior.
      if (!identidadeValidaParaSalvar(data)) {
        socket.emit("salvamento_personagem_erro", { arquivo, message: "Este personagem não está mais aberto nesta aba." });
        return;
      }
      try {
        const resultado = await salvarArquivoPersonagem(
          data.player,
          data.nomePasta,
          arquivo,
          data.dados,
        );
        if (!resultado.ok) {
          socket.emit("salvamento_personagem_erro", {
            arquivo,
            message: resultado.message,
          });
          return;
        }
        // Os arquivos que o jogador precisa ver iguais ao servidor voltam já corrigidos (status e inventário).
        socket.emit("personagem_salvo", {
          arquivo,
          ...(ARQUIVOS_CONFERIDOS.includes(arquivo)
            ? { dados: resultado.dados }
            : {}),
        });
        atualizarCardPeloSalvo(socket, arquivo, resultado.dados);

        if (ARQUIVOS_DO_MESTRE.includes(arquivo)) {
          const charId = charIdDoSocket(socket.id);
          if (charId) {
            io.to(SALA_MESTRES).emit("ficha_arquivo", {
              charId,
              arquivo,
              dados: resultado.dados,
            });
          }
        }
      } catch (error) {
        console.error(`Falha ao salvar ${arquivo}.json:`, error);
        socket.emit("salvamento_personagem_erro", {
          arquivo,
          message: "Não foi possível salvar o arquivo do personagem.",
        });
      }
    });
  });

  ouvir("player_update", (data) => {
    const charId = normalizarId(data?.id, socket.id);
    const identidade = socket.data.personagem ?? null;
    const publicar = () => {
      if (!socket.connected || (identidade && socket.data.personagem !== identidade)) return;

      // Um socket representa um único personagem e não pode publicar (nem sobrescrever) o card de outro.
      // A mesma ficha aberta em duas abas é permitida (mesma identidade).
      if (socket.data.charId && socket.data.charId !== charId) {
        console.warn(
          `[SEGURANÇA] player_update recusado: ${socket.id} já representa outro personagem.`,
        );
        return;
      }
      const atual = playersState[charId];
      if (
        atual &&
        atual.socketId !== socket.id &&
        io.sockets.sockets.has(atual.socketId)
      ) {
        const mesmaFicha =
          identidade &&
          atual.player === identidade.player &&
          atual.nomePasta === identidade.nomePasta;
        if (!mesmaFicha) {
          console.warn(
            `[SEGURANÇA] player_update recusado: ${socket.id} tentou usar o card ${charId}.`,
          );
          return;
        }
      }
      socket.data.charId = charId;

      // Com personagem aberto, a vida vem do que o servidor tem (card atual ou status.json) e o nome do
      // perfil salvo: o que o cliente manda aqui é ignorado. Sem personagem aberto, vale o enviado.
      const vitals = identidade
        ? (atual?.vitals ??
          normalizarVitais(
            lerArquivosNormalizados(
              path.join(PLAYERS_PATH, identidade.player, identidade.nomePasta),
              ["status"],
            ).status,
          ))
        : normalizarVitais(data?.vitals);
      if (!vitals) return;

      jogadoresRecentes.delete(charId);
      playersState[charId] = {
        id: charId,
        socketId: socket.id,
        name:
          socket.data.nomePersonagem ||
          normalizarTexto(data?.name, "Herói Sem Nome", 80),
        vitals,
        avatar: identidade ? socket.data.avatarPersonagem || "" : "",
        lastUpdate: new Date().toLocaleTimeString(),
        ...(socket.data.personagem ?? {}), // player + nomePasta, para o mestre ler a ficha
      };
      console.log(
        `[FICHA] ${playersState[charId].name} | Update: / HP ${vitals.hp.current}/${vitals.hp.max} / Vigor ${vitals.vigor.current}/${vitals.vigor.max} / Sanidade ${vitals.sanity.current}/${vitals.sanity.max} |`,
      );
      io.emit("player_updated", estadoPublico(playersState[charId]));
    };
    return identidade ? naFilaPersonagem(identidade.player, identidade.nomePasta, publicar) : publicar();
  });

  ouvir("client_log", (data) => {
    const action = normalizarTexto(data?.action, "Ação do cliente", 100);
    const context =
      data?.context && typeof data.context === "object" ? data.context : {};
    const character = normalizarTexto(
      context.personagem,
      "Personagem desconhecido",
      80,
    );
    const details = Object.entries(context)
      .filter(([key]) => !["personagem", "personagemId", "url"].includes(key))
      .map(
        ([key, value]) => `${key}=${normalizarTexto(String(value), "", 160)}`,
      )
      .filter(Boolean)
      .join(", ");

    console.log(
      `\n[ALTERAÇÃO] ${character}: ${action}${details ? ` | ${details}` : ""}`,
    );
  });

  ouvir("dice_roll", (data, confirmar) => {
    const responder = (ok) => typeof confirmar === "function" && confirmar(ok);
    const nome = socket.data.nomePersonagem; // quem rola é o personagem aberto nesta aba
    const total = Number(data?.total);
    if (!nome || !Number.isFinite(total) || Math.abs(total) > MAX_VITAL) {
      responder(false);
      return;
    }

    // `rid` identifica a rolagem: se a ficha reenviar (ex.: o aviso de recebimento se perdeu), não duplica.
    const rid = ehIdSeguro(data.rid) ? data.rid : "";
    if (rid && rolagensVistas.has(rid)) {
      responder(true);
      return;
    }
    if (rid) {
      rolagensVistas.add(rid);
      if (rolagensVistas.size > 500)
        rolagensVistas.delete(rolagensVistas.values().next().value);
    }

    const quando = Number(data.quando);
    const agora = Date.now();
    const roll = {
      character: nome,
      total: Math.round(total),
      details: normalizarTexto(data.details, "Rolagem", 300),
      // hora em que foi rolada (uma rolagem feita sem conexão chega depois)
      quando:
        Number.isFinite(quando) &&
        quando <= agora + 60_000 &&
        quando >= agora - 86_400_000
          ? Math.round(quando)
          : agora,
    };
    console.log(`[DADOS] ${roll.character}: ${roll.details} = ${roll.total}`);
    io.emit("dice_rolled", roll);
    responder(true);
  });

  ouvir("master_adjust_vital", async (data) => {
    const charId = normalizarId(data.charId, "");
    const r = await ajustarVitalDoJogador(charId, data.type, data.delta);
    socket.emit("master_feedback", {
      success: r.ok,
      message: r.ok
        ? `${data.type.toUpperCase()} ajustado (${r.delta > 0 ? "+" : ""}${r.delta})!`
        : r.message,
    });
  });

  ouvir("master_get_personagem", (data) => {
    const charId = normalizarId(data?.charId, "");
    // O charId vai junto nas falhas para o painel fechar o card que ficaria "carregando" para sempre.
    const falhar = (message) =>
      socket.emit("master_feedback", { success: false, message, charId });


    const entrada = playersState[charId];
    if (!entrada?.player || !entrada?.nomePasta) {
      falhar(
        "Ficha indisponível: o jogador precisa estar com o personagem aberto.",
      );
      return;
    }

    const pasta = path.join(PLAYERS_PATH, entrada.player, entrada.nomePasta);
    if (!fs.existsSync(pasta)) {
      falhar("Não foi possível ler a ficha deste personagem.");
      return;
    }

    socket.join(SALA_MESTRES); // passa a receber ficha_arquivo em tempo real
    socket.emit("master_personagem", {
      charId,
      // Leitura pura: não migra nem grava nada (quem migra é a carga feita pelo próprio jogador).
      personagem: lerArquivosNormalizados(pasta, ARQUIVOS_DO_MESTRE),
    });
  });

  ouvir("master_update_config", (data) => {

    systemConfig = normalizarConfig({ ...systemConfig, ...data.config });
    try {
      salvarConfig(systemConfig);
      console.log("[CONFIG] Regras da mesa salvas:", systemConfig);
      io.emit("sync_config", systemConfig);
      socket.emit("master_feedback", {
        success: true,
        message: "Regras da mesa atualizadas!",
      });
    } catch (error) {
      console.error("Erro ao gravar config.json:", error);
      socket.emit("master_feedback", {
        success: false,
        message: "Erro ao gravar no config.json.",
      });
    }
  });

  // ---- Painel do mestre: fundação (Sprint 1 da Fase 2) ----
  // Entra na sala que recebe os dados da campanha em tempo real.
  comandos.registrar(socket, "master_entrar", () => {
    socket.join(SALA_MESTRES);
    return {
      sala: SALA_MESTRES,
      avisos: campanha.avisos,
      recursos: { armaFigurante: true },
    };
  });

  // Sem `tipo`: devolve tudo (inimigos, npcs, baus, batalha).
  comandos.registrar(socket, "master_campanha_ler", ({ tipo }) =>
    tipo === undefined ? campanha.lerTudo() : campanha.ler(tipo),
  );

  // Baú: o editor nunca define `liberado` nem `historico` (são do servidor), e baú liberado não se edita
  // (recolha primeiro): senão a edição desfaria reservas em andamento.
  const prepararBau = (item) => {
    if (!personagemModelo.ehObjeto(item)) return item;
    const atual = personagemModelo.ehIdSeguro(item.id)
      ? campanha.ver("baus").find((b) => b.id === item.id)
      : null;
    if (atual?.liberado)
      throw new ErroCampanha("bau_liberado", "Recolha o baú antes de editar.");
    return { ...item, liberado: false, historico: atual?.historico || [] };
  };
  // NPC: campos que o editor não enviou continuam como estão no servidor (uma aba com cópia velha não desfaz
  // o HP ajustado em outra aba).
  const prepararFigurante = (tipo, item) => {
    if (
      !personagemModelo.ehObjeto(item) ||
      !personagemModelo.ehIdSeguro(item.id)
    )
      return item;
    const atual = campanha.ver(tipo).find((n) => n.id === item.id);
    return atual ? { ...atual, ...item } : item;
  };
  comandos.registrar(
    socket,
    "master_campanha_salvar",
    ({ tipo, item }) =>
      campanha.salvarItem(
        tipo,
        tipo === "baus"
          ? prepararBau(item)
          : ["npcs", "inimigos"].includes(tipo)
            ? prepararFigurante(tipo, item)
            : item,
      ),
    { mudaEstado: true },
  );

  // HP do NPC por delta atômico (cliques rápidos e duas abas do mestre somam, nunca se sobrescrevem).
  comandos.registrar(
    socket,
    "master_npc_hp",
    async ({ id, delta, atual }) => {
      if (!personagemModelo.ehIdSeguro(id))
        throw new ErroCampanha("id_invalido", "Id inválido.");
      const valor = delta === undefined ? atual : delta;
      if (
        (delta !== undefined) === (atual !== undefined) ||
        !Number.isInteger(valor) ||
        Math.abs(valor) > MAX_VITAL
      )
        throw new ErroCampanha(
          "formato_invalido",
          "Informe delta ou atual, com um valor inteiro de HP válido.",
        );
      let hp;
      await campanha.atualizar("npcs", (lista) => {
        const n = lista.find((x) => x.id === id);
        if (!n)
          throw new ErroCampanha(
            "npc_inexistente",
            "Esse NPC não existe mais.",
          );
        n.hp.atual = Math.max(
          0,
          Math.min(n.hp.max, delta === undefined ? atual : n.hp.atual + delta),
        );
        hp = { ...n.hp };
        return lista;
      });
      return { hp };
    },
    { mudaEstado: true },
  );

  // A biblioteca de inimigos controla o HP máximo do modelo, não a vida das cópias em combate.
  comandos.registrar(
    socket,
    "master_inimigo_hp",
    async ({ id, delta, atual }) => {
      if (!personagemModelo.ehIdSeguro(id))
        throw new ErroCampanha("id_invalido", "Id inválido.");
      const valor = delta === undefined ? atual : delta;
      if (
        (delta !== undefined) === (atual !== undefined) ||
        !Number.isInteger(valor) ||
        Math.abs(valor) > MAX_VITAL
      )
        throw new ErroCampanha(
          "formato_invalido",
          "Informe delta ou atual, com um valor inteiro de HP válido.",
        );
      let hpMax;
      await campanha.atualizar("inimigos", (lista) => {
        const alvo = lista.find((x) => x.id === id);
        if (!alvo)
          throw new ErroCampanha(
            "modelo_inexistente",
            "Esse inimigo não existe mais na biblioteca.",
          );
        alvo.hpMax = Math.max(
          1,
          Math.min(MAX_VITAL, delta === undefined ? atual : alvo.hpMax + delta),
        );
        hpMax = alvo.hpMax;
        return lista;
      });
      return { hpMax };
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_campanha_remover",
    async ({ tipo, id }) => ({
      removido: await campanha.removerItem(tipo, id),
    }),
    { mudaEstado: true },
  );

  // Energia é controlada por delta na mesma fila do HP. Usar um poder cobra o custo que está no
  // servidor, nunca o valor enviado pelo navegador; uma reserva insuficiente não é consumida.
  const alterarEnergiaFigurante = async (
    { tipo, id, delta, atual, lista, indice, nome },
    usarPoder = false,
  ) => {
    if (
      !["npcs", "inimigos", "batalha"].includes(tipo) ||
      !personagemModelo.ehIdSeguro(id)
    ) {
      throw new ErroCampanha("alvo_invalido", "Figurante inválido.");
    }
    let energia;
    await campanha.atualizar(tipo, (dados) => {
      const alvo = (tipo === "batalha" ? dados.combatentes : dados).find(
        (x) => (tipo === "batalha" ? x.alvoId : x.id) === id,
      );
      if (!alvo)
        throw new ErroCampanha(
          "alvo_inexistente",
          "Esse figurante não existe mais.",
        );
      if (usarPoder) {
        if (
          !["habilidades", "magias"].includes(lista) ||
          !Number.isInteger(indice)
        )
          throw new ErroCampanha("poder_invalido", "Poder inválido.");
        const poder = alvo[lista]?.[indice];
        if (!poder || poder.nome !== nome || poder.cost?.vital !== "vigor")
          throw new ErroCampanha(
            "poder_invalido",
            "O poder mudou. Atualize a página.",
          );
        delta = -poder.cost.amount;
        atual = undefined;
      }
      const valor = delta === undefined ? atual : delta;
      if (
        (delta !== undefined) === (atual !== undefined) ||
        !Number.isInteger(valor) ||
        Math.abs(valor) > MAX_VITAL
      )
        throw new ErroCampanha(
          "valor_invalido",
          "Informe delta ou atual, com um valor inteiro de energia válido.",
        );
      if (usarPoder && alvo.energia.atual + delta < 0)
        throw new ErroCampanha(
          "energia_insuficiente",
          "Energia insuficiente para usar esse poder.",
        );
      alvo.energia.atual = Math.max(
        0,
        Math.min(
          alvo.energia.max,
          delta === undefined ? atual : alvo.energia.atual + delta,
        ),
      );
      energia = { ...alvo.energia };
    });
    console.log(
      `[FIGURANTE] ${tipo} | ${id} | Energia ${energia.atual}/${energia.max}${usarPoder ? ` | Usou: ${nome}` : ""}`,
    );
    return { energia };
  };
  comandos.registrar(
    socket,
    "master_figurante_energia",
    (dados) => alterarEnergiaFigurante(dados),
    { mudaEstado: true },
  );
  comandos.registrar(
    socket,
    "master_figurante_usar_poder",
    (dados) => alterarEnergiaFigurante(dados, true),
    { mudaEstado: true },
  );

  // ---- Entregas (Sprint 2): o mestre deixa na caixa do personagem; a própria ficha aplica ----
  // A ficha pede as entregas pendentes DEPOIS de montar a tela (a partir daí recebe as novas na hora).
  ouvir("entregas_pedir", async () => {
    const aberto = socket.data.personagem;
    if (!aberto) return;
    socket.data.recebeEntregas = true;
    socket.join(SALA_BAUS);
    socket.emit("baus_estado", { baus: bausPublicos(campanha.ver("baus")) });
    for (const e of await entregas.pendentesAsync(aberto.player, aberto.nomePasta))
      enviarEntrega(socket, e);
  });

  // A ficha confirma DEPOIS de salvar. O servidor confere no arquivo do personagem antes de marcar
  // como entregue (a confirmação sozinha não basta) e só vale para a ficha que esta aba abriu.
  ouvir("entrega_aplicada", async (dados) => {
    try {
      const aberto = socket.data.personagem;
      if (
        !aberto ||
        !personagemModelo.ehObjeto(dados) ||
        !personagemModelo.ehIdSeguro(dados.entregaId)
      )
        return;
      const e = (await entregas.pendentesAsync(aberto.player, aberto.nomePasta))
        .find((i) => i.entregaId === dados.entregaId);
      if (!e) return;
      if (!entregaEstaNoArquivo(aberto.player, aberto.nomePasta, e)) return;
      await entregas.marcarEntregue(
        aberto.player,
        aberto.nomePasta,
        e.entregaId,
      );
      if (e.origem) await finalizarReserva(e.entregaId, "pegou");
    } catch (erro) {
      console.error("[ENTREGAS] Falha ao confirmar entrega:", erro.message);
    }
  });

  // A ficha não conseguiu aplicar o item (sem espaço na mochila): o item volta ao baú. Só vale se o item
  // realmente NÃO está no arquivo do personagem.
  ouvir("entrega_recusada", async (dados) => {
    try {
      const aberto = socket.data.personagem;
      if (
        !aberto ||
        !personagemModelo.ehObjeto(dados) ||
        !personagemModelo.ehIdSeguro(dados.entregaId)
      )
        return;
      const e = (await entregas.pendentesAsync(aberto.player, aberto.nomePasta))
        .find((i) => i.entregaId === dados.entregaId);
      if (
        !e?.origem ||
        entregaEstaNoArquivo(aberto.player, aberto.nomePasta, e)
      )
        return;
      await finalizarReserva(e.entregaId, "sem_espaco");
    } catch (erro) {
      console.error("[BAÚ] Falha ao recusar entrega:", erro.message);
    }
  });

  // Jogador pega item de um baú liberado. Fase 1: reserva (sai da disponibilidade, ninguém mais leva).
  // Fase 2: entrega à ficha dele, que aplica e confirma (ou recusa por falta de espaço).
  const falhaPegar = (erro, mensagem) => ({ ok: false, erro, mensagem });
  ouvir("jogador_pegar_item", async (dados, confirmar) => {
    const responder = (r) => {
      if (typeof confirmar === "function") confirmar(r);
    };
    const { ehObjeto } = personagemModelo;
    const aberto = socket.data.personagem;
    if (!aberto || !socket.data.recebeEntregas)
      return responder(
        falhaPegar("sem_personagem", "Abra um personagem primeiro."),
      );
    if (
      !ehObjeto(dados) ||
      !ehIdSeguro(dados.bauId) ||
      !ehIdSeguro(dados.linhaId) ||
      !Number.isInteger(dados.quantidade) ||
      dados.quantidade < 1 ||
      dados.quantidade > 999
    ) {
      return responder(falhaPegar("formato_invalido", "Pedido inválido."));
    }
    if (dados.pedidoId !== undefined && !ehIdSeguro(dados.pedidoId))
      return responder(falhaPegar("formato_invalido", "Pedido inválido."));

    const executar = async () => {
      try {
        const { bauId, linhaId, quantidade } = dados;
        const item = await campanha.reservarDoBau(bauId, linhaId, quantidade);
        let entrega;
        try {
          // o jogador não define nenhum campo: o item é a cópia do que o mestre colocou no baú
          entrega = await entregas.adicionar(aberto.player, aberto.nomePasta, {
            tipo: "itens",
            entrada: {
              ...itemParaInventario(item),
              quantity: quantidade,
              catalogId: item.id,
            },
            origem: { bauId, linhaId, quantidade },
          });
        } catch (erro) {
          await campanha.devolverAoBau(bauId, linhaId, quantidade);
          throw erro;
        }
        reservas.set(entrega.entregaId, {
          player: aberto.player,
          nomePasta: aberto.nomePasta,
          nomePersonagem: nomeDoPersonagem(aberto.player, aberto.nomePasta),
          bauId,
          linhaId,
          quantidade,
          itemNome: item.name,
          desde: Date.now(),
        });
        enviarEntrega(socket, entrega);
        return { ok: true, dados: { entregaId: entrega.entregaId } };
      } catch (erro) {
        if (erro?.negocio === true)
          return falhaPegar(erro.codigo, erro.message);
        console.error("[BAÚ] jogador_pegar_item falhou:", erro);
        return falhaPegar("erro_interno", "Erro interno do servidor.");
      }
    };

    if (dados.pedidoId === undefined) return responder(await executar());
    // mesmo pedidoId (duplo clique, reenvio): executa uma vez só, mesmo chegando ao mesmo tempo
    socket.data.pedidosVistos ??= new Map();
    let execucao = socket.data.pedidosVistos.get(dados.pedidoId);
    if (!execucao) {
      execucao = executar();
      socket.data.pedidosVistos.set(dados.pedidoId, execucao);
      execucao.then((r) => {
        if (!r.ok) socket.data.pedidosVistos.delete(dados.pedidoId); // falha pode ser tentada de novo
      });
      if (socket.data.pedidosVistos.size > 50)
        socket.data.pedidosVistos.delete(
          socket.data.pedidosVistos.keys().next().value,
        );
    }
    return responder(await execucao);
  });

  // Mestre: liberar ou recolher um baú (1 clique). Só o mestre muda isso; o editor nunca mexe em `liberado`.
  comandos.registrar(
    socket,
    "master_bau_liberar",
    async ({ id, liberado }) => {
      if (!personagemModelo.ehIdSeguro(id) || typeof liberado !== "boolean")
        throw new ErroCampanha("formato_invalido", "Pedido inválido.");
      if (!campanha.ver("baus").some((b) => b.id === id))
        throw new ErroCampanha("bau_inexistente", "Esse baú não existe.");
      await campanha.atualizar("baus", (baus) => {
        baus.find((b) => b.id === id).liberado = liberado;
        return baus;
      });
      return { liberado };
    },
    { mudaEstado: true },
  );

  // ---- Batalha (Sprint 5): o servidor é a fonte da verdade; cada ação é atômica e idempotente (acaoId) ----
  const exigirIdDeAlvo = (id) => {
    if (!personagemModelo.ehIdSeguro(id))
      throw new ErroCampanha("id_invalido", "Id inválido.");
  };
  const hpDoCombatente = (dados, alvoId) =>
    dados.combatentes.find((c) => c.alvoId === alvoId);

  comandos.registrar(
    socket,
    "master_batalha_adicionar",
    async ({ modeloId, quantidade, tipo = "inimigos" }) => {
      exigirIdDeAlvo(modeloId);
      if (!["inimigos", "npcs"].includes(tipo))
        throw new ErroCampanha("tipo_invalido", "Tipo de figurante inválido.");
      const modelo = campanha.ver(tipo).find((i) => i.id === modeloId);
      if (!modelo)
        throw new ErroCampanha(
          "modelo_inexistente",
          "Esse figurante não existe mais na biblioteca.",
        );
      const dados = await campanha.atualizar("batalha", (b) =>
        regrasDaBatalha.adicionar(
          b,
          { ...modelo, tipo: tipo === "npcs" ? "npc" : "inimigo" },
          quantidade,
        ),
      );
      return {
        adicionados: dados.combatentes
          .slice(-quantidade)
          .map((c) => ({ alvoId: c.alvoId, nome: c.nome })),
      };
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_batalha_hp",
    async ({ alvoId, delta, atual }) => {
      exigirIdDeAlvo(alvoId);
      const dados = await campanha.atualizar("batalha", (b) =>
        regrasDaBatalha.ajustarHp(b, alvoId, { delta, atual }),
      );
      const c = hpDoCombatente(dados, alvoId);
      return { hp: c.hp, derrotado: c.derrotado };
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_batalha_notas",
    async ({ alvoId, notas }) => {
      exigirIdDeAlvo(alvoId);
      if (typeof notas !== "string" || notas.length > 2000)
        throw new ErroCampanha(
          "formato_invalido",
          "As notas devem ter até 2000 caracteres.",
        );
      await campanha.atualizar("batalha", (b) => {
        const alvo = hpDoCombatente(b, alvoId);
        if (!alvo)
          throw new ErroCampanha(
            "alvo_inexistente",
            "Esse combatente não está na batalha.",
          );
        alvo.notasCombate = notas;
        return b;
      });
      return { notas };
    },
    { mudaEstado: true },
  );

  // Atualização explícita: não recria a cópia nem sobrescreve os recursos/notas do combate.
  comandos.registrar(
    socket,
    "master_batalha_arma_modelo",
    async ({ alvoId }) => {
      exigirIdDeAlvo(alvoId);
      const dados = await campanha.atualizar("batalha", (b) => {
        const alvo = hpDoCombatente(b, alvoId);
        if (!alvo)
          throw new ErroCampanha(
            "alvo_inexistente",
            "Esse combatente não está na batalha.",
          );
        const modelo = campanha
          .ver(alvo.tipo === "npc" ? "npcs" : "inimigos")
          .find((x) => x.id === alvo.modeloId);
        if (!modelo)
          throw new ErroCampanha(
            "modelo_inexistente",
            "O modelo não existe mais na biblioteca.",
          );
        alvo.arma = modelo.arma
          ? JSON.parse(JSON.stringify(modelo.arma))
          : null;
        return b;
      });
      return { arma: hpDoCombatente(dados, alvoId).arma };
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_batalha_derrotado",
    async ({ alvoId, derrotado }) => {
      exigirIdDeAlvo(alvoId);
      await campanha.atualizar("batalha", (b) =>
        regrasDaBatalha.marcarDerrotado(b, alvoId, derrotado),
      );
      return { derrotado };
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_batalha_remover",
    async ({ alvoId }) => {
      exigirIdDeAlvo(alvoId);
      await campanha.atualizar("batalha", (b) =>
        regrasDaBatalha.remover(b, alvoId),
      );
      return { removido: true };
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_batalha_limpar",
    async () => {
      await campanha.atualizar("batalha", (b) => regrasDaBatalha.limpar(b));
      return { limpa: true };
    },
    { mudaEstado: true },
  );

  // ---- Rolagem e dano (Sprint 6) ----
  // Rolagem no servidor (aleatório do sistema); a resposta traz cada dado. O servidor guarda as últimas
  // para o ataque referenciar por id (o total vem do servidor).
  comandos.registrar(
    socket,
    "master_rolar",
    ({ componentes, expressao }) => {
      if (expressao !== undefined && componentes !== undefined)
        throw new ErroCampanha("formato_invalido", "Informe a expressão ou os componentes, não ambos.");
      if (expressao !== undefined && typeof expressao !== "string")
        throw new ErroCampanha("formula_invalida", "Informe uma expressão de dados válida.");
      return historicoDeRolagens.guardar(rolagemDoMestre.rolar(expressao !== undefined ? expressao : componentes));
    },
    {
      mudaEstado: true,
    },
  );

  // Aplica dano: o total vem de UMA rolagem do servidor (`rolagemId`) ou de um `valor` informado; cada alvo
  // tem multiplicador não negativo. Cada rolagem só pode causar dano uma vez, mesmo entre abas.
  comandos.registrar(
    socket,
    "master_aplicar_dano",
    ({ rolagemId, valor, alvos }) => {
      const temRolagem = rolagemId !== undefined;
      if (temRolagem === (valor !== undefined))
        throw new ErroCampanha(
          "formato_invalido",
          "Informe a rolagem ou o valor (um dos dois).",
        );
      if (temRolagem) {
        const rolagem = personagemModelo.ehIdSeguro(rolagemId)
          ? historicoDeRolagens.obter(rolagemId)
          : null;
        if (!rolagem)
          throw new ErroCampanha(
            "rolagem_inexistente",
            "Essa rolagem não existe mais. Role de novo.",
          );
        danoDoMestre.validarAlvos(alvos);
        const assinatura = JSON.stringify(alvos.map(({ alvoId, mult }) => ({ alvoId, mult }))
          .sort((a, b) => a.alvoId.localeCompare(b.alvoId)));
        return historicoDeRolagens.aplicarUmaVez(rolagemId, total => danoDoMestre.aplicar({ total, alvos }), assinatura);
      } else {
        if (!Number.isInteger(valor) || valor < 0 || valor > MAX_VITAL)
          throw new ErroCampanha("formato_invalido", "Valor de dano inválido.");
        return danoDoMestre.aplicar({ total: valor, alvos });
      }
    },
    { mudaEstado: true },
  );

  comandos.registrar(
    socket,
    "master_desfazer_dano",
    ({ aplicacaoId }) => {
      if (
        typeof aplicacaoId !== "string" ||
        !personagemModelo.ehIdSeguro(aplicacaoId)
      )
        throw new ErroCampanha("id_invalido", "Id inválido.");
      return danoDoMestre.desfazer(aplicacaoId);
    },
    { mudaEstado: true },
  );

  // Lista unificada de alvos (jogadores online + NPCs + inimigos em batalha) com ids estáveis: base do Sprint 6.
  comandos.registrar(socket, "master_listar_alvos", () => {
    const alvos = [];
    for (const p of Object.values(playersState)) {
      if (!p.player || !p.nomePasta) continue;
      const energia = p.vitals.vigor || p.vitals.mana;
      alvos.push({
        alvoId: idDoJogador(p.player, p.nomePasta),
        tipo: "jogador",
        nome: p.name,
        player: p.player,
        nomePasta: p.nomePasta,
        imagem: p.avatar || "",
        hp: { atual: p.vitals.hp.current, max: p.vitals.hp.max },
        energia: { atual: energia?.current ?? energia?.atual ?? 0, max: energia?.max ?? 0 },
      });
    }
    for (const n of campanha.ver("npcs"))
      alvos.push({ alvoId: n.id, tipo: "npc", nome: n.nome, imagem: n.retrato || "", hp: n.hp, energia: n.energia });
    for (const c of campanha.ver("batalha").combatentes) {
      const modelo = c.imagem ? null : campanha.ver(c.tipo === "npc" ? "npcs" : "inimigos").find(item => item.id === c.modeloId);
      alvos.push({
        alvoId: c.alvoId,
        tipo: c.tipo === "npc" ? "npc" : "inimigo",
        nome: c.nome,
        imagem: c.imagem || modelo?.imagem || modelo?.retrato || "",
        hp: c.hp,
        energia: c.energia,
        derrotado: c.derrotado,
      });
    }
    return { alvos };
  });

  // Personagens existentes (online ou não), para o mestre escolher a quem entregar.
  comandos.registrar(socket, "master_listar_personagens", () => {
    const lista = [];
    for (const conta of fs.readdirSync(PLAYERS_PATH, { withFileTypes: true })) {
      if (!conta.isDirectory() || !nomePastaValido(conta.name)) continue;
      for (const pasta of fs.readdirSync(path.join(PLAYERS_PATH, conta.name), {
        withFileTypes: true,
      })) {
        if (!pasta.isDirectory() || !nomePastaValido(pasta.name)) continue;
        const perfil = path.join(
          PLAYERS_PATH,
          conta.name,
          pasta.name,
          "perfil.json",
        );
        if (!fs.existsSync(perfil)) continue;
        let nome = "";
        try {
          nome = String(personagemModelo.lerJson(perfil)?.nome || "").slice(
            0,
            80,
          );
        } catch {
          /* perfil ilegível: usa o nome da pasta */
        }
        lista.push({
          player: conta.name,
          nomePasta: pasta.name,
          nome: nome || extrairNomeEId(pasta.name).nome,
          online: Boolean(abaDoPersonagem(conta.name, pasta.name)),
        });
        if (lista.length >= 300) return lista;
      }
    }
    return lista;
  });

  comandos.registrar(
    socket,
    "master_entregar",
    async ({ tipo, catalogId, player, nomePasta }) => {
      if (!TIPOS_CATALOGO.includes(tipo))
        throw new ErroCampanha("tipo_invalido", "Tipo inválido.");
      if (!personagemModelo.ehIdSeguro(catalogId))
        throw new ErroCampanha("id_invalido", "Id inválido.");
      const pasta =
        nomePastaValido(player) && nomePastaValido(nomePasta)
          ? path.join(PLAYERS_PATH, player, nomePasta)
          : null;
      if (!pasta || !fs.existsSync(path.join(pasta, "perfil.json"))) {
        throw new ErroCampanha(
          "personagem_inexistente",
          "Personagem não encontrado.",
        );
      }
      const item = campanha.ver(tipo).find((i) => i.id === catalogId);
      if (!item)
        throw new ErroCampanha(
          "catalogo_inexistente",
          "Essa entrada não existe mais no catálogo.",
        );
      try {
        const ficha = personagemModelo.lerJson(
          path.join(pasta, `${tipo}.json`),
        );
        if (
          Array.isArray(ficha?.items) &&
          ficha.items.some((i) => i?.catalogId === catalogId)
        ) {
          throw new ErroCampanha(
            "ja_possui",
            "O personagem já tem essa entrada.",
          );
        }
      } catch (erro) {
        if (erro.negocio) throw erro; // arquivo ausente/ilegível: segue
      }
      const entrega = await entregas.adicionar(player, nomePasta, {
        tipo,
        entrada: entradaParaFicha(item),
      });
      const aba = abaDoPersonagem(player, nomePasta);
      if (aba) enviarEntrega(aba, entrega);
      return { entregaId: entrega.entregaId, online: Boolean(aba) };
    },
    { mudaEstado: true },
  );

  ouvir("disconnect", () => {
    console.log(`[DESCONEXÃO] Cliente desconectado: ${socket.id}`);
    for (const [charId, player] of Object.entries(playersState)) {
      if (player.socketId !== socket.id) continue;

      // Mesma ficha aberta em outra aba: o card continua, agora ligado a essa aba.
      const outraAba = [...io.sockets.sockets.values()].find(
        (s) =>
          s.id !== socket.id &&
          player.player &&
          s.data.personagem?.player === player.player &&
          s.data.personagem?.nomePasta === player.nomePasta,
      );
      if (outraAba) {
        player.socketId = outraAba.id;
        outraAba.data.charId = charId;
        outraAba.emit("sincronizar_ficha");
        console.log(
          `[FICHA] ${player.name} (${charId}) segue ativo em outra aba.`,
        );
        continue;
      }

      limparJogadoresRecentes();
      const recente = { jogador: estadoPublico(player), expiraEm: Date.now() + TEMPO_JOGADOR_RECENTE_MS };
      jogadoresRecentes.set(charId, recente);
      const timerRecente = setTimeout(() => {
        if (jogadoresRecentes.get(charId) === recente) jogadoresRecentes.delete(charId);
      }, TEMPO_JOGADOR_RECENTE_MS);
      timerRecente.unref();
      delete playersState[charId];
      console.log(
        `[FICHA] ${player.name} (${charId}) removido: cliente desconectado.`,
      );
      io.emit("player_removed", { charId });
      io.emit("player_recently_disconnected", recente);
    }
  });
});


// Último middleware: corpo malformado/grande vira resposta limpa (sem pilha de erro na tela nem no log) e qualquer
// outra falha de rota vira "erro interno" genérico.
app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  const status =
    Number.isInteger(erro?.status) && erro.status >= 400 && erro.status < 500
      ? erro.status
      : 500;
  if (status >= 500)
    console.error(`[ERRO HTTP] ${req.method} ${req.path}:`, erro);
  const mensagem =
    status === 413
      ? "Pedido grande demais."
      : status < 500
        ? "Pedido inválido."
        : "Erro interno do servidor.";
  res.status(status).json({ success: false, message: mensagem });
});

server.on("error", (erro) => {
  console.error(
    erro.code === "EADDRINUSE"
      ? `[ERRO] A porta ${PORT} já está em uso. Feche o outro servidor (ou outra janela do terminal) ou use outra porta: PORT=3001 node server.js`
      : `[ERRO] O servidor não conseguiu iniciar: ${erro.message}`,
  );
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RPG Login disponível em http://localhost:${PORT}/login`);
  console.log(`RPG VTT disponível em http://localhost:${PORT}`);
  console.log(`Painel do mestre: http://localhost:${PORT}/mestre`);
});

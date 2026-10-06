const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { enderecoEhLocal, lerCookie } = require("./acesso.js");
const personagemModelo = require("./personagem");
const {
  MAX_VITAL,
  VITAL_TYPES,
  NORMALIZADORES,
  normalizarEntradaCodice,
  ehIdSeguro,
  extrairNomeEId,
  criarArquivosPadrao,
  carregarPersonagemDaPasta,
  lerArquivosNormalizados,
  gravarJson,
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
// Defina SENHA_MESTRE no ambiente antes de expor a mesa na rede.
const SENHA_MESTRE = process.env.SENHA_MESTRE || "2245";
const SESSIONS = new Map();

const COOKIE_SESSAO = "rpg_sessao";

// Abre a sessão. Com `res`, o token vai também num cookie: é ele que permite ao servidor exigir
// login para abrir as páginas (a ficha continua usando o token do sessionStorage nos sockets).
function criarSessao(player, res) {
  const token = crypto.randomUUID();
  SESSIONS.set(token, player);
  if (res) res.setHeader("Set-Cookie", `${COOKIE_SESSAO}=${token}; Path=/; HttpOnly; SameSite=Lax`);
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

const app = express();
app.use(express.json());

//=============================== LOGIN ==================================//
app.post("/api/login", (req, res) => {
  const { nome, senha, criarSeNaoExistir } = req.body;

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
    safeNome.length > 40
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
      fs.writeFileSync(caminhoLogin, JSON.stringify({ senha: senhaDigitada }, null, 2), "utf8");
      return res.json({ success: true, message: mensagemOk, player: safeNome, token: criarSessao(safeNome, res) });
    } catch (err) {
      return res.status(500).json({ success: false, message: mensagemErro });
    }
  };

  // 1. A pasta da conta NÃO existe: cria a conta, ou avisa para o cliente abrir o popup
  if (!fs.existsSync(pastaJogador)) {
    if (criarSeNaoExistir) {
      return cadastrar("Conta criada com sucesso!", "Erro ao criar a conta no servidor.");
    }
    return res.json({ exists: false, message: "A conta não existe." });
  }

  // 2. A pasta existe mas não tem login.json: cadastra a senha digitada
  if (!fs.existsSync(caminhoLogin)) {
    return cadastrar("Senha cadastrada com sucesso!", "Erro ao gravar login.json.");
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

function criarPersonagem(player, nome) {
  const id = gerarIdPersonagem(player, nome);
  const nomePasta = `${nome}_${id}`;
  const personagemPath = path.join(PLAYERS_PATH, player, nomePasta);

  fs.mkdirSync(personagemPath, { recursive: true });
  criarArquivosPadrao(personagemPath, { id, nome });

  return {
    id,
    nome,
    pasta: nomePasta,
    path: personagemPath,
  };
}

// Devolve { personagem } ou { motivo: "nao_encontrado" | "invalido" } (para a ficha mostrar a mensagem certa).
function carregarPersonagem(player, nomePasta) {
  const personagemPath = path.join(PLAYERS_PATH, player, nomePasta);

  if (!fs.existsSync(personagemPath)) {
    return { motivo: "nao_encontrado" };
  }

  try {
    const { personagem, erros } = carregarPersonagemDaPasta(personagemPath);
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
function salvarArquivoPersonagem(player, nomePasta, arquivo, dados) {
  const normalizar = Object.hasOwn(NORMALIZADORES, arquivo)
    ? NORMALIZADORES[arquivo]
    : null;
  if (!normalizar)
    return { ok: false, message: "Arquivo de personagem desconhecido." };

  const limpo = normalizar(dados);
  if (!limpo)
    return { ok: false, message: `Formato inválido para ${arquivo}.` };

  const caminho = path.join(PLAYERS_PATH, player, nomePasta, `${arquivo}.json`);
  gravarJson(caminho, limpo);
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

app.post("/api/personagens", (req, res) => {
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
    /[/\\?%*:|"<>\u0000]/.test(nome)
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Nome de personagem inválido." });
  }

  try {
    const personagem = criarPersonagem(player, nome);
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

//=============================== CATÁLOGO GLOBAL (Sprint 5) ==================================//
// Arquivos catalogo/magias.json e catalogo/habilidades.json: { schemaVersion, items: [{ id, nome, ... }] }.
// Somente leitura para os jogadores; o mestre edita os arquivos à mão por enquanto.
const CATALOGO_PATH = path.join(__dirname, "catalogo");
const TIPOS_CATALOGO = ["magias", "habilidades"];
const MAX_CATALOGO = 2000;

function carregarCatalogo(tipo) {
  const caminho = path.join(CATALOGO_PATH, `${tipo}.json`);
  if (!fs.existsSync(caminho)) return [];

  const bruto = JSON.parse(fs.readFileSync(caminho, "utf8").replace(/^\uFEFF/, ""));
  const lista = Array.isArray(bruto?.items) ? bruto.items.slice(0, MAX_CATALOGO) : [];
  const idsVistos = new Set();
  const itens = [];

  for (const entrada of lista) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) continue;
    // Entrada sem id válido, ou com id repetido, é ignorada (o id liga a ficha ao catálogo).
    if (!ehIdSeguro(entrada.id) || idsVistos.has(entrada.id)) continue;
    idsVistos.add(entrada.id);
    const { uid, ...limpa } = normalizarEntradaCodice(entrada, new Set());
    itens.push(limpa);
  }
  return itens;
}

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
    return res.json({ success: true, tipo, items: carregarCatalogo(tipo) });
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
  const { schemaVersion, ...vitaisLimpos } = status;
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
let playersState = {};

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
const rolagensVistas = new Set(); // ids das últimas rolagens (evita duplicar um reenvio)
// Arquivos cuja versão normalizada (a do servidor) volta no aviso de salvamento, para a ficha conferir.
const ARQUIVOS_CONFERIDOS = ["status", "inventario"];
const ESPERA_OUTRA_ABA_MS = 600; // folga para uma aba que está fechando/recarregando

// Estado enviado a todos os clientes: sem a identidade (player/pasta) do personagem no disco.
function estadoPublico(estado) {
  const { player, nomePasta, ...publico } = estado;
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
  if (arquivo === "perfil") socket.data.nomePersonagem = dados.nome;
  const charId = socket.data.charId;
  const card = charId && playersState[charId];
  if (!card || (arquivo !== "status" && arquivo !== "perfil")) return;

  if (arquivo === "status") card.vitals = normalizarVitais(dados) ?? card.vitals;
  else card.name = dados.nome;
  card.lastUpdate = new Date().toLocaleTimeString();
  io.emit("player_updated", estadoPublico(card));
}

function charIdDoSocket(socketId) {
  return Object.keys(playersState).find(
    (id) => playersState[id].socketId === socketId,
  );
}

function verificarAcessoMestre(req, res, next) {
  const ip = req.socket.remoteAddress || "";
  const enderecosProprios = Object.values(os.networkInterfaces())
    .flat()
    .map((placa) => placa?.address);

  if (enderecoEhLocal(ip, enderecosProprios) || req.query.chave === SENHA_MESTRE) {
    next();
    return;
  }

  console.warn(
    `[BLOQUEIO] Tentativa de acesso em /mestre recusada do IP: ${ip}`,
  );
  res
    .status(403)
    .send(
      "<h1>403 - Acesso Negado</h1><p>Esta área é restrita ao Mestre da mesa.</p>",
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
  "/login": { arquivo: path.join(__dirname, "login", "entrar.html"), protegida: false },
  "/selecao": { arquivo: path.join(__dirname, "login", "login.html"), protegida: true },
};
for (const [rota, { arquivo, protegida }] of Object.entries(PAGINAS)) {
  app.get(rota, ...(protegida ? [exigirLogin] : []), (req, res) => res.sendFile(arquivo));
}

app.get(["/mestre", "/mestre.html"], verificarAcessoMestre, (req, res) => {
  res.sendFile(path.join(__dirname, "mestre.html"));
});

io.on("connection", (socket) => {
  const peer = socket.handshake.address || "IP desconhecido";
  console.log(`[CONEXÃO] Cliente conectado: ${socket.id} (${peer})`);
  socket.emit("sync_all_players", todosEstadosPublicos());
  socket.emit("sync_config", systemConfig);

  socket.on("carregar_personagem", (identidade = {}) => {
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

    const entregar = () => {
      const { personagem, motivo } = carregarPersonagem(player, nomePasta);

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
      socket.data.nomePersonagem = personagem.perfil?.nome || extrairNomeEId(nomePasta).nome;
      socket.emit("personagem_carregado", { ...personagem, player, nomePasta });
    };

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
        entregar();
      }, ESPERA_OUTRA_ABA_MS);
      return;
    }
    entregar();
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

  socket.on("salvar_personagem", (data = {}) => {
    const arquivo = typeof data.arquivo === "string" ? data.arquivo : "";

    if (!identidadeValidaParaSalvar(data)) {
      socket.emit("salvamento_personagem_erro", {
        arquivo,
        message: "Este personagem não está aberto nesta aba (ou a sessão é inválida).",
      });
      return;
    }

    try {
      const resultado = salvarArquivoPersonagem(
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
        ...(ARQUIVOS_CONFERIDOS.includes(arquivo) ? { dados: resultado.dados } : {}),
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

  socket.on("player_update", (data) => {
    const charId = normalizarId(data?.id, socket.id);
    const identidade = socket.data.personagem ?? null;

    // Um socket representa um único personagem e não pode publicar (nem sobrescrever) o card de outro.
    // A mesma ficha aberta em duas abas é permitida (mesma identidade).
    if (socket.data.charId && socket.data.charId !== charId) {
      console.warn(`[SEGURANÇA] player_update recusado: ${socket.id} já representa outro personagem.`);
      return;
    }
    const atual = playersState[charId];
    if (atual && atual.socketId !== socket.id && io.sockets.sockets.has(atual.socketId)) {
      const mesmaFicha =
        identidade && atual.player === identidade.player && atual.nomePasta === identidade.nomePasta;
      if (!mesmaFicha) {
        console.warn(`[SEGURANÇA] player_update recusado: ${socket.id} tentou usar o card ${charId}.`);
        return;
      }
    }
    socket.data.charId = charId;

    // Com personagem aberto, a vida vem do que o servidor tem (card atual ou status.json) e o nome do
    // perfil salvo: o que o cliente manda aqui é ignorado. Sem personagem aberto, vale o enviado.
    const vitals = identidade
      ? (atual?.vitals ?? normalizarVitais(lerArquivosNormalizados(path.join(PLAYERS_PATH, identidade.player, identidade.nomePasta), ["status"]).status))
      : normalizarVitais(data?.vitals);
    if (!vitals) return;

    playersState[charId] = {
      id: charId,
      socketId: socket.id,
      name: socket.data.nomePersonagem || normalizarTexto(data?.name, "Herói Sem Nome", 80),
      vitals,
      lastUpdate: new Date().toLocaleTimeString(),
      ...(socket.data.personagem ?? {}), // player + nomePasta, para o mestre ler a ficha
    };
    console.log(
      `[FICHA] ${playersState[charId].name} | Update: / HP ${vitals.hp.current}/${vitals.hp.max} / Vigor ${vitals.vigor.current}/${vitals.vigor.max} / Sanidade ${vitals.sanity.current}/${vitals.sanity.max} |`,
    );
    io.emit("player_updated", estadoPublico(playersState[charId]));
  });

  socket.on("client_log", (data) => {
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

  socket.on("dice_roll", (data, confirmar) => {
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
      if (rolagensVistas.size > 500) rolagensVistas.delete(rolagensVistas.values().next().value);
    }

    const quando = Number(data.quando);
    const agora = Date.now();
    const roll = {
      character: nome,
      total: Math.round(total),
      details: normalizarTexto(data.details, "Rolagem", 300),
      // hora em que foi rolada (uma rolagem feita sem conexão chega depois)
      quando: Number.isFinite(quando) && quando <= agora + 60_000 && quando >= agora - 86_400_000 ? Math.round(quando) : agora,
    };
    console.log(`[DADOS] ${roll.character}: ${roll.details} = ${roll.total}`);
    io.emit("dice_rolled", roll);
    responder(true);
  });

  // Confere o token do mestre; se errado, avisa o cliente (com `extra`, ex.: o charId) e devolve false.
  function exigirMestre(data, acao, extra = {}) {
    if (data?.token === SENHA_MESTRE) return true;
    console.warn(`[SEGURANÇA] ${acao} recusado para o cliente ${socket.id}: token inválido.`);
    socket.emit("master_feedback", {
      success: false,
      message: "Token/Senha do mestre incorreta!",
      ...extra,
    });
    return false;
  }

  socket.on("master_adjust_vital", (data) => {
    if (!exigirMestre(data, "Ajuste vital")) return;

    const charId = normalizarId(data.charId, "");
    const type = data.type;
    const delta = Number(data.delta);
    const player = playersState[charId];
    if (
      !VITAL_TYPES.includes(type) ||
      !Number.isFinite(delta) ||
      Math.abs(delta) > MAX_VITAL
    ) {
      socket.emit("master_feedback", {
        success: false,
        message: "Ajuste de atributo inválido.",
      });
      return;
    }
    // Enquanto o recurso "Vigor" for controlado por AtivarMana (regra atual da mesa).
    if (type === "vigor" && !systemConfig.AtivarMana) {
      socket.emit("master_feedback", {
        success: false,
        message: "Vigor está desativado nas regras da mesa.",
      });
      return;
    }
    if (!player?.vitals) {
      socket.emit("master_feedback", {
        success: false,
        message: "Personagem ainda não registrado no servidor!",
      });
      return;
    }

    const vital = player.vitals[type];

    if (!vital) {
      socket.emit("master_feedback", {
        success: false,
        message: "Atributo vital inválido.",
      });
      return;
    }

    vital.current = Math.max(
      0,
      Math.min(vital.current + Math.round(delta), vital.max),
    );
    console.log(
      `[MESTRE] ${player.name}: ${type.toUpperCase()} ${delta > 0 ? "+" : ""}${Math.round(delta)} => ${vital.current}/${vital.max}`,
    );

    // O servidor passa a ser a fonte da verdade: grava no status.json mesmo que a aba do
    // jogador esteja em segundo plano. O delta vai junto para o cliente aplicar sobre o
    // valor dele (assim uma edição simultânea do jogador não é perdida).
    if (player.player && player.nomePasta) {
      try {
        const salvo = salvarArquivoPersonagem(
          player.player,
          player.nomePasta,
          "status",
          player.vitals,
        );
        if (!salvo.ok) console.warn(`[MESTRE] status.json não gravado: ${salvo.message}`);
      } catch (error) {
        console.error("[MESTRE] Falha ao gravar status.json:", error);
      }
    }
    io.emit("vital_adjusted", {
      charId,
      vitals: player.vitals,
      type,
      delta: Math.round(delta),
    });
    socket.emit("master_feedback", {
      success: true,
      message: `${type.toUpperCase()} ajustado (${delta > 0 ? "+" : ""}${Math.round(delta)})!`,
    });
  });

  socket.on("master_get_personagem", (data) => {
    const charId = normalizarId(data?.charId, "");
    // O charId vai junto nas falhas para o painel fechar o card que ficaria "carregando" para sempre.
    const falhar = (message) =>
      socket.emit("master_feedback", { success: false, message, charId });

    if (!exigirMestre(data, "Leitura de ficha", { charId })) return;

    const entrada = playersState[charId];
    if (!entrada?.player || !entrada?.nomePasta) {
      falhar("Ficha indisponível: o jogador precisa estar com o personagem aberto.");
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

  socket.on("master_update_config", (data) => {
    if (!exigirMestre(data, "Atualização de configuração")) return;

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

  socket.on("disconnect", () => {
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
        console.log(`[FICHA] ${player.name} (${charId}) segue ativo em outra aba.`);
        continue;
      }

      delete playersState[charId];
      console.log(
        `[FICHA] ${player.name} (${charId}) removido: cliente desconectado.`,
      );
      io.emit("player_removed", { charId });
    }
  });
});

if (!process.env.SENHA_MESTRE) {
  console.warn('[AVISO] Usando a senha padrão do mestre ("2245"). Defina a variável SENHA_MESTRE para trocar.');
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RPG Login disponível em http://localhost:${PORT}/login`);
  console.log(`RPG VTT disponível em http://localhost:${PORT}`);
  console.log(`Painel do mestre: http://localhost:${PORT}/mestre`);
});

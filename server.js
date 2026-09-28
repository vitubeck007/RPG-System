const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const personagemModelo = require("./personagem");
const {
  MAX_VITAL,
  VITAL_TYPES,
  NORMALIZADORES,
  criarArquivosPadrao,
  carregarPersonagemDaPasta,
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

function criarSessao(player) {
  const token = crypto.randomUUID();
  SESSIONS.set(token, player);
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

  // 1. Se a pasta da conta NÃO existe
  if (!fs.existsSync(pastaJogador)) {
    if (criarSeNaoExistir) {
      try {
        fs.mkdirSync(pastaJogador, { recursive: true });
        const dadosLogin = { senha: String(senha || "") };
        fs.writeFileSync(
          path.join(pastaJogador, "login.json"),
          JSON.stringify(dadosLogin, null, 2),
          "utf8",
        );
        return res.json({
          success: true,
          message: "Conta criada com sucesso!",
          player: safeNome,
          token: criarSessao(safeNome),
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: "Erro ao criar a conta no servidor.",
        });
      }
    }

    // Retorna avisando que a conta não existe para abrir o popup
    return res.json({ exists: false, message: "A conta não existe." });
  }

  // 2. Se a pasta da conta EXISTE
  const caminhoLogin = path.join(pastaJogador, "login.json");

  // Se não tem login.json, cria o arquivo com a senha digitada
  if (!fs.existsSync(caminhoLogin)) {
    try {
      const dadosLogin = { senha: String(senha || "") };
      fs.writeFileSync(
        caminhoLogin,
        JSON.stringify(dadosLogin, null, 2),
        "utf8",
      );
      return res.json({
        success: true,
        message: "Senha cadastrada com sucesso!",
        player: safeNome,
        token: criarSessao(safeNome),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ success: false, message: "Erro ao gravar login.json." });
    }
  }

  // Se o login.json já existe, confere se a senha confere
  try {
    const dadosLogin = JSON.parse(fs.readFileSync(caminhoLogin, "utf8"));
    if (dadosLogin.senha === String(senha || "")) {
      return res.json({
        success: true,
        player: safeNome,
        token: criarSessao(safeNome),
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

function carregarPersonagem(player, nomePasta) {
  const personagemPath = path.join(PLAYERS_PATH, player, nomePasta);

  if (!fs.existsSync(personagemPath)) {
    return null;
  }

  try {
    const { personagem, erros } = carregarPersonagemDaPasta(personagemPath);
    if (erros) {
      console.error(
        `Personagem com arquivos inválidos em ${personagemPath}:`,
        erros,
      );
      return null;
    }
    return personagem;
  } catch (error) {
    console.error(`Falha ao carregar ${personagemPath}:`, error);
    return null;
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
  return { ok: true };
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
        nome: entry.name.replace(/_\d+(?:_\d+)?$/, ""),
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
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    ? value
    : fallback;
}

function normalizarTexto(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

let systemConfig = carregarConfig();
const server = http.createServer(app);
const io = new Server(server);
let playersState = {};

function verificarAcessoMestre(req, res, next) {
  const ip = req.socket.remoteAddress || "";
  const isLocalhost =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

  if (isLocalhost || req.query.chave === SENHA_MESTRE) {
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

app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login", "entrar.html"));
});

app.get("/selecao", (req, res) => {
  res.sendFile(path.join(__dirname, "login", "login.html"));
});

app.get(["/mestre", "/mestre.html"], verificarAcessoMestre, (req, res) => {
  res.sendFile(path.join(__dirname, "mestre.html"));
});

io.on("connection", (socket) => {
  const peer = socket.handshake.address || "IP desconhecido";
  console.log(`[CONEXÃO] Cliente conectado: ${socket.id} (${peer})`);
  socket.emit("sync_all_players", playersState);
  socket.emit("sync_config", systemConfig);

  socket.on("carregar_personagem", (identidade = {}) => {
    const { player, nomePasta } = identidade;
    const playerAutenticado = SESSIONS.get(socket.handshake.auth?.token);
    if (
      !playerAutenticado ||
      playerAutenticado !== player ||
      typeof nomePasta !== "string" ||
      nomePasta === "." ||
      nomePasta === ".." ||
      path.basename(nomePasta) !== nomePasta ||
      /[/\\\u0000]/.test(nomePasta)
    ) {
      socket.emit("personagem_erro", {
        message: "Sessão inválida para carregar este personagem.",
      });
      return;
    }

    console.log("Solicitação para carregar:", player, nomePasta);

    const personagem = carregarPersonagem(player, nomePasta);

    if (!personagem) {
      socket.emit("personagem_erro", {
        message: "Personagem não encontrado.",
      });
      return;
    }

    console.log("Personagem carregado:", personagem);

    socket.emit("personagem_carregado", { ...personagem, player, nomePasta });
  });

  function identidadeValidaParaSalvar(data) {
    const playerAutenticado = SESSIONS.get(socket.handshake.auth?.token);
    return (
      playerAutenticado &&
      data?.player === playerAutenticado &&
      typeof data.nomePasta === "string" &&
      data.nomePasta !== "." &&
      data.nomePasta !== ".." &&
      path.basename(data.nomePasta) === data.nomePasta &&
      !/[/\\\u0000]/.test(data.nomePasta)
    );
  }

  socket.on("salvar_personagem", (data = {}) => {
    const arquivo = typeof data.arquivo === "string" ? data.arquivo : "";

    if (!identidadeValidaParaSalvar(data)) {
      socket.emit("salvamento_personagem_erro", {
        arquivo,
        message: "Sessão inválida para salvar este personagem.",
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
      socket.emit("personagem_salvo", { arquivo });
    } catch (error) {
      console.error(`Falha ao salvar ${arquivo}.json:`, error);
      socket.emit("salvamento_personagem_erro", {
        arquivo,
        message: "Não foi possível salvar o arquivo do personagem.",
      });
    }
  });

  socket.on("player_update", (data) => {
    const vitals = normalizarVitais(data?.vitals);
    if (!vitals) return;

    const charId = normalizarId(data.id, socket.id);
    playersState[charId] = {
      id: charId,
      socketId: socket.id,
      name: normalizarTexto(data.name, "Herói Sem Nome", 80),
      vitals,
      lastUpdate: new Date().toLocaleTimeString(),
    };
    console.log(
      `[FICHA] ${playersState[charId].name} | Update: / HP ${vitals.hp.current}/${vitals.hp.max} / Vigor ${vitals.vigor.current}/${vitals.vigor.max} / Sanidade ${vitals.sanity.current}/${vitals.sanity.max} |`,
    );
    io.emit("player_updated", playersState[charId]);
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

  socket.on("dice_roll", (data) => {
    const total = Number(data?.total);
    if (!Number.isFinite(total) || Math.abs(total) > MAX_VITAL) return;

    const roll = {
      character: normalizarTexto(data.character, "Herói Sem Nome", 80),
      total: Math.round(total),
      details: normalizarTexto(data.details, "Rolagem", 300),
    };
    console.log(`[DADOS] ${roll.character}: ${roll.details} = ${roll.total}`);
    io.emit("dice_rolled", roll);
  });

  socket.on("master_adjust_vital", (data) => {
    if (data?.token !== SENHA_MESTRE) {
      console.warn(
        `[SEGURANÇA] Ajuste vital recusado para o cliente ${socket.id}: token inválido.`,
      );
      socket.emit("master_feedback", {
        success: false,
        message: "Token/Senha do mestre incorreta!",
      });
      return;
    }

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
    io.emit("vital_adjusted", { charId, vitals: player.vitals });
    socket.emit("master_feedback", {
      success: true,
      message: `${type.toUpperCase()} ajustado (${delta > 0 ? "+" : ""}${Math.round(delta)})!`,
    });
  });

  socket.on("master_update_config", (data) => {
    if (data?.token !== SENHA_MESTRE) {
      console.warn(
        `[SEGURANÇA] Atualização de configuração recusada para o cliente ${socket.id}: token inválido.`,
      );
      socket.emit("master_feedback", {
        success: false,
        message: "Token incorreto!",
      });
      return;
    }

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
      if (player.socketId === socket.id) {
        delete playersState[charId];
        console.log(
          `[FICHA] ${player.name} (${charId}) removido: cliente desconectado.`,
        );
        io.emit("player_removed", { charId });
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RPG Login disponível em http://localhost:${PORT}/login`);
  console.log(`RPG VTT disponível em http://localhost:${PORT}`);
  console.log(`Painel do mestre: http://localhost:${PORT}/mestre`);
});

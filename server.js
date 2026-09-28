const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
const DEFAULT_CONFIG = {
  AtivarRiquezas: false,
  UsarEx: true,
  AtivarSlotMochila: false,
  AtivarMana: false,
};
const VITAL_TYPES = new Set(["hp", "mana", "stress"]);
const DEFAULT_STATUS = {
  hp: { current: 34, max: 40 },
  vigor: { current: 18, max: 25 },
  sanity: { current: 4, max: 10 },
};
const MAX_VITAL = 100_000;
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
// Defina SENHA_MESTRE no ambiente antes de expor a mesa na rede.
const SENHA_MESTRE = process.env.SENHA_MESTRE || "2245";

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
      return res.json({ success: true });
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
const PLAYERS_PATH = path.join(__dirname, "players");

if (!fs.existsSync(PLAYERS_PATH)) {
  fs.mkdirSync(PLAYERS_PATH);
}

function criarArquivosPersonagem(personagemPath) {
  const arquivos = {
    "backpack.json": {
      items: [],
      equipped: { mainHand: null, offHand: null, back: null, backpack: null },
    },
    "status.json": DEFAULT_STATUS,
    "habilidades.json": [],
    "magias.json": [],
  };

  Object.entries(arquivos).forEach(([nomeArquivo, dados]) => {
    fs.writeFileSync(
      path.join(personagemPath, nomeArquivo),
      JSON.stringify(dados, null, 2),
      "utf8",
    );
  });
}

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

  criarArquivosPersonagem(personagemPath);

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

  const arquivos = [
    "backpack.json",
    "status.json",
    "habilidades.json",
    "magias.json",
  ];

  const personagem = {};

  for (const arquivo of arquivos) {
    const caminho = path.join(personagemPath, arquivo);

    if (!fs.existsSync(caminho)) {
      console.error(`Arquivo ausente: ${caminho}`);
      return null;
    }

    try {
      personagem[arquivo.replace(".json", "")] = JSON.parse(
        fs.readFileSync(caminho, "utf8"),
      );
    } catch (error) {
      console.error(`JSON inválido em ${caminho}:`, error);
      return null;
    }
  }

  return personagem;
}

function salvarDadosPersonagem(player, nomePasta, arquivo, dados) {
  const personagemPath = path.join(PLAYERS_PATH, player, nomePasta);

  const caminho = path.join(personagemPath, arquivo);

  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), "utf8");
}

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

function limitarNumero(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(Math.round(number), MAX_VITAL));
}

function normalizarVitais(vitais) {
  if (!vitais || typeof vitais !== "object") return null;

  const normalized = {};
  for (const type of VITAL_TYPES) {
    const maxKey = `${type}Max`;
    const max = limitarNumero(vitais[maxKey], 0);
    normalized[maxKey] = max;
    normalized[type] = Math.min(limitarNumero(vitais[type], 0), max);
  }
  return normalized;
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
  res.sendFile(path.join(__dirname, "login", "login.html"));
});

app.get("/selecao", (req, res) =>
  res.sendFile(path.join(__dirname, "login", "selecao.html")),
);

app.get(["/mestre", "/mestre.html"], verificarAcessoMestre, (req, res) => {
  res.sendFile(path.join(__dirname, "mestre.html"));
});

io.on("connection", (socket) => {
  const peer = socket.handshake.address || "IP desconhecido";
  console.log(`[CONEXÃO] Cliente conectado: ${socket.id} (${peer})`);
  socket.emit("sync_all_players", playersState);
  socket.emit("sync_config", systemConfig);

  socket.on("carregar_personagem", ({ player, nomePasta }) => {
    console.log("Solicitação para carregar:", player, nomePasta);

    const personagem = carregarPersonagem(player, nomePasta);

    if (!personagem) {
      socket.emit("personagem_erro", {
        message: "Personagem não encontrado.",
      });
      return;
    }

    console.log("Personagem carregado:", personagem);

    socket.emit("personagem_carregado", personagem);
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
      `[FICHA] ${playersState[charId].name} | Update: / HP ${vitals.hp}/${vitals.hpMax} / Vigor ${vitals.mana}/${vitals.manaMax} / Sanidade ${vitals.stress}/${vitals.stressMax} |`,
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
    if (type === "mana" && !systemConfig.AtivarMana) {
      socket.emit("master_feedback", {
        success: false,
        message: "Mana está desativada nas regras da mesa.",
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
    if (
      !VITAL_TYPES.has(type) ||
      !Number.isFinite(delta) ||
      Math.abs(delta) > MAX_VITAL
    ) {
      socket.emit("master_feedback", {
        success: false,
        message: "Ajuste de atributo inválido.",
      });
      return;
    }

    const maxKey = `${type}Max`;
    player.vitals[type] = Math.max(
      0,
      Math.min(player.vitals[type] + Math.round(delta), player.vitals[maxKey]),
    );
    console.log(
      `[MESTRE] ${player.name}: ${type.toUpperCase()} ${delta > 0 ? "+" : ""}${Math.round(delta)} => ${player.vitals[type]}/${player.vitals[maxKey]}`,
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

server.listen(PORT, () => {
  console.log(`RPG VTT disponível em http://localhost:${PORT}`);
  console.log(`Painel do mestre: http://localhost:${PORT}/mestre`);
});

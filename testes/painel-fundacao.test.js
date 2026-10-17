/* Sprint 1 (Fase 2): fundação segura do painel do mestre, com o servidor REAL.
   Cobre: acesso (mestre x jogador x anônimo) em cada evento novo, sala dos mestres, gravar/ler/remover,
   idempotência, concorrência, persistência com reinício, VAZAMENTO (o jogador nunca recebe dado do
   mestre), arquivo corrompido ao ligar, e o lado do navegador (pedirAoServidor / entrada na sala). */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const { iniciarServidor, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste"; // a mesma que o ambiente passa ao servidor
const SEGREDO = "SEGREDO-UNICO-7731";

describe("Fundação do painel do mestre (Sprint 1 da Fase 2)", { concurrency: false }, () => {
  let s, tokenJogador, pastaPersonagem;
  const abertos = [];

  before(async () => {
    s = await iniciarServidor();
    tokenJogador = (await s.api("/api/login", { nome: "jog1", senha: "x", criarSeNaoExistir: true })).token;
    pastaPersonagem = (await s.api("/api/personagens", { nome: "Alfa" }, tokenJogador)).personagem.nomePasta;
  });
  after(async () => {
    abertos.forEach((k) => k.close());
    await s?.parar();
  });

  const conectar = async ({ jogador = false } = {}) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(jogador ? { auth: { token: tokenJogador } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const comToken = (dados = {}) => ({ token: SENHA, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    const r = await pedir(sock, "master_entrar", comToken());
    assert.equal(r.ok, true, JSON.stringify(r));
    return sock;
  };
  const lerArquivoCampanha = (tipo) => JSON.parse(fs.readFileSync(path.join(s.dir, "campanha", `${tipo}.json`), "utf8"));

  const EVENTOS = [
    ["master_entrar", {}],
    ["master_campanha_ler", { tipo: "npcs" }],
    ["master_campanha_salvar", { tipo: "npcs", item: { nome: "Intruso" }, acaoId: "acao_x" }],
    ["master_campanha_remover", { tipo: "npcs", id: "qualquer", acaoId: "acao_y" }],
  ];

  /* --------------------------- acesso --------------------------- */
  it("anônimo e jogador são recusados em TODO evento novo; nada é gravado nem entra na sala", async () => {
    const anonimo = await conectar();
    const jogador = await conectar({ jogador: true });
    const intrusos = [anonimo, jogador];
    const tentativas = [
      {}, // sem token
      { token: "" },
      { token: "errado" },
      { token: tokenJogador }, // o token de SESSÃO do jogador não é a senha do mestre
      { token: ["senha-teste"] },
      { token: { $ne: null } },
    ];
    for (const sock of intrusos) {
      for (const [evento, base] of EVENTOS) {
        for (const extra of tentativas) {
          const r = await pedir(sock, evento, { ...base, ...extra });
          assert.equal(r.ok, false, `${evento} ${JSON.stringify(extra)}`);
          assert.equal(r.erro, "nao_autorizado", `${evento} ${JSON.stringify(extra)}`);
          assert.equal(r.dados, undefined);
        }
        // pedidos que nem são objeto
        for (const lixo of [null, undefined, "texto", 7, [SENHA]]) {
          const r = await pedir(sock, evento, lixo);
          assert.equal(r.ok, false);
          assert.equal(r.erro, "formato_invalido");
        }
      }
    }
    assert.equal(fs.existsSync(path.join(s.dir, "campanha", "npcs.json")), false, "nada foi gravado");
    // e sem função de confirmação também não derruba o servidor
    anonimo.emit("master_campanha_salvar", { tipo: "npcs", item: { nome: "x" }, acaoId: "acao_z" });
    await esperar(150);
    const r = await pedir(await conectar(), "master_campanha_ler", comToken());
    assert.equal(r.ok, true, "servidor continua de pé");
  });

  it("um jogador que descobre a senha do mestre... só entra se ela estiver certa (token é a única chave)", async () => {
    const jogador = await conectar({ jogador: true });
    assert.equal((await pedir(jogador, "master_entrar", { token: "2245" })).ok, false, "senha padrão do código não vale: o servidor usa a do ambiente");
    assert.equal((await pedir(jogador, "master_entrar", comToken())).ok, true);
  });

  /* --------------------------- CRUD pela rede --------------------------- */
  it("mestre salva, lê, edita e remove; resposta no padrão { ok, dados }", async () => {
    const m = await mestre();
    const criado = await pedir(m, "master_campanha_salvar", comToken({ tipo: "npcs", acaoId: "acao_c1", item: { nome: "Ana", segredo: SEGREDO, lore: "Ferreira" } }));
    assert.equal(criado.ok, true);
    assert.equal(criado.dados.nome, "Ana");
    assert.match(criado.dados.id, /^npc_/);

    const lido = await pedir(m, "master_campanha_ler", comToken({ tipo: "npcs" }));
    assert.deepEqual(lido.dados.map((n) => n.nome), ["Ana"]);
    const tudo = await pedir(m, "master_campanha_ler", comToken());
    assert.deepEqual(Object.keys(tudo.dados).sort(), ["batalha", "baus", "habilidades", "inimigos", "itens", "magias", "npcs"]);

    const editado = await pedir(m, "master_campanha_salvar", comToken({ tipo: "npcs", acaoId: "acao_c2", item: { id: criado.dados.id, nome: "Ana Maria" } }));
    assert.equal(editado.dados.id, criado.dados.id);
    assert.equal((await pedir(m, "master_campanha_ler", comToken({ tipo: "npcs" }))).dados.length, 1);

    const removido = await pedir(m, "master_campanha_remover", comToken({ tipo: "npcs", id: criado.dados.id, acaoId: "acao_c3" }));
    assert.deepEqual(removido, { ok: true, dados: { removido: true } });
    assert.deepEqual((await pedir(m, "master_campanha_ler", comToken({ tipo: "npcs" }))).dados, []);
  });

  it("entradas ruins são recusadas ou limpas pelo servidor (nunca confiadas)", async () => {
    const m = await mestre();
    const erro = async (dados) => (await pedir(m, "master_campanha_salvar", comToken({ acaoId: `a_${Math.random().toString(36).slice(2)}`, ...dados }))).erro;
    assert.equal(await erro({ tipo: "batalha", item: { nome: "x" } }), "tipo_invalido");
    assert.equal(await erro({ tipo: "../players", item: { nome: "x" } }), "tipo_invalido");
    assert.equal(await erro({ tipo: "npcs", item: "texto" }), "item_invalido");
    assert.equal(await erro({ tipo: "npcs", item: { nome: "x", notas: "y".repeat(40_000) } }), "item_grande");
    assert.equal((await pedir(m, "master_campanha_salvar", comToken({ tipo: "npcs", item: { nome: "x" } }))).erro, "acao_id_obrigatorio");
    assert.equal((await pedir(m, "master_campanha_ler", comToken({ tipo: "players" }))).erro, "tipo_invalido");
    assert.equal((await pedir(m, "master_campanha_remover", comToken({ tipo: "npcs", id: "../x", acaoId: "a_r1" }))).erro, "id_invalido");
    const grande = await pedir(m, "master_campanha_salvar", comToken({ tipo: "npcs", acaoId: "a_g", item: { nome: "z".repeat(100_000) } }));
    assert.equal(grande.erro, "pedido_grande");

    // dado hostil que passa é limpo
    const r = await pedir(m, "master_campanha_salvar", comToken({
      tipo: "inimigos", acaoId: "a_h",
      item: { nome: "<img src=x onerror=alert(1)>", imagem: "javascript:alert(1)", hpMax: "9999999999", __proto__: { admin: true }, ataques: [{ dado: "1d6; rm -rf" }] },
    }));
    assert.equal(r.ok, true);
    assert.equal(r.dados.imagem, "");
    assert.ok(r.dados.hpMax <= 100000);
    assert.equal(r.dados.ataques[0].dado, "");
    assert.equal(r.dados.admin, undefined);
    assert.equal(({}).admin, undefined, "protótipo global intacto");
  });

  /* --------------------------- idempotência e concorrência --------------------------- */
  it("reenviar o mesmo acaoId (duplo clique / reenvio após tempo esgotado) cria UM item só", async () => {
    const m = await mestre();
    const antes = (await pedir(m, "master_campanha_ler", comToken({ tipo: "inimigos" }))).dados.length;
    const pedido = comToken({ tipo: "inimigos", acaoId: "acao_dup_1", item: { nome: "Orc" } });
    const [a, b, c] = await Promise.all([pedir(m, "master_campanha_salvar", pedido), pedir(m, "master_campanha_salvar", pedido), pedir(m, "master_campanha_salvar", pedido)]);
    const depois = await pedir(m, "master_campanha_salvar", pedido); // e de novo, bem depois
    assert.deepEqual([a.dados.id, b.dados.id, c.dados.id, depois.dados.id], [a.dados.id, a.dados.id, a.dados.id, a.dados.id]);
    assert.equal((await pedir(m, "master_campanha_ler", comToken({ tipo: "inimigos" }))).dados.length, antes + 1);
  });

  it("dois mestres gravando ao mesmo tempo: nada se perde e o arquivo continua válido", async () => {
    const m1 = await mestre();
    const m2 = await mestre();
    const antes = (await pedir(m1, "master_campanha_ler", comToken({ tipo: "baus" }))).dados.length;
    const envios = [];
    for (let i = 0; i < 20; i++) {
      envios.push(pedir(i % 2 ? m1 : m2, "master_campanha_salvar", comToken({ tipo: "baus", acaoId: `acao_bau_${i}`, item: { nome: `Baú ${i}`, itens: [{ item: { name: "Moeda", weight: 0.01 }, quantidade: 10 }] } })));
    }
    const rs = await Promise.all(envios);
    assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.find((r) => !r.ok)));
    const noDisco = lerArquivoCampanha("baus");
    assert.equal(noDisco.items.length, antes + 20);
    assert.equal(new Set(noDisco.items.map((b) => b.id)).size, noDisco.items.length);
    assert.deepEqual(fs.readdirSync(path.join(s.dir, "campanha")).filter((f) => f.endsWith(".tmp")), []);
  });

  /* --------------------------- sala dos mestres e vazamento --------------------------- */
  it("só quem entrou na sala recebe campanha_atualizada; anônimo e jogador nunca recebem", async () => {
    const dono = await mestre();
    const outroMestre = await mestre();
    const quemNaoEntrou = await conectar(); // mestre que ainda não deu master_entrar
    const anonimo = await conectar();
    const jogador = await conectar({ jogador: true });
    const recebidos = { outroMestre: [], dono: [], quemNaoEntrou: [], anonimo: [], jogador: [] };
    for (const [nome, sock] of Object.entries({ outroMestre, dono, quemNaoEntrou, anonimo, jogador })) {
      sock.on("campanha_atualizada", (d) => recebidos[nome].push(d));
    }
    const r = await pedir(dono, "master_campanha_salvar", comToken({ tipo: "npcs", acaoId: "acao_sala_1", item: { nome: "Beto", segredo: SEGREDO } }));
    assert.equal(r.ok, true);
    await esperarAte(() => recebidos.outroMestre.length >= 1 && recebidos.dono.length >= 1, { rotulo: "aviso na sala" });
    await esperar(200);
    assert.equal(recebidos.outroMestre[0].tipo, "npcs");
    assert.ok(recebidos.outroMestre[0].dados.some((n) => n.nome === "Beto"));
    assert.equal(recebidos.dono.length, 1, "exatamente um aviso por gravação");
    for (const quem of ["quemNaoEntrou", "anonimo", "jogador"]) assert.equal(recebidos[quem].length, 0, quem);
  });

  it("VAZAMENTO: durante um jogo completo, o jogador não recebe NADA da campanha do mestre", async () => {
    const jogador = await conectar({ jogador: true });
    const anonimo = await conectar();
    const vistos = [];
    jogador.onAny((evento, ...args) => vistos.push([evento, args]));
    anonimo.onAny((evento, ...args) => vistos.push([evento, args]));

    // o jogador abre a ficha e age normalmente
    await new Promise((res) => { jogador.once("personagem_carregado", res); jogador.emit("carregar_personagem", { player: "jog1", nomePasta: pastaPersonagem }); });
    const m = await mestre();
    // o mestre mexe em tudo
    await pedir(m, "master_campanha_salvar", comToken({ tipo: "npcs", acaoId: "acao_v1", item: { nome: "Vilão", segredo: SEGREDO, notas: SEGREDO } }));
    await pedir(m, "master_campanha_salvar", comToken({ tipo: "inimigos", acaoId: "acao_v2", item: { nome: "Besta", nota: SEGREDO } }));
    await pedir(m, "master_campanha_salvar", comToken({ tipo: "baus", acaoId: "acao_v3", item: { nome: "Baú secreto", itens: [{ item: { name: SEGREDO } }] } }));
    await pedir(m, "master_campanha_ler", comToken());
    const a = await pedir(m, "master_campanha_salvar", comToken({ tipo: "npcs", acaoId: "acao_v4", item: { nome: "Temporário" } }));
    await pedir(m, "master_campanha_remover", comToken({ tipo: "npcs", id: a.dados.id, acaoId: "acao_v5" }));
    await esperar(300);

    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0, "o jogador recebeu os seus próprios eventos (o teste está de fato ouvindo)");
    assert.ok(!tudo.includes(SEGREDO), "o segredo do mestre vazou para um jogador");
    assert.ok(!tudo.includes("campanha_atualizada"));
    assert.ok(!tudo.includes("Vilão") && !tudo.includes("Besta") && !tudo.includes("Baú secreto"));
  });

  it("auditoria do código: todo io.emit/broadcast é de um evento conhecido; dado de campanha só sai pela sala", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    const permitidos = new Set(["dice_rolled", "player_removed", "player_updated", "sync_config", "vital_adjusted"]);
    const gerais = [...codigo.matchAll(/(?:io\.emit|io\.sockets\.emit|socket\.broadcast\.emit|socket\.broadcast\.to\([^)]*\)\.emit)\(\s*["']([\w-]+)["']/g)].map((m) => m[1]);
    assert.ok(gerais.length >= 5, "achou os broadcasts conhecidos");
    for (const evento of gerais) assert.ok(permitidos.has(evento), `broadcast geral novo: ${evento} (dado do mestre só por io.to(SALA_MESTRES))`);
    assert.ok(!/campanha_atualizada/.test(gerais.join()));
    // todo emit de campanha_atualizada passa por io.to(SALA_MESTRES)
    const emitsCampanha = [...codigo.matchAll(/[^\n]*campanha_atualizada[^\n]*/g)].map((m) => m[0]);
    assert.ok(emitsCampanha.length >= 1);
    for (const linha of emitsCampanha) assert.match(linha, /io\.to\(SALA_MESTRES\)\.emit/);
    // nenhum evento master_* é tratado fora do padrão novo sem exigir o token
    for (const [, nome] of codigo.matchAll(/(?:socket\.on|ouvir)\("(master_\w+)"/g)) {
      const inicio = Math.max(codigo.indexOf(`ouvir("${nome}"`), codigo.indexOf(`socket.on("${nome}"`));
      const bloco = codigo.slice(inicio, inicio + 400);
      assert.match(bloco, /exigirMestre\(/, `${nome} sem exigirMestre`);
    }
  });

  it("os arquivos da campanha não são alcançáveis por URL", async () => {
    const base = s.url;
    for (const caminho of ["/campanha/npcs.json", "/campanha.js", "/comandos.js", "/personagem.js", "/mestre/campanha.js", "/mestre/%2e%2e/campanha/npcs.json", "/JS/../campanha/npcs.json", "/campanha/_backup/"]) {
      const r = await fetch(base + caminho, { redirect: "manual" });
      const corpo = await r.text();
      assert.ok(!corpo.includes(SEGREDO), `${caminho} vazou o segredo`);
      assert.notEqual(r.status, 200, `${caminho} respondeu 200`);
    }
  });

  /* --------------------------- persistência e recuperação --------------------------- */
  it("os dados sobrevivem ao reinício do servidor, e o reinício cria backup", async () => {
    const m = await mestre();
    const antes = (await pedir(m, "master_campanha_ler", comToken())).dados;
    assert.ok(antes.npcs.some((n) => n.nome === "Beto"));
    await s.reiniciar();
    const m2 = await mestre();
    const depois = (await pedir(m2, "master_campanha_ler", comToken())).dados;
    assert.deepEqual(depois, antes);
    const backups = fs.readdirSync(path.join(s.dir, "campanha", "_backup"));
    assert.ok(backups.length >= 1 && backups.length <= 7, backups.join());
    // a ficha do jogador também continua abrindo normalmente (o resto do sistema não foi afetado);
    // as sessões de login vivem na memória do servidor, então depois do reinício é preciso entrar de novo
    tokenJogador = (await s.api("/api/login", { nome: "jog1", senha: "x" })).token;
    const jogador = await conectar({ jogador: true });
    const ok = await new Promise((res) => { jogador.once("personagem_carregado", () => res(true)); jogador.once("personagem_erro", () => res(false)); jogador.emit("carregar_personagem", { player: "jog1", nomePasta: pastaPersonagem }); });
    assert.equal(ok, true);
  });

  it("arquivo da campanha corrompido ao ligar: servidor sobe, guarda o arquivo e avisa o mestre", async () => {
    fs.writeFileSync(path.join(s.dir, "campanha", "npcs.json"), "{ lixo ::");
    await s.reiniciar();
    const sock = await conectar();
    const r = await pedir(sock, "master_entrar", comToken());
    assert.equal(r.ok, true);
    assert.equal(r.dados.avisos.length, 1);
    assert.match(r.dados.avisos[0], /npcs\.json/);
    assert.ok(fs.readdirSync(path.join(s.dir, "campanha", "_corrompidos")).length === 1);
    assert.deepEqual((await pedir(sock, "master_campanha_ler", comToken({ tipo: "npcs" }))).dados, []);
    // os outros tipos não foram afetados
    assert.ok((await pedir(sock, "master_campanha_ler", comToken({ tipo: "inimigos" }))).dados.length >= 1);
  });

  /* --------------------------- lado do navegador (comum.js) --------------------------- */
  describe("navegador: pedirAoServidor e entrada na sala", () => {
    const abrir = (opcoes = {}) => abrirPaginaMestre(s, "npc", opcoes);
    const textoDoToast = (pg) => pg.document.getElementById("toast-container")?.textContent || "";

    it("pedido de leitura: manda o token, não manda acaoId e entrega só os dados", async () => {
      const pg = await abrir({ tokenInicial: SENHA });
      try {
        pg.run("socket.connected = true");
        const p = pg.run("pedirAoServidor('master_campanha_ler', { tipo: 'npcs' })");
        const pedido = pg.falso.pedidos.at(-1);
        assert.equal(pedido.evento, "master_campanha_ler");
        assert.deepEqual({ ...pedido.dados }, { tipo: "npcs", token: SENHA });
        assert.equal(pedido.ms, 8000);
        pedido.cb(null, { ok: true, dados: ["a", "b"] });
        assert.deepEqual(await p, ["a", "b"]);
      } finally { pg.fechar(); }
    });

    it("pedido que muda algo: ganha acaoId e, se falhar, o erro devolve o MESMO id para reenviar", async () => {
      const pg = await abrir({ tokenInicial: SENHA });
      try {
        pg.run("socket.connected = true");
        const p = pg.run("pedirAoServidor('master_campanha_salvar', { tipo: 'npcs', item: { nome: 'x' } }, { muda: true }).then(() => 'ok', (e) => e)");
        const pedido = pg.falso.pedidos.at(-1);
        assert.match(pedido.dados.acaoId, /^acao_[a-z0-9]+$/);
        pedido.cb(new Error("timeout"), undefined);
        const erro = await p;
        assert.equal(erro.codigo, "tempo_esgotado");
        assert.equal(erro.acaoId, pedido.dados.acaoId);
        assert.match(textoDoToast(pg), /não respondeu a tempo/);

        // reenvio com o mesmo id
        pg.run(`window.__id = ${JSON.stringify(erro.acaoId)}`);
        pg.run("pedirAoServidor('master_campanha_salvar', { tipo: 'npcs', item: { nome: 'x' } }, { muda: true, acaoId: window.__id })");
        assert.equal(pg.falso.pedidos.at(-1).dados.acaoId, erro.acaoId);
      } finally { pg.fechar(); }
    });

    it("erro do servidor vira toast com a mensagem; 'silencioso' não mostra toast; sem conexão avisa", async () => {
      const pg = await abrir({ tokenInicial: SENHA });
      try {
        pg.run("socket.connected = true");
        const p = pg.run("pedirAoServidor('master_campanha_ler', { tipo: 'x' }).then(() => 'ok', (e) => e)");
        pg.falso.pedidos.at(-1).cb(null, { ok: false, erro: "tipo_invalido", mensagem: "Tipo de dado desconhecido." });
        const erro = await p;
        assert.equal(erro.codigo, "tipo_invalido");
        assert.match(textoDoToast(pg), /Tipo de dado desconhecido/);

        pg.document.getElementById("toast-container").textContent = "";
        const q = pg.run("pedirAoServidor('master_campanha_ler', {}, { silencioso: true }).then(() => 'ok', (e) => e)");
        pg.falso.pedidos.at(-1).cb(null, { ok: false, erro: "nao_autorizado", mensagem: "Token/Senha do mestre incorreta!" });
        assert.equal((await q).codigo, "nao_autorizado");
        assert.equal(textoDoToast(pg), "", "silencioso: sem toast");

        pg.run("socket.connected = false");
        const antes = pg.falso.pedidos.length;
        const r = await pg.run("pedirAoServidor('master_campanha_ler', {}).then(() => 'ok', (e) => e)");
        assert.equal(r.codigo, "sem_conexao");
        assert.equal(pg.falso.pedidos.length, antes, "sem conexão não emite");
        assert.match(textoDoToast(pg), /Sem conexão/);
      } finally { pg.fechar(); }
    });

    it("ao conectar (e reconectar) com token lembrado: entra na sala; sem token: não pede nada", async () => {
      const comToken_ = await abrir({ tokenInicial: SENHA });
      const semToken = await abrir();
      try {
        for (const pg of [comToken_, semToken]) pg.run("socket.connected = true");
        comToken_.disparar("connect");
        semToken.disparar("connect");
        const entrar = comToken_.falso.pedidos.filter((p) => p.evento === "master_entrar");
        assert.equal(entrar.length, 1);
        assert.equal(entrar[0].dados.token, SENHA);
        assert.equal(semToken.falso.pedidos.filter((p) => p.evento === "master_entrar").length, 0);
        comToken_.disparar("connect"); // reconexão: entra de novo (a sala se perde quando a conexão cai)
        assert.equal(comToken_.falso.pedidos.filter((p) => p.evento === "master_entrar").length, 2);
      } finally { comToken_.fechar(); semToken.fechar(); }
    });

    it("avisos do servidor (arquivo corrompido) aparecem como toast ao entrar na sala", async () => {
      const pg = await abrir({ tokenInicial: SENHA });
      try {
        pg.run("socket.connected = true");
        pg.disparar("connect");
        pg.falso.pedidos.find((p) => p.evento === "master_entrar").cb(null, { ok: true, dados: { sala: "mestres", avisos: ["campanha/npcs.json estava corrompido"] } });
        await esperarAte(() => /corrompido/.test(textoDoToast(pg)), { rotulo: "toast do aviso" });
      } finally { pg.fechar(); }
    });

    it("digitar o token e confirmar entra na sala; token errado mostra o erro", async () => {
      const pg = await abrir();
      try {
        pg.run("socket.connected = true");
        const campo = pg.document.getElementById("master-token-input");
        campo.value = "errado";
        campo.dispatchEvent(new pg.window.Event("input"));
        campo.dispatchEvent(new pg.window.Event("change"));
        const pedido = pg.falso.pedidos.find((p) => p.evento === "master_entrar");
        assert.equal(pedido.dados.token, "errado");
        pedido.cb(null, { ok: false, erro: "nao_autorizado", mensagem: "Token/Senha do mestre incorreta!" });
        await esperarAte(() => /incorreta/.test(textoDoToast(pg)), { rotulo: "toast de senha errada" });
      } finally { pg.fechar(); }
    });

    it("de ponta a ponta com o servidor real: a página entra na sala sozinha e recebe as mudanças em tempo real", async () => {
      const pg = await abrir({ real: true, tokenInicial: SENHA });
      const outro = await mestre();
      try {
        pg.run("window.__recebidos = []; socket.on('campanha_atualizada', (d) => window.__recebidos.push(d))");
        await esperarAte(() => pg.run("socket.connected"), { rotulo: "página conectar" });
        await esperar(300); // o master_entrar automático
        await pedir(outro, "master_campanha_salvar", comToken({ tipo: "inimigos", acaoId: "acao_pg_1", item: { nome: "Ogro" } }));
        await esperarAte(() => pg.window.__recebidos.length >= 1, { rotulo: "página receber a mudança" });
        assert.equal(pg.window.__recebidos[0].tipo, "inimigos");
        // e a própria página consegue pedir
        const lista = await pg.run("pedirAoServidor('master_campanha_ler', { tipo: 'inimigos' })");
        assert.ok(lista.some((i) => i.nome === "Ogro"));
        // pedido que muda algo, pela página
        const criado = await pg.run("pedirAoServidor('master_campanha_salvar', { tipo: 'npcs', item: { nome: 'Via página' } }, { muda: true })");
        assert.equal(criado.nome, "Via página");
      } finally { pg.fechar(); }
    });

    it("com senha errada na página real: nada entra na sala e nenhuma mudança chega", async () => {
      const pg = await abrir({ real: true, tokenInicial: "senha-errada" });
      const outro = await mestre();
      try {
        pg.run("window.__recebidos = []; socket.on('campanha_atualizada', (d) => window.__recebidos.push(d))");
        await esperarAte(() => pg.run("socket.connected"), { rotulo: "página conectar" });
        await esperar(300);
        await pedir(outro, "master_campanha_salvar", comToken({ tipo: "inimigos", acaoId: "acao_pg_2", item: { nome: "Troll" } }));
        await esperar(400);
        assert.equal(pg.window.__recebidos.length, 0);
        const r = await pg.run("pedirAoServidor('master_campanha_ler', {}, { silencioso: true }).then(() => 'ok', (e) => e.codigo)");
        assert.equal(r, "nao_autorizado");
      } finally { pg.fechar(); }
    });
  });
});

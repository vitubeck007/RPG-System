/* Teste de integração ponta a ponta (Sprint 7): a ficha REAL (index.html + os scripts de JS/)
   conversando com o servidor REAL, com reinício do servidor no meio.
   Rodar:  node --test testes/integracao.test.js
   Requer (devDependencies): jsdom e socket.io-client. */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { io: clienteIo } = require("socket.io-client");
const { ARQUIVOS } = require("../personagem.js");
const { iniciarServidor, abrirFicha, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const NOMES = ["perfil", "biografia", "atributos", "pericias", "status", "inventario", "magias", "habilidades"];

describe("Checklist ponta a ponta", { concurrency: false }, () => {
  let s, token, pasta, ficha, mestre;
  const lerDisco = (arq) => s.lerArquivo("ana", pasta, arq);
  const tudoNoDisco = () => JSON.stringify(Object.fromEntries(NOMES.map((n) => [n, lerDisco(n)])));
  const run = (codigo) => ficha.run(codigo);
  // Traz um valor da ficha como objeto "normal" (o contexto da ficha tem outro Object.prototype).
  const json = (codigo) => JSON.parse(run(`JSON.stringify(${codigo})`));

  // Digita num campo da ficha como o usuário: input + blur.
  const digitar = (campo, valor) => {
    const el = ficha.document.querySelector(`[data-campo="${campo}"]`);
    assert.ok(el, `campo ${campo} existe na tela`);
    el.value = valor;
    el.dispatchEvent(new ficha.window.Event("input", { bubbles: true }));
    el.dispatchEvent(new ficha.window.Event("blur"));
  };
  const tela = (id) => ficha.document.getElementById(id).textContent.trim();

  before(async () => {
    s = await iniciarServidor();
    const login = await s.api("/api/login", { nome: "ana", senha: "x", criarSeNaoExistir: true });
    token = login.token;
    const criado = await s.api("/api/personagens", { nome: "Kael" }, token);
    pasta = criado.personagem.nomePasta;
    mestre = clienteIo(s.url, { transports: ["websocket"] });
    await esperarAte(() => mestre.connected, { rotulo: "mestre conectar" });
  });

  after(async () => {
    mestre?.close();
    ficha?.fechar();
    await s?.parar();
  });

  it("1. cria um personagem novo do zero, com todos os arquivos no formato oficial", async () => {
    for (const arq of ARQUIVOS) assert.equal(lerDisco(arq).schemaVersion, 1, `${arq}.json com schemaVersion`);
    ficha = await abrirFicha(s, { player: "ana", nomePasta: pasta, token });
    assert.equal(run("STATE.name"), "Kael");
    assert.deepEqual(json("STATE.atributos"), { FOR: 10, DES: 10, INT: 10, SAB: 10, PRE: 10, VON: 10 },
      "personagem novo começa com atributos neutros (10 = modificador 0)");
    assert.equal(run("STATE.skills.every((p) => calcularPericia(p).total === 0)"), true, "perícias novas valem +0");
    assert.equal(run("STATE.backpackItems.length"), 0, "mochila nova vazia");
    assert.equal(run("Object.values(STATE.equipped).every((i) => i === null)"), true, "nada equipado");
    assert.deepEqual(ficha.erros, []);
  });

  it("2. altera perfil e biografia e grava no disco", async () => {
    digitar("perfil.nome", "Kael Voss");
    digitar("perfil.classe", "Guerreiro");
    digitar("perfil.origem", "Norte");
    digitar("perfil.idade", "31");
    digitar("perfil.alinhamento", "Neutro");
    digitar("perfil.divindade", "Pacto das Cinzas");
    digitar("biografia.history", "Cresceu nas fendas do norte.");
    digitar("biografia.scars", "Cicatriz no ombro.");
    digitar("biografia.notes", "Deve um favor ao ferreiro.");
    await ficha.salvos();
    const perfil = lerDisco("perfil");
    assert.equal(perfil.nome, "Kael Voss");
    assert.equal(perfil.classe, "Guerreiro");
    assert.equal(perfil.divindade, "Pacto das Cinzas");
    assert.equal(lerDisco("biografia").history, "Cresceu nas fendas do norte.");
    assert.equal(lerDisco("biografia").notes, "Deve um favor ao ferreiro.");
    assert.equal(run("STATE.name"), "Kael Voss");
  });

  it("3. altera os 6 atributos e recalcula as perícias (modificador + bônus)", async () => {
    const novos = { FOR: 15, DES: 12, INT: 8, SAB: 10, PRE: 14, VON: 18 };
    for (const [attr, v] of Object.entries(novos)) digitar(`atributos.${attr}`, String(v));
    run("alterarModPericia('atletismo', 3)"); // bônus +3
    run("alterarModPericia('vontade', 2)"); // bônus +2
    await ficha.salvos();

    assert.deepEqual(lerDisco("atributos"), { schemaVersion: 1, ...novos });
    assert.equal(lerDisco("pericias").skills.atletismo.mod, 3);
    // FOR 15 -> +2; bônus 3 -> +5 | VON 18 -> +4; bônus 2 -> +6 | INT 8 -> -1; bônus 0 -> -1
    assert.equal(tela("skill-mod-atletismo"), "+5");
    assert.equal(tela("skill-mod-vontade"), "+6");
    assert.equal(tela("skill-mod-investigacao"), "-1");
    assert.equal(tela("skill-detail-atletismo"), "FOR +2 • bônus +3");

    // mudar o atributo recalcula a perícia na hora
    digitar("atributos.FOR", "20");
    assert.equal(tela("skill-mod-atletismo"), "+8"); // FOR 20 -> +5, bônus 3
    digitar("atributos.FOR", "15");
    await ficha.salvos();
  });

  it("3b. valores de atributo fora do limite são ajustados (0 a 999) e inteiros", async () => {
    digitar("atributos.SAB", "-4");
    assert.equal(run("STATE.atributos.SAB"), 0);
    digitar("atributos.SAB", "1000");
    assert.equal(run("STATE.atributos.SAB"), 999);
    digitar("atributos.SAB", "abc");
    assert.equal(run("STATE.atributos.SAB"), 0);
    digitar("atributos.SAB", "10");
    await ficha.salvos();
    assert.equal(lerDisco("atributos").SAB, 10);
  });

  it("4. rolagens somam atributo e perícia corretamente e chegam ao mestre", async () => {
    run("Math.random = () => 0.5"); // d20 = 11, d6 = 4
    const rolagens = [];
    mestre.on("dice_rolled", (r) => rolagens.push(r));

    run("rolarAtributo('FOR', 'Força')"); // 11 + mod(15)=+2
    assert.equal(run("STATE.history[0].total"), 13);

    run("STATE.combo = []");
    run("adicionarPericiaAoCombo('atletismo')"); // +5
    run("adicionarDadoAvulso('1d20')"); // 11
    run("adicionarDadoAvulso('2d6')"); // 4 + 4
    run("rolarCombo()");
    assert.equal(run("STATE.history[0].total"), 5 + 11 + 8);

    await esperarAte(() => rolagens.length >= 2, { rotulo: "mestre receber as rolagens" });
    assert.deepEqual(rolagens.map((r) => r.total), [13, 24]);
  });

  it("5. define o máximo e consome/recupera HP, Vigor e Sanidade", async () => {
    mestre.emit("master_update_config", { token: "senha-teste", config: { AtivarMana: true } });
    await esperarAte(() => run("GLOBAL_CONFIG.AtivarMana"), { rotulo: "regra Vigor chegar à ficha" });

    run("definirMaximoVital('hp', 20)");
    run("definirMaximoVital('vigor', 8)");
    run("definirMaximoVital('sanity', 10)");
    assert.deepEqual(json("[STATE.vitals.hp.current, STATE.vitals.vigor.current, STATE.vitals.sanity.current]"), [20, 8, 10],
      "ao definir o máximo de um vital cheio, ele continua cheio");

    run("alterarVital('hp', -7)");
    assert.equal(tela("hp-val"), "13");
    assert.equal(tela("hp-max"), "20");
    run("alterarVital('hp', 100)");
    assert.equal(run("STATE.vitals.hp.current"), 20, "não passa do máximo");
    run("alterarVital('hp', -100)");
    assert.equal(run("STATE.vitals.hp.current"), 0, "não fica negativo");
    run("alterarVital('hp', 12)");
    run("alterarVital('vigor', -3)");
    run("alterarVital('sanity', -4)");
    await ficha.salvos();
    const status = lerDisco("status");
    assert.deepEqual([status.hp, status.vigor, status.sanity], [{ current: 12, max: 20 }, { current: 5, max: 8 }, { current: 6, max: 10 }]);

    // o mestre também ajusta, e o servidor grava
    const charId = run("STATE.id");
    mestre.emit("master_adjust_vital", { token: "senha-teste", charId, type: "hp", delta: -2 });
    await esperarAte(() => run("STATE.vitals.hp.current") === 10, { rotulo: "ajuste do mestre chegar à ficha" });
    await ficha.salvos();
    assert.equal(lerDisco("status").hp.current, 10);
  });

  it("6. adiciona, equipa e remove itens duplicados pelo UID", async () => {
    const adaga = { id: "adaga", name: "Adaga", type: "Arma", weight: 1, w: 1, h: 1, maxStack: 1 };
    run(`adicionarItemAoInventario(${JSON.stringify(adaga)}, 2)`);
    const pocao = { id: "pocao", name: "Poção", type: "Consumível", weight: 0.5, w: 1, h: 1, maxStack: 5 };
    run(`adicionarItemAoInventario(${JSON.stringify(pocao)}, 7)`);

    const itens = json("STATE.backpackItems");
    const adagas = itens.filter((i) => i.id === "adaga");
    assert.equal(adagas.length, 2, "duas adagas = duas instâncias");
    assert.notEqual(adagas[0].uid, adagas[1].uid, "cada instância tem seu uid");
    assert.deepEqual([...itens.filter((i) => i.id === "pocao").map((i) => i.quantity)].sort(), [2, 5], "7 poções = pilhas 5 + 2");
    assert.equal(new Set(itens.map((i) => i.uid)).size, itens.length, "uids únicos");

    // equipa a primeira adaga; a segunda continua na mochila
    run(`itemPopoverAtual = STATE.backpackItems.find((i) => i.uid === ${JSON.stringify(adagas[0].uid)}); equiparItemAtual('mainHand')`);
    assert.equal(run("STATE.equipped.mainHand.uid"), adagas[0].uid);
    assert.equal(run(`STATE.backpackItems.some((i) => i.uid === ${JSON.stringify(adagas[0].uid)})`), false);

    // descarta só a segunda (por uid): a equipada permanece
    run(`itemPopoverAtual = STATE.backpackItems.find((i) => i.uid === ${JSON.stringify(adagas[1].uid)}); descartarItemAtual()`);
    assert.equal(run(`STATE.backpackItems.some((i) => i.uid === ${JSON.stringify(adagas[1].uid)})`), false);
    assert.equal(run("STATE.equipped.mainHand.uid"), adagas[0].uid);

    await ficha.salvos();
    const inv = lerDisco("inventario");
    assert.equal(inv.equipped.mainHand.uid, adagas[0].uid);
    assert.equal(inv.items.filter((i) => i.id === "adaga").length, 0);
    assert.equal(inv.items.filter((i) => i.id === "pocao").length, 2);
  });

  it("7. adiciona e remove magias e habilidades (catálogo e criação própria)", async () => {
    await run("carregarCatalogoCodice('habilidades')");
    const catalogo = json("CODICE_UI.catalogo.habilidades.map((e) => e.id)");
    assert.ok(catalogo.length >= 1, "catálogo de habilidades carregado do servidor");

    run(`adicionarDoCatalogo('habilidades', CODICE_UI.catalogo.habilidades.find((e) => e.id === ${JSON.stringify(catalogo[0])}))`);
    run(`adicionarDoCatalogo('habilidades', CODICE_UI.catalogo.habilidades.find((e) => e.id === ${JSON.stringify(catalogo[0])}))`); // duplicata
    assert.equal(run("STATE.abilities.length"), 1, "mesma entrada do catálogo não entra duas vezes");

    // cria uma magia pelo formulário
    run("trocarSubAbaCodice('magias')");
    const campo = (id, v) => { ficha.document.getElementById(id).value = v; };
    campo("codice-f-nome", "Bola de Cinzas");
    campo("codice-f-dados", "3d6+1");
    campo("codice-f-dano", "Fogo");
    campo("codice-f-custo-vital", "vigor");
    campo("codice-f-custo-valor", "3");
    campo("codice-f-desc", "Explosão de cinzas.");
    run("criarEntradaCodice()");
    assert.equal(run("STATE.spells.length"), 1);

    // cria uma segunda e remove (o fluxo de remover pede dois cliques na tela; aqui, a ação final)
    campo("codice-f-nome", "Descartável");
    run("criarEntradaCodice()");
    assert.equal(run("STATE.spells.length"), 2);
    run("removerEntradaCodice('magias', STATE.spells.find((e) => e.nome === 'Descartável'))");
    assert.equal(run("STATE.spells.length"), 1);

    await ficha.salvos();
    const magias = lerDisco("magias").items;
    assert.equal(magias.length, 1);
    assert.equal(magias[0].nome, "Bola de Cinzas");
    assert.deepEqual(magias[0].cost, { vital: "vigor", amount: 3 });
    assert.match(magias[0].uid, /^[A-Za-z0-9_-]{4,64}$/);
    assert.equal(lerDisco("habilidades").items[0].catalogId, catalogo[0]);
  });

  it("8. troca o avatar e rejeita links perigosos", async () => {
    const url = ficha.document.getElementById("avatar-url-input");
    url.value = "https://exemplo.com/retrato.png";
    run("salvarAvatar()");
    await ficha.salvos();
    assert.equal(lerDisco("perfil").avatar, "https://exemplo.com/retrato.png");

    url.value = "javascript:alert(1)";
    run("salvarAvatar()");
    await esperar(150);
    assert.equal(lerDisco("perfil").avatar, "https://exemplo.com/retrato.png", "link inválido não é gravado");
  });

  it("9. fecha o navegador, reinicia o servidor, reabre e tudo permanece intacto", async () => {
    await ficha.salvos();
    const antes = tudoNoDisco();
    const estadoAntes = JSON.stringify(json("({ a: STATE.atributos, v: STATE.vitals, i: STATE.backpackItems, e: STATE.equipped, s: STATE.spells, h: STATE.abilities, n: STATE.name })"));
    ficha.fechar();
    mestre.close();

    await s.reiniciar();
    const login = await s.api("/api/login", { nome: "ana", senha: "x" });
    ficha = await abrirFicha(s, { player: "ana", nomePasta: pasta, token: login.token });

    assert.equal(tudoNoDisco(), antes, "a abertura/migração não altera nenhum arquivo");
    const estadoDepois = JSON.stringify(json("({ a: STATE.atributos, v: STATE.vitals, i: STATE.backpackItems, e: STATE.equipped, s: STATE.spells, h: STATE.abilities, n: STATE.name })"));
    assert.equal(estadoDepois, estadoAntes, "a ficha reaberta mostra exatamente o que estava antes");
    assert.equal(tela("skill-mod-atletismo"), "+5");
    assert.equal(tela("hp-val"), "10");
    assert.equal(ficha.document.querySelector('[data-campo="perfil.classe"]').value, "Guerreiro");
    assert.equal(ficha.document.querySelector('[data-campo="biografia.history"]').value, "Cresceu nas fendas do norte.");
  });
});

describe("Estabilização: carregamento, conexão e erros", { concurrency: false }, () => {
  let s, token, pasta;
  before(async () => {
    s = await iniciarServidor();
    token = (await s.api("/api/login", { nome: "bia", senha: "x", criarSeNaoExistir: true })).token;
    pasta = (await s.api("/api/personagens", { nome: "Lira" }, token)).personagem.nomePasta;
  });
  after(async () => { await s?.parar(); });

  it("alteração feita ANTES da ficha carregar não sobrescreve os dados salvos", async () => {
    const a = await abrirFicha(s, { player: "bia", nomePasta: pasta, token });
    a.run("alterarModPericia('luta', 4)");
    await a.salvos();
    a.fechar();
    assert.equal(s.lerArquivo("bia", pasta, "pericias").skills.luta.mod, 4);

    const b = await abrirFicha(s, { player: "bia", nomePasta: pasta, token, esperarCarga: false });
    b.run("alterarModPericia('acrobacia', 1)"); // clique na janela de carregamento
    await b.aguardarCarga();
    await esperar(300);
    assert.equal(b.run("STATE.skills.find((p) => p.id === 'luta').mod"), 4, "a ficha mostra o valor salvo");
    assert.equal(s.lerArquivo("bia", pasta, "pericias").skills.luta.mod, 4, "o disco continua com o valor salvo");
    b.fechar();
  });

  it("edição feita sem conexão é enviada ao reconectar, com aviso na tela", async () => {
    const f = await abrirFicha(s, { player: "bia", nomePasta: pasta, token });
    f.run("socket.disconnect()");
    await esperarAte(() => !f.run("socket.connected"), { rotulo: "desconectar" });
    const campo = f.document.querySelector('[data-campo="perfil.origem"]');
    campo.value = "Ilhas do Sul";
    campo.dispatchEvent(new f.window.Event("input", { bubbles: true }));
    campo.dispatchEvent(new f.window.Event("blur"));
    assert.match(f.document.getElementById("save-status").textContent, /Sem conexão/);
    assert.match(f.document.getElementById("estado-ficha").textContent, /Sem conexão/);
    assert.notEqual(s.lerArquivo("bia", pasta, "perfil").origem, "Ilhas do Sul");

    f.run("socket.connect()");
    await f.salvos();
    assert.equal(s.lerArquivo("bia", pasta, "perfil").origem, "Ilhas do Sul");
    assert.equal(f.document.getElementById("estado-ficha").classList.contains("hidden"), true, "aviso some ao reconectar");
    f.fechar();
  });

  it("o máximo de HP é editado clicando no número (Enter confirma, Esc cancela)", async () => {
    const f = await abrirFicha(s, { player: "bia", nomePasta: pasta, token });
    const doc = f.document;
    const teclar = (campo, key) => campo.dispatchEvent(new f.window.KeyboardEvent("keydown", { key, bubbles: true }));

    f.run("editarMaximoVital('hp')"); // o onclick inline do HTML não roda no jsdom
    let campo = doc.querySelector("#vital-cards-container input[type=number]");
    assert.ok(campo, "o número vira um campo editável");
    campo.value = "30";
    teclar(campo, "Enter");
    assert.equal(doc.getElementById("hp-max").textContent, "30");
    assert.equal(doc.getElementById("hp-val").textContent, "30", "vital cheio continua cheio");

    f.run("editarMaximoVital('hp')"); // o onclick inline do HTML não roda no jsdom
    campo = doc.querySelector("#vital-cards-container input[type=number]");
    campo.value = "99";
    teclar(campo, "Escape");
    assert.equal(doc.getElementById("hp-max").textContent, "30", "Esc cancela");

    f.run("alterarVital('hp', -10)");
    f.run("editarMaximoVital('hp')"); // o onclick inline do HTML não roda no jsdom
    campo = doc.querySelector("#vital-cards-container input[type=number]");
    campo.value = "15";
    teclar(campo, "Enter");
    assert.equal(doc.getElementById("hp-val").textContent, "15", "o atual é cortado no novo teto");

    f.run("editarMaximoVital('hp')"); // o onclick inline do HTML não roda no jsdom
    campo = doc.querySelector("#vital-cards-container input[type=number]");
    campo.value = "abc";
    teclar(campo, "Enter");
    assert.equal(doc.getElementById("hp-max").textContent, "15", "valor inválido é ignorado");

    await f.salvos();
    assert.deepEqual(s.lerArquivo("bia", pasta, "status").hp, { current: 15, max: 15 });
    f.fechar();
  });

  it("remover magia/habilidade pede um segundo clique para confirmar", async () => {
    const f = await abrirFicha(s, { player: "bia", nomePasta: pasta, token });
    f.run("trocarSubAbaCodice('habilidades')");
    f.document.getElementById("codice-f-nome").value = "Golpe de Teste";
    f.run("criarEntradaCodice()");
    const botao = f.document.querySelector('#abilities-container button[title="Remover"]');
    botao.click();
    assert.equal(f.run("STATE.abilities.length"), 1, "o primeiro clique só pede confirmação");
    assert.match(botao.textContent, /Confirmar/);
    botao.click();
    assert.equal(f.run("STATE.abilities.length"), 0, "o segundo clique remove");
    assert.match(f.document.getElementById("abilities-container").textContent, /Nenhuma habilidade/);
    await f.salvos();
    assert.equal(s.lerArquivo("bia", pasta, "habilidades").items.length, 0);
    f.fechar();
  });

  it("mostra 'Carregando' enquanto a ficha não chegou", async () => {
    const f = await abrirFicha(s, { player: "bia", nomePasta: pasta, token, esperarCarga: false });
    const banner = f.document.getElementById("estado-ficha");
    assert.equal(banner.classList.contains("hidden"), false);
    assert.match(banner.textContent, /Conectando|Carregando/);
    await f.aguardarCarga();
    assert.equal(banner.classList.contains("hidden"), true);
    f.fechar();
  });

  it("sessão expirada (servidor reiniciado) avisa e limpa a sessão, sem travar", async () => {
    const f = await abrirFicha(s, { player: "bia", nomePasta: pasta, token });
    await s.reiniciar(); // as sessões ficam só na memória do servidor
    await esperarAte(() => f.window.sessionStorage.getItem("rpg_token") === null, { ms: 15000, rotulo: "ficha reconhecer a sessão expirada" });
    assert.match(f.document.getElementById("toast-container").textContent, /Sessão expirada/);
    f.fechar();
  });
});

describe("Correções de bugs (regressão)", { concurrency: false }, () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { NORMALIZADORES } = require("../personagem.js");
  let s;
  const tokens = {};
  const pastas = {};
  const vitais = { hp: { current: 5, max: 10 }, vigor: { current: 3, max: 5 }, sanity: { current: 6, max: 6 } };

  before(async () => {
    s = await iniciarServidor();
    for (const nome of ["c1", "c2"]) {
      tokens[nome] = (await s.api("/api/login", { nome, senha: "x", criarSeNaoExistir: true })).token;
      pastas[nome] = (await s.api("/api/personagens", { nome: `Heroi${nome}` }, tokens[nome])).personagem.nomePasta;
    }
  });
  after(async () => { await s?.parar(); });

  // Socket "jogador" que já carregou o personagem (como a ficha faz).
  async function jogador(conta, pasta = pastas[conta], extra = {}) {
    const sock = await conectar(conta);
    sock.emit("carregar_personagem", { player: conta, nomePasta: pasta, ...extra });
    await new Promise((res) => sock.once("personagem_carregado", res));
    return sock;
  }
  async function conectar(conta) {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, auth: { token: tokens[conta] } });
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  }
  // Pede a carga e devolve "carregado" ou o código do erro recebido.
  const pedirCarga = (sock, conta, extra = {}) => new Promise((res) => {
    sock.once("personagem_carregado", () => res("carregado"));
    sock.once("personagem_erro", (e) => res(e.code || e.message));
    sock.emit("carregar_personagem", { player: conta, nomePasta: pastas[conta], ...extra });
  });
  const mestreSock = async () => {
    const m = clienteIo(s.url, { transports: ["websocket"], forceNew: true });
    await esperarAte(() => m.connected, { rotulo: "mestre conectar" });
    return m;
  };
  const toasts = (f) => f.document.getElementById("toast-container").textContent;

  it("combo: fórmula inválida cancela a rolagem inteira (0d6, +1d4, texto solto)", async () => {
    const token = tokens.c1;
    const f = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token });
    const m = await mestreSock();
    const rolagens = [];
    m.on("dice_rolled", (r) => rolagens.push(r));

    for (const ruim of ["0d6", "+1d4", "abc", "2d0", "5000d6"]) {
      f.run("STATE.combo = []; STATE.history = []");
      f.run("adicionarAoCombo('Bônus', '+3', 'bonus', 'manual')");
      f.run(`adicionarAoCombo('Ruim', ${JSON.stringify(ruim)}, 'dice', 'manual')`);
      f.run("rolarCombo()");
      assert.equal(f.run("STATE.history.length"), 0, `"${ruim}" não gera histórico`);
    }
    assert.match(toasts(f), /Fórmula inválida/);
    await esperar(200);
    assert.equal(rolagens.length, 0, "nada chega ao mestre");

    // fórmulas válidas continuam funcionando (inclui espaço no bônus e dado sem quantidade)
    f.run("Math.random = () => 0.5");
    f.run("STATE.combo = []; STATE.history = []");
    f.run("adicionarAoCombo('Bônus', '+ 5', 'bonus', 'manual')");
    f.run("adicionarAoCombo('D20', 'd20', 'dice', 'manual')");
    f.run("adicionarAoCombo('Dano', '2d6 - 1', 'dice', 'manual')");
    f.run("rolarCombo()");
    assert.equal(f.run("STATE.history[0].total"), 5 + 11 + (4 + 4 - 1));
    m.close(); f.fechar();
  });

  it("som: um único AudioContext é reutilizado em todas as rolagens", async () => {
    const f = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1 });
    let criados = 0;
    f.window.AudioContext = function () {
      criados++;
      this.state = "running"; this.currentTime = 0; this.destination = {};
      this.createOscillator = () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} });
      this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
    };
    for (let i = 0; i < 4; i++) {
      f.run("STATE.combo = []; adicionarAoCombo('Dado', '1d20', 'dice', 'manual'); rolarCombo()");
    }
    assert.equal(criados, 1);
    f.fechar();
  });

  it("avatar: dá para remover o retrato (o modal abre com o link atual)", async () => {
    const f = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1 });
    const input = f.document.getElementById("avatar-url-input");
    const img = f.document.getElementById("char-avatar-img");
    const padrao = img.getAttribute("src");

    input.value = "https://exemplo.com/a.png";
    f.run("salvarAvatar()");
    await f.salvos();
    assert.equal(s.lerArquivo("c1", pastas.c1, "perfil").avatar, "https://exemplo.com/a.png");

    f.run("openAvatarModal()");
    assert.equal(input.value, "https://exemplo.com/a.png", "abre já com o link atual");
    f.run("salvarAvatar()"); // salvar sem mexer não remove
    await f.salvos();
    assert.equal(s.lerArquivo("c1", pastas.c1, "perfil").avatar, "https://exemplo.com/a.png");

    f.run("openAvatarModal()");
    input.value = "";
    f.run("salvarAvatar()");
    await f.salvos();
    assert.equal(s.lerArquivo("c1", pastas.c1, "perfil").avatar, "", "removido no disco");
    assert.equal(img.getAttribute("src"), padrao, "volta à imagem padrão na tela");
    f.fechar();
  });

  it("erro de salvamento repetido mostra o aviso só uma vez", async () => {
    const f = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1 });
    f.run("STATE.vitals.hp = null; salvarStatus()"); // o servidor recusa esse formato
    await esperarAte(() => /Formato inválido/.test(toasts(f)), { rotulo: "1º aviso" });
    for (let i = 0; i < 3; i++) {
      f.run("enviarSalvamentosPendentes()"); // o que reconexão / aba escondida fazem
      await esperar(120);
    }
    assert.equal((toasts(f).match(/Formato inválido/g) || []).length, 1, "um único aviso");
    assert.match(f.document.getElementById("save-status").textContent, /Erro ao salvar/);
    f.run("STATE.vitals.hp = { current: 0, max: 0 }; salvarStatus()");
    await f.salvos();
    assert.doesNotMatch(f.document.getElementById("save-status").textContent, /Erro/, "ao salvar certo, o erro some");
    f.fechar();
  });

  it("moedas negativas ou quebradas são corrigidas já na tela", async () => {
    const f = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1 });
    const ouro = f.document.getElementById("coin-gold");
    ouro.value = "-5"; f.run("aoAlterarMoedas()");
    assert.equal(ouro.value, "0");
    ouro.value = "12.7"; f.run("aoAlterarMoedas()");
    assert.equal(ouro.value, "13");
    ouro.value = ""; f.run("aoAlterarMoedas()");
    assert.equal(ouro.value, "0");
    f.fechar();
  });

  it("atributo ausente no arquivo vale 10 (não 0)", () => {
    assert.deepEqual({ ...NORMALIZADORES.atributos({ FOR: 12 }) }, { schemaVersion: 1, FOR: 12, DES: 10, INT: 10, SAB: 10, PRE: 10, VON: 10 });
    assert.equal(NORMALIZADORES.atributos({}).VON, 10);
    assert.equal(NORMALIZADORES.atributos({ FOR: "abc" }).FOR, 10);
  });

  it("um jogador não consegue sobrescrever o card de outro", async () => {
    const m = await mestreSock();
    const vistos = [];
    m.on("player_updated", (p) => vistos.push(p));
    const a = await jogador("c1");
    const b = await jogador("c2");

    a.emit("player_update", { id: "card_dono", name: "Nome inventado", vitals: vitais });
    await esperarAte(() => vistos.some((p) => p.id === "card_dono"), { rotulo: "card do dono" });
    b.emit("player_update", { id: "card_dono", name: "Invasor", vitals: vitais });
    a.emit("player_update", { id: "card_outro", name: "Outro", vitals: vitais }); // mesmo socket, outro id
    await esperar(300);
    assert.equal(vistos.some((p) => p.name === "Invasor"), false, "card do dono preservado");
    assert.equal(vistos.some((p) => p.id === "card_outro"), false, "um socket só publica um personagem");
    assert.equal(vistos.every((p) => !("nomePasta" in p) && !("player" in p)), true, "sem identidade nos broadcasts");
    assert.equal(vistos.find((p) => p.id === "card_dono").name, "Heroic1", "o nome do card vem do perfil salvo, não do cliente");
    a.close(); b.close(); m.close();
  });

  it("reconexão: quando o socket antigo some depois, o card continua com a aba nova", async () => {
    const m = await mestreSock();
    const removidos = [];
    m.on("player_removed", (r) => removidos.push(r.charId));
    const aba1 = await jogador("c1");
    const aba2 = await jogador("c1", pastas.c1, { reconexao: true }); // sobreposição de uma reconexão
    let pediuSync = false;
    aba1.on("sincronizar_ficha", () => { pediuSync = true; });

    aba1.emit("player_update", { id: "card_duas_abas", name: "Aba1", vitals: vitais });
    await esperar(200);
    aba2.emit("player_update", { id: "card_duas_abas", name: "Aba2", vitals: vitais }); // mesma ficha: permitido
    await esperar(200);
    aba2.close(); // a aba dona do card (a última a atualizar) fecha
    await esperarAte(() => pediuSync, { rotulo: "aba restante receber pedido de sincronização" });
    assert.deepEqual(removidos, [], "o card continua");
    aba1.close();
    await esperarAte(() => removidos.includes("card_duas_abas"), { rotulo: "card removido ao fechar a última aba" });
    m.close();
  });

  it("'Ver ficha' do mestre só lê: não migra nem grava, e as falhas dizem de qual ficha", async () => {
    const a = await jogador("c1");
    const m = await mestreSock();
    a.emit("player_update", { id: "card_leitura", name: "Leitura", vitals: vitais });
    await esperar(200);

    // arquivo "antigo" (item sem uid): ler não pode reescrevê-lo
    const arq = path.join(s.dir, "players", "c1", pastas.c1, "habilidades.json");
    const antes = JSON.stringify({ schemaVersion: 1, items: [{ nome: "Sem uid" }] });
    fs.writeFileSync(arq, antes);
    m.emit("master_get_personagem", { token: "senha-teste", charId: "card_leitura" });
    const lido = await new Promise((res) => m.once("master_personagem", res));
    assert.ok(lido.personagem.habilidades.items[0].uid, "o painel recebe o dado normalizado");
    assert.equal(fs.readFileSync(arq, "utf8"), antes, "o arquivo no disco não foi tocado");
    assert.equal(fs.existsSync(path.join(s.dir, "players", "c1", pastas.c1, "_backup_pre_schema")), false, "sem backup/migração");

    m.emit("master_get_personagem", { token: "errado", charId: "card_leitura" });
    const f1 = await new Promise((res) => m.once("master_feedback", res));
    assert.deepEqual([f1.success, f1.charId], [false, "card_leitura"]);
    m.emit("master_get_personagem", { token: "senha-teste", charId: "nao_existe" });
    const f2 = await new Promise((res) => m.once("master_feedback", res));
    assert.deepEqual([f2.success, f2.charId], [false, "nao_existe"]);
    a.close(); m.close();
  });

  it("carregar: mensagem diferente para personagem inexistente e arquivos inválidos", async () => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, auth: { token: tokens.c1 } });
    await esperarAte(() => sock.connected, { rotulo: "conectar" });
    const pedir = (nomePasta) => new Promise((res) => {
      sock.once("personagem_erro", res);
      sock.emit("carregar_personagem", { player: "c1", nomePasta });
    });
    assert.match((await pedir("Fantasma_1234")).message, /não encontrado/);
    // personagem só para este teste (o arquivo corrompido não pode afetar os outros)
    const corrompido = (await s.api("/api/personagens", { nome: "Corrompido" }, tokens.c1)).personagem.nomePasta;
    fs.writeFileSync(path.join(s.dir, "players", "c1", corrompido, "atributos.json"), "{ quebrado");
    assert.match((await pedir(corrompido)).message, /inválidos/);
    sock.close();
  });

  it("o mesmo personagem não abre em duas abas: a segunda é recusada", async () => {
    const a = await conectar("c2");
    assert.equal(await pedirCarga(a, "c2"), "carregado");

    const b = await conectar("c2");
    assert.equal(await pedirCarga(b, "c2"), "ja_carregado", "2ª aba recusada");

    // outro personagem da mesma conta não é afetado
    const outro = (await s.api("/api/personagens", { nome: "Outro" }, tokens.c2)).personagem.nomePasta;
    const c = await conectar("c2");
    const r = await new Promise((res) => {
      c.once("personagem_carregado", () => res("carregado"));
      c.once("personagem_erro", (e) => res(e.code || e.message));
      c.emit("carregar_personagem", { player: "c2", nomePasta: outro });
    });
    assert.equal(r, "carregado");

    // reconexão da própria aba (o socket antigo ainda existe no servidor) é aceita
    const d = await conectar("c2");
    assert.equal(await pedirCarga(d, "c2", { reconexao: true }), "carregado");
    [a, b, c, d].forEach((x) => x.close());
  });

  it("depois que a aba fecha, o personagem abre de novo (inclusive logo em seguida, como no F5)", async () => {
    const a = await conectar("c2");
    assert.equal(await pedirCarga(a, "c2"), "carregado");
    a.close();
    const b = await conectar("c2"); // sem esperar o servidor notar o fechamento
    assert.equal(await pedirCarga(b, "c2"), "carregado");
    b.close();
  });

  it("ficha: a 2ª aba avisa 'já carregado', volta para a seleção e a 1ª segue normal", async () => {
    const um = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1 });
    const dois = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1, esperarCarga: false });
    await esperarAte(() => /já carregado/.test(toasts(dois)), { ms: 5000, rotulo: "aviso na 2ª aba" });
    assert.equal(dois.carregada(), false, "a 2ª aba não carrega a ficha");
    assert.equal(dois.window.sessionStorage.getItem("rpg_character"), null, "a seleção não reabre o personagem sozinha");
    assert.ok(dois.window.sessionStorage.getItem("rpg_token"), "a sessão (login) continua");

    // a 1ª aba continua carregada e salvando
    assert.equal(um.carregada(), true);
    um.run("alterarModPericia('luta', 1)");
    await um.salvos();
    dois.fechar(); um.fechar();
  });

  it("ficha: ao reconectar, avisa o servidor que é reconexão", async () => {
    const f = await abrirFicha(s, { player: "c1", nomePasta: pastas.c1, token: tokens.c1 });
    f.run("window.__cargas = []; const emitir = socket.emit.bind(socket); socket.emit = (ev, ...a) => { if (ev === 'carregar_personagem') window.__cargas.push(a[0]); return emitir(ev, ...a); }");
    f.run("socket.disconnect()");
    await esperarAte(() => !f.run("socket.connected"), { rotulo: "desconectar" });
    f.run("socket.connect()");
    await esperarAte(() => f.run("window.__cargas.length") === 1, { rotulo: "novo pedido de carga" });
    assert.equal(f.run("window.__cargas[0].reconexao"), true);
    await f.aguardarCarga();
    assert.equal(f.carregada(), true, "a aba que reconectou continua na ficha");
    f.fechar();
  });

  it("Mesa do mestre: cards não esticam, ficha ilegível fecha o card, undefined não aparece", async () => {
    const m = await abrirPaginaMestre(s, "index");
    const doc = m.document;

    assert.match(doc.getElementById("players-cards-container").className, /items-start/);
    assert.equal(m.window.escaparHtml(undefined), "");

    m.disparar("sync_config", { AtivarMana: true });
    m.disparar("sync_all_players", { a: { id: "a", name: "A", vitals: vitais, lastUpdate: "1" }, b: { id: "b", name: "B", vitals: vitais, lastUpdate: "1" } });
    doc.getElementById("master-token-input").value = "errado";
    m.window.alternarFicha("a");
    assert.match(doc.getElementById("players-cards-container").textContent, /Carregando ficha/);
    m.disparar("master_feedback", { success: false, message: "Token/Senha do mestre incorreta!", charId: "a" });
    const cards = doc.getElementById("players-cards-container").textContent;
    assert.doesNotMatch(cards, /Carregando ficha/, "o card não fica preso em 'Carregando'");
    assert.equal((cards.match(/Ver ficha/g) || []).length, 2, "os dois cards voltam a 'Ver ficha'");

    // reconectar sem token no campo não deixa fichas abertas esperando
    m.window.alternarFicha("b");
    doc.getElementById("master-token-input").value = "";
    m.disparar("connect");
    m.disparar("sync_all_players", { a: { id: "a", name: "A", vitals: vitais, lastUpdate: "1" }, b: { id: "b", name: "B", vitals: vitais, lastUpdate: "1" } });
    assert.doesNotMatch(doc.getElementById("players-cards-container").textContent, /Carregando ficha/);
    m.fechar();
  });
});

describe("Simplificações (o comportamento não mudou)", { concurrency: false }, () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const regras = require("../JS/regras.js");
  const { extrairNomeEId, ehIdSeguro } = require("../personagem.js");
  let s, token, pasta;
  const vitais = { hp: { current: 5, max: 10 }, vigor: { current: 3, max: 5 }, sanity: { current: 6, max: 6 } };

  before(async () => {
    s = await iniciarServidor();
    token = (await s.api("/api/login", { nome: "dani", senha: "x", criarSeNaoExistir: true })).token;
    pasta = (await s.api("/api/personagens", { nome: "Rhea" }, token)).personagem.nomePasta;
  });
  after(async () => { await s?.parar(); });

  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth } : {}) });
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };

  it("regras.js compartilhado: custo, carga, escape de HTML e URL de imagem", () => {
    assert.deepEqual(regras.custoDaEntrada({ cost: { vital: "vigor", amount: 3 } }), { texto: "3 Vigor", vital: "vigor", definido: true });
    assert.deepEqual(regras.custoDaEntrada({ cost: { vital: "sanity", amount: 0 } }), { texto: "0 Sanidade", vital: "sanity", definido: true });
    assert.deepEqual(regras.custoDaEntrada({ custo: "2 Vigor" }), { texto: "2 Vigor", vital: "", definido: true });
    assert.deepEqual(regras.custoDaEntrada({ cost: "5" }), { texto: "5", vital: "", definido: true });
    assert.deepEqual(regras.custoDaEntrada({}), { texto: "0", vital: "", definido: false });

    assert.equal(regras.pesoDoItem({ weight: 1.5, quantity: 2 }), 3);
    assert.equal(regras.pesoDoItem({ weight: 2, quantity: "abc" }), 2, "quantidade inválida vale 1");
    assert.equal(regras.calcularCarga([{ weight: 1.5, quantity: 2 }, { weight: 1 }], { weight: 2.5 }), 6.5);
    assert.equal(regras.calcularCarga(undefined, null), 0);

    assert.equal(regras.escaparHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    assert.equal(regras.escaparHtml(undefined), "");

    assert.equal(regras.urlDeImagem(" https://a.com/x.png "), "https://a.com/x.png");
    assert.equal(regras.urlDeImagem("/img/a.png"), "/img/a.png");
    for (const ruim of ["//evil.com/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "ftp://x", "", null, `https://a.com/${"x".repeat(2000)}`]) {
      assert.equal(regras.urlDeImagem(ruim), "", `recusa ${String(ruim).slice(0, 30)}`);
    }
  });

  it("o servidor usa a mesma validação de avatar da ficha", () => {
    const { NORMALIZADORES } = require("../personagem.js");
    const base = { nome: "X", progressao: {} };
    assert.equal(NORMALIZADORES.perfil({ ...base, avatar: "https://a.com/x.png" }).avatar, "https://a.com/x.png");
    assert.equal(NORMALIZADORES.perfil({ ...base, avatar: "javascript:1" }).avatar, "");
  });

  it("ids e nome/id da pasta: um só padrão e um só extrator", () => {
    assert.deepEqual([ehIdSeguro("abc_1-2"), ehIdSeguro(""), ehIdSeguro("a b"), ehIdSeguro(undefined), ehIdSeguro("x".repeat(65))], [true, false, false, false, false]);
    assert.deepEqual(extrairNomeEId("Kael_1234"), { nome: "Kael", id: "1234" });
    assert.deepEqual(extrairNomeEId("Kael_1234_2"), { nome: "Kael", id: "1234" });
    assert.deepEqual(extrairNomeEId("SemId"), { nome: "SemId", id: "" });
  });

  it("login: conta nova, senha errada, senha certa, conta inexistente e pasta sem login.json", async () => {
    assert.equal((await s.api("/api/login", { nome: "fantasma", senha: "x" })).exists, false);

    const criada = await s.api("/api/login", { nome: "nova", senha: "abc", criarSeNaoExistir: true });
    assert.deepEqual([criada.success, criada.message, criada.player], [true, "Conta criada com sucesso!", "nova"]);
    assert.ok(criada.token);

    const errada = await s.api("/api/login", { nome: "nova", senha: "zzz" });
    assert.deepEqual([errada.success, errada.message, errada.token], [false, "Senha incorreta!", undefined]);
    const certa = await s.api("/api/login", { nome: "nova", senha: "abc" });
    assert.deepEqual([certa.success, certa.player], [true, "nova"]);
    assert.ok(certa.token);

    fs.mkdirSync(path.join(s.dir, "players", "semsenha"));
    const cadastro = await s.api("/api/login", { nome: "semsenha", senha: "123" });
    assert.deepEqual([cadastro.success, cadastro.message], [true, "Senha cadastrada com sucesso!"]);
    assert.equal((await s.api("/api/login", { nome: "semsenha", senha: "outra" })).success, false);
    assert.equal((await s.api("/api/login", { nome: "semsenha", senha: "123" })).success, true);

    assert.equal((await s.api("/api/login", { nome: "..", senha: "x" })).status, 400, "nome '..' é recusado");
    // as barras são removidas do nome ("../x" vira "..x"): não sai de players/ e a conta não existe
    const traversal = await s.api("/api/login", { nome: "../x", senha: "x" });
    assert.equal(traversal.exists, false);
    assert.equal(fs.existsSync(path.join(s.dir, "x")), false);
  });

  it("token do mestre: os três comandos recusam com a mesma mensagem (e o charId volta na leitura)", async () => {
    const m = await conectar();
    const feedback = (envio) => new Promise((res) => { m.once("master_feedback", res); envio(); });

    const a = await feedback(() => m.emit("master_adjust_vital", { token: "errado", charId: "x", type: "hp", delta: 1 }));
    const b = await feedback(() => m.emit("master_get_personagem", { token: "errado", charId: "abc" }));
    const c = await feedback(() => m.emit("master_update_config", { token: "errado", config: { AtivarMana: true } }));
    for (const r of [a, b, c]) assert.deepEqual([r.success, r.message], [false, "Token/Senha do mestre incorreta!"]);
    assert.equal(b.charId, "abc");

    // com o token certo a configuração é aceita
    const ok = await feedback(() => m.emit("master_update_config", { token: "senha-teste", config: { AtivarMana: false } }));
    assert.equal(ok.success, true);
    m.close();
  });

  it("nome de pasta: caminhos, pasta vazia e caracteres perigosos são recusados; nomes com u e 0 passam", async () => {
    const sock = await conectar({ token });
    try {
      const pedir = (nomePasta) => new Promise((res) => {
        sock.once("personagem_carregado", () => res("carregado"));
        sock.once("personagem_erro", (e) => res(e.message));
        sock.emit("carregar_personagem", { player: "dani", nomePasta });
      });
      for (const ruim of ["", ".", "..", "../outra", "a/b", "a\\b", "a\u0000b", null, 42]) {
        assert.match(await pedir(ruim), /Sessão inválida/, `recusa ${JSON.stringify(ruim)}`);
      }
      assert.equal(await pedir(pasta), "carregado");

      // salvar com pasta inválida também é recusado
      const erro = await new Promise((res) => {
        sock.once("salvamento_personagem_erro", res);
        sock.emit("salvar_personagem", { player: "dani", nomePasta: "", arquivo: "perfil", dados: {} });
      });
      assert.match(erro.message, /não está aberto/);
    } finally {
      sock.close();
    }

    // nome com 'u' e '0' (letras que já pareceram suspeitas numa regex) funciona de ponta a ponta
    const incomum = (await s.api("/api/personagens", { nome: "Lucas Zulu 0" }, token)).personagem.nomePasta;
    const f = await abrirFicha(s, { player: "dani", nomePasta: incomum, token });
    assert.equal(f.run("STATE.name"), "Lucas Zulu 0");
    f.fechar();
  });

  it("catálogo: entrada sem id (ou com id inválido/repetido) é ignorada", async () => {
    const arq = path.join(s.dir, "catalogo", "habilidades.json");
    fs.writeFileSync(arq, JSON.stringify({ schemaVersion: 1, items: [
      { id: "ok-1", nome: "Boa" },
      { nome: "Sem id" },
      { id: "com espaço", nome: "Id ruim" },
      { id: "ok-1", nome: "Repetida" },
      { id: "", nome: "Vazia" },
      { id: "ok-2", nome: "Outra boa" },
    ] }));
    // o catálogo vive no armazém (memória): arquivo editado à mão vale ao ligar o servidor
    await s.reiniciar();
    token = (await s.api("/api/login", { nome: "dani", senha: "x" })).token;
    const r = await s.api("/api/catalogo/habilidades", null, token);
    assert.deepEqual(r.items.map((i) => i.id), ["ok-1", "ok-2"]);
    assert.equal(r.items.every((i) => i.publico === undefined), true, "controle do mestre não vai para a ficha");
    assert.equal(r.items[0].nome, "Boa", "fica a primeira de cada id");
  });

  it("rolagens: atributo e combo passam pelo mesmo caminho (cartão, histórico, log e mestre)", async () => {
    const f = await abrirFicha(s, { player: "dani", nomePasta: pasta, token });
    const m = await conectar();
    const recebidas = [];
    m.on("dice_rolled", (r) => recebidas.push(r));
    f.run("Math.random = () => 0.5"); // d20 = 11
    // linhas do cartão de resultado, como "Nome: detalhe = soma" (os dois <span> de cada linha)
    const cartao = () => [...f.document.getElementById("result-breakdown").children]
      .map((linha) => `${linha.children[0].textContent} ${linha.children[1].textContent}`).join(" | ");

    // atributo: FOR 10 -> modificador +0 (sem sinal na conta)
    f.run("rolarAtributo('FOR', 'Força')");
    assert.equal(f.document.getElementById("total-result-number").textContent, "11");
    assert.equal(f.document.getElementById("result-summary-text").textContent, "Teste de Força (FOR)");
    assert.equal(cartao(), "Força: 1d20 (11) = 11");
    assert.equal(f.run("STATE.history[0].detalhes"), "Teste de Força (11)", "o histórico mantém o nome 'Teste de ...'");

    // atributo com modificador: FOR 15 -> +2
    f.run("STATE.atributos.FOR = 15; document.querySelector('[data-campo=\"atributos.FOR\"]').value = 15");
    f.run("rolarAtributo('FOR', 'Força')");
    assert.equal(cartao(), "Força: 1d20 (11) +2 = 13");
    assert.equal(f.run("STATE.history[0].total"), 13);

    // combo
    f.run("STATE.combo = []; adicionarAoCombo('Bônus', '+3', 'bonus', 'manual'); adicionarAoCombo('D20', '1d20', 'dice', 'manual'); rolarCombo()");
    assert.equal(f.document.getElementById("total-result-number").textContent, "14");
    assert.equal(f.document.getElementById("result-summary-text").textContent, "2 componentes combinados");
    assert.equal(cartao(), "Bônus: +3 = 3 | D20: 1d20 -> [11] = 11");

    await esperarAte(() => recebidas.length === 3, { rotulo: "mestre receber as 3 rolagens" });
    assert.deepEqual(recebidas.map((r) => r.total), [11, 13, 14]);
    assert.equal(recebidas[1].details, "Teste de Força: 1d20 (11) +2 = 13");
    assert.equal(recebidas[2].details, "Bônus (3) + D20 (11)");
    assert.equal(recebidas[0].character, "Rhea");
    m.close(); f.fechar();
  });

  it("rolarAtributo não interpreta HTML no nome do teste", async () => {
    const f = await abrirFicha(s, { player: "dani", nomePasta: pasta, token });
    f.run("rolarAtributo('FOR', '<img src=x onerror=alert(1)>')");
    assert.equal(f.document.getElementById("result-breakdown").querySelector("img"), null);
    assert.match(f.document.getElementById("result-breakdown").textContent, /<img src=x/);
    f.fechar();
  });

  it("Mesa do mestre: contador usa o limite do script e as funções vêm do regras.js", async () => {
    const painel = fs.readFileSync(path.join(s.dir, "mestre", "JS", "painel.js"), "utf8");
    assert.doesNotMatch(painel, /function escaparHtml|const ROTULO_VITAL/, "sem cópia própria");
    const m = await abrirPaginaMestre(s, "index");
    assert.equal(m.document.getElementById("max-players").textContent, "5");

    m.disparar("sync_config", { AtivarMana: true });
    m.disparar("sync_all_players", { a: { id: "a", name: "A", vitals: vitais, lastUpdate: "1" } });
    m.document.getElementById("master-token-input").value = "t";
    m.window.alternarFicha("a");
    m.disparar("master_personagem", { charId: "a", personagem: {
      inventario: { items: [{ name: "Adaga", weight: 1.5, quantity: 2 }], equipped: { backpack: { name: "Mochila", weight: 2.5 } } },
      habilidades: { items: [{ nome: "Golpe", dice: "2d8", cost: { vital: "vigor", amount: 4 } }, { nome: "Sem custo" }] },
      magias: { items: [] },
    } });
    const texto = m.document.getElementById("players-cards-container").textContent.replace(/\s+/g, " ");
    assert.match(texto, /carga 5\.5/, "1,5 x 2 + mochila 2,5");
    assert.match(texto, /2d8 • custo 4 Vigor/);
    assert.doesNotMatch(texto, /Sem custo[^G]*custo/, "entrada sem custo não mostra 'custo'");
    m.fechar();
  });
});

describe("Segurança leve: donos da ficha, páginas pela URL e consistência", { concurrency: false }, () => {
  const fs = require("node:fs");
  const http = require("node:http");
  const path = require("node:path");
  const { enderecoEhLocal, lerCookie } = require("../acesso.js");
  let s;
  const tokens = {};
  const pastas = {};
  const vitais = { hp: { current: 5, max: 10 }, vigor: { current: 3, max: 5 }, sanity: { current: 6, max: 6 } };
  const arquivo = (conta, pasta, nome) => path.join(s.dir, "players", conta, pasta, `${nome}.json`);

  before(async () => {
    s = await iniciarServidor();
    for (const nome of ["e1", "e2"]) {
      const r = await s.api("/api/login", { nome, senha: "x", criarSeNaoExistir: true });
      tokens[nome] = r.token;
    }
    pastas.a = (await s.api("/api/personagens", { nome: "Alfa" }, tokens.e1)).personagem.nomePasta;
    pastas.b = (await s.api("/api/personagens", { nome: "Beta" }, tokens.e1)).personagem.nomePasta;
    pastas.c = (await s.api("/api/personagens", { nome: "Gama" }, tokens.e2)).personagem.nomePasta;
    // páginas de login/seleção de mentira (o projeto real tem as suas em login/)
    fs.mkdirSync(path.join(s.dir, "login"));
    fs.writeFileSync(path.join(s.dir, "login", "entrar.html"), "<h1>entrar</h1>");
    fs.writeFileSync(path.join(s.dir, "login", "login.html"), "<h1>selecao</h1>");
  });
  after(async () => { await s?.parar(); });

  const conectar = async (conta) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(conta ? { auth: { token: tokens[conta] } } : {}) });
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const carregar = (sock, player, nomePasta, extra = {}) => new Promise((res) => {
    sock.once("personagem_carregado", () => res("carregado"));
    sock.once("personagem_erro", (e) => res(e.code || e.message));
    sock.emit("carregar_personagem", { player, nomePasta, ...extra });
  });
  const salvar = (sock, player, nomePasta, nome, dados) => new Promise((res) => {
    sock.once("personagem_salvo", () => res("salvo"));
    sock.once("salvamento_personagem_erro", (e) => res(e.message));
    sock.emit("salvar_personagem", { player, nomePasta, arquivo: nome, dados });
  });
  const aberto = async (conta, pasta) => {
    const sock = await conectar(conta);
    assert.equal(await carregar(sock, conta, pasta), "carregado");
    return sock;
  };
  // GET cru (sem o fetch "arrumar" o caminho); `de` = endereço de origem da conexão.
  const pedir = (caminho, { de, cookie } = {}) => new Promise((res, rej) => {
    const req = http.request({ host: "127.0.0.1", port: s.porta, path: caminho, method: "GET", localAddress: de, headers: cookie ? { Cookie: cookie } : {} }, (r) => {
      let corpo = ""; r.on("data", (d) => (corpo += d)); r.on("end", () => res({ status: r.statusCode, local: r.headers.location, corpo, cookie: r.headers["set-cookie"]?.[0] }));
    });
    req.on("error", rej); req.end();
  });

  // ---------------------------------- 1. donos da ficha ----------------------------------
  it("ninguém abre nem grava na ficha de outro jogador", async () => {
    const e1 = await conectar("e1");
    try {
      const antes = fs.readFileSync(arquivo("e2", pastas.c, "perfil"), "utf8");
      assert.match(await carregar(e1, "e2", pastas.c), /Sessão inválida/, "não abre ficha de outra conta");
      assert.match(await carregar(e1, "e1", `../../e2/${pastas.c}`), /Sessão inválida/, "caminho para outra conta é recusado");
      const msg = await salvar(e1, "e2", pastas.c, "perfil", { nome: "Invadido" });
      assert.match(msg, /não está aberto/);
      assert.equal(fs.readFileSync(arquivo("e2", pastas.c, "perfil"), "utf8"), antes, "arquivo do outro jogador intacto");
    } finally { e1.close(); }
  });

  it("grava só no personagem que esta aba abriu (nem em outro da mesma conta)", async () => {
    const sock = await aberto("e1", pastas.a);
    try {
      const antesB = fs.readFileSync(arquivo("e1", pastas.b, "perfil"), "utf8");
      assert.match(await salvar(sock, "e1", pastas.b, "perfil", { nome: "Trocado" }), /não está aberto/);
      assert.equal(fs.readFileSync(arquivo("e1", pastas.b, "perfil"), "utf8"), antesB);
      assert.equal(await salvar(sock, "e1", pastas.a, "biografia", { history: "ok", scars: "", notes: "" }), "salvo", "no aberto grava normalmente");
    } finally { sock.close(); }
  });

  it("a aba recusada por 'já carregado' também não consegue gravar", async () => {
    const primeira = await aberto("e1", pastas.a);
    const segunda = await conectar("e1");
    try {
      assert.equal(await carregar(segunda, "e1", pastas.a), "ja_carregado");
      const antes = fs.readFileSync(arquivo("e1", pastas.a, "biografia"), "utf8");
      assert.match(await salvar(segunda, "e1", pastas.a, "biografia", { history: "intruso", scars: "", notes: "" }), /não está aberto/);
      assert.equal(fs.readFileSync(arquivo("e1", pastas.a, "biografia"), "utf8"), antes);
    } finally { primeira.close(); segunda.close(); }
  });

  it("rolagem: quem rola é o personagem aberto (o nome vem do servidor), com id sem duplicar", async () => {
    const m = await conectar();
    const feed = [];
    m.on("dice_rolled", (r) => feed.push(r));
    const sock = await aberto("e1", pastas.a);
    const bare = await conectar("e1"); // sem personagem aberto
    try {
      const enviar = (sk, dados) => new Promise((res) => sk.emit("dice_roll", dados, res));
      assert.equal(await enviar(bare, { total: 10, details: "x", rid: "r_bare" }), false, "sem personagem aberto não rola");
      assert.equal(await enviar(sock, { total: "abc", details: "x" }), false);
      assert.equal(await enviar(sock, { total: 10 ** 9, details: "x" }), false);

      const dados = { total: 17, details: "1d20 (17)", rid: "rolagem_unica_1", character: "Outro Jogador" };
      assert.equal(await enviar(sock, dados), true);
      assert.equal(await enviar(sock, dados), true, "o reenvio também é confirmado");
      await esperar(300);
      assert.equal(feed.length, 1, "chega uma vez só");
      assert.equal(feed[0].character, "Alfa", "o nome não pode ser escolhido pelo cliente");
      assert.equal(feed[0].total, 17);
      assert.ok(Math.abs(feed[0].quando - Date.now()) < 5000);
    } finally { sock.close(); bare.close(); m.close(); }
  });

  it("o card do mestre usa nome e vida salvos no servidor, não o que o cliente diz", async () => {
    const m = await conectar();
    const cards = [];
    m.on("player_updated", (p) => cards.push(p));
    const sock = await aberto("e1", pastas.a);
    try {
      sock.emit("player_update", { id: "card_s", name: "Super Herói", vitals: { hp: { current: 999, max: 999 }, vigor: { current: 9, max: 9 }, sanity: { current: 9, max: 9 } } });
      await esperarAte(() => cards.length > 0, { rotulo: "card" });
      assert.equal(cards.at(-1).name, "Alfa");
      assert.deepEqual(cards.at(-1).vitals.hp, { current: 0, max: 0 }, "vida = status.json (personagem novo: 0/0)");

      // ao salvar a vida / o nome, o card acompanha o que o servidor guardou
      assert.equal(await salvar(sock, "e1", pastas.a, "status", vitais), "salvo");
      await esperarAte(() => cards.at(-1).vitals.hp.max === 10, { rotulo: "card com a vida salva" });
      assert.deepEqual(cards.at(-1).vitals.hp, { current: 5, max: 10 });
      assert.equal(await salvar(sock, "e1", pastas.a, "perfil", { nome: "Alfa Renomeado", progressao: {} }), "salvo");
      await esperarAte(() => cards.at(-1).name === "Alfa Renomeado", { rotulo: "card com o nome salvo" });
    } finally { sock.close(); m.close(); }
  });

  // --------------------------------- 2. páginas pela URL ---------------------------------
  it("arquivos do servidor, dados dos jogadores e testes não ficam acessíveis pela URL", async () => {
    const alvos = ["/server.js", "/personagem.js", "/acesso.js", "/package.json", "/config.json", "/players/e1/login.json",
      `/players/e1/${pastas.a}/perfil.json`, "/catalogo/habilidades.json", "/testes/integracao.test.js", "/node_modules/express/package.json",
      "/JS/../server.js", "/JS/..%2fserver.js", "/JS/%2e%2e/server.js", "/CSS/../players/e1/login.json", "/index.js", "/regras.js"];
    for (const alvo of alvos) {
      const r = await pedir(alvo);
      assert.notEqual(r.status, 200, `${alvo} não pode abrir (deu ${r.status})`);
      assert.doesNotMatch(r.corpo, /SENHA_MESTRE|"senha"|express\(\)/, `${alvo} não vaza conteúdo`);
    }
    assert.equal((await pedir("/JS/regras.js")).status, 200, "os scripts da página continuam servidos");
  });

  it("o painel do mestre (todas as páginas, scripts e estilos) só abre na máquina do servidor ou com a chave", async (t) => {
    const paginas = ["/mestre", "/mestre/", "/mestre/rolagem", "/mestre/inimigos", "/mestre/npc", "/mestre/loot", "/mestre/habilidades-magias"];
    const arquivos = ["/mestre/JS/comum.js", "/mestre/JS/painel.js", "/mestre/JS/tailwind-config.js", "/mestre/CSS/mestre.css", "/mestre/rolagem.html"];

    for (const alvo of [...paginas, ...arquivos]) assert.equal((await pedir(alvo)).status, 200, `${alvo}: a máquina do mestre abre`);
    const legado = await pedir("/mestre.html");
    assert.deepEqual([legado.status, legado.local], [302, "/mestre"], "o endereço antigo leva ao painel novo");
    assert.equal((await pedir("/mestre/nao-existe")).status, 404);
    const fuga = await pedir("/mestre/JS/..%2f..%2fserver.js");
    assert.notEqual(fuga.status, 200, "não sai da pasta mestre/");
    assert.doesNotMatch(fuga.corpo, /SENHA_MESTRE/);

    let remoto;
    try { remoto = await pedir("/mestre", { de: "127.0.0.2" }); } catch { return t.skip("este sistema não permite usar 127.0.0.2 como origem"); }
    assert.equal(remoto.status, 403, "outro endereço sem chave: bloqueado");
    assert.match(remoto.corpo, /restrita ao Mestre/);
    for (const alvo of [...paginas, ...arquivos, "/mestre.html"]) {
      assert.equal((await pedir(alvo, { de: "127.0.0.2" })).status, 403, `${alvo} bloqueado`);
    }
    for (const caminho of ["/mestre?chave=errada", "/mestre?chave=senha-teste&chave=outra", "/mestre?chave[]=senha-teste", "/mestre?chave=", "/mestre/rolagem?chave=errada"]) {
      assert.equal((await pedir(caminho, { de: "127.0.0.2" })).status, 403, `${caminho} bloqueado`);
    }

    // com a chave certa abre e entrega um cookie: dá para navegar e carregar os arquivos sem repetir ?chave=
    const entrada = await pedir("/mestre/rolagem?chave=senha-teste", { de: "127.0.0.2" });
    assert.equal(entrada.status, 200, "com a chave certa abre");
    assert.match(entrada.cookie, /^rpg_mestre=[\w-]+; Path=\/mestre; HttpOnly/);
    const cookie = entrada.cookie.split(";")[0];
    for (const alvo of [...paginas, ...arquivos]) {
      assert.equal((await pedir(alvo, { de: "127.0.0.2", cookie })).status, 200, `${alvo} abre com o cookie`);
    }
    assert.equal((await pedir("/mestre", { de: "127.0.0.2", cookie: "rpg_mestre=inventado" })).status, 403, "cookie inventado não vale");
    assert.equal((await pedir("/mestre", { de: "127.0.0.2", cookie: "rpg_sessao=qualquer" })).status, 403, "o cookie de jogador não vale");
    assert.equal((await pedir("/mestre", { de: "127.0.0.2" })).cookie, undefined, "sem chave não ganha cookie");
  });

  it("ficha e seleção exigem login; a tela de login é pública", async () => {
    const entrar = await fetch(`${s.url}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "e1", senha: "x" }) });
    const cookie = entrar.headers.get("set-cookie").split(";")[0];
    assert.match(cookie, /^rpg_sessao=/);
    assert.match(entrar.headers.get("set-cookie"), /HttpOnly/);

    for (const pagina of ["/", "/index.html", "/selecao"]) {
      const sem = await pedir(pagina);
      assert.deepEqual([sem.status, sem.local], [302, "/login"], `${pagina} sem login volta para /login`);
      const falso = await pedir(pagina, { cookie: "rpg_sessao=nao-existe" });
      assert.deepEqual([falso.status, falso.local], [302, "/login"], `${pagina} com cookie inventado volta para /login`);
      assert.equal((await pedir(pagina, { cookie })).status, 200, `${pagina} com login abre`);
    }
    const login = await pedir("/login");
    assert.equal(login.status, 200);
    assert.match(login.corpo, /entrar/);
  });

  it("acesso.js: endereço local (inclusive o IP da rede da própria máquina) e leitura de cookie", () => {
    assert.equal(enderecoEhLocal("127.0.0.1"), true);
    assert.equal(enderecoEhLocal("::1"), true);
    assert.equal(enderecoEhLocal("::ffff:127.0.0.1"), true);
    assert.equal(enderecoEhLocal("192.168.0.50"), false, "outro computador da rede");
    assert.equal(enderecoEhLocal("192.168.0.50", ["10.0.0.2", "192.168.0.50"]), true, "o mestre abrindo pelo IP da rede da própria máquina");
    assert.equal(enderecoEhLocal("::ffff:192.168.0.50", ["192.168.0.50"]), true);
    assert.equal(enderecoEhLocal("", []), false);
    assert.equal(enderecoEhLocal(undefined, []), false);

    assert.equal(lerCookie("a=1; rpg_sessao=abc-123; b=2", "rpg_sessao"), "abc-123");
    assert.equal(lerCookie("xrpg_sessao=zzz", "rpg_sessao"), "", "não confunde nomes parecidos");
    assert.equal(lerCookie("", "rpg_sessao"), "");
    assert.equal(lerCookie(undefined, "rpg_sessao"), "");
    assert.equal(lerCookie("rpg_sessao=%E0%A4%A", "rpg_sessao"), "", "valor quebrado não derruba o servidor");
  });

  // ------------------------- 3. servidor e ficha sempre iguais -------------------------
  it("vida: se a ficha local tiver valor fora do permitido, ela adota o do servidor", async () => {
    const f = await abrirFicha(s, { player: "e1", nomePasta: pastas.b, token: tokens.e1 });
    f.run("definirMaximoVital('hp', 10)");
    await f.salvos();
    f.run("STATE.vitals.hp.current = 99999999; salvarStatus()"); // acima do máximo: o servidor corta
    await esperarAte(() => f.run("STATE.vitals.hp.current") === 10, { rotulo: "ficha adotar a vida do servidor" });
    await f.salvos();
    assert.deepEqual(JSON.parse(fs.readFileSync(arquivo("e1", pastas.b, "status"), "utf8")).hp, { current: 10, max: 10 });
    assert.match(f.document.getElementById("toast-container").textContent, /servidor ajustou/);
    f.fechar();
  });

  it("mochila: quantidade fora do permitido e item sem uid voltam corrigidos pelo servidor", async () => {
    const f = await abrirFicha(s, { player: "e1", nomePasta: pastas.b, token: tokens.e1 });
    f.run("STATE.backpackItems.push({ id: 'pedra', name: 'Pedra', w: 1, h: 1, col: 1, row: 1, weight: 1, quantity: 5000, maxStack: 1 })");
    f.run("marcarAlterado('inventario', { imediato: true })");
    await esperarAte(() => f.run("STATE.backpackItems.length === 1 && STATE.backpackItems[0].quantity") === 1, { rotulo: "quantidade corrigida" });
    assert.match(f.run("STATE.backpackItems[0].uid"), /^[A-Za-z0-9_-]{4,64}$/, "o item ganhou o uid do servidor");
    await f.salvos();
    const disco = JSON.parse(fs.readFileSync(arquivo("e1", pastas.b, "inventario"), "utf8"));
    assert.equal(disco.items[0].quantity, 1);
    assert.equal(disco.items[0].uid, f.run("STATE.backpackItems[0].uid"), "mesmo uid no disco e na ficha");
    f.fechar();
  });

  it("uso normal não dispara correção: vida e mochila continuam sem recarregar o personagem", async () => {
    const f = await abrirFicha(s, { player: "e1", nomePasta: pastas.b, token: tokens.e1 });
    f.run("window.__cargas = 0; const emitir = socket.emit.bind(socket); socket.emit = (ev, ...a) => { if (ev === 'carregar_personagem') window.__cargas++; return emitir(ev, ...a); }");
    f.run("STATE.backpackItems = []; marcarAlterado('inventario', { imediato: true })");
    await f.salvos();
    f.run("definirMaximoVital('hp', 30); alterarVital('hp', -7); alterarVital('hp', 3); alterarVital('sanity', 0)");
    f.run(`adicionarItemAoInventario(${JSON.stringify({ id: "adaga", name: "Adaga", type: "Arma", weight: 1, w: 1, h: 1, maxStack: 1 })}, 2)`);
    f.run(`adicionarItemAoInventario(${JSON.stringify({ id: "pocao", name: "Poção", type: "Consumível", weight: 0.5, w: 1, h: 1, maxStack: 5 })}, 7)`);
    f.run("itemPopoverAtual = STATE.backpackItems.find((i) => i.id === 'adaga'); equiparItemAtual('mainHand')");
    f.run("itemPopoverAtual = STATE.backpackItems.find((i) => i.id === 'adaga'); descartarItemAtual()");
    await f.salvos();
    await esperar(400);
    assert.equal(f.run("window.__cargas"), 0, "nenhuma correção do servidor foi necessária");
    f.fechar();
  });

  it("página lenta: a conexão termina antes de a ficha iniciar e ela carrega mesmo assim", async () => {
    // Reproduz o "Carregando ficha…" infinito: o socket conecta durante o carregamento dos scripts,
    // antes do DOMContentLoaded, e o evento 'connect' passava sem ninguém ouvir.
    const f = await abrirFicha(s, { player: "e1", nomePasta: pastas.b, token: tokens.e1, atrasarInicio: 400 });
    assert.equal(f.carregada(), true);
    assert.doesNotMatch(f.document.getElementById("estado-ficha").textContent, /Carregando/);
    f.fechar();
  });

  it("erro ao montar a tela não impede a ficha de conectar e carregar, e o erro aparece no topo", async () => {
    const f = await abrirFicha(s, {
      player: "e1", nomePasta: pastas.b, token: tokens.e1, atrasarInicio: 50,
      antesDoInicio: (rodar) => rodar("iniciarFichaBasica = () => { throw new Error('falha de teste'); }"),
    });
    assert.equal(f.carregada(), true, "conectou e carregou mesmo com a tela falhando");
    const faixa = f.document.getElementById("estado-ficha").textContent;
    assert.match(faixa, /Erro ao iniciar a ficha: falha de teste/);
    assert.match(faixa, /F12/);
    f.fechar();
  });

  it("se a inicialização (index.js) não rodar, em 6 s a faixa diz isso em vez de ficar 'Conectando…'", async () => {
    const f = await abrirFicha(s, { player: "e1", nomePasta: pastas.b, token: tokens.e1, esperarCarga: false, omitirScripts: ["JS/index.js"] });
    const faixa = () => f.document.getElementById("estado-ficha").textContent;
    await esperar(1000);
    assert.match(faixa(), /Conectando/, "no início ainda é só 'Conectando'");
    await esperarAte(() => /A ficha não iniciou/.test(faixa()), { ms: 9000, rotulo: "aviso de que a ficha não iniciou" });
    assert.match(faixa(), /Ctrl\+F5/);
    assert.equal(f.carregada(), false);
    f.fechar();
  });

  it("rolagem feita sem conexão fica na fila e chega ao mestre (uma vez, com a hora real) ao reconectar", async () => {
    const m = await conectar();
    const feed = [];
    m.on("dice_rolled", (r) => feed.push(r));
    const f = await abrirFicha(s, { player: "e1", nomePasta: pastas.b, token: tokens.e1 });
    f.run("Math.random = () => 0.5");
    f.run("socket.disconnect()");
    await esperarAte(() => !f.run("socket.connected"), { rotulo: "desconectar" });

    const rolouEm = Date.now();
    f.run("rolarAtributo('FOR', 'Força')");
    f.run("STATE.combo = []; adicionarAoCombo('D20', '1d20', 'dice', 'manual'); rolarCombo()");
    assert.equal(f.run("rolagensPendentes.length"), 2, "duas rolagens esperando");
    assert.equal(f.run("STATE.history.length"), 2, "a ficha local já tem as duas no histórico");
    await esperar(300);
    assert.equal(feed.length, 0, "o mestre ainda não viu nada");

    await esperar(500);
    f.run("socket.connect()");
    await esperarAte(() => feed.length === 2, { rotulo: "mestre receber as rolagens guardadas" });
    await esperarAte(() => f.run("rolagensPendentes.length") === 0, { rotulo: "fila esvaziar" });
    const totaisDaFicha = JSON.parse(f.run("JSON.stringify(STATE.history.map((h) => h.total))")).reverse(); // do mais antigo ao mais novo
    assert.deepEqual(feed.map((r) => r.total), totaisDaFicha, "o mestre recebeu os mesmos totais, na mesma ordem");
    assert.deepEqual(totaisDaFicha, [11, 11]);
    for (const r of feed) {
      assert.equal(r.character, "Beta");
      assert.ok(r.quando >= rolouEm - 50 && r.quando < rolouEm + 400, "a hora é a de quando rolou, não a da reconexão");
    }
    await esperar(300);
    assert.equal(feed.length, 2, "sem duplicar");
    f.fechar(); m.close();
  });
});

describe("Painel do mestre em páginas (Mesa pronta, demais preparadas)", { concurrency: false }, () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ROTAS = {
    index: "/mestre", rolagem: "/mestre/rolagem", inimigos: "/mestre/inimigos",
    npc: "/mestre/npc", loot: "/mestre/loot", "habilidades-magias": "/mestre/habilidades-magias",
  };
  const PREPARADAS = [];
  // Páginas com script próprio (cada sprint da Fase 2 move uma página da lista acima para cá).
  const COM_SCRIPT = ["habilidades-magias", "loot", "npc", "inimigos", "rolagem"];
  // Únicos scripts que as páginas preparadas podem carregar (infraestrutura comum, sem lógica própria).
  const PERMITIDOS = ["https://cdn.tailwindcss.com", "/mestre/JS/tailwind-config.js", "/socket.io/socket.io.js", "/JS/regras.js", "/mestre/JS/comum.js"];
  let s, token, pasta;

  before(async () => {
    s = await iniciarServidor();
    token = (await s.api("/api/login", { nome: "mest", senha: "x", criarSeNaoExistir: true })).token;
    pasta = (await s.api("/api/personagens", { nome: "Lyra" }, token)).personagem.nomePasta;
  });
  after(async () => { await s?.parar(); });

  const baixar = async (caminho) => { const r = await fetch(`${s.url}${caminho}`); return { status: r.status, tipo: r.headers.get("content-type") || "", corpo: await r.text() }; };
  const arquivoDaPagina = (id) => fs.readFileSync(path.join(s.dir, "mestre", `${id}.html`), "utf8");
  const srcs = (html, tag, atributo) => [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(new RegExp(`<${tag}[^>]*?${atributo}="([^"]+)"`, "g"))].map((m) => m[1]);

  it("as seis páginas abrem e cada uma sabe quem ela é", async () => {
    for (const [id, rota] of Object.entries(ROTAS)) {
      const r = await baixar(rota);
      assert.equal(r.status, 200, rota);
      assert.match(r.tipo, /text\/html/);
      assert.match(r.corpo, new RegExp(`<header id="mestre-cabecalho" data-pagina="${id}">`), `${rota} declara a sua página`);
    }
  });

  it("toda página só referencia arquivos que existem, e as cinco preparadas não têm script próprio", async () => {
    for (const id of Object.keys(ROTAS)) {
      const html = arquivoDaPagina(id);
      for (const ref of [...srcs(html, "script", "src"), ...srcs(html, "link", "href")].filter((r) => r.startsWith("/"))) {
        assert.equal((await baixar(ref)).status, 200, `${id}: ${ref} existe`);
      }
    }
    for (const id of PREPARADAS) {
      const html = arquivoDaPagina(id);
      assert.deepEqual(srcs(html, "script", "src"), PERMITIDOS, `${id}: só a infraestrutura comum`);
      assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ""), /<script(?![^>]*\bsrc=)/, `${id}: sem script inline`);
      assert.doesNotMatch(html, /onclick=/, `${id}: sem botões falsos`);
      assert.match(html, new RegExp(`<!-- Script desta página \\(a fazer.*mestre/JS/${id}\\.js`), `${id}: deixa indicado onde entra o script`);
      assert.equal(fs.existsSync(path.join(s.dir, "mestre", "JS", `${id}.js`)), false, `${id}: o script ainda não existe`);
      assert.match(html, /Em\s+construção/);
      assert.match(html, new RegExp(`id="${id.replace("habilidades-magias", "habmag")}-`), `${id}: tem as zonas do esqueleto`);
    }
    assert.ok(srcs(arquivoDaPagina("index"), "script", "src").includes("/mestre/JS/painel.js"), "a Mesa carrega o seu script");
    for (const id of COM_SCRIPT) {
      assert.deepEqual(srcs(arquivoDaPagina(id), "script", "src").slice(-2), ["/mestre/JS/comum.js", `/mestre/JS/${id}.js`], `${id}: comum.js e depois o seu script`);
    }
  });

  it("menu: as seis páginas aparecem, a atual fica marcada e as que não existem ainda dizem 'em breve'", async () => {
    for (const id of Object.keys(ROTAS)) {
      const m = await abrirPaginaMestre(s, id);
      try {
        const links = [...m.document.querySelectorAll("nav a[data-pagina-link]")];
        assert.deepEqual(links.map((a) => a.getAttribute("href")), Object.values(ROTAS), `${id}: links na ordem`);
        const ativos = links.filter((a) => a.getAttribute("aria-current") === "page");
        assert.deepEqual(ativos.map((a) => a.dataset.paginaLink), [id], `${id}: só ela está marcada`);
        const emBreve = links.filter((a) => /em breve/i.test(a.textContent)).map((a) => a.dataset.paginaLink);
        assert.deepEqual(emBreve, PREPARADAS, `${id}: 'em breve' nas preparadas`);
        assert.equal(m.falso.conexoes, 1, `${id}: conecta uma vez, no fim da inicialização`);
        assert.deepEqual(m.erros, [], `${id}: sem erros de script`);
      } finally { m.fechar(); }
    }
  });

  it("indicador de conexão e token: o token digitado vale para as outras páginas da aba", async () => {
    const a = await abrirPaginaMestre(s, "rolagem");
    try {
      const status = () => a.document.getElementById("connection-status").textContent.trim();
      assert.equal(status(), "Conectando…");
      a.disparar("connect");
      assert.equal(status(), "Servidor Online");
      a.disparar("disconnect");
      assert.equal(status(), "Desconectado");

      const campo = a.document.getElementById("master-token-input");
      assert.equal(campo.value, "");
      campo.value = " senha-teste ";
      campo.dispatchEvent(new a.window.Event("input"));
      assert.equal(a.run("tokenDoMestre()"), "senha-teste", "o token vem do campo, sem espaços");
      assert.equal(a.window.sessionStorage.getItem("rpg_mestre_token"), "senha-teste");
    } finally { a.fechar(); }

    const b = await abrirPaginaMestre(s, "loot", { tokenInicial: "senha-teste" });
    assert.equal(b.document.getElementById("master-token-input").value, "senha-teste", "a outra página já abre com o token");
    b.fechar();
  });

  it("Mesa de verdade (servidor real): jogador aparece, vida ajustada pelo mestre chega à ficha, rolagem cai no feed", async () => {
    const f = await abrirFicha(s, { player: "mest", nomePasta: pasta, token });
    f.run("Math.random = () => 0.5");
    f.run("definirMaximoVital('hp', 10)");
    await f.salvos();
    const m = await abrirPaginaMestre(s, "index", { real: true, tokenInicial: "senha-teste" });
    try {
      const cards = () => m.document.getElementById("players-cards-container").textContent.replace(/\s+/g, " ");
      await esperarAte(() => /Lyra/.test(cards()) && /10\/10/.test(cards()), { rotulo: "card do jogador com a vida" });
      assert.equal(m.document.getElementById("connected-count").textContent, "1");
      assert.equal(m.document.getElementById("connection-status").textContent.trim(), "Servidor Online");

      // ajuste do mestre: servidor grava, ficha e card ficam iguais
      const charId = f.run("STATE.id");
      m.window.ajustarVital(charId, "hp", -3);
      await esperarAte(() => f.run("STATE.vitals.hp.current") === 7, { rotulo: "ficha receber o ajuste" });
      await esperarAte(() => /7\/10/.test(cards()), { rotulo: "card do mestre mostrar 7/10" });
      await f.salvos();
      assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "players", "mest", pasta, "status.json"), "utf8")).hp.current, 7);

      // rolagem do jogador no feed
      f.run("rolarAtributo('FOR', 'Força')");
      await esperarAte(() => /Força/.test(m.document.getElementById("rolls-feed-container").textContent), { rotulo: "rolagem no feed" });
      assert.match(m.document.getElementById("rolls-feed-container").textContent, /Lyra[\s\S]*= 11/);

      // ficha completa, somente leitura
      m.window.alternarFicha(charId);
      await esperarAte(() => /Atributos/.test(cards()), { rotulo: "ficha expandida" });
      assert.deepEqual(m.erros, []);
    } finally { m.fechar(); f.fechar(); }
  });
});

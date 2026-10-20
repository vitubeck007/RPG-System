/* Sprint 4 (Fase 2): NPCs (mini lore, status básicos, segredo do mestre) e a página NPCs. */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io: clienteIo } = require("socket.io-client");
const { criarCampanha, normalizarNpc, LIMITE_DE_ITENS } = require("../campanha.js");
const { iniciarServidor, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const SEGREDO = "SEGREDO-NPC-4471";
const mudo = { log() {}, warn() {}, error() {} };
const pastas = [];
const novaPasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-teste-npc-"));
  pastas.push(d);
  return d;
};
after(() => pastas.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("Modelo do NPC (armazém)", () => {
  it("limites: nome, papel, lore 4000, segredo 2000, notas 2000; atributos opcionais; retrato validado", () => {
    const n = normalizarNpc({
      nome: "  Brenna  ", papel: "p".repeat(200), lore: "l".repeat(5000), segredo: "s".repeat(3000), notas: "n".repeat(3000),
      retrato: "javascript:alert(1)", atributos: { FOR: "12", DES: "", INT: "abc", SAB: -4, PRE: 5000, VON: null, XXX: 9 }, hp: { atual: 50, max: 20 },
    });
    assert.equal(n.nome, "Brenna");
    assert.equal(n.papel.length, 80);
    assert.equal(n.lore.length, 4000);
    assert.equal(n.segredo.length, 2000);
    assert.equal(n.notas.length, 2000);
    assert.equal(n.retrato, "");
    assert.deepEqual(n.atributos, { FOR: 12, SAB: 0, PRE: 999 });
    assert.deepEqual(n.hp, { atual: 20, max: 20 });
    assert.equal(normalizarNpc({ nome: "x", retrato: "https://ex.com/a.png" }).retrato, "https://ex.com/a.png");
    assert.equal(normalizarNpc({ nome: "x", retrato: "/JS/a.png" }).retrato, "/JS/a.png");
    assert.equal(normalizarNpc({ nome: "x", retrato: "//evil.com/a.png" }).retrato, "");
    assert.equal(normalizarNpc({ nome: "   " }).nome, "NPC", "nome vazio vira 'NPC'");
  });

  it("reduzir o HP máximo corta o atual; HP máximo 0 é aceito", () => {
    assert.deepEqual(normalizarNpc({ nome: "x", hp: { atual: 30, max: 10 } }).hp, { atual: 10, max: 10 });
    assert.deepEqual(normalizarNpc({ nome: "x", hp: { atual: 5, max: 0 } }).hp, { atual: 0, max: 0 });
    assert.deepEqual(normalizarNpc({ nome: "x" }).hp, { atual: 10, max: 10 });
  });

  it("limite de 500 NPCs e persistência", async () => {
    const dir = novaPasta();
    const c = criarCampanha(dir, { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    await c.atualizar("npcs", (lista) => { for (let i = 0; i < LIMITE_DE_ITENS.npcs; i++) lista.push({ nome: `N${i}` }); });
    assert.equal(c.ler("npcs").length, 500);
    await assert.rejects(() => c.salvarItem("npcs", { nome: "501" }), { codigo: "limite_atingido" });
    const outra = criarCampanha(dir, { log: mudo, pastaCatalogo: novaPasta() }).iniciar();
    assert.equal(outra.ler("npcs").length, 500);
  });
});

describe("NPCs com o servidor real", { concurrency: false }, () => {
  let s, ana;
  const abertos = [];
  const paginas = [];
  let contador = 0;

  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_n${++contador}`, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  const salvar = async (m, item) => (await cmd(m, "master_campanha_salvar", { tipo: "npcs", item })).dados;
  const listar = async (m) => (await pedir(m, "master_campanha_ler", { token: SENHA, tipo: "npcs" })).dados;

  afterEach(async () => {
    paginas.splice(0).forEach((p) => p.fechar());
    abertos.splice(0).forEach((k) => k.close());
    await esperar(200);
  });
  before(async () => {
    s = await iniciarServidor();
    const token = (await s.api("/api/login", { nome: "ana", senha: "x", criarSeNaoExistir: true })).token;
    const pasta = (await s.api("/api/personagens", { nome: "Ana" }, token)).personagem.nomePasta;
    ana = { token, pasta };
  });
  after(async () => { await s?.parar(); });

  it("CRUD pela rede: cria, lê, edita (mesmo id), duplica e remove; dado hostil é limpo", async () => {
    const m = await mestre();
    const a = await salvar(m, { nome: "Brenna", papel: "Ferreira", lore: "Forja desde criança.", segredo: SEGREDO, hp: { atual: 8, max: 12 }, atributos: { FOR: 14 }, retrato: "https://ex.com/b.png" });
    assert.match(a.id, /^npc_/);
    assert.deepEqual([a.hp, a.atributos, a.segredo], [{ atual: 8, max: 12 }, { FOR: 14 }, SEGREDO]);
    const b = await salvar(m, { ...a, nome: "Brenna Ferro", hp: { atual: 3, max: 12 } });
    assert.equal(b.id, a.id);
    assert.equal(b.criadoEm, a.criadoEm);
    assert.equal((await listar(m)).filter((n) => n.id === a.id).length, 1);
    const hostil = await salvar(m, { nome: "<img src=x onerror=alert(1)>", retrato: "javascript:alert(1)", lore: "x".repeat(900), __proto__: { admin: 1 }, hp: { atual: "abc", max: 99999999 } });
    assert.equal(hostil.retrato, "");
    assert.equal(hostil.lore.length, 900);
    assert.equal(hostil.admin, undefined);
    assert.ok(hostil.hp.max <= 100000);
    const r = await cmd(m, "master_campanha_remover", { tipo: "npcs", id: a.id });
    assert.deepEqual(r, { ok: true, dados: { removido: true } });
    assert.ok(!(await listar(m)).some((n) => n.id === a.id));
  });

  it("jogador e anônimo não leem nem gravam NPCs (todo tipo de token forjado)", async () => {
    const m = await mestre();
    const npc = await salvar(m, { nome: "Reservado", segredo: SEGREDO });
    for (const sock of [await conectar(ana.token), await conectar()]) {
      for (const token of [undefined, "", "errado", ana.token]) {
        for (const [evento, dados] of [
          ["master_campanha_ler", { tipo: "npcs" }],
          ["master_campanha_ler", {}],
          ["master_campanha_salvar", { tipo: "npcs", item: { nome: "Hack" }, acaoId: "acao_h1" }],
          ["master_campanha_remover", { tipo: "npcs", id: npc.id, acaoId: "acao_h2" }],
        ]) {
          const r = await pedir(sock, evento, { ...dados, token });
          assert.equal(r.erro, "nao_autorizado", `${evento} ${token}`);
          assert.equal(r.dados, undefined);
        }
      }
    }
    const lista = await listar(m);
    assert.ok(lista.some((n) => n.id === npc.id));
    assert.ok(!lista.some((n) => n.nome === "Hack"));
  });

  it("VAZAMENTO: o jogador, com a ficha aberta, nunca recebe NPC nem segredo", async () => {
    const m = await mestre();
    const j = await conectar(ana.token);
    const vistos = [];
    j.onAny((ev, ...a) => vistos.push([ev, a]));
    await new Promise((res) => { j.once("personagem_carregado", res); j.emit("carregar_personagem", { player: "ana", nomePasta: ana.pasta }); });
    j.emit("entregas_pedir");
    const n = await salvar(m, { nome: "Nome-Oculto-NPC4471", lore: "lore-oculta-4471", segredo: SEGREDO });
    await salvar(m, { ...n, notas: "mudou-4471" });
    await cmd(m, "master_campanha_remover", { tipo: "npcs", id: n.id });
    await esperar(400);
    const tudo = JSON.stringify(vistos);
    assert.ok(vistos.length > 0);
    assert.ok(!tudo.includes("4471"), "dado de NPC vazou para o jogador");
    assert.ok(!tudo.includes("campanha_atualizada"));
    assert.equal((await s.api("/api/catalogo/npcs", null, ana.token)).success, false);
  });

  it("os NPCs sobrevivem ao reinício do servidor", async () => {
    const m = await mestre();
    const n = await salvar(m, { nome: "Persistente", papel: "Guarda", segredo: SEGREDO, atributos: { VON: 12 } });
    await s.reiniciar();
    const m2 = await mestre();
    const depois = (await listar(m2)).find((x) => x.id === n.id);
    assert.deepEqual(depois, n);
  });

  it("auditoria: NPC só circula pela sala dos mestres", () => {
    const codigo = fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    assert.ok(!/(io\.emit|broadcast\.emit)\(\s*["'][^"']*npc/i.test(codigo));
    assert.ok(!/bausPublicos[^;]*npcs|npcs[^;]*SALA_BAUS/.test(codigo));
  });

  /* ---- página ---- */
  describe("página NPCs (navegador)", () => {
    const abrirPagina = async (opcoes = { real: true, tokenInicial: SENHA }) => {
      const pg = await abrirPaginaMestre(s, "npc", opcoes);
      paginas.push(pg);
      return pg;
    };
    const clicar = (pg, el) => el.dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true }));
    const preencher = (pg, id, v) => {
      const el = pg.document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new pg.window.Event("input", { bubbles: true }));
    };
    const cartoes = (pg) => [...pg.document.querySelectorAll("#npc-cartoes [data-id]")];
    const cartao = (pg, nome) => cartoes(pg).find((c) => c.querySelector("h4").textContent === nome);

    it("criar, editar, buscar, duplicar e excluir; segredo fica fora do cartão; texto nunca vira HTML", async () => {
      const pg = await abrirPagina();
      await esperarAte(() => pg.run("npcs.carregou"), { rotulo: "página carregar" });
      const xss = "Gárgula <img src=x onerror=alert(1)>";
      clicar(pg, pg.document.getElementById("npc-novo"));
      clicar(pg, pg.document.getElementById("np-salvar"));
      assert.match(pg.document.getElementById("toast-container").textContent, /Dê um nome ao NPC/);
      preencher(pg, "np-nome", xss);
      preencher(pg, "np-papel", "Vigia <b>da torre</b>");
      preencher(pg, "np-lore", "Lore ".repeat(5));
      preencher(pg, "np-hp-atual", "30");
      preencher(pg, "np-hp-max", "20");
      preencher(pg, "np-attr-FOR", "16");
      preencher(pg, "np-segredo", SEGREDO);
      assert.equal(pg.document.getElementById("np-lore-contador").textContent, "(25/500)");
      clicar(pg, pg.document.getElementById("np-salvar"));
      await esperarAte(() => cartao(pg, xss), { rotulo: "cartão" });
      const c = cartao(pg, xss);
      assert.match(c.textContent, /HP 20\/20/, "HP atual cortado no máximo");
      assert.match(c.textContent, /FOR 16/);
      assert.equal(pg.document.querySelectorAll("#npc-cartoes img, #npc-cartoes b").length, 0, "texto do usuário nunca vira HTML");
      assert.ok(c.querySelector("[data-segredo]"), "indica que tem segredo");
      assert.ok(!pg.document.getElementById("npc-cartoes").textContent.includes(SEGREDO), "o segredo não aparece no cartão");

      // editar: o segredo aparece no editor, e editar não cria outro
      clicar(pg, c.querySelector('[data-acao="editar"]'));
      assert.equal(pg.document.getElementById("np-segredo").value, SEGREDO);
      assert.equal(pg.document.getElementById("np-attr-DES").value, "", "atributo não definido continua vazio");
      preencher(pg, "np-nome", "Gárgula");
      clicar(pg, pg.document.getElementById("np-salvar"));
      await esperarAte(() => cartao(pg, "Gárgula"), { rotulo: "cartão editado" });
      assert.equal(cartoes(pg).filter((x) => x.querySelector("h4").textContent.startsWith("Gárgula")).length, 1);

      // busca sem acento nem maiúsculas (nome, papel, lore) — não procura no segredo
      preencher(pg, "npc-busca", "VIGIA");
      assert.deepEqual(cartoes(pg).map((x) => x.querySelector("h4").textContent), ["Gárgula"]);
      preencher(pg, "npc-busca", "gargula");
      assert.equal(cartoes(pg).length, 1);
      preencher(pg, "npc-busca", SEGREDO);
      assert.equal(cartoes(pg).length, 0);
      preencher(pg, "npc-busca", "");

      // duplicar e excluir com confirmação
      clicar(pg, cartao(pg, "Gárgula").querySelector('[data-acao="duplicar"]'));
      await esperarAte(() => cartao(pg, "Gárgula (cópia)"), { rotulo: "cópia" });
      assert.ok(cartao(pg, "Gárgula (cópia)").querySelector("[data-segredo]"), "a cópia leva o segredo");
      const excluir = () => cartao(pg, "Gárgula (cópia)").querySelector('[data-acao="excluir"]');
      clicar(pg, excluir());
      assert.equal(excluir().textContent, "Confirmar?");
      clicar(pg, excluir());
      await esperarAte(() => !cartao(pg, "Gárgula (cópia)"), { rotulo: "cópia excluída" });
      assert.ok(cartao(pg, "Gárgula"));
    });

    it("retrato: só URL válida; inválida é recusada na página antes de enviar; cartão mostra a imagem com segurança", async () => {
      const pg = await abrirPagina();
      await esperarAte(() => pg.run("npcs.carregou"), { rotulo: "página carregar" });
      clicar(pg, pg.document.getElementById("npc-novo"));
      preencher(pg, "np-nome", "Retratada");
      preencher(pg, "np-retrato", "javascript:alert(1)");
      const antes = (await listar(await mestre())).length;
      clicar(pg, pg.document.getElementById("np-salvar"));
      assert.match(pg.document.getElementById("toast-container").textContent, /Retrato inválido/);
      assert.equal((await listar(await mestre())).length, antes, "nada foi enviado");
      preencher(pg, "np-retrato", "https://exemplo.com/foto.png");
      clicar(pg, pg.document.getElementById("np-salvar"));
      await esperarAte(() => cartao(pg, "Retratada"), { rotulo: "cartão" });
      const img = cartao(pg, "Retratada").querySelector("img");
      assert.equal(img.getAttribute("src"), "https://exemplo.com/foto.png");
      assert.equal(img.referrerPolicy, "no-referrer");
      // um NPC com retrato perigoso que chegasse ao navegador não vira <img>
      pg.run("renderizarNpcs.__x = 1; npcs.lista = [{ id: 'x1', nome: 'Hostil', papel: '', lore: '', notas: '', segredo: '', retrato: 'javascript:alert(1)', hp: { atual: 1, max: 1 }, atributos: {} }]; renderizarNpcs();");
      assert.equal(pg.document.querySelectorAll("#npc-cartoes img").length, 0);
    });

    it("HP: cliques rápidos não se perdem (+1 cinco vezes = +5), nunca passa do máximo nem fica abaixo de 0", async () => {
      const m = await mestre();
      const n = await salvar(m, { nome: "Alvo", hp: { atual: 0, max: 8 } });
      const pg = await abrirPagina();
      await esperarAte(() => cartao(pg, "Alvo"), { rotulo: "cartão" });
      const botao = (acao) => cartao(pg, "Alvo").querySelector(`[data-acao="${acao}"]`);
      for (let i = 0; i < 5; i++) clicar(pg, botao("hp+1"));
      await esperarAte(async () => (await listar(m)).find((x) => x.id === n.id).hp.atual === 5, { rotulo: "HP 5" });
      clicar(pg, botao("hp+5"));
      clicar(pg, botao("hp+5"));
      await esperarAte(() => /HP 8\/8/.test(cartao(pg, "Alvo").textContent), { rotulo: "HP no máximo" });
      for (let i = 0; i < 3; i++) clicar(pg, botao("hp-5"));
      await esperarAte(() => /HP 0\/8/.test(cartao(pg, "Alvo").textContent), { rotulo: "HP em 0" });
      assert.equal((await listar(m)).find((x) => x.id === n.id).hp.atual, 0);
    });

    it("dezenas de NPCs: mostra 100 cartões, ordenados, e avisa para refinar a busca; a contagem é de todos", async () => {
      const m = await mestre();
      const base = (await listar(m)).length;
      await Promise.all(Array.from({ length: 120 }, (_, i) => salvar(m, { nome: `Aldeão ${String(i).padStart(3, "0")}` })));
      const pg = await abrirPagina();
      await esperarAte(() => pg.run("npcs.carregou"), { rotulo: "página carregar" });
      assert.equal(cartoes(pg).length, 100);
      assert.match(pg.document.getElementById("npc-cartoes").textContent, /Mostrando 100 de \d+\. Refine a busca\./);
      assert.equal(pg.document.getElementById("npc-contagem").textContent, `${base + 120} NPCs`);
      const nomes = cartoes(pg).map((c) => c.querySelector("h4").textContent);
      assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
      preencher(pg, "npc-busca", "Aldeão 07");
      assert.equal(cartoes(pg).length, 10);
      assert.equal(pg.document.getElementById("npc-contagem").textContent, `10 de ${base + 120} NPCs`);
    });

    it("tempo real entre duas páginas do mestre; token errado não carrega nada", async () => {
      const a = await abrirPagina();
      const b = await abrirPagina();
      await esperarAte(() => a.run("npcs.carregou") && b.run("npcs.carregou"), { rotulo: "páginas carregarem" });
      preencher(b, "npc-busca", "tempo real"); // com muitos NPCs, só os 100 primeiros aparecem sem busca
      clicar(a, a.document.getElementById("npc-novo"));
      preencher(a, "np-nome", "Aparece em tempo real");
      clicar(a, a.document.getElementById("np-salvar"));
      await esperarAte(() => cartao(b, "Aparece em tempo real"), { rotulo: "NPC na outra página" });
      const errada = await abrirPagina({ real: true, tokenInicial: "errado" });
      await esperarAte(() => errada.run("socket.connected"), { rotulo: "conectar" });
      await esperar(400);
      assert.equal(errada.run("npcs.carregou"), false);
      assert.equal(cartoes(errada).length, 0);
    });
  });
});

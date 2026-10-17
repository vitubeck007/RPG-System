/* Sprint 7 (Fase 2): integração, segurança e estabilização do painel do mestre.
   Checklist ponta a ponta (mestre + 3 jogadores, com reinício no meio), auditoria de vazamento, auditoria de
   acesso, concorrência, recuperação e desempenho. Servidor, fichas e páginas REAIS (jsdom). */
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { io: clienteIo } = require("socket.io-client");
const { iniciarServidor, abrirFicha, abrirPaginaMestre, esperar, esperarAte } = require("./ajuda/ambiente.js");

const SENHA = "senha-teste";
const EXPIRA_MS = 3000;

describe("Fase 2: integração do painel do mestre", { concurrency: false }, () => {
  let s;
  const jogadores = {};
  const abertos = [];
  const fichas = [];
  const paginas = [];
  const capturas = { ana: [], bia: [], caio: [] };
  let contador = 0;

  /* ---------------- ajudantes ---------------- */
  const criarJogador = async (conta, nome) => {
    const token = (await s.api("/api/login", { nome: conta, senha: "x", criarSeNaoExistir: true })).token;
    const pasta = (await s.api("/api/personagens", { nome }, token)).personagem.nomePasta;
    return { conta, nome, token, pasta };
  };
  const relogar = async (j) => { j.token = (await s.api("/api/login", { nome: j.conta, senha: "x" })).token; };
  const statusArquivo = (j, hp) => fs.writeFileSync(path.join(s.dir, "players", j.conta, j.pasta, "status.json"), JSON.stringify({ schemaVersion: 1, hp: { current: hp, max: hp }, vigor: { current: 0, max: 0 }, sanity: { current: 0, max: 0 } }));
  const conectar = async (auth) => {
    const sock = clienteIo(s.url, { transports: ["websocket"], forceNew: true, ...(auth ? { auth: { token: auth } } : {}) });
    abertos.push(sock);
    await esperarAte(() => sock.connected, { rotulo: "socket conectar" });
    return sock;
  };
  const pedir = (sock, evento, dados) => new Promise((res) => sock.emit(evento, dados, res));
  const cmd = (sock, evento, dados = {}) => pedir(sock, evento, { token: SENHA, acaoId: `acao_f${++contador}`, ...dados });
  const mestre = async () => {
    const sock = await conectar();
    assert.equal((await pedir(sock, "master_entrar", { token: SENHA })).ok, true);
    return sock;
  };
  const abrir = async (j) => {
    const f = await abrirFicha(s, { player: j.conta, nomePasta: j.pasta, token: j.token, capturar: capturas[j.conta] || null });
    fichas.push(f);
    await esperarAte(() => f.run("personagemCarregado"), { rotulo: `ficha de ${j.nome} carregar` });
    await esperar(250);
    return f;
  };
  const salvar = async (m, tipo, item) => {
    const r = await cmd(m, "master_campanha_salvar", { tipo, item });
    assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r)}`);
    return r.dados;
  };
  const ler = async (m, tipo) => (await pedir(m, "master_campanha_ler", { token: SENHA, tipo })).dados;
  const alvos = async (m) => (await cmd(m, "master_listar_alvos")).dados.alvos;
  const fecharTudo = async () => {
    paginas.splice(0).forEach((p) => p.fechar());
    fichas.splice(0).forEach((f) => f.fechar());
    abertos.splice(0).forEach((k) => k.close());
    await esperar(300);
  };
  const hpDaFicha = (f) => f.run("STATE.vitals.hp.current");
  const quantidadeDoItem = (f, itemId) => f.run(`STATE.backpackItems.filter((i) => i.id === ${JSON.stringify(itemId)}).reduce((t, i) => t + i.quantity, 0)`);

  afterEach(async () => { if (s) await fecharTudo(); });
  before(async () => {
    s = await iniciarServidor(undefined, { RESERVA_EXPIRA_MS: String(EXPIRA_MS) });
    for (const [conta, nome] of [["ana", "Ana"], ["bia", "Bia"], ["caio", "Caio"]]) {
      jogadores[conta] = await criarJogador(conta, nome);
      statusArquivo(jogadores[conta], 20);
    }
  });
  after(async () => { await fecharTudo(); await s?.parar(); });

  /* ===================== 1. checklist ponta a ponta (com reinício) + vazamento ===================== */
  it("CHECKLIST: habilidade entregue, baú disputado, NPC, batalha, ataque ×½/×2, REINÍCIO no meio, tudo confere; e nenhum dado do mestre vaza", async () => {
    const { ana, bia, caio } = jogadores;
    const m = await mestre();
    const m2 = await mestre();
    const fichasDe = { ana: await abrir(ana), bia: await abrir(bia), caio: await abrir(caio) };

    // --- habilidade e magia privadas entregues (cada uma só para o seu jogador)
    const hab = await salvar(m, "habilidades", { nome: "Fúria-ANA-ONLY", desc: "d" });
    await salvar(m, "habilidades", { nome: "Segredo-HAB-OCULTA", desc: "nunca entregue" });
    const mag = await salvar(m, "magias", { nome: "Raio-BIA-ONLY" });
    assert.equal((await cmd(m, "master_entregar", { tipo: "habilidades", catalogId: hab.id, player: "ana", nomePasta: ana.pasta })).dados.online, true);
    assert.equal((await cmd(m, "master_entregar", { tipo: "magias", catalogId: mag.id, player: "bia", nomePasta: bia.pasta })).dados.online, true);
    await esperarAte(() => fichasDe.ana.run(`STATE.abilities.some((a) => a.catalogId === ${JSON.stringify(hab.id)})`), { rotulo: "habilidade na ficha da Ana" });
    await esperarAte(() => fichasDe.bia.run(`STATE.spells.some((a) => a.catalogId === ${JSON.stringify(mag.id)})`), { rotulo: "magia na ficha da Bia" });
    assert.equal(fichasDe.caio.run("STATE.abilities.length + STATE.spells.length"), 0, "o Caio não recebeu nada");

    // --- baú: 3 jogadores disputam 4 poções (2 + 2 + 2): exatamente dois levam, o terceiro não
    const pocao = await salvar(m, "itens", { name: "Poção-VIS", type: "Poção", maxStack: 5, weight: 0.5 });
    const tesouro = await salvar(m, "itens", { name: "Tesouro-OCULTO", type: "Joia" });
    const bau = await salvar(m, "baus", { nome: "Baú-VIS", itens: [{ item: pocao, quantidade: 4 }] });
    await salvar(m, "baus", { nome: "Baú-OCULTO", itens: [{ item: tesouro, quantidade: 1 }] });
    assert.equal((await cmd(m, "master_bau_liberar", { id: bau.id, liberado: true })).ok, true);
    await esperarAte(() => ["ana", "bia", "caio"].every((c) => fichasDe[c].document.getElementById("bau-janela").textContent.includes("Baú-VIS")), { rotulo: "janela do baú nas 3 fichas" });
    for (const c of ["ana", "bia", "caio"]) {
      assert.ok(!fichasDe[c].document.getElementById("bau-janela").textContent.includes("OCULTO"), `${c}: baú oculto não aparece`);
      fichasDe[c].run("pegarDoBau(bausLiberados[0], bausLiberados[0].itens[0], 2)"); // os 3 pedidos saem quase juntos
    }
    await esperarAte(async () => (await ler(m, "baus")).find((b) => b.id === bau.id).itens[0].quantidade === 0, { rotulo: "baú esgotar" });
    await esperarAte(() => ["ana", "bia", "caio"].map((c) => quantidadeDoItem(fichasDe[c], pocao.id)).filter((q) => q === 2).length === 2, { rotulo: "2 jogadores com 2 poções" });
    const qtds = ["ana", "bia", "caio"].map((c) => quantidadeDoItem(fichasDe[c], pocao.id));
    assert.deepEqual([...qtds].sort(), [0, 2, 2], `quem levou: ${qtds}`);
    await esperarAte(async () => ((await ler(m, "baus")).find((b) => b.id === bau.id).historico.filter((h) => h.resultado === "pegou").length === 2), { rotulo: "histórico do baú" });

    // --- NPC com segredo e batalha com 3 inimigos
    const npc = await salvar(m, "npcs", { nome: "NPC-Secreto-ZQ", lore: "lore-ZQ", segredo: "SEGREDO-NPC-ZQ", notas: "nota-ZQ", hp: { atual: 20, max: 20 } });
    const modelo = await salvar(m, "inimigos", { nome: "Goblin-ZQ", hpMax: 20, nota: "nota-inimigo-ZQ", ataques: [{ nome: "Faca-ZQ", dado: "1d4" }] });
    const gob = (await cmd(m, "master_batalha_adicionar", { modeloId: modelo.id, quantidade: 3 })).dados.adicionados;
    assert.deepEqual(gob.map((g) => g.nome), ["Goblin-ZQ 1", "Goblin-ZQ 2", "Goblin-ZQ 3"]);

    // --- ataque com rolagem do servidor (+7): jogadores ×½ e ×2, NPC ×1, inimigos ×2 e ×½; o outro mestre age ao mesmo tempo
    const rol = (await cmd(m, "master_rolar", { componentes: [{ formula: "+7" }] })).dados;
    assert.equal(rol.total, 7);
    const lista = await alvos(m);
    const idJog = (j) => lista.find((a) => a.tipo === "jogador" && a.nomePasta === j.pasta).alvoId;
    const [ataque, extra] = await Promise.all([
      cmd(m, "master_aplicar_dano", { rolagemId: rol.rolagemId, alvos: [{ alvoId: idJog(ana), mult: 0.5 }, { alvoId: idJog(bia), mult: 2 }, { alvoId: npc.id, mult: 1 }, { alvoId: gob[0].alvoId, mult: 2 }, { alvoId: gob[1].alvoId, mult: 0.5 }] }),
      cmd(m2, "master_batalha_hp", { alvoId: gob[2].alvoId, delta: -4 }),
    ]);
    assert.equal(ataque.ok, true, JSON.stringify(ataque));
    assert.equal(extra.ok, true);
    assert.deepEqual(ataque.dados.resultados.map((r) => [r.nome, r.dano, r.antes, r.depois]), [["Ana", 3, 20, 17], ["Bia", 14, 20, 6], ["NPC-Secreto-ZQ", 7, 20, 13], ["Goblin-ZQ 1", 14, 20, 6], ["Goblin-ZQ 2", 3, 20, 17]]);
    await esperarAte(() => hpDaFicha(fichasDe.ana) === 17 && hpDaFicha(fichasDe.bia) === 6, { rotulo: "fichas com o dano" });
    assert.equal(hpDaFicha(fichasDe.caio), 20);

    // --- ficha com edição pendente recebe uma nova entrega sem perder a edição
    const extraHab = await salvar(m, "habilidades", { nome: "Extra-ANA-ONLY2" });
    fichasDe.ana.run("adicionarEntradaCodice('habilidades', { uid: 'cx_propriaA', nome: 'Original' })");
    await esperarAte(() => s.lerArquivo("ana", ana.pasta, "habilidades").items.some((a) => a.nome === "Original"), { rotulo: "habilidade própria salva" });
    fichasDe.ana.run("STATE.abilities.find((a) => a.uid === 'cx_propriaA').nome = 'Editada antes da entrega'; marcarAlterado('habilidades')");
    await cmd(m, "master_entregar", { tipo: "habilidades", catalogId: extraHab.id, player: "ana", nomePasta: ana.pasta });
    await esperarAte(() => s.lerArquivo("ana", ana.pasta, "habilidades").items.some((a) => a.nome === "Extra-ANA-ONLY2"), { rotulo: "entrega salva" });
    const nomesAna = s.lerArquivo("ana", ana.pasta, "habilidades").items.map((a) => a.nome);
    assert.ok(nomesAna.includes("Editada antes da entrega") && nomesAna.includes("Fúria-ANA-ONLY"), nomesAna.join());
    await fichasDe.ana.salvos();

    // --- estado antes do reinício (fonte de comparação)
    const antes = { baus: await ler(m, "baus"), npcs: await ler(m, "npcs"), batalha: await ler(m, "batalha"), itens: await ler(m, "itens"), habilidades: await ler(m, "habilidades") };

    // =============== REINÍCIO DO SERVIDOR NO MEIO ===============
    await fecharTudo();
    await s.reiniciar();
    for (const j of Object.values(jogadores)) await relogar(j);
    const m3 = await mestre();
    for (const tipo of ["baus", "npcs", "batalha", "itens", "habilidades"]) assert.deepEqual(await ler(m3, tipo), antes[tipo], `${tipo} igual depois do reinício`);
    const f = { ana: await abrir(ana), bia: await abrir(bia), caio: await abrir(caio) };
    assert.deepEqual([hpDaFicha(f.ana), hpDaFicha(f.bia), hpDaFicha(f.caio)], [17, 6, 20], "HP dos jogadores sobreviveu (status.json)");
    assert.equal(f.ana.run("STATE.abilities.filter((a) => /ANA-ONLY/.test(a.nome)).length"), 2);
    assert.equal(f.bia.run("STATE.spells.filter((a) => /BIA-ONLY/.test(a.nome)).length"), 1);
    assert.deepEqual(["ana", "bia", "caio"].map((c) => quantidadeDoItem(f[c], pocao.id)).sort(), [0, 2, 2]);
    assert.equal((await ler(m3, "baus")).find((b) => b.id === bau.id).liberado, true, "baú continua liberado");
    await esperarAte(() => f.caio.document.getElementById("bau-janela").textContent.includes("Baú-VIS"), { rotulo: "janela do baú depois do reinício" });
    // o desfazer vive só na memória: depois do reinício a aplicação anterior não pode mais ser desfeita (e nada quebra)
    assert.equal((await cmd(m3, "master_desfazer_dano", { aplicacaoId: ataque.dados.aplicacaoId })).erro, "nao_e_a_ultima");

    // --- continua funcionando: novo ataque (valor manual) em jogador e inimigo; ficha, disco e card batem
    const lista2 = await alvos(m3);
    const idJogador = (j) => lista2.find((a) => a.tipo === "jogador" && a.nomePasta === j.pasta).alvoId;
    const r = await cmd(m3, "master_aplicar_dano", { valor: 5, alvos: [{ alvoId: idJogador(ana), mult: 1 }, { alvoId: gob[0].alvoId, mult: 1 }] });
    assert.deepEqual(r.dados.resultados.map((x) => [x.nome, x.antes, x.depois]), [["Ana", 17, 12], ["Goblin-ZQ 1", 6, 1]]);
    await esperarAte(() => hpDaFicha(f.ana) === 12, { rotulo: "ficha da Ana" });
    assert.equal(s.lerArquivo("ana", ana.pasta, "status").hp.current, 12);
    assert.equal((await alvos(m3)).find((a) => a.alvoId === idJogador(ana)).hp.atual, 12);
    assert.equal((await cmd(m3, "master_bau_liberar", { id: bau.id, liberado: false })).ok, true);
    await esperarAte(() => !f.ana.document.getElementById("bau-janela").textContent.includes("Baú-VIS"), { rotulo: "baú recolhido" });
    assert.deepEqual(f.ana.erros, []);
    assert.deepEqual(f.bia.erros, []);

    // =============== 2. auditoria de vazamento (tudo que os 3 jogadores receberam na sessão inteira) ===============
    await fecharTudo();
    for (const c of ["ana", "bia", "caio"]) assert.ok(capturas[c].length > 10, `${c}: a captura tem eventos (${capturas[c].length})`);
    const texto = Object.fromEntries(Object.entries(capturas).map(([c, v]) => [c, JSON.stringify(v)]));
    const nuncaVisivel = ["NPC-Secreto-ZQ", "SEGREDO-NPC-ZQ", "lore-ZQ", "nota-ZQ", "Goblin-ZQ", "Faca-ZQ", "nota-inimigo-ZQ", "Baú-OCULTO", "Tesouro-OCULTO", "Segredo-HAB-OCULTA", "campanha_atualizada", rol.rolagemId, ataque.dados.aplicacaoId, "rol_", "apl_"];
    for (const c of ["ana", "bia", "caio"]) for (const marca of nuncaVisivel) assert.ok(!texto[c].includes(marca), `VAZAMENTO para ${c}: ${marca}`);
    assert.ok(texto.ana.includes("Fúria-ANA-ONLY") && texto.ana.includes("Extra-ANA-ONLY2"), "a Ana recebeu as suas entregas");
    assert.ok(texto.bia.includes("Raio-BIA-ONLY"));
    for (const marca of ["Fúria-ANA-ONLY", "Extra-ANA-ONLY2", "Raio-BIA-ONLY"]) {
      for (const c of ["ana", "bia", "caio"]) {
        const dono = marca.includes("ANA") ? "ana" : "bia";
        if (c !== dono) assert.ok(!texto[c].includes(marca), `entrega de ${dono} apareceu para ${c}: ${marca}`);
      }
    }
    assert.ok(texto.caio.includes("Baú-VIS"), "o que é público (baú liberado) aparece, como deve");
    // segredos de NPC e inimigos também não estão em nenhum arquivo servido por URL
    for (const caminho of ["/campanha/npcs.json", "/campanha/batalha.json", "/catalogo/itens.json"]) {
      const corpo = await (await fetch(s.url + caminho)).text();
      assert.ok(!corpo.includes("ZQ"), caminho);
    }
    void m2;
  });

  /* ===================== 3. auditoria de acesso ===================== */
  describe("auditoria de acesso", () => {
    const codigo = () => fs.readFileSync(path.join(s.dir, "server.js"), "utf8");
    const eventosMaster = () => new Set([...codigo().matchAll(/(?:socket\.on|ouvir)\("(master_\w+)"/g)].map((m) => m[1]).concat([...codigo().matchAll(/comandos\.registrar\(\s*socket,\s*"(master_\w+)"/g)].map((m) => m[1])));
    const hashDosDados = () => {
      const h = crypto.createHash("sha1");
      for (const dir of ["campanha", "catalogo"]) {
        for (const f of fs.readdirSync(path.join(s.dir, dir)).filter((x) => x.endsWith(".json")).sort()) h.update(fs.readFileSync(path.join(s.dir, dir, f)));
      }
      h.update(fs.readFileSync(path.join(s.dir, "config.json")));
      return h.digest("hex");
    };

    it("TODO evento master_* (varrido do server.js) recusa jogador e anônimo, sem efeito nem resposta de dados", async () => {
      const eventos = eventosMaster();
      assert.ok(eventos.size >= 20, `eventos encontrados: ${eventos.size}`);
      for (const esperado of ["master_entrar", "master_campanha_salvar", "master_entregar", "master_bau_liberar", "master_batalha_hp", "master_aplicar_dano", "master_desfazer_dano", "master_rolar", "master_npc_hp", "master_listar_alvos", "master_adjust_vital", "master_get_personagem", "master_update_config"]) {
        assert.ok(eventos.has(esperado), `evento conhecido não encontrado no server.js: ${esperado}`);
      }
      const j = jogadores.ana;
      const f = await abrir(j); // ficha aberta: um jogador "de verdade" tentando agir como mestre
      const m = await mestre();
      const alvoReal = (await alvos(m)).find((a) => a.tipo === "jogador");
      const antes = hashDosDados();
      const hpAntes = hpDaFicha(f);
      for (const quem of ["anonimo", "jogador"]) {
        const sock = await conectar(quem === "jogador" ? j.token : undefined);
        const recebidos = [];
        sock.onAny((ev) => recebidos.push(ev));
        for (const evento of eventos) {
          for (const token of [undefined, "", "errado", j.token, { $ne: 1 }]) {
            const dados = { token, acaoId: "acao_audit", charId: alvoReal.alvoId, id: "x", type: "hp", delta: -5, config: { AtivarMana: true }, tipo: "npcs", item: { nome: "Hack" }, alvos: [{ alvoId: alvoReal.alvoId, mult: 2 }], valor: 99 };
            const resposta = await new Promise((res) => {
              const t = setTimeout(() => res("sem-ack"), 120); // eventos antigos respondem por master_feedback, sem confirmação
              sock.emit(evento, dados, (r) => { clearTimeout(t); res(r); });
            });
            if (resposta !== "sem-ack") assert.equal(resposta.ok, false, `${quem} ${evento} ${JSON.stringify(token)}`);
            if (resposta !== "sem-ack") assert.equal(resposta.erro, "nao_autorizado", `${quem} ${evento}`);
          }
        }
        await esperar(200);
        const permitido = new Set(["master_feedback"]);
        assert.deepEqual([...new Set(recebidos)].filter((e) => !permitido.has(e) && !/^(player_updated|player_removed)$/.test(e)), [], `${quem}: só pode receber master_feedback`);
        sock.close();
      }
      assert.equal(hashDosDados(), antes, "nenhum dado do mestre nem a config mudaram");
      assert.equal(hpDaFicha(f), hpAntes, "o HP do jogador não mudou");
      assert.equal((await alvos(m)).find((a) => a.alvoId === alvoReal.alvoId).hp.atual, hpAntes);
    });

    // GET com endereço de origem escolhido (127.0.0.2 = "outro computador", como no teste da Fase 1)
    const pedirHttp = (caminho, { de = null, cookie = null } = {}) =>
      new Promise((resolver, rejeitar) => {
        const req = http.request(s.url + caminho, { method: "GET", localAddress: de || undefined, headers: cookie ? { cookie } : {} }, (res) => {
          let corpo = "";
          res.on("data", (d) => { corpo += d; });
          res.on("end", () => resolver({ status: res.statusCode, corpo }));
        });
        req.on("error", rejeitar);
        req.end();
      });
    const arquivosDoPainel = (pasta = "mestre", base = "/mestre") => fs.readdirSync(path.join(s.dir, pasta), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivosDoPainel(path.join(pasta, e.name), `${base}/${e.name}`) : [`${base}/${e.name}`]));

    it("TODA rota e arquivo de /mestre recusa quem vem de fora (sem chave, com cookie de jogador ou cookie inventado)", async (t) => {
      const arquivos = arquivosDoPainel();
      const rotas = ["/mestre", "/mestre/", "/mestre/rolagem", "/mestre/inimigos", "/mestre/npc", "/mestre/loot", "/mestre/habilidades-magias", "/mestre.html"];
      assert.ok(arquivos.length >= 12, `arquivos do painel: ${arquivos.length}`);
      for (const alvo of [...rotas, ...arquivos]) assert.equal((await pedirHttp(alvo)).status < 400 || alvo === "/mestre.html", true, `${alvo}: a máquina do mestre abre`);
      try { await pedirHttp("/mestre", { de: "127.0.0.2" }); } catch { return t.skip("este sistema não permite usar 127.0.0.2 como origem"); }
      const cookieJogador = `rpg_sessao=${jogadores.ana.token}; rpg_mestre=inventado`;
      for (const alvo of [...rotas, ...arquivos]) {
        for (const opcoes of [{ de: "127.0.0.2" }, { de: "127.0.0.2", cookie: cookieJogador }]) {
          const r = await pedirHttp(alvo, opcoes);
          assert.equal(r.status, 403, `${alvo} (${opcoes.cookie ? "cookie de jogador" : "sem chave"}) deveria ser recusado`);
          assert.doesNotMatch(r.corpo, /master_|pedirAoServidor|SESSAO_MESTRE/);
        }
        assert.equal((await pedirHttp(`${alvo}?chave=errada`, { de: "127.0.0.2" })).status, 403, `${alvo}?chave=errada`);
      }
      assert.equal((await pedirHttp("/mestre/loot?chave=senha-teste", { de: "127.0.0.2" })).status, 200, "com a chave certa abre");
    });

    it("dados e código do servidor não são servidos por URL (nem para o dono da máquina)", async () => {
      const caminhos = ["/server.js", "/personagem.js", "/campanha.js", "/comandos.js", "/entregas.js", "/batalha.js", "/rolagem.js", "/dano.js", "/acesso.js", "/package.json", "/config.json",
        "/campanha/npcs.json", "/campanha/baus.json", "/campanha/batalha.json", "/campanha/_backup/", "/catalogo/itens.json", "/catalogo/habilidades.json", "/catalogo/magias.json",
        "/players/ana/login.json", `/players/ana/${jogadores.ana.pasta}/status.json`, `/players/ana/${jogadores.ana.pasta}/entregas.json`, "/testes/integracao.test.js", "/mestre/../server.js", "/JS/../server.js", "/JS/..%2fserver.js", "/mestre/%2e%2e/campanha/npcs.json"];
      for (const c of caminhos) {
        const r = await pedirHttp(c);
        assert.notEqual(r.status, 200, `${c} respondeu 200`);
        assert.doesNotMatch(r.corpo, /SENHA_MESTRE|SEGREDO-NPC|senha-teste|"schemaVersion"/, c);
      }
    });
  });

  /* ===================== 4. concorrência ===================== */
  describe("concorrência", () => {
    it("duas abas do mestre: HP do NPC por delta soma (20 cliques de 2 abas), e editar o texto não desfaz o HP ajustado na outra aba", async () => {
      const m1 = await mestre();
      const m2 = await mestre();
      const npc = await salvar(m1, "npcs", { nome: "Concorrido", lore: "original", hp: { atual: 50, max: 50 } });
      await Promise.all(Array.from({ length: 20 }, (_, i) => cmd(i % 2 ? m1 : m2, "master_npc_hp", { id: npc.id, delta: -1 })));
      assert.equal((await ler(m1, "npcs")).find((n) => n.id === npc.id).hp.atual, 30);
      // a aba 2 tem a cópia velha (HP 50) e só edita a lore: o HP continua o do servidor
      const editado = await salvar(m2, "npcs", { id: npc.id, nome: "Concorrido", lore: "editada na aba 2" });
      assert.equal(editado.lore, "editada na aba 2");
      assert.equal(editado.hp.atual, 30, "campo não enviado = mantém o do servidor");
      assert.equal(editado.criadoEm, npc.criadoEm);
      // pedidos inválidos
      assert.equal((await cmd(m1, "master_npc_hp", { id: npc.id, delta: 1.5 })).erro, "formato_invalido");
      assert.equal((await cmd(m1, "master_npc_hp", { id: "nao_existe", delta: 1 })).erro, "npc_inexistente");
      assert.equal((await cmd(m1, "master_npc_hp", { id: "../x", delta: 1 })).erro, "id_invalido");
    });

    it("página do NPC: editar só a lore na aba velha não desfaz o HP ajustado em outra aba", async () => {
      const m = await mestre();
      const npc = await salvar(m, "npcs", { nome: "Duas-Abas", hp: { atual: 10, max: 10 } });
      const a = await abrirPaginaMestre(s, "npc", { real: true, tokenInicial: SENHA });
      const b = await abrirPaginaMestre(s, "npc", { real: true, tokenInicial: SENHA });
      paginas.push(a, b);
      const cartao = (pg) => [...pg.document.querySelectorAll("#npc-cartoes [data-id]")].find((c) => c.querySelector("h4").textContent === "Duas-Abas");
      await esperarAte(() => cartao(a) && cartao(b), { rotulo: "NPC nas duas páginas" });
      const clicar = (pg, el) => el.dispatchEvent(new pg.window.MouseEvent("click", { bubbles: true }));
      // a aba B abre o editor (cópia com HP 10)...
      clicar(b, cartao(b).querySelector('[data-acao="editar"]'));
      // ...a aba A baixa o HP...
      for (let i = 0; i < 4; i++) clicar(a, cartao(a).querySelector('[data-acao="hp-1"]'));
      await esperarAte(async () => (await ler(m, "npcs")).find((n) => n.id === npc.id).hp.atual === 6, { rotulo: "HP 6" });
      // ...e a aba B salva só uma lore nova
      b.document.getElementById("np-lore").value = "lore da aba B";
      clicar(b, b.document.getElementById("np-salvar"));
      await esperarAte(async () => (await ler(m, "npcs")).find((n) => n.id === npc.id).lore === "lore da aba B", { rotulo: "lore salva" });
      assert.equal((await ler(m, "npcs")).find((n) => n.id === npc.id).hp.atual, 6, "o HP da aba A foi preservado");
    });

    it("dois mestres: libera/recolhe e edita baú ao mesmo tempo sem corromper; reservas e edição não se atropelam", async () => {
      const m1 = await mestre();
      const m2 = await mestre();
      const item = await salvar(m1, "itens", { name: "Moeda", type: "Moeda", maxStack: 999 });
      const baus = await Promise.all(Array.from({ length: 6 }, (_, i) => salvar(i % 2 ? m1 : m2, "baus", { nome: `Baú ${i}`, itens: [{ item, quantidade: 10 }] })));
      const rs = await Promise.all(baus.map((b, i) => cmd(i % 2 ? m1 : m2, "master_bau_liberar", { id: b.id, liberado: true })));
      assert.ok(rs.every((r) => r.ok));
      const noDisco = JSON.parse(fs.readFileSync(path.join(s.dir, "campanha", "baus.json"), "utf8")).items;
      assert.ok(baus.every((b) => noDisco.find((x) => x.id === b.id)?.liberado === true));
      assert.deepEqual(fs.readdirSync(path.join(s.dir, "campanha")).filter((f) => f.endsWith(".tmp")), []);
      // baú liberado não se edita (mesmo por outro mestre)
      assert.equal((await cmd(m2, "master_campanha_salvar", { tipo: "baus", item: { ...baus[0], nome: "Mudou" } })).erro, "bau_liberado");
      await Promise.all(baus.map((b) => cmd(m1, "master_campanha_remover", { tipo: "baus", id: b.id })));
    });
  });

  /* ===================== 5. desempenho ===================== */
  describe("desempenho", () => {
    it("6 jogadores, 30 NPCs e 20 combatentes: listar alvos, aplicar dano em todos e carregar as páginas sem travar", async () => {
      const m = await mestre();
      const m2 = await mestre();
      // 6 jogadores (crus, com o personagem aberto e o card publicado)
      const crus = [];
      for (let i = 1; i <= 6; i++) {
        const j = await criarJogador(`perf${i}`, `Perf${i}`);
        statusArquivo(j, 30);
        const sock = await conectar(j.token);
        await new Promise((res) => { sock.once("personagem_carregado", res); sock.emit("carregar_personagem", { player: j.conta, nomePasta: j.pasta }); });
        sock.emit("player_update", { id: `id_${j.conta}`, name: j.nome });
        crus.push(j);
      }
      await esperarAte(async () => (await alvos(m)).filter((a) => a.tipo === "jogador" && /^Perf/.test(a.nome)).length === 6, { rotulo: "6 jogadores na lista" });
      // 30 NPCs e 20 combatentes
      await Promise.all(Array.from({ length: 30 }, (_, i) => cmd(m, "master_campanha_salvar", { tipo: "npcs", item: { nome: `Perf NPC ${String(i).padStart(2, "0")}`, lore: "x".repeat(300), hp: { atual: 40, max: 40 } } })));
      const m1 = await salvar(m, "inimigos", { nome: "Perf Orc", hpMax: 40, ataques: Array.from({ length: 5 }, (_, i) => ({ nome: `A${i}`, dado: "1d6" })) });
      await cmd(m, "master_batalha_limpar");
      await cmd(m, "master_batalha_adicionar", { modeloId: m1.id, quantidade: 20 });

      let t0 = Date.now();
      const todos = await alvos(m);
      const tListar = Date.now() - t0;
      const npcsDoTeste = todos.filter((a) => a.tipo === "npc" && /^Perf NPC/.test(a.nome));
      const combatentes = todos.filter((a) => a.tipo === "inimigo");
      assert.equal(npcsDoTeste.length, 30);
      assert.equal(combatentes.length, 20);
      assert.ok(tListar < 1000, `listar alvos demorou ${tListar} ms`);

      // dano em 56 alvos (6 + 30 + 20) enquanto o outro mestre continua rolando: o servidor responde a ambos
      const alvosDoAtaque = [...todos.filter((a) => a.tipo === "jogador" && /^Perf/.test(a.nome)), ...npcsDoTeste, ...combatentes].map((a, i) => ({ alvoId: a.alvoId, mult: [1, 0.5, 2][i % 3] }));
      assert.equal(alvosDoAtaque.length, 56);
      t0 = Date.now();
      const [ataque, rolagem] = await Promise.all([cmd(m, "master_aplicar_dano", { valor: 9, alvos: alvosDoAtaque }), cmd(m2, "master_rolar", { componentes: [{ formula: "10d20+5" }] })]);
      const tAtaque = Date.now() - t0;
      assert.equal(ataque.ok, true, JSON.stringify(ataque).slice(0, 200));
      assert.equal(ataque.dados.resultados.length, 56);
      assert.ok(ataque.dados.resultados.every((r) => r.ok), "todos receberam");
      assert.equal(rolagem.ok, true);
      assert.ok(tAtaque < 5000, `aplicar dano em 56 alvos demorou ${tAtaque} ms`);
      const antesDesfazer = Date.now();
      const u = await cmd(m, "master_desfazer_dano", { aplicacaoId: ataque.dados.aplicacaoId });
      assert.equal(u.ok, true);
      assert.ok(u.dados.restaurados.every((r) => r.ok), "desfez em todos");
      assert.ok(Date.now() - antesDesfazer < 5000);

      // páginas com a carga completa
      t0 = Date.now();
      const pNpc = await abrirPaginaMestre(s, "npc", { real: true, tokenInicial: SENHA });
      const pIni = await abrirPaginaMestre(s, "inimigos", { real: true, tokenInicial: SENHA });
      const pRol = await abrirPaginaMestre(s, "rolagem", { real: true, tokenInicial: SENHA });
      paginas.push(pNpc, pIni, pRol);
      await esperarAte(() => pNpc.document.querySelectorAll("#npc-cartoes [data-id]").length >= 30, { rotulo: "30 NPCs na página" });
      await esperarAte(() => pIni.document.querySelectorAll("#ini-combatentes [data-alvo-id]").length === 20, { rotulo: "20 combatentes na página" });
      await esperarAte(() => pRol.document.querySelectorAll("#atk-alvos [data-alvo-id]").length >= 56, { rotulo: "56 alvos na página de rolagem" });
      const tPaginas = Date.now() - t0;
      assert.ok(tPaginas < 8000, `3 páginas com a carga completa demoraram ${tPaginas} ms`);
      // e ainda respondem: marcar todos e recalcular as 56 prévias
      t0 = Date.now();
      pRol.document.getElementById("atk-todos").dispatchEvent(new pRol.window.MouseEvent("click", { bubbles: true }));
      assert.ok(Date.now() - t0 < 1500, "marcar todos (56 linhas) travou a página");
      crus.forEach((j) => assert.ok(j));
    });
  });

  /* ===================== 6. recuperação ===================== */
  describe("recuperação", () => {
    it("arquivos corrompidos ao ligar: o servidor sobe, avisa, guarda os estragados e preserva os backups; a restauração traz tudo de volta", async () => {
      // estado conhecido: dados em todos os tipos + um boot para gerar o backup "inicio"
      const m = await mestre();
      const npc = await salvar(m, "npcs", { nome: "Sobrevivente", segredo: "REC-SEGREDO" });
      const item = await salvar(m, "itens", { name: "Relíquia", type: "Joia" });
      const bau = await salvar(m, "baus", { nome: "Baú Recuperável", itens: [{ item, quantidade: 3 }] });
      const hab = await salvar(m, "habilidades", { nome: "Habilidade Recuperável", publico: true });
      const modelo = await salvar(m, "inimigos", { nome: "Recuperável", hpMax: 9 });
      await cmd(m, "master_batalha_limpar");
      await cmd(m, "master_batalha_adicionar", { modeloId: modelo.id, quantidade: 2 });
      const referencia = { npcs: await ler(m, "npcs"), baus: await ler(m, "baus"), itens: await ler(m, "itens"), habilidades: await ler(m, "habilidades"), batalha: await ler(m, "batalha") };
      await fecharTudo();
      await s.reiniciar(); // gera o backup do estado completo
      const pastaBackups = path.join(s.dir, "campanha", "_backup");
      const bom = fs.readdirSync(pastaBackups).sort().at(-1);
      assert.ok(bom, "existe backup");
      assert.deepEqual(fs.readdirSync(path.join(pastaBackups, bom)).sort(), ["baus.json", "batalha.json", "habilidades.json", "inimigos.json", "itens.json", "magias.json", "npcs.json"].filter((f) => fs.existsSync(path.join(pastaBackups, bom, f))).sort());
      assert.ok(fs.existsSync(path.join(pastaBackups, bom, "itens.json")) && fs.existsSync(path.join(pastaBackups, bom, "habilidades.json")), "o backup inclui o catálogo");
      const backupsAntes = fs.readdirSync(pastaBackups).sort();

      // estraga vários arquivos de uma vez (inclusive do catálogo) com o servidor desligado
      await s.desligar();
      const alvosEstragados = [["campanha", "npcs.json"], ["campanha", "baus.json"], ["campanha", "batalha.json"], ["catalogo", "itens.json"]];
      for (const [d, f] of alvosEstragados) fs.writeFileSync(path.join(s.dir, d, f), "{ lixo ::");
      await s.ligar();
      const m2 = await mestre();
      const entrada = await pedir(m2, "master_entrar", { token: SENHA });
      assert.equal(entrada.ok, true);
      assert.equal(entrada.dados.avisos.length, 4, JSON.stringify(entrada.dados.avisos));
      for (const [, f] of alvosEstragados) assert.ok(entrada.dados.avisos.some((a) => a.includes(f)), `aviso sobre ${f}`);
      assert.equal(fs.readdirSync(path.join(s.dir, "campanha", "_corrompidos")).length, 4, "os 4 arquivos estragados foram guardados à parte");
      assert.deepEqual(await ler(m2, "npcs"), []);
      assert.deepEqual(await ler(m2, "habilidades"), referencia.habilidades, "o que não estava estragado continua");
      // os backups estão intactos e o estado incompleto NÃO virou backup novo
      assert.deepEqual(fs.readdirSync(pastaBackups).sort(), backupsAntes, "backups preservados (nenhum novo, nenhum perdido)");
      // o servidor continua usável com os dados que sobraram
      assert.equal((await cmd(m2, "master_campanha_salvar", { tipo: "npcs", item: { nome: "Novo depois do estrago" } })).ok, true);

      // restauração pela linha de comando, com o servidor parado
      await fecharTudo();
      await s.desligar();
      const cli = (...args) => spawnSync(process.execPath, [path.join(s.dir, "campanha.js"), ...args], { cwd: s.dir, env: { ...process.env, CAMPANHA_DIR: path.join(s.dir, "campanha"), CATALOGO_DIR: path.join(s.dir, "catalogo") }, encoding: "utf8" });
      const lista = cli("backups");
      assert.equal(lista.status, 0);
      assert.ok(lista.stdout.includes(bom), lista.stdout);
      const r = cli("restaurar", bom);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(s.dir, "catalogo", "itens.json")), "o catálogo voltou para catalogo/");
      assert.ok(!fs.existsSync(path.join(s.dir, "campanha", "itens.json")), "e não foi parar em campanha/");
      await s.ligar();
      const m3 = await mestre();
      const avisos = (await pedir(m3, "master_entrar", { token: SENHA })).dados.avisos;
      assert.deepEqual(avisos, [], "sem avisos depois de restaurar");
      for (const tipo of ["npcs", "baus", "itens", "habilidades", "batalha"]) assert.deepEqual(await ler(m3, tipo), referencia[tipo], `${tipo} restaurado`);
      assert.ok(referencia.npcs.some((n) => n.id === npc.id));
      assert.ok(referencia.baus.some((b) => b.id === bau.id));
      assert.equal(referencia.habilidades.some((h) => h.id === hab.id), true);
    });
  });
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gravarJsonAsync, trocarArquivoAsync } = require("../personagem.js");
const { criarCampanha } = require("../campanha.js");
const { nomePastaFigurante } = require("../figurantes.js");
const { io: clienteIo } = require("socket.io-client");
const { abrirPaginaMestre, iniciarServidor, abrirFicha, esperarAte } = require("./ajuda/ambiente.js");

// Um cenário integrado, com arquivos próprios, DOM simulado e servidor numa cópia temporária.
test("otimização: gravação ordenada sem bloquear, espelho incremental e interface sincronizada", async (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-otimizacao-"));
  const pastaTemporaria = fs.realpathSync(os.tmpdir());
  const raizReal = fs.realpathSync(raiz);
  assert.equal(path.dirname(raizReal), pastaTemporaria);
  assert.ok(path.basename(raizReal).startsWith("rpg-otimizacao-"));
  const dentroDaRaiz = arquivo => path.resolve(arquivo).startsWith(raizReal + path.sep);
  const paginas = [];
  let timer, servidorReal, mestreReal;
  try {
    // O sandbox do Windows pode recusar rename mesmo sem bloqueio real. A troca simulada
    // permite testar a fila e injetar EPERM de forma determinística, sem medir o sandbox.
    t.mock.method(fs, "renameSync", (origem, destino) => {
      assert.ok(dentroDaRaiz(origem) && dentroDaRaiz(destino));
      fs.copyFileSync(origem, destino); fs.unlinkSync(origem);
    });
    let falhasTransitorias = 0;
    const ordemConfirmada = [];
    t.mock.method(fs.promises, "rename", async (origem, destino) => {
      assert.ok(dentroDaRaiz(origem) && dentroDaRaiz(destino));
      if (path.basename(origem) === "retentativa.tmp" && falhasTransitorias < 2) {
        falhasTransitorias++;
        throw Object.assign(new Error("Arquivo ocupado no teste"), { code: "EPERM" });
      }
      if (path.basename(destino) === "fila.json") {
        ordemConfirmada.push(JSON.parse(await fs.promises.readFile(origem, "utf8")).ordem);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await fs.promises.copyFile(origem, destino); await fs.promises.unlink(origem);
    });

    const origem = path.join(raizReal, "retentativa.tmp"), destino = path.join(raizReal, "retentativa.json");
    fs.writeFileSync(origem, "novo");
    let timerAvancou = false;
    timer = setTimeout(() => { timerAvancou = true; }, 0);
    await trocarArquivoAsync(origem, destino, { tentativas: 3, espera: 5 });
    assert.equal(falhasTransitorias, 2);
    assert.equal(timerAvancou, true, "outros eventos avançam durante a retentativa");
    assert.equal(fs.readFileSync(destino, "utf8"), "novo");
    assert.equal(fs.existsSync(origem), false);

    const fila = path.join(raizReal, "fila.json");
    await Promise.all([gravarJsonAsync(fila, { ordem: 1 }), gravarJsonAsync(fila, { ordem: 2 })]);
    assert.deepEqual(ordemConfirmada, [1, 2]);
    assert.equal(JSON.parse(fs.readFileSync(fila, "utf8")).ordem, 2);
    assert.equal(fs.existsSync(fila + ".tmp"), false);

    const pastaFigurantes = path.join(raizReal, "Figurante");
    const dirCampanha = path.join(raizReal, "campanha");
    const campanha = criarCampanha(dirCampanha, { pastaFigurantes, log: { log() {}, warn() {}, error() {} } }).iniciar();
    const modelo = i => ({
      id: "ini_" + i, nome: "Guardião " + i, hpMax: 40,
      energia: { atual: 10, max: 10 }, atributos: { FOR: 12, DES: 10, INT: 8, SAB: 10, PRE: 8, VON: 10 },
      habilidades: [], magias: [], descricao: "Protege a entrada.", lore: "Vigia antigo.", nota: "Carrega uma chave.",
    });
    await campanha.atualizar("inimigos", () => Array.from({ length: 100 }, (_, i) => modelo(i)));
    let leiturasIndividuais = 0, contarLeituras = true;
    const lerOriginal = fs.promises.readFile.bind(fs.promises);
    t.mock.method(fs.promises, "readFile", async (arquivo, ...args) => {
      if (contarLeituras && path.basename(String(arquivo)) === "figurante.json") leiturasIndividuais++;
      return lerOriginal(arquivo, ...args);
    });
    let publicacoes = 0;
    campanha.aoMudar = () => { publicacoes++; };
    await campanha.atualizar("inimigos", itens => { itens[0].hpMax = 39; return itens; });
    contarLeituras = false;
    assert.equal(leiturasIndividuais, 0, "editar um modelo não relê os 100 arquivos individuais");
    assert.equal(publicacoes, 1);
    const original = campanha.ler("inimigos")[0];
    const pastaDoModelo = item => path.join(pastaFigurantes, "Inimigos", nomePastaFigurante(item));
    const pastaAntiga = pastaDoModelo(original);
    fs.writeFileSync(path.join(pastaAntiga, "anotacao-do-usuario.txt"), "preservar");
    const renomeado = await campanha.salvarItem("inimigos", { ...original, nome: "Guardião Renomeado" });
    assert.equal(fs.existsSync(path.join(pastaAntiga, "figurante.json")), false);
    assert.equal(fs.readFileSync(path.join(pastaAntiga, "anotacao-do-usuario.txt"), "utf8"), "preservar");
    assert.equal(JSON.parse(fs.readFileSync(path.join(pastaDoModelo(renomeado), "figurante.json"), "utf8")).hpMax, 39);
    fs.writeFileSync(path.join(pastaDoModelo(renomeado), "mapa-do-usuario.txt"), "preservar também");
    await campanha.removerItem("inimigos", renomeado.id);
    assert.equal(fs.existsSync(path.join(pastaDoModelo(renomeado), "figurante.json")), false);
    assert.equal(fs.readFileSync(path.join(pastaDoModelo(renomeado), "mapa-do-usuario.txt"), "utf8"), "preservar também");

    const antesDaFalha = campanha.ler("inimigos"), publicacoesAntes = publicacoes;
    const bloqueado = { ...modelo(100), id: "ini_bloqueado", nome: "Bloqueado" };
    const caminhoBloqueado = pastaDoModelo(bloqueado);
    fs.writeFileSync(caminhoBloqueado, "arquivo do usuário");
    await assert.rejects(campanha.salvarItem("inimigos", bloqueado));
    assert.deepEqual(campanha.ler("inimigos"), antesDaFalha, "falha no espelho não confirma o cache");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirCampanha, "inimigos.json"), "utf8")).items, antesDaFalha, "o agregado também volta ao estado anterior");
    assert.equal(publicacoes, publicacoesAntes, "falha não publica sucesso");
    assert.equal(fs.readFileSync(caminhoBloqueado, "utf8"), "arquivo do usuário");

    const servidorFalso = { dir: path.resolve(__dirname, ".."), url: "http://127.0.0.1:3000" };
    const pgRol = await abrirPaginaMestre(servidorFalso, "rolagem", { tokenInicial: "chave-ficticia" });
    paginas.push(pgRol);
    pgRol.run("socket.connected = true");
    const pedidosAlvos = () => pgRol.falso.pedidos.filter(p => p.evento === "master_listar_alvos");
    const alvo = hp => ({ alvoId: "jog_teste", tipo: "jogador", nome: "Jogador", hp: { atual: hp, max: 20 }, energia: { atual: 10, max: 10 } });
    const consulta1 = pgRol.run("carregarAlvos()"), consultaCompartilhada = pgRol.run("carregarAlvos()");
    assert.equal(consulta1, consultaCompartilhada);
    assert.equal(pedidosAlvos().length, 1);
    pgRol.disparar("player_updated", {}); pgRol.disparar("vital_adjusted", {});
    pedidosAlvos()[0].cb(null, { ok: true, dados: { alvos: [alvo(19)] } });
    await esperarAte(() => pedidosAlvos().length === 2);
    pedidosAlvos()[1].cb(null, { ok: true, dados: { alvos: [alvo(18)] } });
    await consulta1;
    assert.equal(pgRol.run("rol.alvos[0].hp.atual"), 18, "invalidação durante a consulta é atendida depois");
    pgRol.disparar("player_updated", {});
    const consultaExplicita = pgRol.run("carregarAlvos()");
    assert.equal(pedidosAlvos().length, 3);
    pedidosAlvos()[2].cb(null, { ok: true, dados: { alvos: [alvo(17)] } });
    await consultaExplicita;
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(pedidosAlvos().length, 3, "consulta explícita cancela o timer que já atende");
    const cardAlvo = pgRol.document.querySelector(".rol-alvo");
    pgRol.run("definirOcupadaRolagem(true); definirOcupadaRolagem(false)");
    assert.equal(pgRol.document.querySelector(".rol-alvo"), cardAlvo, "bloquear controles não recria os alvos");
    assert.deepEqual(pgRol.erros, []);

    const pgFig = await abrirPaginaMestre(servidorFalso, "figurantes", { tokenInicial: "chave-ficticia" });
    paginas.push(pgFig);
    pgFig.run(`socket.connected=true;figurantes.carregou=true;figurantes.aba='batalha';
      figurantes.inimigos=${JSON.stringify(Array.from({ length: 100 }, (_, i) => modelo(i)))};
      figurantes.batalha={ativa:true,combatentes:[0,1].map(i=>({...figurantes.inimigos[i],hp:{atual:40,max:40},alvoId:'cb_'+i,modeloId:'ini_'+i,tipo:'inimigo',notasCombate:''}))};
      var cardsCriadosOtimizacao=0,criarCartaoOriginalOtimizacao=cartaoFigurante;
      cartaoFigurante=(...args)=>{cardsCriadosOtimizacao++;return criarCartaoOriginalOtimizacao(...args)};
      renderizarFigurantes();`);
    assert.equal(pgFig.run("cardsCriadosOtimizacao"), 1, "100 modelos ocultos não constroem 100 cards");
    const outroResumo = pgFig.document.getElementById("fig-combatentes").children[1];
    const fichaSelecionada = pgFig.document.getElementById("fig-selecionado").firstElementChild;
    const notas = pgFig.document.querySelector("#fig-selecionado textarea");
    notas.value = "Rascunho local preservado";
    notas.dispatchEvent(new pgFig.window.Event("input", { bubbles: true }));
    notas.focus();
    pgFig.document.querySelector('#fig-selecionado [aria-label="Diminuir vida de Guardião 0"]').click();
    const pedidoHp = pgFig.falso.pedidos.find(p => p.evento === "master_batalha_hp");
    assert.ok(pedidoHp);
    const batalha = JSON.parse(pgFig.run("JSON.stringify(figurantes.batalha)"));
    batalha.combatentes[0].hp.atual = 39;
    pgFig.disparar("campanha_atualizada", { tipo: "batalha", dados: batalha });
    pedidoHp.cb(null, { ok: true, dados: { hp: { atual: 39, max: 40 }, derrotado: false } });
    await esperarAte(() => pgFig.run("recursosPendentesFig.size === 0"));
    assert.equal(pgFig.document.getElementById("fig-combatentes").children[1], outroResumo);
    assert.equal(pgFig.document.getElementById("fig-selecionado").firstElementChild, fichaSelecionada);
    assert.equal(pgFig.document.querySelector("#fig-selecionado textarea"), notas);
    assert.equal(pgFig.document.activeElement, notas);
    assert.equal(notas.value, "Rascunho local preservado");
    assert.equal(pgFig.document.querySelector('#fig-selecionado [aria-label="Vida atual de Guardião 0"]').value, "39");
    assert.equal(pgFig.run("cardsCriadosOtimizacao"), 1, "ajustar HP não cria novos cards completos");
    assert.deepEqual(pgFig.erros, []);
    t.diagnostic("100 figurantes: 0 leituras individuais ao editar; 1 ficha construída na batalha; cards e rascunho preservados após ajustar HP.");

    // Daqui em diante o servidor usa a implementação real, sem os mocks de disco acima.
    paginas.splice(0).forEach(pg => pg.fechar());
    t.mock.restoreAll();
    servidorReal = await iniciarServidor();
    const copiaReal = fs.realpathSync(servidorReal.dir);
    assert.equal(path.dirname(copiaReal), pastaTemporaria);
    assert.ok(path.basename(copiaReal).startsWith("rpg-teste-"));
    const login = await servidorReal.api("/api/login", { nome: "otimizacao", senha: "teste", criarSeNaoExistir: true });
    assert.equal(login.success, true);
    const criacao = await servidorReal.api("/api/personagens", { nome: "Guardião de teste" }, login.token);
    assert.equal(criacao.success, true);
    const nomePasta = criacao.personagem.nomePasta;
    const ficha = await abrirFicha(servidorReal, { player: "otimizacao", nomePasta, token: login.token });
    paginas.push(ficha);
    await ficha.salvos();
    const statusSalvo = () => servidorReal.lerArquivo("otimizacao", nomePasta, "status");
    ficha.run("STATE.vitals.hp={current:30,max:30};salvarStatus();alterarVital('hp',-3)");
    await ficha.salvos();
    assert.equal(statusSalvo().hp.current, 27);
    assert.equal(statusSalvo().hp.max, 30);

    mestreReal = clienteIo(servidorReal.url, { transports: ["websocket"], forceNew: true });
    await esperarAte(() => mestreReal.connected);
    let sequenciaComando = 0;
    const comando = (evento, dados = {}) => new Promise((resolve, reject) => {
      mestreReal.timeout(10_000).emit(evento, { token: "senha-teste", acaoId: "acao_otimizacao_" + (++sequenciaComando), ...dados }, (erro, resposta) => erro ? reject(erro) : resolve(resposta));
    });
    assert.equal((await comando("master_entrar")).ok, true);
    const alvoJogador = async () => {
      const resposta = await comando("master_listar_alvos");
      assert.equal(resposta.ok, true);
      return resposta.dados.alvos.find(a => a.tipo === "jogador" && a.nomePasta === nomePasta);
    };
    await esperarAte(async () => Boolean(await alvoJogador()));
    const identidadeAlvo = await alvoJogador();
    assert.equal(identidadeAlvo.hp.atual, 27);
    ficha.run("FICHA.perfil.avatar='https://example.com/retrato-teste.png';marcarAlterado('perfil',{imediato:true})");
    await ficha.salvos();
    assert.equal((await alvoJogador()).imagem, "https://example.com/retrato-teste.png", "salvar o perfil atualiza o retrato em memória");
    assert.equal(servidorReal.lerArquivo("otimizacao", nomePasta, "perfil").avatar, "https://example.com/retrato-teste.png");

    const feedback = new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error("Ajuste vital não respondeu")), 10_000);
      mestreReal.once("master_feedback", resposta => { clearTimeout(limite); resolve(resposta); });
    });
    mestreReal.emit("master_adjust_vital", { token: "senha-teste", charId: ficha.run("STATE.id"), type: "hp", delta: -2 });
    assert.equal((await feedback).success, true);
    await esperarAte(() => ficha.run("STATE.vitals.hp.current") === 25);
    await ficha.salvos();
    assert.equal(statusSalvo().hp.current, 25);
    assert.equal((await alvoJogador()).hp.atual, 25);
    const dano = await comando("master_aplicar_dano", { valor: 4, alvos: [{ alvoId: identidadeAlvo.alvoId, mult: 1 }] });
    assert.equal(dano.ok, true, JSON.stringify(dano));
    await esperarAte(() => ficha.run("STATE.vitals.hp.current") === 21);
    await ficha.salvos();
    assert.equal(statusSalvo().hp.current, 21);
    const desfeito = await comando("master_desfazer_dano", { aplicacaoId: dano.dados.aplicacaoId });
    assert.equal(desfeito.ok, true, JSON.stringify(desfeito));
    assert.equal(desfeito.dados.restaurados[0].ok, true);
    await esperarAte(() => ficha.run("STATE.vitals.hp.current") === 25);
    await ficha.salvos();
    assert.equal(statusSalvo().hp.current, 25, "desfazer aguarda a restauração no disco");

    const resultadoItem = ficha.run("adicionarItemAoInventario({id:'item_pocao_teste',name:'Poção',desc:'Item de teste',type:'Consumível',weight:0.5,w:1,h:1,maxStack:10,icon:'fa-flask',dice:'',twoHanded:false},2,{tudoOuNada:true,silencioso:true})");
    assert.equal(resultadoItem.adicionado, 2);
    await ficha.salvos();
    const uidItem = ficha.run("STATE.backpackItems.find(i=>i.id==='item_pocao_teste').uid");
    const blocoItem = ficha.document.getElementById("item-node-" + uidItem);
    assert.ok(blocoItem);
    ficha.run("abrirItemPopover(STATE.backpackItems.find(i=>i.id==='item_pocao_teste'),document.getElementById('item-node-'+STATE.backpackItems.find(i=>i.id==='item_pocao_teste').uid));ajustarQuantidadeItemAtual(1)");
    assert.equal(ficha.document.getElementById("item-node-" + uidItem), blocoItem, "quantidade não reconstrói a mochila");
    assert.equal(blocoItem.querySelector("[data-item-quantidade]").textContent, "×3");
    await ficha.salvos();
    assert.equal(servidorReal.lerArquivo("otimizacao", nomePasta, "inventario").items.find(i => i.uid === uidItem).quantity, 3);

    ficha.run("CODICE_UI.tipo='habilidades';CODICE_UI.catalogo.habilidades=Array.from({length:85},(_,i)=>({id:'cat_'+i,nome:'Poder '+i,desc:'Descrição',dice:'1d6',cost:{vital:'vigor',amount:0}}));STATE.abilities=[{id:'hab_teste',catalogId:'cat_0',nome:'Poder 0'}];document.getElementById('codice-busca').value='';renderizarResultadosCatalogo()");
    const botoesCatalogo = () => [...ficha.document.querySelectorAll("#codice-resultados button")].filter(b => b.textContent === "Adicionar" || b.textContent === "Na ficha");
    assert.equal(botoesCatalogo().length, 40);
    assert.equal(botoesCatalogo().find(b => b.textContent === "Na ficha").disabled, true);
    ficha.document.querySelector('#codice-resultados [data-pagina-catalogo="1"]').click();
    assert.equal(botoesCatalogo().length, 40);
    ficha.document.querySelector('#codice-resultados [data-pagina-catalogo="1"]').click();
    assert.equal(botoesCatalogo().length, 5, "a terceira página permite alcançar os 85 resultados");
    ficha.run("document.getElementById('codice-busca').value='Poder 84';renderizarResultadosCatalogo()");
    assert.equal(botoesCatalogo().length, 1);
    assert.match(ficha.document.getElementById("codice-resultados").textContent, /Poder 84/);

    ficha.run("socket.disconnect()");
    await esperarAte(() => ficha.run("!socket.connected"));
    const storage = Object.getPrototypeOf(ficha.window.localStorage);
    const setItemOriginal = storage.setItem;
    const chaveRascunhoDaFicha = ficha.run("chaveRascunho");
    let gravacoesRascunho = 0;
    t.mock.method(storage, "setItem", function (chave, valor) {
      if (chave === chaveRascunhoDaFicha) gravacoesRascunho++;
      return setItemOriginal.call(this, chave, valor);
    });
    ficha.run("FICHA.perfil.nome='Rascunho offline';marcarAlterado('perfil');atualizarIndicadorSalvamento();guardarRascunhoFicha();guardarRascunhoFicha({conferir:true})");
    assert.equal(gravacoesRascunho, 1, "o mesmo rascunho é gravado apenas uma vez");
    assert.equal(JSON.parse(ficha.window.localStorage.getItem(chaveRascunhoDaFicha)).arquivos.perfil.nome, "Rascunho offline");
    assert.deepEqual(ficha.erros, []);
    paginas.splice(paginas.indexOf(ficha), 1); ficha.fechar();
    const exclusao = await fetch(`${servidorReal.url}/api/personagens/${encodeURIComponent(nomePasta)}`, { method: "DELETE", headers: { Authorization: `Bearer ${login.token}` } });
    assert.equal(exclusao.status, 200);
    assert.equal(fs.existsSync(path.join(copiaReal, "players", "otimizacao", nomePasta)), false);
    assert.equal((await servidorReal.api("/api/personagens", null, login.token)).personagens.length, 0);
    t.diagnostic("Servidor real isolado: criação/carga, vitais, retrato, dano/desfazer e exclusão persistidos; mochila incremental, catálogo 40/40/5 e rascunho sem gravação duplicada.");
  } finally {
    clearTimeout(timer);
    paginas.forEach(pg => pg.fechar());
    mestreReal?.close();
    if (servidorReal) {
      const copiaReal = fs.realpathSync(servidorReal.dir);
      assert.equal(path.dirname(copiaReal), pastaTemporaria);
      assert.ok(path.basename(copiaReal).startsWith("rpg-teste-"));
      await servidorReal.parar();
    }
    assert.equal(fs.realpathSync(raiz), raizReal, "a limpeza fica restrita à pasta criada por este teste");
    assert.equal(path.dirname(raizReal), pastaTemporaria);
    fs.rmSync(raizReal, { recursive: true, force: true });
  }
});

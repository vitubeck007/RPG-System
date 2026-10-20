// Um único smoke virtual. Sem servidor, rede, personagens reais ou gravações em disco.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const { abrirPaginaMestre } = require("./ajuda/ambiente.js");
const raiz = path.resolve(__dirname, "..");
const tick = () => new Promise(resolve => setImmediate(resolve));

async function abrirFichaVirtual(copias = [], identidade = { player: "teste-ux", nomePasta: "Guardiao_1" }) {
  const original = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  const erros = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", erro => erros.push(erro.message));
  const dom = new JSDOM(original.replace(/<script[\s\S]*?<\/script>/g, ""), {
    url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only", virtualConsole: vc,
  });
  const w = dom.window;
  w.sessionStorage.setItem("rpg_character", JSON.stringify(identidade));
  w.sessionStorage.setItem("rpg_token", "sessao-ficticia");
  copias.forEach(([chave, valor]) => w.localStorage.setItem(chave, valor));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; }, set(valor) { this.textContent = valor; },
  });
  const eventos = {}, emitidos = [];
  const socket = {
    connected: false, active: false, on(nome, fn) { (eventos[nome] ||= []).push(fn); },
    emit(nome, dados) { emitidos.push([nome, dados]); }, connect() {}, close() {},
    timeout() { return { emit() {} }; },
  };
  w.io = () => socket;
  w.fetch = async () => ({ ok: true, json: async () => ({ success: true, items: [] }) });
  w.confirm = () => true;
  const run = codigo => new vm.Script(codigo).runInContext(dom.getInternalVMContext());
  for (const [, arquivo] of original.matchAll(/<script src="(JS\/[^"]+)"/g)) {
    run(fs.readFileSync(path.join(raiz, arquivo), "utf8"));
  }
  await tick(); // DOMContentLoaded real do jsdom, uma única vez.
  const carga = {
    ...identidade, perfil: { nome: "Guardião fictício", progressao: { nv: "1", ex: "0%" } },
    biografia: {}, atributos: {}, status: { hp: { current: 10, max: 10 }, vigor: { current: 10, max: 10 }, sanity: { current: 10, max: 10 } },
    pericias: { skills: {} }, riquezas: {}, habilidades: { items: [] }, magias: { items: [] },
    inventario: {
      items: [{ id: "pocao-teste", uid: "it_ux000001", name: "Poção fictícia", type: "Item", w: 1, h: 1, col: 1, row: 1, quantity: 5, maxStack: 5, weight: 1, icon: "fa-flask", color: "from-slate-800 to-slate-900" }],
      equipped: { mainHand: null, offHand: null, back: null, backpack: null }, recebidas: [],
    },
  };
  w.__cargaUX = carga;
  run("aplicarConfiguracaoGlobal({AtivarSlotMochila:true, AtivarMana:true}); aplicarPersonagemCarregado(window.__cargaUX)");
  return {
    w, run, erros, emitidos, socket, carga,
    disparar(nome, dados) { (eventos[nome] || []).forEach(fn => fn(dados)); },
    copias() { return Object.keys(w.localStorage).filter(k => k.startsWith("rpg_pendente_v1:")).map(k => [k, w.localStorage.getItem(k)]); },
    fechar() { w.close(); },
  };
}

test("smoke básico: destinatário estável, bloqueio de repetição, rascunhos, descarte e recuperação", async () => {
  const abertos = [];
  try {
    const mestre = await abrirPaginaMestre({ dir: raiz, url: "http://localhost" }, "habilidades-magias", { tokenInicial: "chave-ficticia" });
    abertos.push(() => mestre.fechar());
    mestre.run(`socket.connected = true;
      habmag.personagens = [
        {player:"amigo",nomePasta:"Ana_1",nome:"Ana",online:true},
        {player:"amigo",nomePasta:"Bia_2",nome:"Bia",online:false}
      ];
      habmag.carregou = true;
      habmag.catalogo.habilidades = [{id:"poder-teste",nome:"Luz",desc:"Somente teste"}];
      renderizarPersonagens(); renderizarLista();`);
    const seletor = mestre.document.getElementById("habmag-personagem");
    assert.equal(seletor.value, "", "não escolhe um destinatário automaticamente");
    seletor.value = JSON.stringify(["amigo", "Ana_1"]);
    seletor.dispatchEvent(new mestre.window.Event("change"));
    mestre.run("habmag.personagens.reverse(); renderizarPersonagens()");
    assert.equal(mestre.run("destinatarioSelecionado().nomePasta"), "Ana_1", "reordenação preserva a identidade");
    const entregar = mestre.document.querySelector('[data-acao="enviar"]');
    entregar.click(); entregar.click();
    assert.equal(entregar.disabled, true);
    const envios = mestre.falso.pedidos.filter(p => p.evento === "master_entregar");
    assert.equal(envios.length, 1, "clique repetido não entrega duas vezes");
    assert.equal(envios[0].dados.nomePasta, "Ana_1");
    envios[0].cb(null, { ok: true, dados: { online: true } });
    await tick();
    assert.equal(entregar.disabled, false);
    mestre.run("abrirEditor(null)");
    mestre.document.getElementById("hm-nome").value = "Rascunho";
    mestre.window.confirm = () => false;
    mestre.document.getElementById("habmag-aba-magias").click();
    assert.equal(mestre.run("habmag.tipo"), "habilidades", "cancelar o descarte mantém o editor");
    assert.equal(mestre.document.getElementById("hm-nome").value, "Rascunho");
    mestre.run('marcarEnvioMestre("hm-salvar", true)');
    assert.equal(mestre.document.getElementById("hm-nome").disabled, true);
    mestre.run('marcarEnvioMestre("hm-salvar", false)');
    assert.equal(mestre.document.getElementById("hm-nome").disabled, false);
    const leitura = mestre.run("carregarCatalogo()");
    mestre.falso.pedidos.at(-1).cb(null, { ok: false, erro: "falha_teste", mensagem: "Falha fictícia" });
    await leitura;
    assert.match(mestre.document.getElementById("habmag-lista").textContent, /Não foi possível carregar/);
    assert.ok(mestre.document.querySelector('[data-acao="recarregar"]'));
    assert.deepEqual(mestre.erros, []);

    // Carrega os scripts das outras áreas para detectar erros básicos de inicialização.
    for (const pagina of ["loot", "figurantes", "rolagem"]) {
      const p = await abrirPaginaMestre({ dir: raiz, url: "http://localhost" }, pagina);
      abertos.push(() => p.fechar());
      assert.deepEqual(p.erros, [], pagina);
    }

    const ficha = await abrirFichaVirtual();
    abertos.push(() => ficha.fechar());
    ficha.run("abrirItemPopover(STATE.backpackItems[0], document.querySelector('.inventory-item'))");
    ficha.w.document.getElementById("popover-discard-qty").value = "3";
    ficha.w.confirm = () => false;
    ficha.run("descartarItemAtual()");
    assert.equal(ficha.run("STATE.backpackItems[0].quantity"), 5, "recusar não remove itens");
    ficha.w.confirm = () => true;
    ficha.run("descartarItemAtual()");
    assert.equal(ficha.run("STATE.backpackItems[0].quantity"), 2, "remove somente a quantidade confirmada");
    const copias = ficha.copias();
    assert.equal(copias.length, 1);
    assert.equal(JSON.parse(copias[0][1]).arquivos.inventario.items[0].quantity, 2);
    const saida = new ficha.w.Event("beforeunload", { cancelable: true });
    ficha.w.dispatchEvent(saida);
    assert.equal(saida.defaultPrevented, true, "avisa ao sair com alterações pendentes");
    ficha.run(`abrirItemPopover({name:"Mochila fictícia",desc:"",isBackpackItem:true,maxStack:1,quantity:1,type:"Item"}, document.body);
      aplicarConfiguracaoGlobal({AtivarSlotMochila:false})`);
    assert.equal(ficha.w.document.body.style.overflow, "");
    assert.ok(!ficha.w.document.getElementById("ficha-conteudo").inert, "configuração fecha o modal restaurando o fundo");
    ficha.run("abrirModalCodice('criar')");
    ficha.w.document.getElementById("codice-f-nome").value = "Poder em rascunho";
    ficha.run("definirModoCodice('catalogo'); definirModoCodice('criar')");
    assert.equal(ficha.w.document.getElementById("codice-f-nome").value, "Poder em rascunho");
    ficha.run("fecharModalCodice()");
    ficha.socket.connected = true;
    ficha.run("enviarSalvamentosPendentes()");
    ficha.disparar("salvamento_personagem_erro", { arquivo: "inventario", message: "Falha fictícia de gravação" });
    assert.match(ficha.w.document.getElementById("save-status").textContent, /Mochila/);
    assert.equal(ficha.w.document.getElementById("save-retry").hidden, false);
    ficha.run("tentarSalvarNovamente()");
    assert.equal(ficha.emitidos.filter(([e]) => e === "salvar_personagem").length, 2);
    ficha.disparar("personagem_salvo", { arquivo: "inventario", dados: JSON.parse(ficha.run('JSON.stringify(dadosParaSalvar("inventario"))')) });
    assert.equal(ficha.copias().length, 0, "remove a cópia somente após confirmação");
    assert.deepEqual(ficha.erros, []);

    const reaberta = await abrirFichaVirtual(copias);
    abertos.push(() => reaberta.fechar());
    assert.equal(reaberta.run("STATE.backpackItems[0].quantity"), 5, "não restaura automaticamente sobre o servidor");
    assert.equal(reaberta.w.document.getElementById("draft-recovery").hidden, false);
    reaberta.run("restaurarRascunhoFicha()");
    assert.equal(reaberta.run("STATE.backpackItems[0].quantity"), 2);
    assert.equal(reaberta.run('arquivosSujos.has("inventario")'), true, "mantém na fila enquanto offline");
    const outra = await abrirFichaVirtual(copias, { player: "outra-conta", nomePasta: "Outro_2" });
    abertos.push(() => outra.fechar());
    assert.equal(outra.w.document.getElementById("draft-recovery").hidden, true, "não mistura personagens/contas");
  } finally { abertos.reverse().forEach(fechar => fechar()); }
});

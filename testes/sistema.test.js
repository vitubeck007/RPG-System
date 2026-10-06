/* TESTE DO CRITÉRIO DO SPRINT 1 (ponta a ponta)
   Ficha REAL (index.html + index.js) <-> servidor REAL, via socket.io de verdade:
   altera tudo -> derruba o servidor (SIGKILL) -> sobe de novo -> reabre -> confere.
   Roda ISOLADO numa pasta temporária (não toca em players/ nem em config.json do projeto).
   Rode na raiz do projeto:  node testes/sistema.test.js   (precisa de: npm i -D jsdom socket.io-client) */
const os = require("os");
const path = require("path");
const RAIZ = process.cwd();
const TMP = require("fs").mkdtempSync(path.join(os.tmpdir(), "vtt-teste-"));
for (const f of ["server.js", "personagem.js", "index.html", "mestre.html"]) require("fs").copyFileSync(path.join(RAIZ, f), path.join(TMP, f));
require("fs").copyFileSync(require("fs").existsSync(path.join(RAIZ, "JS/index.js")) ? path.join(RAIZ, "JS/index.js") : path.join(RAIZ, "index.js"), path.join(TMP, "index.js"));
require("fs").writeFileSync(path.join(TMP, "config.json"), JSON.stringify({ AtivarRiquezas: true, UsarEx: false, AtivarSlotMochila: true, AtivarMana: false }));
process.chdir(TMP);
process.on("exit", () => { try { require("fs").rmSync(TMP, { recursive: true, force: true }); } catch {} });
const { JSDOM, VirtualConsole } = require("jsdom");
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => console.error("[jsdom]", e.message));
if (process.env.VERBOSE) vc.sendTo(console);
const { io: realIo } = require("socket.io-client");
const { spawn } = require("child_process");
const fs = require("fs");
const PORTA = 40000 + Math.floor(Math.random() * 10000); // evita conflito com outra coisa rodando
const base = `http://127.0.0.1:${PORTA}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync("index.html", "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const codigo = fs.readFileSync("index.js", "utf8").replace(/^\uFEFF/, "");
let srv, falhas = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) falhas++; };
let saidaServidor = "";
// Sobe o servidor e ESPERA ele responder (até 30 s). Se ele cair ao iniciar, mostra o motivo.
const iniciar = async () => {
  saidaServidor = "";
  let saiu = null;
  srv = spawn(process.execPath, ["server.js"], {
    cwd: TMP,
    env: { ...process.env, PORT: String(PORTA), NODE_PATH: path.join(RAIZ, "node_modules") },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  srv.stdout.on("data", (d) => (saidaServidor += d));
  srv.stderr.on("data", (d) => (saidaServidor += d));
  srv.on("exit", (codigo) => (saiu = codigo));
  for (let i = 0; i < 300; i++) {
    if (saiu !== null) throw new Error(`O servidor encerrou ao iniciar (código ${saiu}).\n--- saída do servidor ---\n${saidaServidor || "(vazia)"}`);
    try { await fetch(base + "/login"); return; } catch { await sleep(100); }
  }
  throw new Error(`O servidor não respondeu em 30 s na porta ${PORTA}.\n--- saída do servidor ---\n${saidaServidor || "(vazia)"}`);
};
const parar = async () => {
  await new Promise((resolver) => { if (srv.exitCode !== null) return resolver(); srv.once("exit", resolver); srv.kill("SIGKILL"); setTimeout(resolver, 5000); });
  await sleep(300);
};
const login = (nome, criar) => fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, senha: "x", criarSeNaoExistir: criar }) }).then((r) => r.json());

async function abrirFicha(token, nomePasta) {
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: "outside-only", url: base + "/", pretendToBeVisual: true });
  const w = dom.window;
  w.sessionStorage.setItem("rpg_character", JSON.stringify({ player: "eva", nomePasta }));
  w.sessionStorage.setItem("rpg_token", token);
  w.io = (opts) => realIo(base, { ...opts, reconnection: false });
  w.scrollTo = () => {};
  if (w.document.readyState !== "complete") await new Promise((r) => w.addEventListener("load", r)); // evita o DOMContentLoaded automático do jsdom disparar 2x
  w.eval(codigo + "\n;window.__T={STATE,FICHA,get loaded(){return personagemCarregado},get sujos(){return [...arquivosSujos]},get emVoo(){return totalEmVoo()},setPop:(i)=>{itemPopoverAtual=i;}};");
  w.dispatchEvent(new w.Event("DOMContentLoaded"));
  for (let i = 0; i < 60 && !w.__T.loaded; i++) await sleep(100);
  w.$ = (s) => w.document.querySelector(s);
  w.esperarSalvo = async () => { for (let i = 0; i < 60 && (w.__T.sujos.length || w.__T.emVoo); i++) await sleep(100); await sleep(150); };
  return w;
}
const digitar = (w, sel, valor) => { const el = w.$(sel); el.value = valor; el.dispatchEvent(new w.Event("input")); el.dispatchEvent(new w.Event("blur")); };
const mudar = (w, sel, valor) => { const el = w.$(sel); el.value = valor; el.dispatchEvent(new w.Event("change")); el.dispatchEvent(new w.Event("input")); };

(async () => {
  await iniciar();
  const t1 = (await login("eva", true)).token;
  const { personagem } = await fetch(base + "/api/personagens", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t1 }, body: JSON.stringify({ nome: "Eva" }) }).then((r) => r.json());
  const nomePasta = personagem.nomePasta, dir = `players/eva/${nomePasta}`;

  // itens iniciais (a tela ainda não tem "adicionar item"): 2 adagas iguais + espada + poção
  const it = (id, uid, ex = {}) => ({ id, name: id, col: 1, row: 1, w: 1, h: 1, weight: 1, type: "Arma", uid, ...ex });
  const inv = JSON.parse(fs.readFileSync(`${dir}/inventario.json`, "utf8"));
  inv.items = [it("adaga", "ua01"), it("adaga", "ub02"), it("espada", "uc03", { twoHanded: true }), it("pocao", "ud04", { type: "Consumível" }), it("flecha", "ue05", { type: "Munição", quantity: 10, maxStack: 20, weight: 0.1 })];
  fs.writeFileSync(`${dir}/inventario.json`, JSON.stringify(inv));

  console.log("1) Abre a ficha e ALTERA TUDO");
  let w = await abrirFicha(t1, nomePasta);
  ok(w.__T.loaded, "ficha carregou do servidor real");
  ok(w.__T.STATE.backpackItems.length === 5, "mochila com 5 itens");
  ok(new Set(w.__T.STATE.backpackItems.map((i) => `${i.col},${i.row}`)).size === 5, "itens que estavam todos em (1,1) foram reposicionados ao carregar");
  digitar(w, "#char-name-input", "Eva Sombria");
  digitar(w, "#char-class-input", "Necromante");
  digitar(w, "[data-campo='perfil.origem']", "Vale Cinzento");
  digitar(w, "[data-campo='perfil.idade']", "31 Ciclos");
  digitar(w, "[data-campo='perfil.alinhamento']", "Neutro");
  digitar(w, "[data-campo='perfil.divindade']", "A Dama Pálida");
  digitar(w, "#bio-history-text", "Nasceu no vale.\nPerdeu tudo.");
  digitar(w, "#bio-scars-text", "• Marca no ombro\n• Medo de fogo");
  digitar(w, "#bio-notes-text", "Devo 50 pratas — \"Kael\" & cia");
  w.eval("alterarVital('hp', 3)"); w.eval("alterarVital('hp', -1)");
  w.eval("alterarVital('sanity', 2)");
  w.eval("alterarModPericia('ocultismo', 1)"); w.eval("alterarModPericia('ocultismo', 1)"); w.eval("alterarModPericia('vontade', -1)");
  mudar(w, "#progression-val-input", "12");
  w.$("#avatar-url-input").value = "https://exemplo.com/eva.png"; w.eval("salvarAvatar()");
  // o HTML tem onchange="atualizarResumoMoedas()" (o jsdom não roda handlers inline): chama a mesma função
  for (const [sel, val] of [["#coin-gold", "150"], ["#coin-silver", "64"], ["#coin-copper", "310"], ["#coin-blood", "2"]]) { w.$(sel).value = val; w.eval("atualizarResumoMoedas()"); }
  ok(/onchange="atualizarResumoMoedas\(\)"/.test(html) && ["coin-gold", "coin-silver", "coin-copper", "coin-blood"].every((id) => new RegExp('id="' + id + '"[^>]*onchange="atualizarResumoMoedas\\(\\)"').test(html.replace(/\n\s*/g, " "))), "as 4 moedas têm onchange ligado no HTML");
  // inventário: equipa UMA adaga (a outra deve ficar), equipa espada de 2 mãos, desequipa, descarta a poção, equipa a outra adaga na secundária
  const S = w.__T.STATE;
  // atributos (data-campo), magias e habilidades (não há tela para criar: mexe no estado e usa o salvamento central)
  for (const [k, val] of Object.entries({ FOR: "3", DES: "2", INT: "1", SAB: "0", PRE: "5", VON: "4" })) digitar(w, `[data-campo='atributos.${k}']`, val);
  S.spells = [{ id: "fogo", name: "Bola de Fogo", dice: "3d6" }, { id: "gelo", name: "Lança de Gelo" }];
  w.eval("salvarMagias({ imediato: true })");
  S.abilities = [{ id: "golpe", nome: "Golpe Sombrio", dice: "2d6", custo: "3", acao: "Ação", desc: "Ataque \"forte\"." }];
  w.eval("salvarHabilidades({ imediato: true })");
  w.__T.setPop(S.backpackItems[0]); w.eval("equiparItemAtual('mainHand')");
  ok(S.backpackItems.filter((i) => i.id === "adaga").length === 1, "equipar uma adaga NÃO faz a outra adaga sumir");
  w.__T.setPop(S.backpackItems.find((i) => i.id === "espada")); w.eval("equiparItemAtual('mainHand')");
  w.eval("desequiparSlot('mainHand')");
  w.__T.setPop(S.backpackItems.find((i) => i.id === "pocao")); w.eval("descartarItemAtual()");
  w.__T.setPop(S.backpackItems.find((i) => i.uid === "ub02")); w.eval("equiparItemAtual('offHand')");
  w.__T.setPop(S.backpackItems.find((i) => i.uid === "ue05")); w.eval("ajustarQuantidadeItemAtual(5)"); // flechas 10 -> 15
  const esperadoPos = JSON.stringify(S.backpackItems.map((i) => [i.uid, i.col, i.row, i.quantity]).sort());
  const esperadoMochila = S.backpackItems.map((i) => i.uid).sort().join(","), esperadoMain = S.equipped.mainHand?.uid ?? null, esperadoOff = S.equipped.offHand?.uid ?? null;
  console.log(`   (antes de fechar: mochila=[${esperadoMochila}] mãoPrincipal=${esperadoMain} mãoSecundária=${esperadoOff})`);
  await w.esperarSalvo();
  ok(w.$("#save-status").textContent === "Salvo ✓", "indicador mostra 'Salvo ✓'");
  const antes = { vit: JSON.stringify(S.vitals), per: S.skills.filter((s) => s.mod).map((s) => s.id + ":" + s.mod).join(",") };
  w.close();

  console.log("2) FECHA TUDO: derruba o servidor (SIGKILL) e sobe de novo");
  await parar(); await iniciar();
  const t2 = (await login("eva", false)).token;

  console.log("3) Abre a ficha de novo e confere na tela");
  w = await abrirFicha(t2, nomePasta);
  const S2 = w.__T.STATE, v = (s) => w.$(s).value;
  ok(w.__T.loaded, "ficha carregou de novo");
  ok(v("#char-name-input") === "Eva Sombria" && v("#char-class-input") === "Necromante", "nome e classe");
  ok(v("[data-campo='perfil.origem']") === "Vale Cinzento" && v("[data-campo='perfil.idade']") === "31 Ciclos" && v("[data-campo='perfil.alinhamento']") === "Neutro" && v("[data-campo='perfil.divindade']") === "A Dama Pálida", "origem, idade, alinhamento, divindade/pacto");
  ok(v("#bio-history-text") === "Nasceu no vale.\nPerdeu tudo." && v("#bio-scars-text") === "• Marca no ombro\n• Medo de fogo" && v("#bio-notes-text") === "Devo 50 pratas — \"Kael\" & cia", "história, cicatrizes e anotações");
  ok(JSON.stringify(S2.vitals) === antes.vit, "vitais (hp/vigor/sanidade)");
  ok(S2.skills.filter((s) => s.mod).map((s) => s.id + ":" + s.mod).join(",") === antes.per, "perícias");
  ok(v("#progression-val-input") === "12", "progressão (Nv/Ex) na tela");
  ok(w.$("#char-avatar-img").src === "https://exemplo.com/eva.png" && w.$("#char-bio-portrait").src === "https://exemplo.com/eva.png", "avatar (topo e biografia)");
  ok(v("#coin-gold") === "150" && v("#coin-silver") === "64" && v("#coin-copper") === "310" && v("#coin-blood") === "2", "moedas (ouro, prata, cobre, sangue)");
  ok(w.$("#riches-summary").innerText === "150 PO • 64 PP • 310 PC", "resumo das moedas");
  ok(S2.backpackItems.map((i) => i.uid).sort().join(",") === esperadoMochila, "mochila (itens que sobraram, incluindo a adaga repetida)");
  ok((S2.equipped.mainHand?.uid ?? null) === esperadoMain && (S2.equipped.offHand?.uid ?? null) === esperadoOff, "itens equipados");
  ok(S2.backpackItems.every((i) => i.id !== "pocao"), "poção descartada continua descartada");
  ok(S2.backpackItems.find((i) => i.uid === "ue05")?.quantity === 15, "pilha de flechas: quantidade 15 persistiu");
  ok(JSON.stringify(S2.backpackItems.map((i) => [i.uid, i.col, i.row, i.quantity]).sort()) === esperadoPos, "uid, posição e quantidade de cada item idênticos");
  ok(S2.backpackItems.filter((i) => i.id === "adaga").length + (S2.equipped.offHand?.id === "adaga" ? 1 : 0) + (S2.equipped.mainHand?.id === "adaga" ? 1 : 0) === 2, "as duas adagas continuam existindo (uma equipada, uma na mochila)");
  ok(["FOR:3", "DES:2", "INT:1", "SAB:0", "PRE:5", "VON:4"].every((p) => { const [k, x] = p.split(":"); return v(`[data-campo='atributos.${k}']`) === x && S2.atributos[k] === Number(x); }), "atributos (6 campos na tela e no estado)");
  ok(S2.spells.length === 2 && S2.spells[0].name === "Bola de Fogo" && S2.spells[0].dice === "3d6", "magias.json");
  ok(S2.abilities.length === 1 && S2.abilities[0].nome === "Golpe Sombrio" && S2.abilities[0].desc === "Ataque \"forte\".", "habilidades.json");
  w.eval("trocarAba(4)");
  ok(/Golpe Sombrio/.test(w.$("#abilities-container").textContent), "habilidade aparece na aba do códice");
  ok(w.$("#save-status").textContent === "", "reabrir não marca nada como alterado");
  w.close(); await parar();

  console.log("3b) Personagem ANTIGO (inventário sem uid, itens sobrepostos)");
  await iniciar();
  const t3 = (await login("eva", false)).token;
  const { personagem: p2 } = await fetch(base + "/api/personagens", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t3 }, body: JSON.stringify({ nome: "Velho" }) }).then((r) => r.json());
  const dir2 = `players/eva/${p2.nomePasta}`;
  fs.writeFileSync(`${dir2}/inventario.json`, JSON.stringify({ schemaVersion: 1, items: [{ id: "adaga", name: "Adaga", w: 1, h: 1, col: 1, row: 1, weight: 1, type: "Arma" }, { id: "adaga", name: "Adaga", w: 1, h: 1, col: 1, row: 1, weight: 1, type: "Arma" }], equipped: { mainHand: null, offHand: null, back: null, backpack: null } }));
  let wv = await abrirFicha(t3, p2.nomePasta);
  const uids1 = wv.__T.STATE.backpackItems.map((i) => i.uid);
  ok(uids1.length === 2 && uids1.every(Boolean) && new Set(uids1).size === 2, "duas adagas antigas ganham uids diferentes");
  ok(new Set(wv.__T.STATE.backpackItems.map((i) => `${i.col},${i.row}`)).size === 2, "e deixam de se sobrepor");
  await wv.esperarSalvo(); wv.close();
  await parar(); await iniciar();
  const t4 = (await login("eva", false)).token;
  wv = await abrirFicha(t4, p2.nomePasta);
  ok(JSON.stringify(wv.__T.STATE.backpackItems.map((i) => i.uid)) === JSON.stringify(uids1), "depois de reiniciar, os uids são os mesmos (estáveis)");
  ok(JSON.parse(fs.readFileSync(`${dir2}/inventario.json`, "utf8")).items.every((i) => i.uid && i.quantity === 1 && i.maxStack === 1), "inventario.json em disco tem uid, quantity e maxStack");
  wv.close(); await parar();

  console.log("4) Arquivos em disco");
  const disco = (a) => JSON.parse(fs.readFileSync(`${dir}/${a}.json`, "utf8"));
  ok(["perfil", "atributos", "status", "pericias", "inventario", "magias", "habilidades", "biografia", "riquezas"].every((a) => fs.existsSync(`${dir}/${a}.json`)), "os 9 JSON existem");
  ok(!fs.existsSync(`${dir}/backpack.json`), "backpack.json não existe (só inventario.json)");
  ok(disco("atributos").PRE === 5 && disco("magias").items.length === 2 && disco("habilidades").items.length === 1, "atributos.json, magias.json e habilidades.json em disco");
  ok(disco("riquezas").sangue === 2 && (disco("perfil").progressao.nv === "12" || disco("perfil").progressao.ex === "12"), "riquezas.json e perfil.json com os valores novos");

  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nCRITÉRIO ATENDIDO: alterou tudo -> fechou -> abriu -> 100% presente");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error("ERRO NO TESTE:", e); try { srv.kill("SIGKILL"); } catch {} process.exit(1); });

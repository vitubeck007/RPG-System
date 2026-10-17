const { JSDOM, VirtualConsole } = require("jsdom");
const vm = require("node:vm");
// Sem ruído: o log [RPG] da ficha só aparece com VERBOSE=1; erros reais do jsdom sempre aparecem.
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => console.error("[jsdom]", e.message));
if (process.env.VERBOSE) vc.sendTo(console);
const fs = require("fs");
let falhas = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) falhas++; };
const RAIZ = process.cwd();
const htmlOriginal = fs.readFileSync(RAIZ + "/index.html", "utf8");
const html = htmlOriginal.replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const scripts = [...htmlOriginal.matchAll(/<script src="(JS\/[^"]+)"/g)].map((m) =>
  fs.readFileSync(RAIZ + "/" + m[1], "utf8").replace(/^\uFEFF/, ""),
);

// Cria uma ficha nova (jsdom) já carregada com o inventário informado.
function ficha(inventario, extra = {}) {
  const dom = new JSDOM(html, { virtualConsole: vc, runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  w.sessionStorage.setItem("rpg_character", JSON.stringify({ player: "bia", nomePasta: "A_1" }));
  w.sessionStorage.setItem("rpg_token", "t");
  const h = {}, em = [];
  const sock = {
    connected: true,
    id: "s",
    on: (e, f) => {
      const anterior = h[e];
      h[e] = (...args) => {
        anterior?.(...args);
        f(...args);
      };
    },
    emit: (e, d) => em.push([e, d]),
    connect() {},
  };
  w.io = () => sock; w.scrollTo = () => {};
  const contexto = dom.getInternalVMContext();
  for (const codigo of scripts) new vm.Script(codigo).runInContext(contexto);
  new vm.Script("window.__T={STATE,BALANCEAMENTO,setPop:(i)=>{itemPopoverAtual=i;},get sem(){return [...itensSemEspaco]},get emVoo(){return {...emVoo}}};").runInContext(contexto);
  w.dispatchEvent(new w.Event("DOMContentLoaded"));
  const carga = () => ({ player: "bia", nomePasta: "A_1", perfil: { schemaVersion: 1, id: "1", nome: "A", progressao: { ex: "0%", nv: "1" }, avatar: "" }, biografia: {}, atributos: {}, status: { hp: { current: 5, max: 5 }, vigor: { current: 0, max: 0 }, sanity: { current: 0, max: 0 } }, pericias: { skills: {} }, inventario, magias: { items: [] }, habilidades: { items: [] }, ...extra });
  h.sync_config({ AtivarSlotMochila: true, AtivarMana: true, AtivarRiquezas: true, UsarEx: false });
  h.personagem_carregado(carga());
  return { w, h, em, S: w.__T.STATE, T: w.__T, recarregar: () => h.personagem_carregado(carga()),
    saves: (a) => em.filter(([e, d]) => e === "salvar_personagem" && d.arquivo === a),
    equipar: (item, slot) => { w.__T.setPop(item); w.eval(`equiparItemAtual('${slot}')`); },
    descartar: (item) => { w.__T.setPop(item); w.eval("descartarItemAtual()"); },
    quantidade: (item, d) => { w.__T.setPop(item); w.eval(`ajustarQuantidadeItemAtual(${d})`); },
    toasts: () => [...w.document.querySelectorAll("#toast-container span")].map((s) => s.textContent) };
}
const it = (id, uid, w = 1, h = 1, col, row, extra = {}) => ({ id, name: id, uid, w, h, col, row, weight: 1, type: "Arma", color: "from-amber-950/80 to-stone-900 border-amber-600/70", icon: "fa-khanda", ...extra });
const vazio = { hand: null, offHand: null, back: null, backpack: null };
const eq = (o = {}) => ({ mainHand: null, offHand: null, back: null, backpack: null, ...o });
const sobrepoe = (l) => l.some((a, i) => l.some((b, j) => i < j && a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h));
const dentro = (l, c, r) => l.every((i) => i.col >= 1 && i.row >= 1 && i.col + i.w - 1 <= c && i.row + i.h - 1 <= r);

console.log("1) uid: instâncias duplicadas são itens distintos");
{
  const f = ficha({ items: [it("adaga", "u1", 1, 1, 1, 1), it("adaga", "u2", 1, 1, 2, 1), it("espada", "u3", 1, 3, 3, 1)], equipped: eq() });
  const ids = [...f.w.document.querySelectorAll("[id]")].map((e) => e.id);
  ok(new Set(ids).size === ids.length, "nenhum id repetido no DOM (item-node-<uid>)");
  ok(!!f.w.document.getElementById("item-node-u1") && !!f.w.document.getElementById("item-node-u2"), "as duas adagas têm elementos próprios");
  f.equipar(f.S.backpackItems[0], "mainHand");
  ok(f.S.equipped.mainHand.uid === "u1" && f.S.backpackItems.map((i) => i.uid).join() === "u2,u3", "equipar u1 deixa u2 na mochila");
  f.descartar(f.S.backpackItems.find((i) => i.uid === "u2"));
  ok(f.S.backpackItems.map((i) => i.uid).join() === "u3" && f.S.equipped.mainHand.uid === "u1", "descartar u2 não afeta u1 (equipada)");
}

console.log("2) pilhas: quantidade, limite e peso");
{
  const pocao = it("pocao", "p1", 1, 1, 1, 1, { type: "Consumível", weight: 0.5, quantity: 3, maxStack: 5, name: "Poção" });
  const f = ficha({ items: [pocao, it("espada", "e1", 1, 3, 2, 1)], equipped: eq() });
  const p = f.S.backpackItems[0];
  ok(/×3/.test(f.w.document.getElementById("item-node-p1").textContent), "badge ×3 aparece na grade");
  ok(/2\.5 kg/.test(f.w.document.getElementById("backpack-weight-label").textContent), "peso da mochila = 3×0,5 (pilha) + 1 (espada) = 2,5 kg");
  f.w.__T.setPop(p); f.w.abrirItemPopover(p, f.w.document.getElementById("item-node-p1"));
  ok(!f.w.document.getElementById("popover-qty-row").classList.contains("hidden"), "balão mostra controle de quantidade (item empilhável)");
  ok(f.w.document.getElementById("popover-qty-label").innerText === "3/5", "rótulo 3/5");
  f.em.length = 0;
  f.quantidade(p, +1); f.quantidade(p, +1);
  ok(p.quantity === 5, "+ até o máximo (5)");
  f.quantidade(p, +1);
  ok(p.quantity === 5 && f.toasts().some((t) => /Pilha cheia/.test(t)), "além do máximo: recusa e avisa");
  f.quantidade(p, -4);
  ok(p.quantity === 1, "− limita em 1");
  f.quantidade(p, -1);
  ok(p.quantity === 1 && f.toasts().some((t) => /Descartar/.test(t)), "abaixo de 1: recusa (usar Descartar)");
  ok(f.saves("inventario").length >= 2 && f.saves("inventario").at(-1)[1].dados.items[0].quantity === 1, "cada mudança de quantidade é salva");
  f.w.__T.setPop(f.S.backpackItems[1]); f.w.abrirItemPopover(f.S.backpackItems[1], f.w.document.getElementById("item-node-e1"));
  ok(f.w.document.getElementById("popover-qty-row").classList.contains("hidden"), "item não empilhável: sem controle de quantidade");
  f.descartar(p);
  ok(f.S.backpackItems.length === 1, "Descartar remove a pilha inteira");
}

console.log("3) capacidade: espaço fragmentado não engana");
{
  // 3x3 (bolsos). Linha do meio ocupada: 6 células livres, mas nenhuma coluna livre de 3 em altura.
  const espada = it("espada", "s1", 1, 3);
  const f = ficha({ items: [it("a", "m1", 1, 1, 1, 2), it("b", "m2", 1, 1, 2, 2), it("c", "m3", 1, 1, 3, 2)], equipped: eq({ mainHand: espada }) });
  f.em.length = 0;
  f.w.eval("desequiparSlot('mainHand')");
  ok(f.S.equipped.mainHand?.uid === "s1" && f.S.backpackItems.length === 3, "sem espaço contíguo: item continua equipado");
  ok(f.toasts().some((t) => /Sem espaço/.test(t)) && f.saves("inventario").length === 0, "avisa e não salva nada");
  f.descartar(f.S.backpackItems.find((i) => i.uid === "m1"));
  f.em.length = 0;
  f.w.eval("desequiparSlot('mainHand')");
  const s = f.S.backpackItems.find((i) => i.uid === "s1");
  ok(!!s && f.S.equipped.mainHand === null, "com uma coluna livre, o item volta à mochila");
  ok(s.col === 1 && s.row === 1, "e é colocado na primeira posição livre (1,1)");
  ok(!sobrepoe(f.S.backpackItems) && dentro(f.S.backpackItems, 3, 3), "sem sobreposição e dentro da grade");
  ok(f.saves("inventario").length === 1, "salvo uma vez");
}

console.log("4) capacidade: trocar/tirar mochila só se tudo couber");
{
  const tatica = it("mochila-tatica", "b1", 1, 1, undefined, undefined, { backpackType: "tatica", isBackpackItem: true, weight: 2 });
  const itens = [it("q1", "q1", 2, 2, 1, 1), it("q2", "q2", 2, 2, 3, 1), it("q3", "q3", 2, 2, 1, 3), it("q4", "q4", 2, 2, 3, 3), it("m", "m", 1, 1, 5, 1)];
  const f = ficha({ items: itens, equipped: eq({ backpack: tatica }) });
  ok(f.w.document.getElementById("grid-dimensions-label").innerText.includes("5x4"), "grade ativa 5x4 (mochila tática)");
  f.em.length = 0;
  f.w.eval("desequiparSlot('backpack')");
  ok(f.S.equipped.backpack?.uid === "b1" && f.S.backpackItems.length === 5, "tirar a mochila com 17 células ocupadas: recusado (bolsos = 9)");
  ok(f.toasts().some((t) => /não cabem/.test(t)) && f.saves("inventario").length === 0, "avisa; nada muda; nada é salvo");
  ["q2", "q3", "q4"].forEach((u) => f.descartar(f.S.backpackItems.find((i) => i.uid === u)));
  f.em.length = 0;
  f.w.eval("desequiparSlot('backpack')");
  ok(f.S.equipped.backpack === null && f.S.backpackItems.length === 3, "depois de liberar espaço, a mochila sai");
  ok(!sobrepoe(f.S.backpackItems) && dentro(f.S.backpackItems, 3, 3), "todos reacomodados dentro de 3x3 sem sobreposição");
  ok(f.w.document.getElementById("grid-dimensions-label").innerText.includes("3x3"), "grade passa a 3x3");
}

console.log("5) equipar arma de 2 mãos é tudo-ou-nada");
{
  const duas = it("montante", "t1", 1, 1, 1, 1, { twoHanded: true });
  const cheios = [duas, ...["a", "b", "c", "d", "e", "f", "g", "h"].map((n, i) => it(n, "x" + n, 1, 1, ((i + 1) % 3) + 1, Math.floor((i + 1) / 3) + 1))];
  const f = ficha({ items: cheios, equipped: eq({ mainHand: it("espada", "m1"), offHand: it("escudo", "o1") }) });
  ok(f.S.backpackItems.length === 9 && !sobrepoe(f.S.backpackItems), "grade 3x3 cheia (9 itens)");
  f.em.length = 0;
  f.equipar(duas, "mainHand");
  ok(f.S.equipped.mainHand.uid === "m1" && f.S.equipped.offHand.uid === "o1" && f.S.backpackItems.length === 9, "espada e escudo devolvidos não cabem: NADA muda");
  ok(f.saves("inventario").length === 0, "e nada é salvo");
  f.descartar(f.S.backpackItems.find((i) => i.uid === "xa"));
  f.equipar(duas, "mainHand");
  ok(f.S.equipped.mainHand.uid === "t1" && f.S.equipped.offHand === null, "com espaço para os dois devolvidos, equipa");
  ok(f.S.backpackItems.some((i) => i.uid === "m1") && f.S.backpackItems.some((i) => i.uid === "o1") && !sobrepoe(f.S.backpackItems), "espada e escudo voltaram à mochila sem sobreposição");
}

console.log("6) dados antigos: uid ausente e itens sobrepostos são reparados ao carregar");
{
  const antigo = [{ id: "adaga", name: "Adaga", w: 1, h: 1, col: 1, row: 1, weight: 1, type: "Arma" }, { id: "adaga", name: "Adaga", w: 1, h: 1, col: 1, row: 1, weight: 1, type: "Arma" }, { id: "corda", name: "Corda", w: 2, h: 1, col: 1, row: 1, weight: 1, type: "Item" }];
  const f = ficha({ items: antigo, equipped: eq() });
  const uids = f.S.backpackItems.map((i) => i.uid);
  ok(uids.every(Boolean) && new Set(uids).size === 3, "todos ganham uid, sem repetição");
  ok(!sobrepoe(f.S.backpackItems) && dentro(f.S.backpackItems, 3, 3), "posições reorganizadas (sem sobreposição)");
  ok(f.saves("inventario").length === 1, "a correção é salva automaticamente");
  const cheio = Array.from({ length: 11 }, (_, i) => it("i" + i, "z" + i, 1, 1, 1, 1));
  const g = ficha({ items: cheio, equipped: eq() });
  ok(g.T.sem.length === 2 && g.toasts().some((t) => /não cabem/.test(t)), "11 itens em 9 células: 2 marcados 'sem espaço' + aviso (nenhum é apagado)");
  ok(g.S.backpackItems.length === 11, "nenhum item foi perdido");
}

console.log("7) adicionarItemAoInventario: completa pilhas, cria novas, respeita a capacidade");
{
  const f = ficha({ items: [], equipped: eq() });
  const modelo = { id: "pocao", name: "Poção", type: "Consumível", weight: 0.5, w: 1, h: 1, maxStack: 5, icon: "fa-flask", color: "from-emerald-950/80 to-stone-900 border-emerald-600/70" };
  let r = f.w.eval("adicionarItemAoInventario").call(null, modelo, 12);
  ok(r.adicionado === 12 && r.sobrou === 0, "12 poções (maxStack 5) entram");
  ok(f.S.backpackItems.map((i) => i.quantity).sort().join() === "2,5,5", "viram 3 pilhas: 5 + 5 + 2");
  ok(new Set(f.S.backpackItems.map((i) => i.uid)).size === 3, "cada pilha tem uid próprio");
  r = f.w.eval("adicionarItemAoInventario").call(null, modelo, 3);
  ok(r.adicionado === 3 && f.S.backpackItems.length === 3 && f.S.backpackItems.map((i) => i.quantity).sort().join() === "5,5,5", "+3 completa a pilha de 2 (sem criar pilha nova)");
  r = f.w.eval("adicionarItemAoInventario").call(null, modelo, 40);
  ok(r.adicionado === 30 && r.sobrou === 10, "grade 3x3 comporta 9 pilhas: entram 30, sobram 10");
  ok(f.toasts().some((t) => /Sem espaço/.test(t)), "avisa o que não coube");
  ok(f.S.backpackItems.length === 9 && !sobrepoe(f.S.backpackItems) && dentro(f.S.backpackItems, 3, 3), "9 pilhas, sem sobreposição");
  ok(f.saves("inventario").length >= 3, "cada adição é salva");
  const g = ficha({ items: [it("espada", "e1", 1, 1, 1, 1)], equipped: eq() });
  r = g.w.eval("adicionarItemAoInventario").call(null, { id: "espada", name: "Espada", w: 1, h: 1, weight: 3, type: "Arma" }, 2);
  ok(g.S.backpackItems.length === 3 && new Set(g.S.backpackItems.map((i) => i.uid)).size === 3, "item não empilhável: 2 unidades = 2 itens com uid próprio");
}

console.log("8) segurança: nomes de item não injetam HTML");
{
  const mau = it("mau", "h1", 1, 1, 1, 1, { name: "<img src=x onerror=window.__pwn=1>", type: "<b>tipo</b>", icon: "fa-x\"onmouseover=\"window.__pwn=2", color: "x\"><script>window.__pwn=3</script>" });
  const f = ficha({ items: [mau], equipped: eq({ mainHand: it("adaga", "h2", 1, 1, undefined, undefined, { name: "D'água \"x\"", dice: "1d4" }) }) });
  f.w.__T.setPop(mau); f.w.abrirItemPopover(f.S.backpackItems[0], f.w.document.getElementById("item-node-h1"));
  ok(!f.w.document.querySelector("#backpack-grid img[src='x']") && !f.w.document.querySelector("#popover-tags b"), "nome/tipo aparecem como texto (sem <img>/<b> criados)");
  ok(f.w.__pwn === undefined, "nenhum script/handler executou");
  ok(/D'água "x"/.test(f.w.document.getElementById("content-mainHand").textContent), "nome com aspas aparece inteiro no slot equipado");
  ok(!/onclick="adicionarAoCombo\('D/.test(f.w.document.getElementById("actions-mainHand").innerHTML), "botão de combo do slot não embute o nome no onclick");
  f.em.length = 0; f.w.eval("enviarSlotParaCombo('mainHand')");
  ok(f.S.combo.some((c) => c.nome === "D'água \"x\""), "combo pelo slot funciona com nome que tem aspas");
  f.equipar(f.S.backpackItems[0], "offHand"); f.w.toast(f.S.equipped.offHand.name);
  ok(![...f.w.document.querySelectorAll("#toast-container img")].length, "toast mostra o nome como texto");
}

console.log("9) carregamento tardio não sobrescreve edição enviada e ainda não confirmada");
{
  const f = ficha({ items: [it("espada", "e1", 1, 1, 1, 1)], equipped: eq() });
  f.w.eval("alterarVital('hp', -3)"); // status enviado, sem ack ainda
  ok(f.T.emVoo.status === 1 && f.S.vitals.hp.current === 2, "hp 5 → 2, envio em andamento");
  f.recarregar(); // resposta de carga antiga (hp 5) chega agora
  ok(f.S.vitals.hp.current === 2, "resposta antiga NÃO reverte o hp");
  f.h.personagem_salvo({ arquivo: "status" });
  f.recarregar();
  ok(f.S.vitals.hp.current === 5, "depois da confirmação, uma carga nova volta a valer");
  const g = ficha({ items: [it("a", "a1", 1, 1, 1, 1)], equipped: eq() });
  g.descartar(g.S.backpackItems[0]);
  g.recarregar();
  ok(g.S.backpackItems.length === 0, "descarte em andamento também é protegido");
}

console.log("10) peso limite ligado à Força (fórmula a definir: bloqueio desligado)");
{
  const f = ficha({ items: [it("pedra", "w1", 1, 1, 1, 1, { weight: 6 })], equipped: eq() });
  const rotulo = () => f.w.document.getElementById("backpack-weight-label").textContent;
  const digitarFor = (v) => { const el = f.w.document.querySelector("[data-campo='atributos.FOR']"); el.value = v; el.dispatchEvent(new f.w.Event("input")); };
  ok(/6\.0 kg/.test(rotulo()) && /a definir/.test(rotulo()), "sem valor definido: mostra só a carga e 'limite: a definir'");
  ok(f.T.BALANCEAMENTO.pesoPorForca === null, "BALANCEAMENTO.pesoPorForca começa indefinido (null)");
  f.T.BALANCEAMENTO.pesoPorForca = 5; // valor de exemplo, só neste teste
  digitarFor("3");
  ok(/6\.0 kg \/ 15\.0 kg/.test(rotulo()) && !/sobrecarregado/.test(rotulo()), "Força 3 × 5 = limite 15 kg; 6 kg está dentro");
  f.w.eval("alterarModPericia('atletismo', 2)");
  ok(/\/ 17\.0 kg/.test(rotulo()), "Atletismo +2 soma ao limite: 17 kg");
  digitarFor("1"); f.w.eval("alterarModPericia('atletismo', -2)");
  ok(/6\.0 kg \/ 5\.0 kg — sobrecarregado/.test(rotulo()), "Força 1 → limite 5 kg: avisa 'sobrecarregado'");
  ok(f.w.document.querySelector("#backpack-weight-label strong").className.includes("crimson"), "carga aparece em vermelho");
  f.equipar(f.S.backpackItems[0], "mainHand");
  ok(f.S.equipped.mainHand?.uid === "w1", "excesso só avisa: ainda dá para equipar/mover itens");
  f.T.BALANCEAMENTO.pesoPorForca = null;
  digitarFor("2");
  ok(/a definir/.test(rotulo()), "voltando a null, a fórmula desliga");
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nINVENTÁRIO: TODOS OS TESTES PASSARAM");
process.exit(falhas ? 1 : 0);

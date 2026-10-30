const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { iniciarServidor, esperarAte } = require("./ajuda/ambiente.js");

it("seleção: exclusão confirmada remove a pasta e persiste após recarregar e reiniciar", async () => {
  const servidor = await iniciarServidor();
  let dom;
  try {
    const login = await servidor.api("/api/login", { nome: "exclusao", senha: "teste", criarSeNaoExistir: true });
    const outro = await servidor.api("/api/login", { nome: "outraConta", senha: "teste", criarSeNaoExistir: true });
    const criar = async (nome) => (await servidor.api("/api/personagens", { nome }, login.token)).personagem;
    const alvo = await criar("Excluir");
    const manter = await criar("Manter");
    const pasta = path.join(servidor.dir, "players", "exclusao", alvo.nomePasta);
    const excluir = (token, nome = alvo.nomePasta) => fetch(`${servidor.url}/api/personagens/${encodeURIComponent(nome)}`, {
      method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    assert.equal((await excluir()).status, 401);
    assert.equal((await excluir(outro.token)).status, 404);
    assert.equal((await excluir(login.token, "../login.json")).status, 400);
    assert.ok(fs.existsSync(pasta));

    dom = new JSDOM(fs.readFileSync(path.join(__dirname, "../login/login.html"), "utf8"), {
      url: `${servidor.url}/selecao`, runScripts: "outside-only",
    });
    const w = dom.window;
    w.AbortController = globalThis.AbortController;
    w.AbortSignal = globalThis.AbortSignal;
    w.sessionStorage.setItem("rpg_player", "exclusao");
    w.sessionStorage.setItem("rpg_token", login.token);
    w.sessionStorage.setItem("rpg_character", JSON.stringify({ player: "exclusao", nomePasta: alvo.nomePasta }));
    w.sessionStorage.setItem("rpg_character_name", alvo.nome);
    w.fetch = (url, options) => fetch(new URL(url, servidor.url), options);
    w.eval(fs.readFileSync(path.join(__dirname, "../JS/interface.js"), "utf8"));
    w.eval([...w.document.scripts].at(-1).textContent);
    await esperarAte(() => w.document.querySelectorAll(".character-card").length === 2);
    w.toggleModoExcluir();
    const card = [...w.document.querySelectorAll(".character-card")].find((c) => c.querySelector('.character-name').textContent === alvo.nome);
    card.querySelector(".trash-icon").click();
    w.cancelarExclusao();
    assert.ok(fs.existsSync(pasta), "cancelar preserva a pasta");
    card.querySelector(".trash-icon").click();
    const fetchReal = w.fetch;
    w.fetch = async () => ({ ok: false, json: async () => ({ success: false, message: "Falha simulada" }) });
    await w.confirmarExclusao();
    assert.equal(w.document.querySelectorAll(".character-card").length, 2, "erro preserva o card");
    assert.ok(fs.existsSync(pasta));
    assert.equal(w.document.getElementById("delete-message").textContent, "Falha simulada");
    assert.equal(w.document.getElementById("modal-confirmar-exclusao").hidden, false);
    w.fetch = fetchReal;
    await w.confirmarExclusao();
    assert.equal(fs.existsSync(pasta), false, "pasta e JSONs removidos");
    assert.equal(w.sessionStorage.getItem("rpg_character"), null);
    assert.equal(w.sessionStorage.getItem("rpg_character_name"), null);
    assert.equal(w.document.querySelectorAll(".character-card").length, 1);
    await w.carregarPersonagens();
    assert.equal(w.document.querySelector(".character-name").textContent, manter.nome);
    assert.ok(fs.existsSync(path.join(servidor.dir, "players", "exclusao", "login.json")));
    await servidor.reiniciar();
    const relogin = await servidor.api("/api/login", { nome: "exclusao", senha: "teste" });
    const lista = await servidor.api("/api/personagens", null, relogin.token);
    assert.deepEqual(lista.personagens.map((p) => p.nomePasta), [manter.nomePasta]);
  } finally {
    dom?.window.close();
    await servidor.parar();
  }
});

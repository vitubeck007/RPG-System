/* Verifica a migração durável de inventários antigos pela ficha e pelo servidor reais. */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { iniciarServidor, abrirFicha } = require("./ajuda/ambiente.js");

describe("migração de inventário legado", { concurrency: false }, () => {
  let servidor;
  let token;
  let player;
  let nomePasta;

  before(async () => {
    servidor = await iniciarServidor();
    player = "migracao";
    const login = await servidor.api("/api/login", {
      nome: player,
      senha: "teste",
      criarSeNaoExistir: true,
    });
    token = login.token;
    const criado = await servidor.api(
      "/api/personagens",
      { nome: "Personagem antigo" },
      token,
    );
    nomePasta = criado.personagem.nomePasta;

    const caminhoInventario = path.join(
      servidor.dir,
      "players",
      player,
      nomePasta,
      "inventario.json",
    );
    fs.writeFileSync(
      caminhoInventario,
      JSON.stringify({
        schemaVersion: 1,
        items: [
          { id: "adaga", name: "Adaga", w: 1, h: 1, col: 1, row: 1, weight: 1, type: "Arma" },
          { id: "adaga", name: "Adaga", w: 1, h: 1, col: 1, row: 1, weight: 1, type: "Arma" },
        ],
        equipped: { mainHand: null, offHand: null, back: null, backpack: null },
      }),
      "utf8",
    );
  });

  after(async () => {
    await servidor?.parar();
  });

  it("atribui UIDs únicos, corrige posições e mantém a migração após reiniciar", async () => {
    let ficha = await abrirFicha(servidor, { player, nomePasta, token });
    const itens = ficha.run("STATE.backpackItems");
    const uids = itens.map((item) => item.uid);
    const posicoes = itens.map((item) => `${item.col},${item.row}`);

    assert.equal(itens.length, 2);
    assert.ok(uids.every(Boolean), "cada item recebe UID");
    assert.equal(new Set(uids).size, 2, "itens iguais recebem UIDs distintos");
    assert.equal(new Set(posicoes).size, 2, "itens não permanecem sobrepostos");
    await ficha.salvos();
    assert.deepEqual(
      servidor.lerArquivo(player, nomePasta, "inventario").items.map((item) => item.uid),
      uids,
      "os UIDs migrados são gravados no disco",
    );
    ficha.fechar();

    await servidor.reiniciar();
    const novoLogin = await servidor.api("/api/login", { nome: player, senha: "teste" });
    ficha = await abrirFicha(servidor, {
      player,
      nomePasta,
      token: novoLogin.token,
    });
    assert.deepEqual(
      ficha.run("STATE.backpackItems.map((item) => item.uid)"),
      uids,
      "os UIDs permanecem estáveis depois do reinício",
    );
    ficha.fechar();
  });
});

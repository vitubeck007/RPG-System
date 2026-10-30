/* Arquivos individuais derivados da campanha. A campanha é a referência para reconstrução,
   backups e recuperação de uma interrupção entre gravações. Não serve arquivos por HTTP. */
const fs = require("node:fs");
const path = require("node:path");
const { gravarJson, gravarJsonAsync, ehIdSeguro } = require("./personagem.js");

function nomePastaFigurante(item) {
  const nome = item.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Figurante";
  if (!ehIdSeguro(item.id)) throw new Error("Identificador de figurante inválido.");
  return `${nome}_${item.id}`;
}

function mesmoCaminho(a, b) {
  const normalizar = valor => process.platform === "win32" ? path.resolve(valor).toLowerCase() : path.resolve(valor);
  return normalizar(a) === normalizar(b);
}

function pastaSegura(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  if (fs.lstatSync(pasta).isSymbolicLink() || !mesmoCaminho(fs.realpathSync(pasta), pasta)) {
    throw new Error(`A pasta de figurantes não pode ser um link: ${pasta}`);
  }
}

function sincronizarFigurantes(raiz, tipo, itens) {
  if (!["npcs", "inimigos"].includes(tipo)) throw new Error("Tipo de figurante inválido.");
  pastaSegura(raiz);
  const pasta = path.join(path.resolve(raiz), tipo === "npcs" ? "NPCs" : "Inimigos");
  pastaSegura(pasta);
  const manter = new Set();
  const chave = (nome) => process.platform === "win32" ? nome.toLowerCase() : nome;
  for (const item of itens) {
    const nome = nomePastaFigurante(item);
    manter.add(chave(nome));
    const destino = path.join(pasta, nome);
    pastaSegura(destino);
    const arquivo = path.join(destino, "figurante.json");
    if (fs.existsSync(arquivo) && fs.lstatSync(arquivo).isSymbolicLink()) throw new Error("Arquivo de figurante não pode ser um link.");
    const registro = { schemaVersion: 1, tipo: tipo === "npcs" ? "npc" : "inimigo", ...item };
    if (!fs.existsSync(arquivo) || fs.readFileSync(arquivo, "utf8") !== JSON.stringify(registro, null, 2)) gravarJson(arquivo, registro);
  }
  // Só remove o JSON gerenciado de registros antigos. Outros arquivos do usuário são preservados.
  for (const entrada of fs.readdirSync(pasta, { withFileTypes: true })) {
    if (!entrada.isDirectory() || manter.has(chave(entrada.name))) continue;
    const destino = path.resolve(pasta, entrada.name);
    if (!mesmoCaminho(path.dirname(destino), pasta) || !mesmoCaminho(fs.realpathSync(destino), destino)) continue;
    const arquivo = path.join(destino, "figurante.json");
    try {
      if (fs.lstatSync(arquivo).isSymbolicLink()) continue;
      const antigo = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      if (!ehIdSeguro(antigo.id) || chave(entrada.name) !== chave(nomePastaFigurante(antigo))) continue;
    } catch { continue; }
    fs.unlinkSync(arquivo);
    if (fs.readdirSync(destino).length === 0) fs.rmdirSync(destino);
  }
}

async function pastaSeguraAsync(pasta) {
  await fs.promises.mkdir(pasta, { recursive: true });
  if ((await fs.promises.lstat(pasta)).isSymbolicLink() || !mesmoCaminho(await fs.promises.realpath(pasta), pasta)) {
    throw new Error(`A pasta de figurantes não pode ser um link: ${pasta}`);
  }
}

// Com a lista anterior, só toca no disco para inclusões, alterações, renomeações e exclusões.
// Sem ela, reconcilia tudo: usado na recuperação e na restauração de backup.
async function sincronizarFigurantesAsync(raiz, tipo, itens, anteriores = null) {
  if (!["npcs", "inimigos"].includes(tipo)) throw new Error("Tipo de figurante inválido.");
  await pastaSeguraAsync(raiz);
  const pasta = path.join(path.resolve(raiz), tipo === "npcs" ? "NPCs" : "Inimigos");
  await pastaSeguraAsync(pasta);
  const chave = nome => process.platform === "win32" ? nome.toLowerCase() : nome;
  const manter = new Set(itens.map(item => chave(nomePastaFigurante(item))));
  const antigos = new Map((anteriores || []).map(item => [item.id, JSON.stringify(item)]));
  for (const item of itens) {
    if (anteriores && antigos.get(item.id) === JSON.stringify(item)) continue;
    const destino = path.join(pasta, nomePastaFigurante(item));
    await pastaSeguraAsync(destino);
    const arquivo = path.join(destino, "figurante.json");
    let existe = false;
    try {
      existe = true;
      if ((await fs.promises.lstat(arquivo)).isSymbolicLink()) throw new Error("Arquivo de figurante não pode ser um link.");
    } catch (erro) { if (erro.code === "ENOENT") existe = false; else throw erro; }
    const registro = { schemaVersion: 1, tipo: tipo === "npcs" ? "npc" : "inimigo", ...item };
    if (anteriores || !existe || await fs.promises.readFile(arquivo, "utf8") !== JSON.stringify(registro, null, 2)) {
      await gravarJsonAsync(arquivo, registro);
    }
  }
  const candidatos = anteriores
    ? anteriores.map(nomePastaFigurante)
    : (await fs.promises.readdir(pasta, { withFileTypes: true })).filter(entrada => entrada.isDirectory()).map(entrada => entrada.name);
  for (const nome of new Set(candidatos)) {
    if (manter.has(chave(nome))) continue;
    const destino = path.resolve(pasta, nome);
    if (!mesmoCaminho(path.dirname(destino), pasta)) continue;
    const arquivo = path.join(destino, "figurante.json");
    try {
      if (!mesmoCaminho(await fs.promises.realpath(destino), destino) || (await fs.promises.lstat(arquivo)).isSymbolicLink()) continue;
      const antigo = JSON.parse(await fs.promises.readFile(arquivo, "utf8"));
      if (!ehIdSeguro(antigo.id) || chave(nome) !== chave(nomePastaFigurante(antigo))) continue;
    } catch { continue; }
    await fs.promises.unlink(arquivo);
    if ((await fs.promises.readdir(destino)).length === 0) {
      try { await fs.promises.rmdir(destino); } catch (erro) { if (erro.code !== "ENOTEMPTY" && erro.code !== "ENOENT") throw erro; }
    }
  }
}

module.exports = { sincronizarFigurantes, sincronizarFigurantesAsync, nomePastaFigurante };

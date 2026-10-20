/* Arquivos individuais derivados da campanha. A campanha é a referência para reconstrução,
   backups e recuperação de uma interrupção entre gravações. Não serve arquivos por HTTP. */
const fs = require("node:fs");
const path = require("node:path");
const { gravarJson, ehIdSeguro } = require("./personagem.js");

function nomePastaFigurante(item) {
  const nome = item.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Figurante";
  if (!ehIdSeguro(item.id)) throw new Error("Identificador de figurante inválido.");
  return `${nome}_${item.id}`;
}

function pastaSegura(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  if (fs.lstatSync(pasta).isSymbolicLink() || fs.realpathSync(pasta) !== path.resolve(pasta)) {
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
    if (path.dirname(destino) !== pasta || fs.realpathSync(destino) !== destino) continue;
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

module.exports = { sincronizarFigurantes, nomePastaFigurante };

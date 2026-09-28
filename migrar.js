/* Migra todos os personagens existentes em players/<conta>/<personagem>/ para o
   formato oficial (ver personagem.js).
   Uso:  node migrar.js --dry-run   (só mostra o que mudaria)
         node migrar.js             (aplica; guarda cópia em _backup_pre_schema/) */
const fs = require("fs");
const path = require("path");
const { migrarPasta } = require("./personagem");

const dryRun = process.argv.includes("--dry-run");
const playersPath = path.join(__dirname, "players");

if (!fs.existsSync(playersPath)) {
  console.log("Pasta players/ não encontrada. Nada a migrar.");
  process.exit(0);
}

const subpastas = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

let total = 0, comMudanca = 0, comErro = 0;

for (const conta of subpastas(playersPath)) {
  for (const personagem of subpastas(path.join(playersPath, conta))) {
    total++;
    const dir = path.join(playersPath, conta, personagem);
    const { alterados, erros } = migrarPasta(dir, { dryRun });
    if (alterados.length) comMudanca++;
    if (erros.length) comErro++;
    if (alterados.length || erros.length) {
      console.log(`\n${conta}/${personagem}`);
      alterados.forEach((a) => console.log(`  ${dryRun ? "mudaria" : "ok"}: ${a}`));
      erros.forEach((e) => console.log(`  ERRO: ${e}`));
    }
  }
}

console.log(`\n${dryRun ? "[DRY-RUN] " : ""}${total} personagem(ns): ${comMudanca} com alterações, ${comErro} com erro.`);

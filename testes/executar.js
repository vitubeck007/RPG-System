/* Roda TODOS os testes (testes/*.test.js) em qualquer sistema e versão do Node (o npm no Windows não expande
   "*.test.js", e o Node mais novo não aceita pasta no lugar de arquivos). Uso: npm test */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const arquivos = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join(__dirname, f));
const args = ["--test"];
// Limite por teste (evita travar para sempre), quando esta versão do Node suporta.
if (process.allowedNodeEnvironmentFlags.has("--test-timeout")) args.push("--test-timeout=240000");
const r = spawnSync(process.execPath, [...args, ...arquivos], { stdio: "inherit" });
process.exit(r.status ?? 1);

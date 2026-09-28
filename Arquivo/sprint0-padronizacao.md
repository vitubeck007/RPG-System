# Sprint 0 — Padronização

Base: análise de `server.js`, `index.js`, `index.html`, `mestre.html`, `config.json`.
Nenhuma funcionalidade nova. Só define a fundação e lista o que precisa ser corrigido para chegar nela.

---

## 1. Diagnóstico: o que existe hoje

| # | Problema | Onde | Efeito |
|---|----------|------|--------|
| 1 | `criarArquivosPersonagem` cria `backpack, status, habilidades, magias`, mas `carregarPersonagem` exige `backpack, status, pericias, magias` | server.js | Personagem novo não carrega ("Arquivo ausente" → `personagem_erro` → volta para `/selecao`). `habilidades.json` é criado e nunca lido |
| 2 | Botões de sanidade chamam `alterarVital('sanidade', ±1)`, mas o código só conhece `sanity` | index.html (l.176/178) | Botões não fazem nada (`STATE.vitals['sanidade']` é `undefined`) |
| 3 | `mestre.html` lê `v.hpMax`, `v.mana`, `v.manaMax`, `v.stress`, `v.stressMax` (formato plano). O servidor envia `{hp:{current,max}, vigor:{…}, sanity:{…}}` | mestre.html (l.246–307) | Painel do mestre mostra `undefined`/`NaN` |
| 4 | Mestre envia tipos `mana` e `stress` em `master_adjust_vital`; o servidor só aceita `hp, vigor, sanity` | mestre.html l.292/307 × server.js | Ajustes de vigor e sanidade são recusados |
| 5 | O servidor bloqueia `type === "mana"` quando `AtivarMana` é falso, mas `"mana"` nem é um tipo válido; o tipo real (`vigor`) não é bloqueado | server.js | Regra de mesa não vale no servidor |
| 6 | Mesmo conceito com 3 nomes: `vigor` (dados) → `mana` (ids DOM, cor Tailwind, flag) e `sanity` → `stress` | index.js `atualizarBarras`, ids `mana-*`/`stress-*`, tailwind config | Mapeamento manual em vários lugares |
| 7 | Loader do cliente aceita 3 formatos de mochila, 3 de perícias, 2 de magias, e vitais planos legados (`hpMax`, `mana`, `stress`) | index.js `personagem_carregado` | Não há formato oficial; cada arquivo pode estar em um formato |
| 8 | Defaults de config em 3 lugares com valores diferentes: `DEFAULT_CONFIG` (UsarEx `true`), `GLOBAL_CONFIG` do cliente (UsarEx `false`, SlotMochila `true`), `config.json` | server.js, index.js, config.json | Comportamento depende de qual carregou primeiro |
| 9 | Nome, classe, progressão, biografia (3 textareas), avatar, moedas, habilidades: só existem no DOM/HTML; não são salvos nem carregados | index.html / index.js | Perdem-se ao recarregar |
| 10 | Nome do personagem vem do nome da pasta (`nome_1234`), e o campo de nome só dispara `player_update`, nunca salva | index.js / server.js | Não há fonte oficial do nome |
| 11 | `pericias.json` grava `name`, `icon`, `attr` de cada perícia junto com o `mod` | index.js `salvarPericias` | Dado de catálogo duplicado em cada ficha; strings corrompidas ficam gravadas |
| 12 | Strings com codificação corrompida no código: "Sobrevivíªncia", "Consumí­vel", "Perí­cia" (e BOM no início do `index.js`) | index.js | Textos errados na UI e nos JSON |
| 13 | `player_update` não verifica o token da sessão (os `salvar_*` verificam) | server.js | Qualquer socket pode publicar vitais de qualquer id |
| 14 | Itens da mochila são removidos por `id` (`i.id !== item.id`); dois itens iguais compartilhariam id | index.js | Remover um remove todos do mesmo tipo |
| 15 | `STATE` mistura dados do personagem, catálogo global (`backpackConfigs`, lista de perícias) e estado de sessão (`combo`, `history`) | index.js | Sem fronteira clara do que salvar |

---

## 2. Decisões propostas

### 2.1 Convenção de nomes

- **Chaves em JSON e no código:** inglês, camelCase (já é o que `status.json`, `STATE` e `equipped` usam: `current`, `max`, `mainHand`).
- **Nomes de arquivo e textos da interface:** português.
- **Abreviações de atributo:** maiúsculas (`FOR DES INT SAB PRE VON`), como já está em `skill.attr`.
- **Flags da mesa:** mantêm `PascalCase` em português (`AtivarRiquezas`…).
- **IDs no DOM seguem a chave canônica:** `hp-val`, `vigor-val`, `sanity-val` (acaba o mapeamento `vigor→mana`, `sanity→stress`).

### 2.2 Nomes oficiais

| Conceito | Oficial | Nomes mortos (remover) |
|----------|---------|------------------------|
| Vida | `hp` | `hpMax` |
| Vigor | `vigor` | `mana`, `manaMax` |
| Sanidade | `sanity` | `sanidade`, `stress`, `stressMax` |
| Valor de vital | `{ current, max }` | formato plano (`hp`, `hpMax`) |
| Mochila/itens | `inventario.json` → `items` + `equipped` | `backpack.json`, `backpackItems`, mochila como array solto |
| Perícias | `pericias.json` → objeto por id | array, `{skills:[…]}` |
| Magias | `magias.json` → array | `{spells:[…]}` |
| Cor Tailwind | `vigor`, `sanity` | `mana`, `stress` |

**Decisões tomadas (você):**

- **Vigor ≠ Mana.** São recursos diferentes; no futuro o `config.js` alternará qual dos dois a mesa usa. Por isso a chave oficial de hoje é `vigor` e `mana` sai do código e dos ids (ficará livre para o recurso real quando existir). **Acoplamento temporário:** a flag `AtivarMana` continua sendo o que liga/desliga o card de Vigor (o servidor agora aplica isso ao tipo `vigor`). Ao implementar a alternância, a flag deve ser substituída por algo como `RecursoPrincipal: "vigor" | "mana"`.
- **Magias ≠ Habilidades.** Arquivos separados. `habilidades.json` existe (vazio) e é carregado, mas fica sem uso na interface até ser implementado.
- **Atributos:** entram logo após estas correções. Regra já definida por você: **atributo = quantidade de dados; perícia = soma fixa**. `atributos.json` já existe com os 6 atributos em 0.
- **Catálogo de perícias fixo** no código (`CATALOGO_PERICIAS` em `index.js`). A ficha guarda só o `mod`. Trocar nome/atributo padrão no futuro = editar o catálogo, sem migrar fichas.
- **`backpack.json` → `inventario.json`:** feito (migração automática).

### 2.3 Modelo oficial do personagem

Uma pasta por personagem, um arquivo por domínio (mantém o que já existe e o `salvar_*` por arquivo):

```text
players/<conta>/login.json                  ← conta, NÃO é do personagem
players/<conta>/<nome>_<id>/
├── perfil.json        dados básicos + avatar + progressão
├── atributos.json     FOR DES INT SAB PRE VON
├── status.json        hp / vigor / sanity
├── pericias.json      só o modificador de cada perícia
├── inventario.json    itens + equipamento (antigo backpack.json)
├── magias.json
├── habilidades.json
├── biografia.json     história, cicatrizes, anotações
└── riquezas.json      moedas (exibido só se AtivarRiquezas)
```

Todo arquivo tem `"schemaVersion": 1` na raiz (ou, para arrays, é migrado para objeto), para permitir migrações futuras sem adivinhar formato.

### 2.4 Estrutura dos JSON

```jsonc
// perfil.json
{
  "schemaVersion": 1,
  "id": "1234",                 // igual ao sufixo da pasta; imutável
  "nome": "Aelric",             // fonte oficial do nome (a pasta não é renomeada)
  "classe": "Lâmina Rúnica • Ocultista",
  "progressao": { "ex": "5%", "nv": "4" },   // o MODO (ex/nv) é global: vem de UsarEx
  "avatar": "https://..."
}

// atributos.json   (reservado: hoje as perícias referenciam esses 6 atributos, mas não há valores)
{ "schemaVersion": 1, "FOR": 0, "DES": 0, "INT": 0, "SAB": 0, "PRE": 0, "VON": 0 }

// status.json
{
  "schemaVersion": 1,
  "hp":     { "current": 10, "max": 10 },
  "vigor":  { "current": 10, "max": 10 },
  "sanity": { "current": 10, "max": 10 }
}

// pericias.json   (nome, ícone e atributo vêm do catálogo global, não da ficha)
{
  "schemaVersion": 1,
  "skills": { "acrobacia": { "mod": 0 }, "ocultismo": { "mod": 5 } }
}

// inventario.json
{
  "schemaVersion": 1,
  "items": [
    { "id": "espada-longa", "name": "...", "desc": "...",
      "col": 1, "row": 1, "w": 1, "h": 3, "weight": 3.5,
      "color": "...", "dice": "2d5", "twoHanded": false,
      "type": "Arma Cortante", "icon": "fa-khanda",
      "backpackType": null, "isBackpackItem": false }
  ],
  "equipped": { "mainHand": null, "offHand": null, "back": null, "backpack": null }
}
// `uid` (identificador único da instância, problema 14) fica para o sprint seguinte;
// hoje o servidor aceita itens sem `uid` e a remoção continua por `id`.

// magias.json / habilidades.json   (proposta a partir do HTML atual, "Custo: 3 Vigor")
{
  "schemaVersion": 1,
  "items": [
    { "id": "lamento-das-sombras", "name": "...", "desc": "...",
      "cost": { "vital": "sanity", "amount": 2 }, "dice": "1d6" }
  ]
}

// biografia.json
{ "schemaVersion": 1, "history": "", "scars": "", "notes": "" }

// riquezas.json
{ "schemaVersion": 1, "po": 0, "pp": 0, "pc": 0 }
```

### 2.5 O que é do personagem × o que é global

| Do personagem (salvo na pasta dele) | Global da mesa / código (não vai na ficha) | Só sessão (nunca salvo) |
|---|---|---|
| perfil, atributos, status, pericias (só `mod`), inventario, magias, habilidades, biografia, riquezas | `config.json` (flags), catálogo de perícias (nome/ícone/atributo), `backpackConfigs` (tamanhos de mochila), `SENHA_MESTRE` | `combo`, `history` (rolagens), `playersState`, `SESSIONS`, `personagemCarregado` |

Conta (`login.json`) é uma terceira camada, do jogador, não do personagem.

**Config:** uma única fonte de verdade, o servidor. `GLOBAL_CONFIG` no cliente vira apenas "valores até chegar o `sync_config`" e usa os mesmos valores do `DEFAULT_CONFIG`.

### 2.6 Como o servidor recebe e salva alterações

**Regra:** o cliente nunca envia a ficha inteira; envia um arquivo por vez. O servidor valida, normaliza e grava.

```text
cliente → servidor   salvar_personagem { player, nomePasta, arquivo, dados }
servidor → cliente   personagem_salvo { arquivo }   |   salvamento_personagem_erro { arquivo, message }
```

No servidor, uma tabela única substitui os handlers repetidos (`salvar_status`, `salvar_pericias`, …):

```js
const ARQUIVOS = {
  perfil: normalizarPerfil,       atributos: normalizarAtributos,
  status: normalizarStatus,       pericias: normalizarPericias,
  inventario: normalizarInventario, magias: normalizarLista,
  habilidades: normalizarLista,   biografia: normalizarBiografia,
  riquezas: normalizarRiquezas,
};
// arquivo fora da lista → recusa. normalizador devolve null → recusa.
```

- **Autenticação:** token da sessão do socket (já existe nos `salvar_*`) + `nomePasta` sem separadores de caminho (já existe).
- **Gravação:** escrever em `arquivo.tmp` e renomear (evita JSON pela metade se o processo cair).
- **Carregamento:** `personagem_carregado` devolve `{ perfil, atributos, status, … }`. Arquivo ausente vira o **padrão** e é criado; não é mais erro (resolve o problema 1 e permite adicionar arquivos no futuro).
- **Broadcast para o mestre** é separado da persistência: `player_update { id, name, vitals }` (projeção pública, sem inventário), agora **com verificação de token**. O `id` passa a ser calculado pelo servidor a partir de `player + nomePasta`.
- **Mestre:** só envia `master_adjust_vital { charId, type: "hp"|"vigor"|"sanity", delta }`. O servidor aplica, respeita `AtivarVigor` para `vigor`, e emite `vital_adjusted`; o cliente dono da ficha persiste via `salvar_personagem` (como hoje).
- **Campos de texto:** salvar com debounce (não a cada tecla).

---

## 3. Estado das correções

| # | Item | Status |
|---|------|--------|
| 1 | `criarArquivosPersonagem` × `carregarPersonagem`; carregar com arquivo ausente vira padrão | ✅ feito (`personagem.js` + `server.js`) |
| 2 | `alterarVital('sanidade')` → `'sanity'` | ✅ |
| 3–4 | `mestre.html` lê `vitals.{hp,vigor,sanity}.{current,max}` e envia `vigor`/`sanity` | ✅ |
| 5 | Regra `AtivarMana` aplicada ao tipo `vigor` no servidor (e tipos `mana`/`stress` recusados) | ✅ |
| 6 | Ids/cores `mana-*`→`vigor-*`, `stress-*`→`sanity-*`; `atualizarBarras` sem mapeamento | ✅ |
| 7 | Fallbacks de formato antigo removidos do cliente; conversão feita no servidor/migração | ✅ |
| 8 | Defaults de config unificados: `AtivarRiquezas:false, UsarEx:false, AtivarSlotMochila:true, AtivarMana:false` (servidor e cliente) | ✅ (`config.json` da mesa não foi alterado) |
| 11 | `pericias.json` só com `mod`; catálogo fixo no código | ✅ |
| 12 | Strings corrompidas e BOM removidos (`index.js`, `index.html`) | ✅ (dados antigos: corrigidos na migração) |
| — | `salvar_personagem` genérico com lista de arquivos e normalizadores; gravação atômica | ✅ |
| — | `PLAYERS_PATH` declarado antes de ser usado no login | ✅ |
| 13 | `player_update` sem verificação de token | ⏳ próximo sprint |
| 14 | `uid` de instância nos itens | ⏳ próximo sprint |
| 15 | Separar catálogo/sessão do `STATE` | ⏳ próximo sprint |
| 9–10 | Persistir perfil, biografia, avatar, riquezas (o servidor já aceita esses arquivos; a interface ainda não os envia) | ⏳ fora do Sprint 0 |

## 4. Como aplicar

1. Faça backup da pasta `players/`.
2. Copie `server.js`, `personagem.js`, `migrar.js` para a raiz; `index.html` e `mestre.html` para a raiz; `index.js` para `JS/index.js`; (`index.css` e `config.json` não mudaram).
3. `node migrar.js --dry-run` (mostra o que mudaria) e depois `node migrar.js`. Cada personagem migrado guarda os arquivos originais em `_backup_pre_schema/`. A migração também roda sozinha ao carregar um personagem, então nenhum personagem antigo fica sem carregar mesmo que você esqueça esse passo.

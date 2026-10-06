/* =========================================================================
   INVENTÁRIO E EQUIPAMENTO
   Slots equipados, mochila em grade, pilhas (quantity), peso/carga, popover do item e equipar/descartar.
   ========================================================================= */

/* =========================================================================
       ALTERAÇÃO 2: RENDERIZAR OS 4 SLOTS (INCLUINDO SLOT MOCHILA)
       ========================================================================= */
function renderizarSlotsEquipados() {
  const slots = ["mainHand", "offHand", "back", "backpack"];
  const isTwoHandedEquipped =
    STATE.equipped.mainHand && STATE.equipped.mainHand.twoHanded;

  slots.forEach((slotKey) => {
    const contentEl = document.getElementById(`content-${slotKey}`);
    const badgeEl = document.getElementById(`badge-${slotKey}`);
    const actionsEl = document.getElementById(`actions-${slotKey}`);
    const item = STATE.equipped[slotKey];

    // Caso Mão Secundária bloqueada
    if (slotKey === "offHand" && isTwoHandedEquipped) {
      badgeEl.innerText = "Bloqueado";
      badgeEl.className =
        "text-[10px] font-mono px-2 py-0.5 rounded bg-crimson-950 text-crimson-400 border border-crimson-800";
      contentEl.innerHTML = `
            <div class="text-center py-2 text-crimson-400/80">
              <i class="fa-solid fa-link-slash text-2xl mb-1"></i>
              <div class="text-[11px] font-cinzel font-bold">Ocupado (2 Mãos)</div>
            </div>
          `;
      actionsEl.classList.add("hidden");
      return;
    }

    // Slot Vazio
    if (!item) {
      badgeEl.innerText = slotKey === "backpack" ? "Bolsos" : "Vazio";
      badgeEl.className =
        "text-[10px] font-mono px-2 py-0.5 rounded bg-dungeon-800 text-slate-400 border border-dungeon-700";

      let emptyIcon = "fa-hand-back-fist";
      let emptyText = "Mão desarmada";
      if (slotKey === "offHand") {
        emptyIcon = "fa-shield-halved";
        emptyText = "Mão livre";
      }
      if (slotKey === "back") {
        emptyIcon = "fa-box";
        emptyText = "Costas vazias";
      }
      if (slotKey === "backpack") {
        emptyIcon = "fa-vest";
        emptyText = "Bolsos Básicos (3x3)";
      }

      contentEl.innerHTML = `
            <i class="fa-solid ${emptyIcon} text-2xl text-slate-700 mb-1"></i>
            <span class="text-xs text-slate-500 italic">${emptyText}</span>
          `;
      actionsEl.classList.add("hidden");
    } else {
      // Slot Preenchido
      badgeEl.innerText = item.backpackType
        ? "Equipada"
        : item.twoHanded
          ? "2 Mãos"
          : "Equipado";
      badgeEl.className =
        "text-[10px] font-mono px-2 py-0.5 rounded bg-amberGold-950 text-amberGold-400 border border-amberGold-700 font-bold";

      contentEl.innerHTML = `
            <div class="flex items-center gap-2 w-full text-left">
              <div class="w-8 h-8 rounded bg-dungeon-900 border border-amberGold-600/50 flex items-center justify-center text-amberGold-400 shrink-0">
                <i class="fa-solid ${escaparHtml(item.icon || "fa-shield")} text-xs"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-cinzel font-bold text-amber-200 truncate">${escaparHtml(item.name)}${quantidadeDoItem(item) > 1 ? ` ×${quantidadeDoItem(item)}` : ""}</div>
                <div class="text-[10px] font-mono text-slate-400">${item.dice ? escaparHtml(item.dice) + " Dano" : item.backpackType ? "Expansão de Slots" : "Item Tático"}</div>
              </div>
            </div>
          `;

      actionsEl.classList.remove("hidden");
      actionsEl.innerHTML = `
            ${
              item.dice
                ? `
              <button onclick="enviarSlotParaCombo('${slotKey}')" 
                      class="flex-1 py-1 bg-amberGold-600 hover:bg-amberGold-500 text-black font-cinzel font-bold text-[10px] rounded transition flex items-center justify-center gap-1">
                <i class="fa-solid fa-dice-d20"></i> Combo
              </button>
            `
                : ""
            }
            <button onclick="desequiparSlot('${slotKey}')" 
                    class="py-1 px-2.5 bg-dungeon-800 hover:bg-crimson-900/60 text-slate-400 hover:text-crimson-300 text-[10px] font-mono rounded border border-dungeon-700 transition" 
                    title="Guardar item">
              <i class="fa-solid fa-arrow-down"></i> Tirar
            </button>
          `;
    }
  });
}

function desequiparSlot(slotKey) {
  const item = STATE.equipped[slotKey];
  if (!item) return;

  // Tirar a mochila troca a grade para "Bolsos Básicos": todos os itens precisam caber lá.
  const config =
    slotKey === "backpack" ? configMochila("bolsos") : configMochila();
  const lista = [...STATE.backpackItems, item];
  const layout = calcularLayout(lista, config);
  if (layout.semEspaco.length) {
    toast(
      slotKey === "backpack"
        ? `Não dá para tirar ${item.name}: os itens não cabem em ${config.label}.`
        : `Sem espaço na mochila para guardar ${item.name}.`,
      "error",
    );
    return;
  }

  aplicarLayout(layout);
  STATE.backpackItems = lista;
  STATE.equipped[slotKey] = null;

  registrarNoTerminal("Item desequipado", { item: item.name, slot: slotKey });
  toast(`${item.name} guardado.`, "info");
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  syncPlayerToServer();
  salvarInventario();
}

/* =========================================================================
       ALTERAÇÃO 3: RENDERIZAR MOCHILA AJUSTADA AOS SLOTS
       ========================================================================= */
let itemPopoverAtual = null;

/* =========================================================================
   INVENTÁRIO (Sprint 3): identidade (uid), pilhas (quantity/maxStack) e capacidade
   - uid   = identifica UMA instância (duas adagas: mesmo `id`, `uid`s diferentes);
   - pilha = item com maxStack > 1 guarda `quantity` em um único bloco da grade;
   - grade = cols x rows da mochila ativa; nada se sobrepõe nem sai da grade.
   Toda troca de itens é atômica: calcula o resultado inteiro e só aplica se couber.
   ========================================================================= */
let itensSemEspaco = new Set(); // uids que não couberam na grade (dados antigos/inconsistentes)

function novoUidItem() {
  const aleatorio = (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  )
    .replace(/-/g, "")
    .slice(0, 10);
  return `it_${aleatorio}`;
}

function mesmoItem(a, b) {
  if (!a || !b) return false;
  return a.uid && b.uid ? a.uid === b.uid : a === b;
}

function limiteDaPilha(item) {
  return Math.max(1, Math.floor(Number(item?.maxStack)) || 1);
}

// Carga = peso da mochila equipada + tudo o que está na grade (mesma conta exibida na tela).
function calcularPesoCarregado() {
  return calcularCarga(STATE.backpackItems, STATE.equipped.backpack);
}

// null = fórmula ainda não definida (BALANCEAMENTO.pesoPorForca).
function calcularPesoLimite() {
  const porForca = BALANCEAMENTO.pesoPorForca;
  if (!Number.isFinite(porForca)) return null;
  const forca = Number(STATE.atributos?.FOR) || 0;
  // Só o BÔNUS de Atletismo (skill.mod): o modificador de FOR já está na perícia total
  // e Força já entra na fórmula, então usar o total contaria FOR duas vezes.
  const atletismo =
    Number(STATE.skills.find((skill) => skill.id === "atletismo")?.mod) || 0;
  return Math.max(0, forca * porForca + atletismo);
}

function atualizarRotuloCarga() {
  const rotulo = document.getElementById("backpack-weight-label");
  if (!rotulo) return;
  const carga = calcularPesoCarregado();
  const limite = calcularPesoLimite();
  const sobrecarregado = limite !== null && carga > limite;

  const valor = document.createElement("strong");
  valor.className = sobrecarregado ? "text-crimson-400" : "text-amber-200";
  valor.textContent = `${carga.toFixed(1)} kg`;
  const complemento = document.createElement("span");
  complemento.className = sobrecarregado
    ? "text-crimson-400"
    : "text-slate-500";
  complemento.textContent =
    limite === null
      ? " • limite: a definir (Força)"
      : ` / ${limite.toFixed(1)} kg${sobrecarregado ? " — sobrecarregado" : ""}`;
  rotulo.replaceChildren("Carga total: ", valor, complemento);
}

function configMochila(tipo = obterTipoMochilaAtiva()) {
  return STATE.backpackConfigs[tipo] || STATE.backpackConfigs.bolsos;
}

const larguraDoItem = (item) => Math.max(1, Math.floor(Number(item?.w)) || 1);
const alturaDoItem = (item) => Math.max(1, Math.floor(Number(item?.h)) || 1);

function retangulosSeSobrepoem(a, b) {
  return (
    a.col < b.col + b.w &&
    b.col < a.col + a.w &&
    a.row < b.row + b.h &&
    b.row < a.row + a.h
  );
}

function retanguloCabeNaGrade(r, config) {
  return (
    r.col >= 1 &&
    r.row >= 1 &&
    r.col + r.w - 1 <= config.cols &&
    r.row + r.h - 1 <= config.rows
  );
}

// Primeira posição livre (linha a linha) para um bloco w x h.
function acharPosicaoLivre(w, h, ocupados, config) {
  for (let row = 1; row + h - 1 <= config.rows; row++) {
    for (let col = 1; col + w - 1 <= config.cols; col++) {
      const candidato = { col, row, w, h };
      if (!ocupados.some((o) => retangulosSeSobrepoem(candidato, o))) {
        return { col, row };
      }
    }
  }
  return null;
}

/**
 * Calcula onde cada item fica na grade, SEM alterar nada. Itens com posição válida
 * (dentro da grade e sem sobreposição) mantêm o lugar; os demais vão para o primeiro
 * espaço livre (maiores primeiro). Retorna { colocados: [{item,col,row}], semEspaco: [item] }.
 */
function calcularLayout(itens, config) {
  const aceitos = [];
  const colocados = [];
  const pendentes = [];

  for (const item of itens) {
    const r = {
      col: item.col,
      row: item.row,
      w: larguraDoItem(item),
      h: alturaDoItem(item),
    };
    const valido =
      Number.isInteger(r.col) &&
      Number.isInteger(r.row) &&
      retanguloCabeNaGrade(r, config) &&
      !aceitos.some((a) => retangulosSeSobrepoem(r, a));
    if (valido) {
      aceitos.push(r);
      colocados.push({ item, col: r.col, row: r.row });
    } else {
      pendentes.push(item);
    }
  }

  const semEspaco = [];
  pendentes.sort(
    (a, b) =>
      larguraDoItem(b) * alturaDoItem(b) - larguraDoItem(a) * alturaDoItem(a),
  );
  for (const item of pendentes) {
    const w = larguraDoItem(item);
    const h = alturaDoItem(item);
    const pos = acharPosicaoLivre(w, h, aceitos, config);
    if (!pos) {
      semEspaco.push(item);
      continue;
    }
    aceitos.push({ ...pos, w, h });
    colocados.push({ item, ...pos });
  }
  return { colocados, semEspaco };
}

function aplicarLayout(layout) {
  layout.colocados.forEach(({ item, col, row }) => {
    item.col = col;
    item.row = row;
  });
  itensSemEspaco = new Set(layout.semEspaco.map((i) => i.uid));
}

// Ao carregar: garante uid único em todos os itens e uma disposição válida na grade.
function repararInventarioAoCarregar() {
  const vistos = new Set();
  let alterou = false;
  const todos = [
    ...STATE.backpackItems,
    ...Object.values(STATE.equipped).filter(Boolean),
  ];
  todos.forEach((item) => {
    if (!item.uid || vistos.has(item.uid)) {
      item.uid = novoUidItem();
      alterou = true;
    }
    vistos.add(item.uid);
  });

  const antes = STATE.backpackItems.map((i) => `${i.col},${i.row}`).join("|");
  const layout = calcularLayout(STATE.backpackItems, configMochila());
  aplicarLayout(layout);
  if (STATE.backpackItems.map((i) => `${i.col},${i.row}`).join("|") !== antes) {
    alterou = true;
  }

  if (layout.semEspaco.length) {
    toast(
      `${layout.semEspaco.length} item(ns) não cabem na mochila atual. Descarte algo ou troque de mochila.`,
      "error",
    );
  }
  if (alterou) marcarAlterado("inventario");
}

/**
 * Adiciona `quantidade` unidades de um item ao inventário: completa pilhas do mesmo
 * tipo, depois cria pilhas novas onde houver espaço. Retorna { adicionado, sobrou }.
 * (É a porta de entrada para loot, itens dados pelo mestre e futura loja/catálogo.)
 */
function adicionarItemAoInventario(modelo, quantidade = 1) {
  let restante = Math.max(1, Math.floor(Number(quantidade)) || 1);
  const total = restante;
  const maximo = limiteDaPilha(modelo);
  const config = configMochila();

  // 1) completa pilhas existentes do mesmo tipo
  if (maximo > 1) {
    for (const existente of STATE.backpackItems) {
      if (restante <= 0) break;
      if (existente.id !== modelo.id || limiteDaPilha(existente) <= 1) continue;
      const espaco = limiteDaPilha(existente) - quantidadeDoItem(existente);
      if (espaco <= 0) continue;
      const parte = Math.min(espaco, restante);
      existente.quantity = quantidadeDoItem(existente) + parte;
      restante -= parte;
    }
  }

  // 2) pilhas novas, enquanto couber na grade
  const novos = [];
  while (restante > 0) {
    const parte = Math.min(maximo, restante);
    const novo = JSON.parse(JSON.stringify(modelo));
    delete novo.col;
    delete novo.row;
    Object.assign(novo, {
      uid: novoUidItem(),
      quantity: parte,
      maxStack: maximo,
      w: larguraDoItem(modelo),
      h: alturaDoItem(modelo),
    });
    const layout = calcularLayout(
      [...STATE.backpackItems, ...novos, novo],
      config,
    );
    if (layout.semEspaco.length) break;
    novos.push(novo);
    restante -= parte;
  }
  if (novos.length) {
    aplicarLayout(calcularLayout([...STATE.backpackItems, ...novos], config));
    STATE.backpackItems.push(...novos);
  }

  const adicionado = total - restante;
  if (adicionado > 0) {
    registrarNoTerminal("Item adicionado", {
      item: modelo.name,
      quantidade: adicionado,
    });
    renderizarMochilaGrid();
    salvarInventario();
  }
  if (restante > 0) {
    toast(
      `Sem espaço: ${restante} × ${modelo.name} não couberam na mochila.`,
      "error",
    );
  }
  return { adicionado, sobrou: restante };
}

function ajustarQuantidadeItemAtual(delta) {
  const item = itemPopoverAtual;
  if (!item) return;
  const maximo = limiteDaPilha(item);
  const atual = quantidadeDoItem(item);
  const nova = Math.min(maximo, Math.max(1, atual + delta));
  if (nova === atual) {
    toast(
      delta > 0
        ? `Pilha cheia (máximo ${maximo}).`
        : "Use “Descartar item” para remover o item.",
      "info",
    );
    return;
  }
  item.quantity = nova;
  registrarNoTerminal("Quantidade alterada", {
    item: item.name,
    anterior: atual,
    atual: nova,
  });
  atualizarPopoverQuantidade(item);
  renderizarMochilaGrid();
  salvarInventario();
}

function atualizarPopoverQuantidade(item) {
  const linha = document.getElementById("popover-qty-row");
  if (!linha) return;
  const empilhavel = limiteDaPilha(item) > 1;
  linha.classList.toggle("hidden", !empilhavel);
  const rotulo = document.getElementById("popover-qty-label");
  if (rotulo)
    rotulo.innerText = `${quantidadeDoItem(item)}/${limiteDaPilha(item)}`;
}

function enviarSlotParaCombo(slotKey) {
  const item = STATE.equipped[slotKey];
  if (item?.dice) adicionarAoCombo(item.name, item.dice, "item", "equipado");
}

function obterTipoMochilaAtiva() {
  if (STATE.equipped.backpack && STATE.equipped.backpack.backpackType) {
    return STATE.equipped.backpack.backpackType;
  }
  return "bolsos"; // Padrão se desequipada
}

function renderizarMochilaGrid() {
  const config = configMochila();
  const gridContainer = document.getElementById("backpack-grid");
  const dimLabel = document.getElementById("grid-dimensions-label");
  const blocksCountEl = document.getElementById("grid-blocks-count");
  if (!gridContainer || !config) return;

  // Tamanho maior para usabilidade confortável
  const cellSize = 60;
  const gap = 3;

  gridContainer.style.width = `${config.cols * cellSize + (config.cols - 1) * gap}px`;
  gridContainer.style.height = `${config.rows * cellSize + (config.rows - 1) * gap}px`;
  gridContainer.innerHTML = "";

  // Grade de fundo
  const gridBg = document.createElement("div");
  gridBg.style.display = "grid";
  gridBg.style.gridTemplateColumns = `repeat(${config.cols}, ${cellSize}px)`;
  gridBg.style.gridTemplateRows = `repeat(${config.rows}, ${cellSize}px)`;
  gridBg.style.gap = `${gap}px`;

  const totalCells = config.cols * config.rows;
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "inventory-cell";
    gridBg.appendChild(cell);
  }
  gridContainer.appendChild(gridBg);

  // Renderização dos itens na grade (só desenha; a disposição é decidida em calcularLayout)
  let celulasUsadas = 0;
  STATE.backpackItems.forEach((item) => {
    const semEspaco = itensSemEspaco.has(item.uid);
    const w = larguraDoItem(item);
    const h = alturaDoItem(item);
    if (!semEspaco) celulasUsadas += w * h;

    // Item que não coube é desenhado dentro da grade só para poder ser visto/descartado.
    const col = Math.max(
      1,
      Math.min(Number(item.col) || 1, config.cols - w + 1),
    );
    const row = Math.max(
      1,
      Math.min(Number(item.row) || 1, config.rows - h + 1),
    );
    const quantidade = quantidadeDoItem(item);

    const itemEl = document.createElement("div");
    itemEl.id = `item-node-${item.uid || item.id}`;
    itemEl.className = `absolute z-10 p-2 rounded-lg border shadow-lg cursor-pointer bg-gradient-to-br ${escaparHtml(item.color)} flex flex-col justify-between hover:scale-[1.02] active:scale-95 transition-all ${semEspaco ? "ring-2 ring-rose-500 opacity-80" : ""}`;

    itemEl.style.left = `${(col - 1) * (cellSize + gap)}px`;
    itemEl.style.top = `${(row - 1) * (cellSize + gap)}px`;
    itemEl.style.width = `${w * cellSize + (w - 1) * gap}px`;
    itemEl.style.height = `${h * cellSize + (h - 1) * gap}px`;
    if (semEspaco) itemEl.title = "Não cabe na mochila atual";

    itemEl.innerHTML = `
          <div class="flex justify-between items-start leading-none pointer-events-none">
            <span class="text-[11px] font-cinzel font-bold text-amber-200 truncate pr-1">${escaparHtml(item.name)}${quantidade > 1 ? ` <span class="text-amberGold-400">×${quantidade}</span>` : ""}</span>
            <i class="fa-solid ${escaparHtml(item.icon)} text-xs text-amber-400"></i>
          </div>
          <div class="text-[10px] font-mono text-slate-300 flex justify-between items-end pointer-events-none">
            <span class="text-amberGold-400 font-bold">${escaparHtml(item.dice || (item.isBackpackItem ? "Mochila" : ""))}</span>
            <span class="text-slate-400">${escaparHtml(Number(pesoDoItem(item).toFixed(2)))}kg</span>
          </div>
        `;

    itemEl.addEventListener("click", (e) => {
      e.stopPropagation();
      abrirItemPopover(item, itemEl);
    });

    gridContainer.appendChild(itemEl);
  });

  dimLabel.innerText = config.label;
  blocksCountEl.innerText = `Grade: ${celulasUsadas}/${totalCells} slots ocupados`;
  atualizarRotuloCarga();
}

/* =========================================================================
       BALÃO DE AÇÕES DO ITEM
       ========================================================================= */
function abrirItemPopover(item, el) {
  itemPopoverAtual = item;
  const popover = document.getElementById("item-popover");

  document.getElementById("popover-title").innerText = item.name;
  document.getElementById("popover-desc").innerText = item.desc;
  document.getElementById("popover-dice-preview").innerText =
    item.dice || "Sem dados";

  // Tags
  const tagsContainer = document.getElementById("popover-tags");
  tagsContainer.innerHTML = `
        <span class="px-1.5 py-0.5 bg-dungeon-800 border border-slate-700 text-slate-300 rounded">${escaparHtml(item.type)}</span>
        ${item.twoHanded ? '<span class="px-1.5 py-0.5 bg-rose-950 border border-rose-700 text-rose-300 rounded font-bold">Duas Mãos</span>' : ""}
        ${item.dice ? `<span class="px-1.5 py-0.5 bg-crimson-900/60 border border-crimson-600/50 text-crimson-300 rounded">${escaparHtml(item.dice)}</span>` : ""}
        <span class="px-1.5 py-0.5 bg-dungeon-800 border border-slate-700 text-slate-400 rounded">${escaparHtml(Number(pesoDoItem(item).toFixed(2)))} kg</span>
      `;
  atualizarPopoverQuantidade(item);

  // Se for mochila, mostra o botão de equipar como mochila
  const btnBackpack = document.getElementById("popover-equip-backpack");
  const handBtns = document.getElementById("popover-hand-btns");
  if (item.isBackpackItem) {
    btnBackpack.classList.toggle("hidden", !GLOBAL_CONFIG.AtivarSlotMochila);
    handBtns.classList.add("hidden");
  } else {
    btnBackpack.classList.add("hidden");
    handBtns.classList.remove("hidden");
  }

  // Duas mãos trava secundária
  const btnOff = document.getElementById("popover-equip-off");
  if (item.twoHanded) {
    btnOff.disabled = true;
    btnOff.classList.add("opacity-40", "cursor-not-allowed");
  } else {
    btnOff.disabled = false;
    btnOff.classList.remove("opacity-40", "cursor-not-allowed");
  }

  // Botão combo
  const btnCombo = document.getElementById("popover-add-combo");
  if (item.dice) {
    btnCombo.classList.remove("hidden");
  } else {
    btnCombo.classList.add("hidden");
  }

  popover.classList.remove("hidden");

  // Posicionamento flutuante inteligente
  const itemRect = el.getBoundingClientRect();
  const parentRect = el.parentElement.getBoundingClientRect();

  let topPos = itemRect.top - parentRect.top - popover.offsetHeight - 8;
  let leftPos = itemRect.left - parentRect.left + itemRect.width / 2 - 144;

  if (topPos < 0) topPos = itemRect.bottom - parentRect.top + 8;
  if (leftPos < 4) leftPos = 4;
  if (leftPos + 288 > parentRect.width)
    leftPos = Math.max(4, parentRect.width - 292);

  popover.style.top = `${topPos}px`;
  popover.style.left = `${leftPos}px`;
}

function fecharItemPopover() {
  document.getElementById("item-popover").classList.add("hidden");
  itemPopoverAtual = null;
}

function equiparItemAtual(slotDestino) {
  if (!itemPopoverAtual) return;
  if (slotDestino === "backpack" && !GLOBAL_CONFIG.AtivarSlotMochila) return;
  const item = itemPopoverAtual;

  // Monta o resultado completo ANTES de aplicar: se algo não couber, nada muda.
  const equipadosNovos = { ...STATE.equipped };
  const devolvidos = [];

  // Se já houver algo no slot, volta para a mochila
  if (equipadosNovos[slotDestino]) devolvidos.push(equipadosNovos[slotDestino]);
  equipadosNovos[slotDestino] = item;

  // Arma de 2 mãos na principal recolhe a secundária
  let recolheuSecundaria = false;
  if (slotDestino === "mainHand" && item.twoHanded && equipadosNovos.offHand) {
    devolvidos.push(equipadosNovos.offHand);
    equipadosNovos.offHand = null;
    recolheuSecundaria = true;
  }

  // O item sai da grade (libera as células) e os devolvidos entram; trocar de mochila
  // troca também o tamanho da grade.
  const restantes = STATE.backpackItems.filter((i) => !mesmoItem(i, item));
  const config =
    slotDestino === "backpack"
      ? configMochila(item.backpackType)
      : configMochila();
  const lista = [...restantes, ...devolvidos];
  const layout = calcularLayout(lista, config);
  if (layout.semEspaco.length) {
    toast(
      slotDestino === "backpack"
        ? `Os itens não cabem em ${config.label}. Descarte algo antes de trocar.`
        : `Sem espaço na mochila para guardar o que está equipado.`,
      "error",
    );
    return;
  }

  aplicarLayout(layout);
  STATE.backpackItems = lista;
  Object.assign(STATE.equipped, equipadosNovos);

  if (recolheuSecundaria) {
    toast(
      "Mão secundária guardada pois a arma requer empunhadura dupla.",
      "info",
    );
  }
  registrarNoTerminal("Item equipado", { item: item.name, slot: slotDestino });
  fecharItemPopover();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  syncPlayerToServer();
  salvarInventario();
  toast(`${item.name} equipado com sucesso!`, "combat");
}

function enviarItemAtualParaCombo() {
  if (itemPopoverAtual && itemPopoverAtual.dice) {
    adicionarAoCombo(
      itemPopoverAtual.name,
      itemPopoverAtual.dice,
      "item",
      "mochila",
    );
    fecharItemPopover();
  }
}

function descartarItemAtual() {
  const item = itemPopoverAtual;
  if (!item) return;
  // Remove o item inteiro (a pilha toda); para tirar só algumas unidades use − no balão.
  STATE.backpackItems = STATE.backpackItems.filter((i) => !mesmoItem(i, item));
  itensSemEspaco.delete(item.uid);
  registrarNoTerminal("Item descartado", {
    item: item.name,
    quantidade: quantidadeDoItem(item),
  });
  fecharItemPopover();
  renderizarSlotsEquipados();
  renderizarMochilaGrid();
  salvarInventario();
  toast("Item descartado.", "info");
}

document.addEventListener("click", (e) => {
  const popover = document.getElementById("item-popover");
  if (popover && !popover.contains(e.target)) {
    fecharItemPopover();
  }
});

/* =========================================================================
   DADOS: ROLAGENS, COMBO E HISTÓRICO
   Teste de atributo, combo de dados, histórico e a fila de envio das rolagens ao painel do mestre.
   ========================================================================= */

function rolarAtributo(chave, nome) {
  const input = document.querySelector(`[data-campo="atributos.${chave}"]`);
  // Mesmo cálculo das perícias (inteiro, arredondado para baixo).
  const valor = modificadorDeAtributo(
    input ? parseInt(input.value, 10) : STATE.atributos?.[chave],
  );

  // Rola o d20 padrão do sistema
  const d20 = rolarDadoIndividual(20);
  const total = d20 + valor;
  const detalhe = valor !== 0 ? `1d20 (${d20}) ${formatarBonus(valor)}` : `1d20 (${d20})`;

  tocarSomImpacto();
  publicarRolagem({
    total,
    resumo: `Teste de ${nome} (${chave})`,
    linhas: [{ nome, detalhe, soma: total }],
    linhasHistorico: [{ nome: `Teste de ${nome}`, detalhe, soma: total }],
    detalhesMestre: `Teste de ${nome}: ${detalhe} = ${total}`,
    log: ["Rolagem de Atributo", { atributo: nome, chave, d20, modificador: valor, total }],
  });
  toast(`Teste de ${nome}: ${total} [${detalhe}]`, "combat");
}

/* Fim comum de toda rolagem: mostra o resultado na aba de Dados, grava no histórico, registra no
   log e envia ao painel do mestre. `linhas` aparecem no cartão de resultado; `linhasHistorico`
   (padrão: as mesmas) vão para o histórico. */
function publicarRolagem({ total, resumo, linhas, linhasHistorico = linhas, detalhesMestre, log: [titulo, dados] }) {
  const totalEl = document.getElementById("total-result-number");
  if (totalEl) totalEl.innerText = total;
  const resumoEl = document.getElementById("result-summary-text");
  if (resumoEl) resumoEl.innerText = resumo;

  const breakdownEl = document.getElementById("result-breakdown");
  if (breakdownEl) {
    breakdownEl.replaceChildren(
      ...linhas.map((linha) => {
        const valorLinha = elTexto("span", "text-amberGold-400");
        valorLinha.append(`${linha.detalhe} = `, elTexto("strong", "text-slate-100", String(linha.soma)));
        const itemRow = elTexto("div", "flex justify-between items-center py-1 border-b border-dungeon-800");
        itemRow.append(elTexto("span", "text-slate-300 font-bold", `${linha.nome}:`), valorLinha);
        return itemRow;
      }),
    );
  }

  adicionarAoHistorico(total, linhasHistorico);
  registrarNoTerminal(titulo, dados);

  enviarRolagem(total, detalhesMestre);
}

/* Rolagens vão para o painel do mestre numa fila: só saem da fila quando o servidor confirma. Se estiver
   sem conexão (ou a confirmação se perder), seguem na fila e são reenviadas ao reconectar. Quem rolou
   é o servidor que define (o personagem aberto nesta aba), e o `rid` impede duplicar um reenvio. */
const rolagensPendentes = [];

function enviarRolagem(total, details) {
  if (rolagensPendentes.length >= 100) rolagensPendentes.shift();
  rolagensPendentes.push({ rid: novoUidCodice(), total, details, quando: Date.now(), enviando: false });
  enviarRolagensPendentes();
}

function enviarRolagensPendentes() {
  if (!personagemCarregado || !socket?.connected) return;
  rolagensPendentes.forEach((rolagem) => {
    if (rolagem.enviando) return;
    rolagem.enviando = true;
    const { rid, total, details, quando } = rolagem;
    socket.timeout(5000).emit("dice_roll", { rid, total, details, quando }, (erro, ok) => {
      rolagem.enviando = false;
      if (erro) return; // sem resposta: continua na fila
      const i = rolagensPendentes.indexOf(rolagem);
      if (i >= 0) rolagensPendentes.splice(i, 1);
      if (!ok) console.warn("[RPG] O servidor recusou a rolagem.");
    });
  });
}

/* =========================================================================
       SISTEMA DE COMBOS DE DADOS COM EMISSÃO SOCKET.IO
       ========================================================================= */
function adicionarAoCombo(nome, formula, iconeTipo = "generic", origem = "") {
  STATE.combo.push({
    id: Date.now() + Math.random(),
    nome: nome,
    formula: formula,
    tipo: iconeTipo,
    origem: origem,
  });

  registrarNoTerminal("combo Add+ ", {
    componente: nome,
    formula,
    origem,
  });
  atualizarInterfaceCombo();
  toast(`Combo: ${nome} (${formula})`, "combat");
}

function adicionarDadoAvulso(dado) {
  adicionarAoCombo("Dado", dado, "dice", "manual");
}

function adicionarAtributo(atributo) {
  const valor = modificadorDeAtributo(STATE.atributos?.[atributo]);
  adicionarAoCombo(
    atributo.toUpperCase(),
    valor === 0 ? "1d20" : `1d20${formatarBonus(valor)}`,
    "attr",
    "manual",
  );
}

function adicionarModificador(valor) {
  const str = valor >= 0 ? `+${valor}` : `${valor}`;
  adicionarAoCombo("Bônus", str, "bonus", "manual");
}

function removerDoCombo(id) {
  const removido = STATE.combo.find((item) => item.id === id);
  STATE.combo = STATE.combo.filter((item) => item.id !== id);
  if (removido)
    registrarNoTerminal("combo rmvd-", {
      componente: removido.nome,
      formula: removido.formula,
    });
  atualizarInterfaceCombo();
}

function limparCombo() {
  const quantidade = STATE.combo.length;
  STATE.combo = [];
  registrarNoTerminal("Combo limpo", { componentesRemovidos: quantidade });
  atualizarInterfaceCombo();
  toast("Fila de combo esvaziada.", "info");
}

function atualizarInterfaceCombo() {
  const container = document.getElementById("combo-chips-container");
  const badge = document.getElementById("combo-badge");
  const formulaDisplay = document.getElementById("combo-formula-display");

  if (!container) return;

  if (STATE.combo.length > 0) {
    badge.innerText = STATE.combo.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  if (STATE.combo.length === 0) {
    container.innerHTML = `
          <span id="combo-empty-msg" class="text-xs text-slate-500 italic">
            Nenhum componente no combo. Adicione armas do inventário, bônus de perícias ou habilidades do grimório.
          </span>
        `;
    formulaDisplay.innerText = "0d0";
    return;
  }

  container.innerHTML = "";
  let formulas = [];

  STATE.combo.forEach((c) => {
    formulas.push(`${c.formula}`);

    const chip = document.createElement("div");
    chip.className =
      "flex items-center gap-1.5 px-2.5 py-1 bg-dungeon-800 border border-amberGold-600/50 rounded-full text-xs text-slate-200";
    const rotuloChip = elTexto("span", "font-bold text-amberGold-400 font-cinzel", c.nome);
    const formulaChip = elTexto("span", "text-slate-400 font-mono", `(${c.formula})`);
    const remover = elTexto("button", "text-slate-400 hover:text-crimson-400 ml-1 text-xs");
    remover.type = "button";
    remover.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    remover.addEventListener("click", () => removerDoCombo(c.id));
    chip.append(rotuloChip, formulaChip, remover);
    container.appendChild(chip);
  });

  formulaDisplay.innerText = formulas.join(" + ");
}

// Um único AudioContext para a página toda (o navegador limita quantos podem existir).
let audioCtxCompartilhado = null;

function tocarSomImpacto() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioCtxCompartilhado ||= new AudioCtx();
    const audioCtx = audioCtxCompartilhado;
    if (audioCtx.state === "suspended") audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(35, audioCtx.currentTime + 0.28);

    gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.28);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.28);
  } catch (erro) {
    console.warn("[RPG] Som indisponível:", erro?.message);
  }
}

function rolarDadoIndividual(lados) {
  return Math.floor(Math.random() * lados) + 1;
}

// O leitor de fórmulas do combo (lerFormulaCombo) agora é compartilhado: vem de JS/regras.js.

function rolarCombo() {
  if (STATE.combo.length === 0) {
    toast("Adicione componentes ao combo antes de disparar o ataque!", "error");
    return;
  }

  // Valida tudo antes de rolar: uma fórmula inválida cancela a rolagem inteira
  // (nada de total parcial no histórico nem no painel do mestre).
  const componentes = STATE.combo.map((item) => ({ item, leitura: lerFormulaCombo(item.formula) }));
  const invalido = componentes.find((c) => !c.leitura);
  if (invalido) {
    toast(`Fórmula inválida em "${invalido.item.nome}": ${invalido.item.formula}`, "error");
    return;
  }

  tocarSomImpacto();

  const btn = document.getElementById("btn-roll-combo");
  btn.classList.add("impact-shake");
  setTimeout(() => btn.classList.remove("impact-shake"), 450);

  let totalFinal = 0;
  const breakdownList = [];

  componentes.forEach(({ item, leitura }) => {
    if (leitura.tipo === "bonus") {
      totalFinal += leitura.bonus;
      breakdownList.push({ nome: item.nome, detalhe: leitura.formula, soma: leitura.bonus });
      return;
    }

    const resultados = [];
    let subtotal = 0;
    for (let i = 0; i < leitura.qtd; i++) {
      const v = rolarDadoIndividual(leitura.lados);
      resultados.push(v);
      subtotal += v;
    }
    const totalComBonus = subtotal + leitura.bonus;
    totalFinal += totalComBonus;
    breakdownList.push({
      nome: item.nome,
      detalhe: `${leitura.formula} -> [${resultados.join(", ")}]`,
      soma: totalComBonus,
    });
  });

  const textoLinhas = breakdownList.map((b) => `${b.nome} (${b.soma})`).join(" + ");
  publicarRolagem({
    total: totalFinal,
    resumo: `${STATE.combo.length} componentes combinados`,
    linhas: breakdownList,
    detalhesMestre: textoLinhas,
    log: ["Combo rolado", { total: totalFinal, detalhes: textoLinhas }],
  });
}

function adicionarAoHistorico(total, breakdown) {
  const histContainer = document.getElementById("history-container");
  const hora = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const entry = {
    hora: hora,
    total: total,
    detalhes: breakdown.map((b) => `${b.nome} (${b.soma})`).join(" + "),
  };

  STATE.history.unshift(entry);
  if (STATE.history.length > 8) STATE.history.pop();

  histContainer.innerHTML = "";
  STATE.history.forEach((h) => {
    const row = document.createElement("div");
    row.className =
      "p-2 bg-dungeon-800/80 rounded border border-dungeon-700 text-xs font-mono flex justify-between items-center";
    const textos = document.createElement("div");
    textos.append(
      elTexto("div", "text-[10px] text-slate-500", h.hora),
      elTexto("div", "text-slate-300 text-[11px] truncate max-w-[180px]", h.detalhes),
    );
    row.append(
      textos,
      elTexto("div", "font-cinzel font-black text-amberGold-400 text-base", `= ${h.total}`),
    );
    histContainer.appendChild(row);
  });
}

function limparHistorico() {
  STATE.history = [];
  document.getElementById("history-container").innerHTML =
    '<div class="text-xs text-slate-500 italic text-center py-4">Nenhum lançamento recente.</div>';
}

/* Perícias: apresentação em duas colunas, totais em destaque e busca local. */
let editandoBonusPericias = false;

function alternarEdicaoBonusPericias() {
  editandoBonusPericias = !editandoBonusPericias;
  atualizarModoPericias();
}

function atualizarModoPericias() {
  const container = document.getElementById('skills-container');
  container?.classList.toggle('is-editing', editandoBonusPericias);
  container?.querySelectorAll('.skill-bonus').forEach(el => { el.hidden = !editandoBonusPericias; });
  const botao = document.getElementById('skills-edit-bonus');
  if (botao) {
    botao.setAttribute('aria-pressed', String(editandoBonusPericias));
    botao.textContent = editandoBonusPericias ? 'Concluir edição de bônus' : 'Editar bônus';
  }
}

function renderizarPericias() {
  const container = document.getElementById("skills-container");
  if (!container) return;
  container.replaceChildren();
  STATE.skills.forEach((skill) => {
    const calc = calcularPericia(skill);
    const card = elTexto("div", "skill-row");
    card.dataset.skillId = skill.id;
    card.dataset.busca = `${skill.name} ${skill.attr}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const info = document.createElement("div");
    info.append(elTexto("div", "skill-name", skill.name));
    const detalhe = elTexto("div", "skill-detail", `${skill.attr} ${formatarBonus(calc.modAtributo)} • bônus ${formatarBonus(calc.bonus)}`);
    detalhe.id = `skill-detail-${skill.id}`;
    info.appendChild(detalhe);
    const total = elTexto("div", "skill-total");
    const valor = elTexto("output", "", formatarBonus(calc.total));
    valor.id = `skill-mod-${skill.id}`;
    valor.setAttribute("aria-label", `Total de ${skill.name}`);
    total.append(elTexto("small", "", "TOTAL"), valor);
    const acoes = elTexto("div", "skill-actions");
    const bonus = elTexto("div", "skill-bonus");
    bonus.appendChild(elTexto("span", "", "Bônus"));
    for (const delta of [-1, 1]) {
      const botao = elTexto("button", "rpg-btn rpg-btn--quiet", delta > 0 ? "+" : "−");
      botao.type = "button";
      botao.disabled = !personagemCarregado;
      botao.setAttribute("aria-label", `${delta > 0 ? "Aumentar" : "Diminuir"} bônus de ${skill.name}`);
      botao.addEventListener("click", () => alterarModPericia(skill.id, delta));
      bonus.appendChild(botao);
    }
    const combo = elTexto("button", "rpg-btn", "+");
    combo.type = "button";
    combo.disabled = !personagemCarregado;
    combo.setAttribute("aria-label", `Adicionar ${skill.name} ao combo`);
    combo.title = `Adicionar ${skill.name} ao combo`;
    combo.addEventListener("click", () => adicionarPericiaAoCombo(skill.id));
    const rolar = elTexto('button', 'rpg-btn');
    const dado = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dado.setAttribute('class', 'rpg-icon');
    dado.setAttribute('viewBox', '0 0 24 24');
    dado.setAttribute('aria-hidden', 'true');
    dado.setAttribute('focusable', 'false');
    const simbolo = document.createElementNS(dado.namespaceURI, 'use');
    simbolo.setAttribute('href', '/CSS/icones.svg#dice');
    dado.append(simbolo); rolar.append(dado);
    rolar.type = 'button'; rolar.disabled = !personagemCarregado;
    rolar.setAttribute('aria-label', `Rolar ${skill.name}: 1d20 ${formatarBonus(calc.total)}`);
    rolar.title = `1d20 ${formatarBonus(calc.total)}`;
    rolar.dataset.rolarPericia = skill.id;
    rolar.addEventListener('click', () => rolarPericia(skill.id));
    acoes.append(bonus, rolar, combo);
    card.append(info, total, acoes);
    container.appendChild(card);
  });
  atualizarModoPericias();
  filtrarPericias();
}

function filtrarPericias() {
  const termo = (document.getElementById("skills-search")?.value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  let total = 0;
  document.querySelectorAll(".skill-row").forEach((card) => {
    const mostrar = termo.split(/\s+/).every((parte) => card.dataset.busca.includes(parte));
    card.hidden = !mostrar;
    if (mostrar) total++;
  });
  const vazio = document.getElementById("skills-empty");
  if (vazio) vazio.hidden = total > 0;
}

// Atualiza só os textos de uma perícia (total e detalhe) sem redesenhar a lista.
function atualizarExibicaoPericia(skill) {
  const calc = calcularPericia(skill);
  const total = document.getElementById(`skill-mod-${skill.id}`);
  if (total) total.textContent = formatarBonus(calc.total);
  const botao = [...document.querySelectorAll('[data-rolar-pericia]')].find(el => el.dataset.rolarPericia === skill.id);
  if (botao) {
    botao.title = `1d20 ${formatarBonus(calc.total)}`;
    botao.setAttribute('aria-label', `Rolar ${skill.name}: ${botao.title}`);
  }
  const detalhe = document.getElementById(`skill-detail-${skill.id}`);
  if (detalhe) {
    detalhe.textContent = `${skill.attr} ${formatarBonus(calc.modAtributo)} • bônus ${formatarBonus(calc.bonus)}`;
  }
}

// Envia ao combo o total da perícia (mod. do atributo + bônus). Continua sendo soma fixa.
function adicionarPericiaAoCombo(id) {
  const skill = STATE.skills.find((s) => s.id === id);
  if (!skill) return;
  const { total } = calcularPericia(skill);
  adicionarAoCombo(skill.name, formatarBonus(total), "skill", "perícia");
}

function rolarPericia(id) {
  if (!personagemCarregado) return;
  const skill = STATE.skills.find(s => s.id === id);
  if (!skill) return;
  const bonus = calcularPericia(skill).total;
  const d20 = rolarDadoIndividual(20), total = d20 + bonus;
  const detalhe = `1d20 (${d20}) ${formatarBonus(bonus)}`;
  tocarSomImpacto();
  publicarRolagem({ total, resumo: `Teste de ${skill.name}`,
    linhas: [{ nome: skill.name, detalhe, soma: total }],
    detalhesMestre: `${skill.name}: ${detalhe} = ${total}`,
    log: ['Rolagem de Perícia', { pericia: skill.name, d20, bonus, total }],
  });
  toast(`${skill.name}: ${total} [${detalhe}]`, 'combat');
}

function alterarModPericia(id, delta) {
  const skill = STATE.skills.find((s) => s.id === id);
  if (skill) {
    const anterior = skill.mod;
    skill.mod += delta;
    atualizarExibicaoPericia(skill);
    registrarNoTerminal("Perícia alterada", {
      pericia: skill.name,
      anterior,
      atual: skill.mod,
      total: calcularPericia(skill).total,
    });
    salvarPericias();
    if (id === "atletismo") atualizarRotuloCarga();
  }
}

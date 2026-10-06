/* =========================================================================
   PERÍCIAS
   Lista de perícias (atributo + bônus), edição do bônus e envio ao combo.
   ========================================================================= */

function renderizarPericias() {
  const container = document.getElementById("skills-container");
  if (!container) return;
  container.innerHTML = "";

  STATE.skills.forEach((skill) => {
    const calc = calcularPericia(skill);
    const div = document.createElement("div");
    div.className =
      "p-3 bg-dungeon-800/70 border border-dungeon-700/80 hover:border-amberGold-600/40 rounded-lg flex items-center justify-between transition";
    div.innerHTML = `
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded bg-dungeon-900 border border-dungeon-700 flex items-center justify-center text-amberGold-400 text-xs">
              <i class="fa-solid ${skill.icon}"></i>
            </div>
            <div>
              <div class="text-xs font-bold text-slate-200 font-cinzel">${skill.name}</div>
              <div class="text-[10px] text-slate-500 font-mono" id="skill-detail-${skill.id}">${skill.attr} ${formatarBonus(calc.modAtributo)} • bônus ${formatarBonus(calc.bonus)}</div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex items-center bg-dungeon-900 rounded border border-dungeon-700">
              <button onclick="alterarModPericia('${skill.id}', -1)" class="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white">-</button>
              <span id="skill-mod-${skill.id}" title="Total = modificador de ${skill.attr} + bônus da perícia" class="px-2 font-mono font-bold text-xs text-amber-300">${formatarBonus(calc.total)}</span>
              <button onclick="alterarModPericia('${skill.id}', 1)" class="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white">+</button>
            </div>
            
            <button onclick="adicionarPericiaAoCombo('${skill.id}')" 
                    title="Adicionar bônus ao Combo"
                    class="p-1.5 rounded bg-dungeon-700 hover:bg-amberGold-600 hover:text-black text-amberGold-400 transition text-xs">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        `;
    container.appendChild(div);
  });
}

// Atualiza só os textos de uma perícia (total e detalhe) sem redesenhar a lista.
function atualizarExibicaoPericia(skill) {
  const calc = calcularPericia(skill);
  const total = document.getElementById(`skill-mod-${skill.id}`);
  if (total) total.textContent = formatarBonus(calc.total);
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

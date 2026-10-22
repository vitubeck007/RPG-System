/* Comportamentos de interface compartilhados. Não modifica o STATE. */
window.RPGUI = (() => {
  let modalAtual = null;
  let focoAnterior = null;
  let overflowAnterior = '';
  const fundos = [];
  const selecionador = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
  function mensagem(elemento, texto = '', estado = '') {
    elemento.textContent = texto;
    elemento.dataset.state = estado;
  }
  function abrirModal(id, focoInicial) {
    const modal = document.getElementById(id);
    if (!modal || modalAtual) return;
    focoAnterior = document.activeElement;
    overflowAnterior = document.body.style.overflow;
    modalAtual = modal;
    modal.hidden = false;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.querySelectorAll('[data-modal-background]').forEach((elemento) => {
      fundos.push([elemento, elemento.inert]);
      elemento.inert = true;
    });
    (document.getElementById(focoInicial) || modal.querySelector(selecionador) || modal).focus();
  }
  function fecharModal(id) {
    if (!modalAtual || modalAtual.id !== id || modalAtual.dataset.busy === 'true') return false;
    modalAtual.hidden = true;
    modalAtual.classList.add('hidden');
    modalAtual = null;
    fundos.splice(0).forEach(([elemento, anterior]) => { elemento.inert = anterior; });
    document.body.style.overflow = overflowAnterior;
    if (focoAnterior?.isConnected && !focoAnterior.disabled) focoAnterior.focus();
    return true;
  }
  document.addEventListener('keydown', (evento) => {
    if (!modalAtual) return;
    if (evento.key === 'Escape') {
      evento.preventDefault();
      if (modalAtual.dataset.busy !== 'true') modalAtual.dispatchEvent(new Event('rpg:cancelar'));
    }
    if (evento.key !== 'Tab') return;
    const controles = [...modalAtual.querySelectorAll(selecionador)].filter((el) => !el.hidden && !el.closest('[hidden], .hidden'));
    const primeiro = controles[0];
    const ultimo = controles.at(-1);
    if (!primeiro) { evento.preventDefault(); modalAtual.focus(); return; }
    if (evento.shiftKey && (document.activeElement === primeiro || !modalAtual.contains(document.activeElement))) {
      evento.preventDefault(); ultimo.focus();
    } else if (!evento.shiftKey && (document.activeElement === ultimo || !modalAtual.contains(document.activeElement))) {
      evento.preventDefault(); primeiro.focus();
    }
  });
  // Inclui a leitura do corpo no prazo: receber só os cabeçalhos não encerra a espera.
  async function pedirJSON(url, opcoes = {}, tempoLimiteMs = 12000) {
    const controlador = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...opcoes, signal: controlador.signal });
          const result = await response.json();
          return { response, result };
        })(),
        new Promise((_, rejeitar) => {
          timer = setTimeout(() => {
            const erro = new Error('O servidor demorou a responder.');
            erro.codigo = 'tempo_limite';
            rejeitar(erro);
            controlador.abort();
          }, tempoLimiteMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  // Preserva apenas estado de apresentação; os valores vindos do servidor continuam atuais.
  function preservarInteracao(area, renderizar) {
    const controles = 'button, input, select, textarea, summary';
    const chaveControle = el => el ? JSON.stringify([
      el.closest('details')?.dataset.detalhe || '', el.tagName,
      el.dataset.campo || el.dataset.preservar || el.dataset.preservarFoco || el.dataset.acao || el.getAttribute('aria-label') || el.textContent,
    ]) : null;
    const registros = new Map();
    for (const card of area.querySelectorAll('[data-ui-chave]')) {
      registros.set(card.dataset.uiChave, {
        abertos: [...card.querySelectorAll('details[open]')].map(el => el.dataset.detalhe),
        valores: [...card.querySelectorAll('[data-preservar], [data-preservar-foco]:focus')].map(el => [el.dataset.preservar || el.dataset.preservarFoco, el.value]),
        foco: card.contains(document.activeElement) ? chaveControle(document.activeElement) : null,
        inicio: document.activeElement?.selectionStart,
        fim: document.activeElement?.selectionEnd,
      });
    }
    const rolagem = area.scrollTop;
    const rolagemHorizontal = area.scrollLeft;
    renderizar();
    for (const card of area.querySelectorAll('[data-ui-chave]')) {
      const registro = registros.get(card.dataset.uiChave);
      if (!registro) continue;
      card.querySelectorAll('details').forEach(el => { el.open = registro.abertos.includes(el.dataset.detalhe); });
      for (const [chave, valor] of registro.valores) {
        const campo = [...card.querySelectorAll('[data-preservar], [data-preservar-foco]')].find(el => (el.dataset.preservar || el.dataset.preservarFoco) === chave);
        if (campo) campo.value = valor;
      }
      if (registro.foco) {
        const controle = [...card.querySelectorAll(controles)].find(el => chaveControle(el) === registro.foco);
        controle?.focus({ preventScroll: true });
        if ((controle?.type === 'text' || controle?.tagName === 'TEXTAREA') && registro.inicio != null) controle.setSelectionRange(registro.inicio, registro.fim ?? registro.inicio);
      }
    }
    area.scrollTop = rolagem;
    area.scrollLeft = rolagemHorizontal;
  }

  function ajustarValor({ titulo, ler, aplicar }) {
    if (modalAtual) return false;
    let modal = document.getElementById('rpg-ajuste');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'rpg-ajuste'; modal.className = 'rpg-modal'; modal.hidden = true;
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'rpg-ajuste-titulo');
      modal.innerHTML = `<form class="rpg-modal-panel">
        <h2 id="rpg-ajuste-titulo"></h2>
        <label class="rpg-field" for="rpg-ajuste-delta">Quanto adicionar ou remover?
          <input id="rpg-ajuste-delta" class="rpg-input" type="number" min="-100000" max="100000" step="1" required placeholder="Ex.: -15 ou 8" aria-describedby="rpg-ajuste-previa">
        </label>
        <p id="rpg-ajuste-previa" class="rpg-message" role="status"></p>
        <p id="rpg-ajuste-erro" class="rpg-message" data-state="error" role="alert"></p>
        <div class="rpg-modal-actions"><button type="button" class="rpg-btn" data-cancelar>Cancelar</button><button type="submit" class="rpg-btn rpg-btn--primary">Confirmar ajuste</button></div>
      </form>`;
      document.body.append(modal);
    }
    const form = modal.querySelector('form'), input = modal.querySelector('input');
    const erro = modal.querySelector('#rpg-ajuste-erro'), previa = modal.querySelector('#rpg-ajuste-previa');
    let referencia;
    const atualizar = () => {
      const valor = ler();
      referencia = valor ? { current: valor.current, max: valor.max } : null;
      if (!referencia) { previa.textContent = 'Este recurso não está mais disponível.'; return; }
      const delta = Number(input.value);
      const depois = Math.max(0, Math.min(referencia.max, referencia.current + delta));
      previa.textContent = input.value && input.validity.valid
        ? `${referencia.current}/${referencia.max} → ${depois}/${referencia.max} (limites: 0 a ${referencia.max})`
        : `Atual: ${referencia.current}/${referencia.max}. Use um número negativo para remover.`;
    };
    modal.querySelector('h2').textContent = titulo;
    input.value = ''; erro.textContent = ''; input.oninput = atualizar; atualizar();
    const cancelar = () => fecharModal(modal.id);
    modal.querySelector('[data-cancelar]').onclick = cancelar;
    if (modal.cancelarAjuste) modal.removeEventListener('rpg:cancelar', modal.cancelarAjuste);
    modal.cancelarAjuste = cancelar;
    modal.addEventListener('rpg:cancelar', cancelar);
    form.onsubmit = async evento => {
      evento.preventDefault();
      if (modal.dataset.busy === 'true' || !form.reportValidity()) return;
      const atual = ler();
      if (!atual) { erro.textContent = 'Recurso indisponível. Cancele e atualize a página.'; return; }
      if (!referencia || atual.current !== referencia.current || atual.max !== referencia.max) {
        atualizar(); erro.textContent = 'O valor mudou enquanto você editava. Confira a prévia e confirme novamente.'; return;
      }
      const delta = Number(input.value);
      if (!Number.isInteger(delta) || !delta) { erro.textContent = 'Informe um inteiro diferente de zero.'; input.focus(); return; }
      modal.dataset.busy = 'true'; form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
      try {
        await aplicar(delta);
        delete modal.dataset.busy; fecharModal(modal.id);
      } catch (falha) { erro.textContent = falha.message || 'Não foi possível enviar o ajuste.'; }
      finally {
        delete modal.dataset.busy; form.removeAttribute('aria-busy');
        form.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
      }
    };
    abrirModal(modal.id, input.id);
    return true;
  }
  return { mensagem, abrirModal, fecharModal, pedirJSON, preservarInteracao, ajustarValor };
})();

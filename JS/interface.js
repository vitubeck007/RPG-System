/* Comportamentos de interface compartilhados. Não modifica o STATE. */
window.numeroFlutuante = (origem, delta) => {
  if (!origem || !Number.isFinite(delta) || !delta) return;
  const caixa = origem.getBoundingClientRect();
  const numero = document.createElement('span');
  numero.className = 'rpg-numero-flutuante';
  numero.textContent = `${delta > 0 ? '+' : ''}${delta}`;
  numero.setAttribute('aria-hidden', 'true');
  numero.style.left = `${caixa.left + caixa.width / 2}px`;
  numero.style.top = `${caixa.top}px`;
  numero.dataset.positivo = String(delta > 0);
  document.body.append(numero);
  setTimeout(() => numero.remove(), 1200);
};
window.RPGUI = (() => {
  // Os valores persistidos continuam iguais; catálogo e prévia usam o mesmo tema.
  const coresItens = Object.freeze([
    ['', 'Padrão', '#1c2836', '#141d28'],
    ['from-slate-800 to-slate-900', 'Cinza ardósia', '#1e293b', '#0f172a'],
    ['from-amber-900 to-amber-950', 'Âmbar', '#78350f', '#451a03'],
    ['from-red-900 to-red-950', 'Vermelho', '#7f1d1d', '#450a0a'],
    ['from-emerald-900 to-emerald-950', 'Verde', '#064e3b', '#022c22'],
    ['from-sky-900 to-sky-950', 'Azul', '#0c4a6e', '#082f49'],
    ['from-violet-900 to-violet-950', 'Violeta', '#4c1d95', '#2e1065'],
  ].map(Object.freeze));
  function aplicarTemaItem(elemento, valor = '') {
    const cor = coresItens.find(([chave]) => chave === valor);
    elemento.classList.add('rpg-item-theme');
    elemento.dataset.colorido = String(Boolean(cor && valor));
    for (const [variavel, indice] of [['--item-base-from', 2], ['--item-base-to', 3]]) {
      if (cor && valor) elemento.style.setProperty(variavel, cor[indice]);
      else elemento.style.removeProperty(variavel);
    }
    return cor;
  }
  let modalAtual = null;
  let confirmacaoPendente = false;
  function confirmar({ titulo = 'Confirmar ação', mensagem: texto, acao = 'Confirmar', perigo = true }) {
    if (confirmacaoPendente) return Promise.resolve(false);
    confirmacaoPendente = true;
    const origem = document.activeElement;
    const dialogo = document.createElement('dialog');
    dialogo.className = 'rpg-confirmacao'; dialogo.setAttribute('role', 'alertdialog');
    dialogo.setAttribute('aria-modal', 'true');
    dialogo.setAttribute('aria-labelledby', 'rpg-confirmar-titulo');
    dialogo.setAttribute('aria-describedby', 'rpg-confirmar-descricao');
    const tituloEl = document.createElement('h2'); tituloEl.id = 'rpg-confirmar-titulo'; tituloEl.textContent = titulo;
    const descricao = document.createElement('p'); descricao.id = 'rpg-confirmar-descricao'; descricao.textContent = texto;
    const acoes = document.createElement('div'); acoes.className = 'rpg-modal-actions';
    const cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.className = 'rpg-btn'; cancelar.textContent = 'Cancelar';
    const aceitar = document.createElement('button'); aceitar.type = 'button'; aceitar.className = `rpg-btn ${perigo ? 'rpg-btn--danger' : 'rpg-btn--primary'}`; aceitar.textContent = acao;
    acoes.append(cancelar, aceitar); dialogo.append(tituloEl, descricao, acoes); document.body.append(dialogo);
    const anteriores = [...document.body.children].filter(el => el !== dialogo).map(el => [el, el.inert]);
    anteriores.forEach(([el]) => { el.inert = true; });
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return new Promise(resolve => {
      const concluir = valor => {
        anteriores.forEach(([el, inert]) => { el.inert = inert; });
        document.body.style.overflow = overflow; dialogo.remove(); confirmacaoPendente = false;
        if (origem?.isConnected) origem.focus(); resolve(valor);
      };
      cancelar.onclick = () => concluir(false); aceitar.onclick = () => concluir(true);
      dialogo.addEventListener('cancel', ev => { ev.preventDefault(); concluir(false); });
      dialogo.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); concluir(false); }
        if (ev.key === 'Tab') { ev.preventDefault(); (document.activeElement === cancelar ? aceitar : cancelar).focus(); }
      });
      if (typeof dialogo.showModal === 'function') dialogo.showModal(); else dialogo.setAttribute('open', '');
      cancelar.focus();
    });
  }
  function validarFormulario(area) {
    const campos = area.matches('input,select,textarea') ? [area] : [...area.querySelectorAll('input,select,textarea')];
    let primeiro;
    for (const input of campos) {
      if (input.disabled || !input.willValidate) continue;
      const invalido = !input.validity.valid;
      const id = `${input.id}-validacao`;
      let erro = document.getElementById(id);
      if (invalido && !erro) { erro = document.createElement('span'); erro.id = id; erro.className = 'rpg-field-error'; erro.setAttribute('aria-live', 'polite'); input.after(erro); }
      input.setAttribute('aria-invalid', String(invalido));
      const refs = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      if (invalido) refs.add(id); else refs.delete(id);
      if (refs.size) input.setAttribute('aria-describedby', [...refs].join(' ')); else input.removeAttribute('aria-describedby');
      if (erro) {
        erro.hidden = !invalido;
        erro.textContent = !invalido ? '' : input.validity.valueMissing ? 'Preencha este campo.' : input.validity.rangeUnderflow ? `Use um valor a partir de ${input.min}.` : input.validity.rangeOverflow ? `Use um valor até ${input.max}.` : input.validity.stepMismatch ? 'Use um valor no intervalo permitido.' : 'Confira o valor informado.';
      }
      if (invalido && !primeiro) primeiro = input;
    }
    primeiro?.focus(); return !primeiro;
  }
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
    // Escape fecha primeiro a lista aberta, sem cancelar o editor atrás dela.
    if (evento.key === 'Escape' && window.CSS?.supports?.('selector(select:open)') && document.querySelector('select:open')) return;
    // O enquadramento de imagem usa dialog nativo e gerencia o próprio teclado.
    if (evento.target.closest?.('dialog[open]')) return;
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
      modal.innerHTML = `<form class="rpg-modal-panel" novalidate>
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
      if (modal.dataset.busy === 'true' || !validarFormulario(form)) return;
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
  return { mensagem, abrirModal, fecharModal, pedirJSON, preservarInteracao, ajustarValor, coresItens, aplicarTemaItem, confirmar, validarFormulario };
})();

// Uma ação explícita de limpar, igual nos catálogos do mestre.
document.addEventListener('DOMContentLoaded', () => {
  // Reagrupa os mesmos campos: IDs, valores, listeners e o editor proprietário são mantidos.
  const organizar = (id, grupos) => {
    const area = document.getElementById(id);
    const grid = area?.querySelector(':scope > .grid');
    if (!grid) return;
    grid.classList.add('rpg-editor-sections');
    for (const [titulo, ids] of grupos) {
      const grupo = document.createElement('fieldset'); grupo.className = 'rpg-editor-group';
      const legenda = document.createElement('legend'); legenda.textContent = titulo; grupo.append(legenda);
      const movidos = new Set();
      for (const campoId of ids) {
        let el = document.getElementById(campoId);
        if (!el || !grid.contains(el)) continue;
        while (el.parentElement !== grid && el.parentElement) el = el.parentElement;
        movidos.add(el);
      }
      for (const el of movidos) grupo.append(el);
      if (movidos.size) grid.append(grupo);
    }
    area.lastElementChild?.classList.add('rpg-editor-actions');
  };
  organizar('loot-editor-item', [
    ['Identificação e descrição', ['li-name','li-subtitulo','li-desc']],
    ['Características', ['li-tipo-rolagem','li-type','li-atributo','li-dice','li-categoria','li-tipoDano','li-tipo-cura','li-usos']],
    ['Imagem e aparência', ['li-escolher-imagem','li-aparencia']],
    ['Peso e armazenamento', ['li-weight']],
  ]);
  organizar('habmag-editor', [
    ['Identificação', ['hm-nome','hm-desc']],
    ['Uso e custo', ['hm-dice','hm-tipoDano','hm-custo-vital','hm-acao','hm-alcance','hm-duracao','hm-requisitos']],
    ['Informações do mestre', ['hm-descLonga','hm-efeitos','hm-publico']],
    ['Aparência', ['hm-aparencia']],
  ]);
  for (const [id, tituloId, cancelarId] of [
    ['loot-editor-item', 'li-titulo', 'li-cancelar'],
    ['habmag-editor', 'hm-titulo', 'hm-cancelar'],
  ]) {
    const painel = document.getElementById(id);
    if (!painel) continue;
    const modal = document.createElement('div');
    modal.id = `${id}-modal`; modal.className = 'rpg-modal master-editor-overlay'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', tituloId); modal.tabIndex = -1;
    painel.classList.add('rpg-modal-panel', 'master-editor-panel');
    document.body.append(modal); modal.append(painel);
    modal.addEventListener('rpg:cancelar', () => document.getElementById(cancelarId).click());
    document.querySelectorAll('.master-main, .master-header, #mestre-cabecalho').forEach(el => el.setAttribute('data-modal-background', ''));
  }
  document.querySelectorAll('.master-app input[type="search"]').forEach(input => {
    const grupo = document.createElement('div'); grupo.className = 'rpg-search';
    const limpar = document.createElement('button'); limpar.type = 'button';
    limpar.className = 'rpg-search-clear'; limpar.textContent = '×';
    limpar.setAttribute('aria-label', `Limpar ${input.getAttribute('aria-label') || 'busca'}`);
    input.before(grupo); grupo.append(input, limpar);
    const atualizar = () => { limpar.hidden = !input.value; limpar.disabled = input.disabled; };
    input.addEventListener('input', atualizar);
    input.addEventListener('focus', atualizar);
    limpar.addEventListener('click', () => {
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus(); atualizar();
    });
    atualizar();
    // As páginas podem restaurar a busca no restante do DOMContentLoaded.
    queueMicrotask(atualizar);
  });
});

// Indicador compartilhado para campos de fórmulas, inclusive danos extras criados depois.
document.addEventListener('DOMContentLoaded', () => {
  const indicadores = new WeakMap();
  function atualizar(input) {
    let indicador = indicadores.get(input);
    if (!indicador) {
      const grupo = document.createElement('span');
      grupo.className = 'rpg-dados-campo';
      indicador = document.createElement('span');
      indicador.className = 'rpg-dados-validade';
      indicador.setAttribute('role', 'img');
      input.before(grupo);
      grupo.append(input, indicador);
      indicadores.set(input, indicador);
    }
    const texto = input.value.trim();
    const tipo = input.dataset.validarDados;
    const valido = tipo === 'expressao' ? !!lerExpressaoRolagem(texto)
      : dadoDePoderValido(texto) || (tipo === 'arma' && /^\d{1,5}$/.test(texto));
    const estado = !texto ? 'vazio' : valido ? 'valido' : 'invalido';
    const simbolo = !texto ? '—' : valido ? '✓' : '✕';
    const descricao = !texto ? 'Digite uma fórmula de dados' : valido ? 'Dados válidos' : 'Dados inválidos';
    if (indicador.dataset.estado !== estado) {
      indicador.dataset.estado = estado;
      indicador.textContent = simbolo;
      indicador.title = descricao;
      indicador.setAttribute('aria-label', descricao);
    }
  }
  const atualizarTodos = () => document.querySelectorAll('input[data-validar-dados]').forEach(atualizar);
  document.addEventListener('input', evento => {
    if (evento.target.matches('input[data-validar-dados]')) atualizar(evento.target);
  });
  document.addEventListener('focusin', evento => {
    if (evento.target.matches('input[data-validar-dados]')) atualizar(evento.target);
  });
  atualizarTodos();
  // Também acompanha preenchimento ao editar/restaurar e campos adicionados dinamicamente.
  new MutationObserver(atualizarTodos).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'],
  });
});

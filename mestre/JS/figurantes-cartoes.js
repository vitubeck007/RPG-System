/* Comando tático: apresentação dos modelos e das cópias independentes em combate. */
const recursosPendentesFig = new Set();
const rascunhosCombateFig = new Map();
const fichasAbertasFig = new Set();
const alturasNotasFig = new Map();
const armasIguaisFig = (a, b) => ["nome", "icone", "alcance", "dano", "categoria"].every(chave => (a?.[chave] ?? "") === (b?.[chave] ?? ""));

function iconeCartaoFig(nome) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `/CSS/icones.svg#${nome}`); svg.append(use); return svg;
}

function acaoCartaoFig(rotulo, tratar, { icone, classe = "" } = {}) {
  const b = botaoDeAcao(rotulo, icone ? "" : rotulo, `fig-tatica-acao ${classe}`);
  if (icone) {
    b.append(iconeCartaoFig(icone)); b.classList.add("fig-tatica-icone");
    b.setAttribute("aria-label", rotulo); b.title = rotulo;
  }
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    b.disabled = true; b.setAttribute("aria-busy", "true");
    try { await tratar(b); } catch { /* pedirAoServidor já mostra o erro e não confirma a alteração. */ }
    finally { b.disabled = false; b.removeAttribute("aria-busy"); }
  });
  return b;
}

function alvoAtualFig(item, tipo, batalha) {
  return (batalha ? figurantes.batalha.combatentes : figurantes[tipo])
    .find(x => (batalha ? x.alvoId : x.id) === (batalha ? item.alvoId : item.id));
}

function retratoCartaoFig(item) {
  const tipo = item.tipo === "npc" ? "npcs" : "inimigos";
  const modelo = item.modeloId ? figurantes[tipo].find(x => x.id === item.modeloId) : null;
  // Cópias antigas podem ter sido criadas antes de o modelo receber um retrato.
  const src = urlDeImagem(item.imagem) || urlDeImagem(item.retrato) || urlDeImagem(modelo?.imagem) || urlDeImagem(modelo?.retrato);
  const img = criar("img", "fig-retrato-imagem");
  const padrao = "/CSS/retrato-padrao.svg";
  img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
  img.src = src || padrao;
  img.addEventListener("error", () => {
    if (img.getAttribute("src") === padrao) { img.hidden = true; return; }
    img.src = padrao;
    img.title = "O retrato original não pôde ser carregado. Verifique a URL em Editar ficha.";
  });
  return img;
}

function recursoCartaoFig(item, tipo, recurso, batalha) {
  const nome = recurso === "hp" ? "Vida" : "Energia";
  const vidaModelo = recurso === "hp" && !batalha && tipo === "inimigos";
  const vital = item[recurso] || (recurso === "hp" ? { atual: item.hpMax, max: item.hpMax } : { atual: 10, max: 10 });
  const minimo = vidaModelo ? 1 : 0, limite = vidaModelo ? 100000 : vital.max;
  const chave = JSON.stringify([batalha ? "batalha" : tipo, item.alvoId || item.id, recurso]);
  const pendente = recursosPendentesFig.has(chave);
  const painel = criar("div", `fig-tatica-recurso fig-tatica-${recurso}`);
  const cabecalho = criar("div", "fig-tatica-recurso-topo");
  cabecalho.append(criar("span", "", nome), criar("small", "", "Atual / máximo"));
  painel.append(cabecalho);
  const controles = criar("div", "fig-tatica-controles");
  const aplicar = async ajuste => {
    if (recursosPendentesFig.has(chave)) return;
    recursosPendentesFig.add(chave); renderizarFigurantes();
    try {
      if (recurso === "energia") await pedirAoServidor("master_figurante_energia", { tipo: batalha ? "batalha" : tipo, id: item.alvoId || item.id, ...ajuste }, { muda: true });
      else if (vidaModelo) await pedirAoServidor("master_inimigo_hp", { id: item.id, ...ajuste }, { muda: true });
      else await pedirAoServidor(batalha ? "master_batalha_hp" : "master_npc_hp", batalha ? { alvoId: item.alvoId, ...ajuste } : { id: item.id, ...ajuste }, { muda: true });
    } catch { /* o servidor mantém o último valor confirmado; o aviso comum explica a falha. */ }
    finally { recursosPendentesFig.delete(chave); renderizarFigurantes(); }
  };
  const menos = acaoCartaoFig(`Diminuir ${nome.toLowerCase()} de ${item.nome}`, () => aplicar({ delta: -1 }), { icone: "minus" });
  menos.disabled = pendente || vital.atual <= minimo; controles.append(menos);
  const valores = criar("div", "fig-tatica-valores");
  {
    const input = criar("input"); input.type = "number"; input.min = String(minimo); input.max = String(limite); input.step = "1"; input.required = true;
    input.value = String(vital.atual); input.disabled = pendente; input.inputMode = "numeric";
    input.style.setProperty("--fig-digitos", Math.max(2, String(vital.max).length));
    input.dataset.preservarFoco = recurso; input.setAttribute("aria-label", `${nome} ${vidaModelo ? "máxima" : "atual"} de ${item.nome}`);
    input.title = vidaModelo ? "Vida máxima do modelo; não altera cópias já em batalha" : "Digite o valor atual e pressione Enter ou saia do campo para salvar";
    const valorAtual = () => { const alvo = alvoAtualFig(item, tipo, batalha); return (vidaModelo ? alvo?.hpMax : alvo?.[recurso]?.atual) ?? vital.atual; };
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
      if (ev.key === "Escape") { input.value = String(valorAtual()); input.blur(); }
    });
    input.addEventListener("change", () => {
      if (!input.reportValidity()) { input.value = String(valorAtual()); return; }
      const atual = Number(input.value);
      if (atual !== valorAtual()) aplicar({ atual });
    });
    valores.append(input);
  }
  valores.append(criar("span", "fig-tatica-maximo", `/ ${vital.max}`)); controles.append(valores);
  const mais = acaoCartaoFig(`Aumentar ${nome.toLowerCase()} de ${item.nome}`, () => aplicar({ delta: 1 }), { icone: "plus" });
  mais.disabled = pendente || vital.atual >= limite; controles.append(mais);
  const barra = criar("div", "fig-tatica-barra"); barra.setAttribute("aria-hidden", "true");
  const preenchimento = criar("span"); preenchimento.style.width = `${vital.max ? Math.max(0, Math.min(100, vital.atual / vital.max * 100)) : 0}%`; barra.append(preenchimento);
  painel.append(controles, barra); return painel;
}

function poderesCartaoFig(item, tipo, batalha) {
  const grupos = criar("div", "fig-tatica-poderes");
  for (const lista of ["habilidades", "magias"]) {
    const poderes = item[lista] || [], grupo = criar("section", `fig-tatica-grupo fig-tatica-${lista}`);
    const titulo = criar("h4", "fig-tatica-grupo-titulo", lista === "magias" ? "Magias" : "Habilidades");
    titulo.prepend(iconeCartaoFig(lista === "magias" ? "fireball" : "sword")); titulo.append(criar("span", "", String(poderes.length))); grupo.append(titulo);
    if (!poderes.length) grupo.append(criar("p", "fig-tatica-vazio", `Nenhuma ${lista === "magias" ? "magia" : "habilidade"} adicionada.`));
    poderes.forEach((p, indice) => {
      const bloco = criar("div", "fig-tatica-poder"), detalhes = criar("details");
      detalhes.dataset.detalhe = JSON.stringify([lista, p.uid || p.id || `${p.catalogId || p.nome}:${indice}`]);
      detalhes.open = batalha && indice === 0;
      const resumo = criar("summary"), tituloPoder = criar("strong", "", p.nome);
      const custo = p.cost?.amount || 0;
      resumo.append(tituloPoder, criar("span", "fig-tatica-meta", [p.dice, custo ? `${custo} ${p.cost?.vital === "vigor" ? "energia" : p.cost?.vital || "energia"}` : "Sem custo"].filter(Boolean).join(" · ")));
      const corpo = criar("div", "fig-tatica-poder-corpo");
      if (p.desc || p.nota) corpo.append(criar("p", "fig-tatica-narrativa", p.desc || p.nota));
      if (p.efeito) corpo.append(criar("p", "fig-tatica-efeito", p.efeito));
      if (!p.desc && !p.nota && !p.efeito) corpo.append(criar("p", "fig-tatica-vazio", "Sem descrição ou efeito cadastrado."));
      const metadados = criar("div", "fig-tatica-metadados");
      for (const [rotulo, valor] of [["Alcance", p.alcance], ["Duração", p.duracao], ["Canalização", p.canalizacao]]) {
        if (valor) { const dado = criar("span"); dado.append(criar("small", "", rotulo), criar("span", "", valor)); metadados.append(dado); }
      }
      if (metadados.children.length) corpo.append(metadados);
      for (const dano of p.danosExtras || []) corpo.append(criar("p", "fig-tatica-extra", [dano.tipo, dano.dado, dano.efeito].filter(Boolean).join(" · ")));
      detalhes.append(resumo, corpo); bloco.append(detalhes);
      const automatico = !custo || p.cost?.vital === "vigor";
      const usar = acaoCartaoFig(`${lista === "magias" ? "Conjurar" : "Usar"} ${p.nome}`, async () => {
        if (p.cost?.vital === "vigor") await pedirAoServidor("master_figurante_usar_poder", { tipo: batalha ? "batalha" : tipo, id: item.alvoId || item.id, lista, indice, nome: p.nome }, { muda: true });
        toast(custo ? "Energia consumida. Aplique o efeito conforme as regras da mesa." : "Poder sem custo. Aplique o efeito conforme as regras da mesa.", "success");
      }, { icone: lista === "magias" ? "fireball" : "sword", classe: "fig-tatica-usar" });
      const insuficiente = custo > (item.energia?.atual ?? 10);
      usar.disabled = !automatico || insuficiente;
      if (!automatico || insuficiente) {
        const aviso = !automatico ? "Custo legado: ajuste esse recurso manualmente na ficha." : "Energia insuficiente";
        usar.title = `${p.nome}: ${aviso}`; corpo.append(criar("p", "fig-tatica-aviso", aviso));
      }
      bloco.append(usar); grupo.append(bloco);
    });
    grupos.append(grupo);
  }
  if (item.ataques?.length) {
    const legados = criar("details", "fig-tatica-legados"); legados.dataset.detalhe = "ataques-legados";
    legados.append(criar("summary", "", `Ataques anteriores (${item.ataques.length})`));
    for (const ataque of item.ataques) legados.append(criar("p", "", [ataque.nome, ataque.dado, ataque.tipo, ataque.alcance, ataque.nota].filter(Boolean).join(" · ")));
    grupos.append(legados);
  }
  return grupos;
}

function atualizarAvisoNotasFig(alvoId) {
  const r = rascunhosCombateFig.get(alvoId);
  if (!r) return;
  const card = [...campo("fig-selecionado").children].find(el => el.dataset.id === alvoId);
  const aviso = card?.querySelector(".fig-tatica-notas-status");
  if (aviso) { aviso.textContent = r.enviando ? "Salvando…" : r.erro ? "Não salvo. Tente novamente." : r.sujo ? "Alterações pendentes…" : "Salvo na batalha"; aviso.dataset.erro = String(r.erro); }
  const repetir = card?.querySelector('[data-acao="Salvar notas novamente"]');
  if (repetir) repetir.hidden = !r.erro || r.enviando;
}

function sincronizarRascunhosCombateFig() {
  const presentes = new Set(figurantes.batalha.combatentes.map(x => x.alvoId));
  for (const id of alturasNotasFig.keys()) if (!presentes.has(id)) alturasNotasFig.delete(id);
  for (const [id, r] of rascunhosCombateFig) {
    if (presentes.has(id)) continue;
    clearTimeout(r.timer); rascunhosCombateFig.delete(id);
    if (r.sujo) toast("Um combatente com notas pendentes foi removido da batalha.", "error");
  }
}

async function salvarNotasCombateFig(alvoId) {
  const r = rascunhosCombateFig.get(alvoId);
  if (!r || !r.sujo || r.enviando) return;
  clearTimeout(r.timer);
  if (r.token !== tokenDoMestre()) { r.erro = true; atualizarAvisoNotasFig(alvoId); return; }
  const notas = r.texto; r.enviando = true; r.erro = false; atualizarAvisoNotasFig(alvoId);
  try {
    await pedirAoServidor("master_batalha_notas", { alvoId, notas }, { muda: true });
    r.sujo = r.texto !== notas;
  } catch { r.erro = true; }
  finally {
    r.enviando = false; atualizarAvisoNotasFig(alvoId);
    // Uma digitação durante o envio vira outro salvamento, nunca perde a revisão mais nova.
    if (rascunhosCombateFig.get(alvoId) === r && r.sujo && !r.erro) r.timer = setTimeout(() => salvarNotasCombateFig(alvoId), 500);
  }
}

function notasCartaoFig(item) {
  const painel = criar("div", "fig-tatica-notas"), label = criar("label");
  const r = rascunhosCombateFig.get(item.alvoId);
  const input = criar("textarea"); input.rows = 2; input.maxLength = 2000;
  input.value = r?.sujo || r?.enviando ? r.texto : item.notasCombate || "";
  input.setAttribute("aria-label", `Notas rápidas de combate de ${item.nome}`);
  input.id = `fig-notas-${item.alvoId}`;
  input.placeholder = "Condições, alvo, último movimento…";
  input.addEventListener("input", () => {
    let atual = rascunhosCombateFig.get(item.alvoId);
    if (!atual) { atual = { token: tokenDoMestre(), enviando: false }; rascunhosCombateFig.set(item.alvoId, atual); }
    atual.texto = input.value; atual.sujo = true; atual.erro = false; clearTimeout(atual.timer);
    atual.timer = setTimeout(() => salvarNotasCombateFig(item.alvoId), 600); atualizarAvisoNotasFig(item.alvoId);
  });
  input.addEventListener("blur", () => salvarNotasCombateFig(item.alvoId));
  const tamanho = botaoDeAcao("redimensionar-notas", "", "fig-tatica-notas-tamanho");
  tamanho.append(criar("span", "", "Notas rápidas de combate"), criar("span", "fig-tatica-notas-alca"));
  const indicacao = criar("span", "fig-tatica-notas-indicacao"); tamanho.append(indicacao);
  tamanho.setAttribute("aria-controls", input.id);
  tamanho.title = "Clique para expandir/recolher; arraste para cima ou use as setas para ajustar a altura.";
  const ajustarAltura = valor => {
    // A camada só pode cobrir a área dos poderes, nunca o cabeçalho ou a arma.
    const area = painel.closest(".fig-tatica-area"), limite = area ? Math.max(44, area.clientHeight - 90) : 440;
    const altura = Math.round(Math.max(44, Math.min(limite, valor)));
    painel.style.setProperty("--fig-altura-notas", `${altura}px`);
    alturasNotasFig.set(item.alvoId, altura);
    tamanho.setAttribute("aria-expanded", String(altura > 44));
    tamanho.setAttribute("aria-label", `${altura > 44 ? "Recolher" : "Expandir"} anotações de ${item.nome}`);
    indicacao.textContent = altura > 44 ? "Recolher" : "Expandir";
  };
  ajustarAltura(alturasNotasFig.get(item.alvoId) || 44);
  let arrasto = null, arrastou = false;
  tamanho.addEventListener("pointerdown", ev => {
    if (ev.button !== 0) return;
    arrastou = false; arrasto = { y: ev.clientY, altura: input.getBoundingClientRect().height };
    tamanho.setPointerCapture(ev.pointerId);
  });
  tamanho.addEventListener("pointermove", ev => {
    if (!arrasto) return;
    if (Math.abs(arrasto.y - ev.clientY) > 3) arrastou = true;
    if (arrastou) ajustarAltura(arrasto.altura + arrasto.y - ev.clientY);
  });
  tamanho.addEventListener("lostpointercapture", () => { arrasto = null; });
  tamanho.addEventListener("pointercancel", () => { arrastou = false; });
  tamanho.addEventListener("click", () => {
    if (!arrastou) ajustarAltura((alturasNotasFig.get(item.alvoId) || 44) > 44 ? 44 : 240);
    arrastou = false;
  });
  tamanho.addEventListener("keydown", ev => {
    if (!["ArrowUp", "ArrowDown", "Escape"].includes(ev.key)) return;
    ev.preventDefault(); ajustarAltura(ev.key === "Escape" ? 44 : (alturasNotasFig.get(item.alvoId) || 44) + (ev.key === "ArrowUp" ? 24 : -24));
  });
  label.append(input);
  const status = criar("small", "fig-tatica-notas-status", r ? r.enviando ? "Salvando…" : r.erro ? "Não salvo. Tente novamente." : r.sujo ? "Alterações pendentes…" : "Salvo na batalha" : "Salvamento automático · só nesta cópia");
  status.setAttribute("role", "status"); status.dataset.erro = String(!!r?.erro);
  const repetir = acaoCartaoFig("Salvar notas novamente", () => salvarNotasCombateFig(item.alvoId)); repetir.hidden = !r?.erro || r.enviando;
  painel.append(tamanho, label, status, repetir); return painel;
}

function selecionarCombatenteFig(alvoId) {
  const alvo = figurantes.batalha.combatentes.find(x => x.alvoId === alvoId);
  if (!alvo) return;
  figurantes.selecionados[alvo.tipo === "npc" ? "npcs" : "inimigos"] = alvoId;
  renderizarFigurantes();
}

async function reviverCombatenteFig(item) {
  const atual = alvoAtualFig(item, "batalha", true);
  if (!atual || atual.hp.max < 1) return;
  // Desmarcar derrotado sozinho deixaria uma ficha com HP zero marcada como viva.
  await pedirAoServidor("master_batalha_hp", { alvoId: atual.alvoId, atual: Math.max(1, atual.hp.atual) }, { muda: true });
}

function resumoCombatenteFig(item, selecionado) {
  const card = criar("li", `fig-resumo fig-tatico${selecionado ? " fig-resumo-ativo" : ""}${item.derrotado ? " fig-resumo-caido" : ""}`);
  card.dataset.id = item.alvoId; card.dataset.uiChave = JSON.stringify(["resumo", item.alvoId]);
  const escolher = botaoDeAcao("selecionar-combatente", "", "fig-resumo-selecionar");
  escolher.setAttribute("aria-label", `Selecionar ${item.nome}${item.derrotado ? ", caído" : ""}`);
  escolher.setAttribute("aria-pressed", String(selecionado)); escolher.setAttribute("aria-controls", "fig-ficha-regiao");
  const foto = criar("span", "fig-resumo-foto");
  foto.append(criar("span", "fig-resumo-inicial", item.nome.slice(0, 1).toUpperCase()));
  foto.append(retratoCartaoFig(item));
  escolher.append(criar("strong", "fig-resumo-nome", item.nome), foto);
  escolher.title = item.nome;
  escolher.addEventListener("click", () => selecionarCombatenteFig(item.alvoId));
  if (item.derrotado) {
    const caido = criar("div", "fig-resumo-recuperacao"); caido.append(criar("span", "", "Caído"));
    const acoes = criar("div");
    const reviver = acaoCartaoFig("Reviver", () => reviverCombatenteFig(item));
    reviver.setAttribute("aria-label", `Reviver ${item.nome}`); reviver.disabled = item.hp.max < 1;
    if (reviver.disabled) reviver.title = "A vida máxima precisa ser maior que zero para reviver.";
    const excluir = acaoCartaoFig("Excluir da batalha", b => confirmarNoBotao(b, () => pedirAoServidor("master_batalha_remover", { alvoId: item.alvoId }, { muda: true }).catch(() => {})), { classe: "fig-perigo" });
    excluir.textContent = "Excluir"; excluir.title = `Excluir somente ${item.nome} da batalha; o modelo é mantido na biblioteca`;
    acoes.append(excluir, reviver); caido.append(acoes); card.append(caido);
  }
  const recursos = criar("div", "fig-resumo-recursos");
  recursos.append(recursoCartaoFig(item, "batalha", "hp", true), recursoCartaoFig(item, "batalha", "energia", true));
  card.append(escolher, recursos, criar("span", "fig-resumo-estado", selecionado ? "Selecionado" : item.derrotado ? "Caído" : "Selecionar para ver ficha"));
  return card;
}

function armaCartaoFig(item, batalha = false) {
  const painel = criar("section", `fig-tatica-arma${item.arma ? "" : " fig-tatica-arma-vazia"}`);
  painel.setAttribute("aria-label", "Arma carregada");
  const arma = item.arma, icone = criar("div", "fig-tatica-arma-icone");
  icone.append(iconeCartaoFig(arma?.icone || "sword"));
  const titulo = criar("div", "fig-tatica-arma-nome");
  titulo.append(criar("small", "", "Arma"), criar("strong", "", arma?.nome || "Sem arma registrada"));
  painel.append(icone, titulo);
  if (!arma) painel.append(criar("p", "fig-discreto", "Sem arma. Cadastre em Editar ficha na biblioteca."));
  const categorias = { leve: "Leve", media: "Média", pesada: "Pesada", natural: "Natural", outra: "Outra" };
  for (const [rotulo, valor] of arma ? [["Alcance", arma.alcance], ["Dano", arma.dano], ["Categoria", categorias[arma.categoria]]] : []) {
    const dado = criar("div", "fig-tatica-arma-dado"); dado.append(criar("small", "", rotulo), criar("span", "", valor || "Não informado")); painel.append(dado);
  }
  if (batalha) {
    const modelo = figurantes[item.tipo === "npc" ? "npcs" : "inimigos"].find(x => x.id === item.modeloId);
    if (modelo && !armasIguaisFig(item.arma, modelo.arma)) {
      const sincronizar = acaoCartaoFig("Atualizar arma do modelo", async () => {
        await pedirAoServidor("master_batalha_arma_modelo", { alvoId: item.alvoId }, { muda: true });
        toast("Arma atualizada nesta cópia. Vida, energia e notas foram mantidas.", "success");
      });
      sincronizar.classList.add("fig-tatica-arma-sincronizar");
      sincronizar.title = "Copiar a arma atual da biblioteca somente para este combatente; mantém vida, energia e notas.";
      painel.append(sincronizar);
    }
  }
  return painel;
}

function atributosCartaoFig(item, abreviado = false) {
  const lista = criar("dl", `fig-tatica-atributos${abreviado ? " fig-tatica-atributos-curtos" : ""}`);
  lista.setAttribute("aria-label", "Atributos");
  for (const [sigla, nome] of [["FOR", "Força"], ["DES", "Destreza"], ["INT", "Inteligência"], ["SAB", "Sabedoria"], ["PRE", "Presença"], ["VON", "Vontade"]]) {
    const valor = item.atributos?.[sigla] ?? "—", dado = criar("div");
    const rotulo = criar("dt", "", abreviado ? sigla : nome);
    if (abreviado) { rotulo.setAttribute("aria-label", nome); dado.title = `${nome}: ${valor}`; }
    dado.append(rotulo, criar("dd", "", String(valor))); lista.append(dado);
  }
  return lista;
}

function cartaoFigurante(item, tipo, batalha = false) {
  const card = criar("article", `fig-cartao fig-tatico${batalha ? " fig-tatico-combate" : " fig-tatico-biblioteca"}${item.derrotado && batalha ? " fig-tatico-derrotado" : ""}`);
  card.dataset.id = batalha ? item.alvoId : item.id; card.dataset.uiChave = JSON.stringify([tipo, card.dataset.id]);
  const topo = criar("header", "fig-tatica-cabecalho"), identidade = criar(batalha ? "div" : "span", "fig-tatica-identidade"), texto = criar(batalha ? "div" : "span", "fig-tatica-identidade-texto");
  identidade.append(retratoCartaoFig(item));
  texto.append(criar("small", "fig-tatica-tipo", batalha ? `${item.tipo === "npc" ? "NPC" : "Inimigo"} · ${item.derrotado ? "Derrotado" : "Em combate"}` : tipo === "npcs" ? "NPC" : "Inimigo"), criar(batalha ? "h3" : "strong", "fig-biblioteca-nome", item.nome));
  if (item.papel && batalha) texto.append(criar("p", "fig-discreto", item.papel)); identidade.append(texto); topo.append(identidade); card.append(topo);
  const corpoBiblioteca = criar("div", "fig-biblioteca-corpo");
  if (!batalha) {
    const chave = JSON.stringify([tipo, item.id]);
    corpoBiblioteca.id = `fig-ficha-${tipo}-${item.id}`;
    corpoBiblioteca.hidden = !fichasAbertasFig.has(chave);
    const expandir = botaoDeAcao("expandir-ficha", "", "fig-biblioteca-expandir");
    expandir.setAttribute("aria-controls", corpoBiblioteca.id);
    const atualizarExpansao = () => {
      expandir.setAttribute("aria-expanded", String(!corpoBiblioteca.hidden));
      expandir.setAttribute("aria-label", `${corpoBiblioteca.hidden ? "Expandir" : "Recolher"} ficha de ${item.nome}`);
      expandir.title = corpoBiblioteca.hidden ? "Expandir ficha" : "Recolher ficha";
    };
    // Identidade e seta formam um único botão; o menu ao lado permanece independente.
    expandir.append(identidade, criar("span", "fig-biblioteca-seta", "⌄"));
    topo.prepend(expandir); atualizarExpansao();
    expandir.addEventListener("click", () => {
      corpoBiblioteca.hidden = !corpoBiblioteca.hidden;
      if (corpoBiblioteca.hidden) fichasAbertasFig.delete(chave); else fichasAbertasFig.add(chave);
      atualizarExpansao();
    });
    const maximos = criar("div", "fig-biblioteca-maximos");
    for (const [recurso, nome, atual, max] of [["hp", "Vida", item.hpMax ?? item.hp?.atual ?? 10, item.hpMax ?? item.hp?.max ?? 10], ["energia", "Energia", item.energia?.atual ?? 10, item.energia?.max ?? 10]]) {
      const dado = criar("div", `fig-biblioteca-maximo fig-tatica-${recurso}`);
      const rotulo = criar("span", "fig-biblioteca-vital-rotulo");
      rotulo.append(criar("span", "", nome), criar("small", "", "Atual / máximo"));
      dado.append(rotulo, criar("strong", "", String(atual)), criar("span", "fig-tatica-maximo", `/ ${max}`)); maximos.append(dado);
    }
    const dados = criar("div", "fig-biblioteca-dados"); dados.append(maximos, atributosCartaoFig(item));
    topo.append(dados); card.append(corpoBiblioteca);
  }
  const recursos = criar("div", "fig-tatica-recursos"); recursos.append(recursoCartaoFig(item, tipo, "hp", batalha), recursoCartaoFig(item, tipo, "energia", batalha));
  if (batalha) {
    topo.append(recursos, atributosCartaoFig(item, true));
    const corpo = criar("div", "fig-tatica-combate-corpo");
    corpo.append(poderesCartaoFig(item, tipo, true));
    const area = criar("div", "fig-tatica-area"); area.append(corpo, notasCartaoFig(item));
    card.append(armaCartaoFig(item, true), area);
  } else {
    corpoBiblioteca.append(recursos, armaCartaoFig(item));
    const historia = criar("div", "fig-tatica-historia");
    for (const [titulo, valor] of [["Descrição", item.descricao], ["Lore", item.lore], ["Anotações", item.notas || item.nota]]) {
      const linha = criar("section"); linha.append(criar("h4", "", titulo), criar("p", valor ? "" : "fig-tatica-vazio", valor || "Ainda não preenchido.")); historia.append(linha);
    }
    corpoBiblioteca.append(historia);
    const poderes = criar("details", "fig-tatica-expansao"); poderes.dataset.detalhe = "poderes-biblioteca";
    poderes.append(criar("summary", "", `Habilidades (${item.habilidades?.length || 0}) e magias (${item.magias?.length || 0})`), poderesCartaoFig(item, tipo, false)); corpoBiblioteca.append(poderes);
  }
  const rodape = criar("footer", "fig-tatica-rodape"), secundarios = criar("div", "fig-tatica-secundarios");
  const menu = criar("details", "fig-tatica-menu"); menu.dataset.detalhe = "mais-acoes"; menu.append(criar("summary", "", "Mais ações"));
  const opcoes = criar("div", "fig-tatica-menu-opcoes");
  if (batalha) {
    const estado = acaoCartaoFig(item.derrotado ? "Reviver" : "Marcar derrotado", () => item.derrotado ? reviverCombatenteFig(item) : pedirAoServidor("master_batalha_derrotado", { alvoId: item.alvoId, derrotado: true }, { muda: true }));
    estado.disabled = item.derrotado && item.hp.max < 1;
    estado.addEventListener("click", () => { menu.open = false; });
    opcoes.append(estado, acaoCartaoFig("Remover da batalha", b => confirmarNoBotao(b, () => pedirAoServidor("master_batalha_remover", { alvoId: item.alvoId }, { muda: true }).catch(() => {})), { classe: "fig-perigo" }));
  } else {
    const label = criar("label", "fig-tatica-copias", "Cópias"), quantidade = criar("input");
    quantidade.type = "number"; quantidade.min = "1"; quantidade.max = "20"; quantidade.step = "1"; quantidade.required = true; quantidade.value = "1"; quantidade.dataset.preservar = "copias";
    quantidade.setAttribute("aria-label", "Cópias na batalha"); label.append(quantidade); rodape.append(label);
    rodape.append(acaoCartaoFig("Colocar em batalha", async () => {
      if (!quantidade.reportValidity()) return;
      await pedirAoServidor("master_batalha_adicionar", { tipo, modeloId: item.id, quantidade: Number(quantidade.value) }, { muda: true });
      toast("Cópias adicionadas. Abra a aba Batalha para jogar.", "success");
    }, { classe: "fig-primario" }));
    secundarios.append(acaoCartaoFig("Editar ficha", () => abrirFichaFigurante(item)));
    opcoes.append(acaoCartaoFig("Editar ficha", () => { menu.open = false; return abrirFichaFigurante(item); }), acaoCartaoFig("Duplicar", async () => {
      const copia = copiarFigurante(item); delete copia.id; copia.nome = `${copia.nome} (cópia)`.slice(0, 80);
      atualizarItemFig(tipo, await pedirAoServidor("master_campanha_salvar", { tipo, item: copia }, { muda: true }));
    }), acaoCartaoFig("Excluir", b => confirmarNoBotao(b, () => pedirAoServidor("master_campanha_remover", { tipo, id: item.id }, { muda: true }).catch(() => {})), { classe: "fig-perigo" }));
  }
  menu.append(opcoes); topo.append(menu);
  menu.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.preventDefault(); menu.open = false; menu.querySelector("summary").focus(); } });
  if (!batalha) { rodape.append(secundarios); corpoBiblioteca.append(rodape); }
  return card;
}

window.addEventListener("beforeunload", ev => {
  if (![...rascunhosCombateFig.values()].some(r => r.sujo || r.enviando)) return;
  ev.preventDefault(); ev.returnValue = "";
});

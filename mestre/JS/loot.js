/* =========================================================================
   PÁGINA LOOT (Sprint 3): catálogo de itens e baús
   Itens: criar, editar, duplicar, excluir, busca e filtro por tipo.
   Baús: montar com itens do catálogo (cópia) e quantidade, liberar/recolher com 1 clique, ver quem pegou o quê.
   Tudo passa pelo servidor (pedirAoServidor); tempo real por campanha_atualizada.
   ========================================================================= */

const loot = {
  aba: "itens",
  itens: [],
  baus: [],
  busca: "",
  filtroTipo: "",
  editandoItem: null, // null = fechado; { id } ou { id: null } (novo)
  editandoBau: null, // null = fechado; { id, linhas: [{ id?, item, quantidade }] }
  carregou: false,
  carregando: false, erro: "",
};

/* ------------------------------ abas ------------------------------ */
function renderizarAbas() {
  for (const aba of ["itens", "baus"]) {
    const ativa = aba === loot.aba;
    const b = campo(`loot-aba-${aba}`);
    b.setAttribute("aria-selected", String(ativa));
    b.tabIndex = ativa ? 0 : -1;
    b.className = `px-3 py-1.5 rounded text-xs font-mono border ${ativa ? "border-amberGold-600 text-amberGold-400" : "border-dungeon-700 text-slate-400"}`;
    b.textContent = `${aba === "itens" ? "Itens" : "Baús"} (${loot[aba].length})`;
    campo(`loot-${aba}`).classList.toggle("hidden", !ativa);
  }
}

/* ------------------------------ itens ------------------------------ */
function renderizarFiltroDeTipos() {
  const select = campo("loot-filtro-tipo");
  const atual = loot.filtroTipo;
  select.replaceChildren(new Option("Todos os tipos", ""));
  [...new Set(loot.itens.map((i) => i.type))].sort().forEach((t) => select.append(new Option(t, t)));
  select.value = [...select.options].some((o) => o.value === atual) ? atual : "";
  if (loot.carregou) loot.filtroTipo = select.value;
}

function criarCartaoItem(item) {
  const c = criar("article", "master-catalog-card bg-dungeon-950 border border-dungeon-700 rounded-lg");
  c.dataset.id = item.id;
  c.classList.add("loot-item-card");
  RPGUI.aplicarTemaItem(c, item.color);
  const topo = criar("div", "loot-item-corpo");
  const identidade = criar("div", "loot-item-identidade");
  const retrato = criar("div", "loot-item-retrato");
  retrato.setAttribute("aria-hidden", "true");
  const simbolo = criar("i", `fa-solid ${/^fa-[a-z0-9-]+$/i.test(item.icon || '') ? item.icon : 'fa-gem'}`);
  retrato.append(simbolo);
  const img = miniaturaDeImagem(item.imagem);
  if (img) retrato.append(img);
  identidade.append(retrato);
  const detalhes = criar("div", "loot-item-detalhes");
  detalhes.append(criar('h4', 'loot-item-nome', item.name));
  if (item.subtitulo) detalhes.append(criar("p", "loot-item-subtitulo", item.subtitulo));
  topo.append(identidade, detalhes); c.append(topo);
  const resumo = criar('div', 'loot-item-resumo');
  const cura = item.tipoRolagem === 'cura';
  const tiposCura = { vigor: 'Vigor', vida: 'Vida', sanidade: 'Sanidade', mana: 'Mana' };
  for (const [rotulo, valor] of [["Dados", item.dice], ["Atributo", item.atributo], ...(cura ? [['Cura', tiposCura[item.tipoCura]], ['Usos', String(item.usos ?? 1)]] : [["Dano", item.tipoDano], ["Categoria", item.categoria]])]) {
    if (!valor) continue;
    const linha = criar("div", "loot-item-linha");
    linha.append(criar("span", "loot-item-rotulo", rotulo), criar("strong", "loot-item-valor", valor));
    resumo.append(linha);
  }
  if (resumo.childElementCount) c.append(resumo);
  if (item.desc) c.append(criar("p", "loot-item-descricao", item.desc));
  const info = [item.type, `${Number(item.weight || 0).toLocaleString('pt-BR')} kg`, item.tamanho || '', item.maxStack > 1 ? `pilha ${item.maxStack}` : ""].filter(Boolean).join(" · ");
  const rodape = criar("div", "loot-item-rodape");
  const menu = criar("details", "master-catalog-menu");
  menu.append(criar("summary", "", "Mais opções"));
  const acoes = criar("div", "master-catalog-menu-opcoes");
  acoes.append(botaoDeAcao("editar", "Editar"), botaoDeAcao("duplicar", "Duplicar"), botaoDeAcao("excluir", "Excluir", "text-rose-300"));
  menu.append(acoes);
  rodape.append(criar("p", "loot-item-info", info), menu);
  const base = criar('div', 'loot-item-base');
  base.append(rodape);
  c.append(base);
  if (item.impossivelArmazenar) {
    base.append(criar('p', 'loot-item-nao-armazenavel', 'Não cabe na mochila'));
  } else {
    const disposicao = criar('details', 'loot-item-disposicao');
    disposicao.append(criar('summary', '', 'Mostrar disposição na mochila'));
    const largura = Math.max(1, Math.min(10, Math.floor(Number(item.w)) || 1));
    const altura = Math.max(1, Math.min(10, Math.floor(Number(item.h)) || 1));
    const grade = criar('div', 'loot-disposicao-grade');
    grade.style.setProperty('--loot-colunas', largura);
    grade.setAttribute('role', 'img');
    grade.setAttribute('aria-label', `Ocupa ${largura} por ${altura} quadrantes na mochila`);
    const ocupados = new Set(quadrantesItem(item).map(p=>p.join(',')));
    for (let i = 0; i < largura * altura; i++) {
      const celula = criar('span', 'loot-disposicao-quadrante');
      if (!ocupados.has(`${i%largura},${Math.floor(i/largura)}`)) celula.style.visibility = 'hidden';
      grade.append(celula);
    }
    disposicao.append(grade, criar('p', 'loot-disposicao-aviso', `${largura} × ${altura} quadrantes`));
    base.append(disposicao);
  }
  return c;
}

function renderizarItens() {
  renderizarFiltroDeTipos();
  const termo = semAcento(loot.busca);
  const lista = campo("loot-lista-itens");
  const visiveis = loot.itens.filter((i) => (!loot.filtroTipo || i.type === loot.filtroTipo) && (!termo || semAcento(`${i.name} ${i.type} ${i.desc}`).includes(termo)));
  lista.replaceChildren();
  if (!visiveis.length) lista.append(criar("p", "master-empty", loot.itens.length ? "Nenhum item corresponde aos filtros. Tente outro nome ou tipo." : 'Nenhum item ainda. Use "Novo item" para começar o catálogo.'));
  visiveis.forEach((i) => lista.append(criarCartaoItem(i)));
  mostrarEstadoLeituraMestre(lista, loot, carregarLoot);
  renderizarSeletorDeItens();
}

let imagemItem = null;
let imagemCarregando = false;
let versaoImagem = 0;

function atualizarBotoesImagem() {
  const temImagem = Boolean(imagemItem || urlDeImagem(campo('li-imagem').value.trim()));
  campo('li-escolher-imagem-texto').textContent = temImagem ? 'Alterar imagem' : 'Escolher imagem';
  campo('li-editar-imagem').disabled = !temImagem || imagemCarregando;
  atualizarMiniaturaItem();
  if (editoresAparenciaMestre.has('li')) atualizarAparenciaMestre('li');
}

function atualizarMiniaturaItem() {
  const miniatura = campo('li-miniatura');
  if (imagemItem) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Imagem do item com o enquadramento atual');
    desenharImagemItem(canvas);
    miniatura.replaceChildren(canvas);
  } else {
    const imagem = miniaturaDeImagem(campo('li-imagem').value.trim());
    const icone = criar('i', 'fa-regular fa-image');
    icone.setAttribute('aria-hidden', 'true');
    miniatura.replaceChildren(icone);
    if (imagem) { imagem.alt = 'Imagem do item'; miniatura.append(imagem); }
  }
  atualizarImagemFormato();
}

function atualizarImagemFormato() {
  for (const input of campo('li-formato-imagem-controles').querySelectorAll('input[type="range"]')) {
    const percentual = (Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.setProperty('--loot-progresso', `${percentual}%`);
  }
  campo('li-formato-imagem-angulo').textContent = `${campo('li-formato-imagem-rotacao').value}°`;
  const grade = document.querySelector('.loot-formato-grade');
  if (!grade) return;
  grade.querySelector('.loot-formato-imagem')?.remove();
  const origem = campo('li-miniatura').querySelector('canvas, img');
  campo('li-formato-imagem-controles').hidden = !origem;
  if (!origem) return;
  const camada = criar('div', 'loot-formato-imagem');
  camada.setAttribute('aria-hidden', 'true');
  let imagem;
  if (origem.tagName === 'CANVAS') {
    imagem = document.createElement('canvas'); imagem.width = origem.width; imagem.height = origem.height;
    imagem.getContext('2d').drawImage(origem, 0, 0);
  } else imagem = origem.cloneNode(true);
  camada.style.left = `${campo('li-formato-imagem-x').value}%`;
  camada.style.top = `${campo('li-formato-imagem-y').value}%`;
  camada.style.width = camada.style.height = `${campo('li-formato-imagem-escala').value}%`;
  camada.style.transform = `translate(-50%, -50%) rotate(${campo('li-formato-imagem-rotacao').value}deg)`;
  camada.append(imagem); grade.prepend(camada);
}

function atualizarBarrasImagem() {
  for (const id of ['li-imagem-zoom', 'li-imagem-x', 'li-imagem-y', 'li-imagem-rotacao']) {
    const input = campo(id);
    const percentual = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
    input.style.setProperty('--loot-progresso', `${Math.max(0, Math.min(100, percentual))}%`);
  }
}

function limparImagemSelecionada() {
  versaoImagem++;
  imagemItem = null;
  imagemCarregando = false;
  campo('li-arquivo-imagem').value = '';
  if (campo('li-enquadramento').open) campo('li-enquadramento').close();
  atualizarBotoesImagem();
}

function dimensoesImagemItem(tamanho) {
  const escala = Math.max(tamanho / imagemItem.naturalWidth, tamanho / imagemItem.naturalHeight) * Number(campo('li-imagem-zoom').value);
  const largura = imagemItem.naturalWidth * escala, altura = imagemItem.naturalHeight * escala;
  const angulo = Number(campo('li-imagem-rotacao').value) * Math.PI / 180;
  const c = Math.abs(Math.cos(angulo)), s = Math.abs(Math.sin(angulo));
  return { largura, altura, angulo, caixaLargura: largura * c + altura * s, caixaAltura: largura * s + altura * c };
}

function desenharImagemItem(canvas) {
  if (!imagemItem) return;
  atualizarBarrasImagem();
  const tamanho = canvas.width;
  const { largura, altura, angulo, caixaLargura, caixaAltura } = dimensoesImagemItem(tamanho);
  const x = -(caixaLargura - tamanho) * Number(campo('li-imagem-x').value) / 100;
  const y = -(caixaAltura - tamanho) * Number(campo('li-imagem-y').value) / 100;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, tamanho, tamanho);
  ctx.save();
  ctx.translate(x + caixaLargura / 2, y + caixaAltura / 2);
  ctx.rotate(angulo);
  ctx.drawImage(imagemItem, -largura / 2, -altura / 2, largura, altura);
  ctx.restore();
}

function atualizarMinimoZoomItem() {
  if (!imagemItem) return;
  const zoom = campo('li-imagem-zoom');
  const atual = Number(zoom.value);
  const dimensoes = dimensoesImagemItem(1);
  zoom.min = String(0.8 * atual / Math.max(dimensoes.caixaLargura, dimensoes.caixaAltura));
  if (atual < Number(zoom.min)) zoom.value = zoom.min;
}

function prepararEnquadramentoItem() {
  const zoom = campo('li-imagem-zoom');
  campo('li-imagem-rotacao').value = '0';
  campo('li-imagem-angulo').textContent = '0°';
  zoom.min = '0.000001';
  zoom.value = '1';
  atualizarMinimoZoomItem();
  campo('li-imagem-x').value = campo('li-imagem-y').value = '50';
}

function ativarMouseEnquadramento() {
  const canvas = campo('li-imagem-previa');
  let arraste = null;
  const atualizar = (id, valor) => {
    const controle = campo(id);
    controle.value = Math.max(Number(controle.min), Math.min(Number(controle.max), valor));
    controle.dispatchEvent(new Event('input', { bubbles: true }));
  };
  canvas.addEventListener('pointerdown', evento => {
    if (!imagemItem || evento.button !== 0) return;
    const tamanho = canvas.getBoundingClientRect().width;
    if (!tamanho) return;
    const dimensoes = dimensoesImagemItem(tamanho);
    arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY,
      horizontal: Number(campo('li-imagem-x').value), vertical: Number(campo('li-imagem-y').value),
      sobraX: dimensoes.caixaLargura - tamanho, sobraY: dimensoes.caixaAltura - tamanho };
    canvas.setPointerCapture(evento.pointerId);
    canvas.classList.add('arrastando');
  });
  canvas.addEventListener('pointermove', evento => {
    if (!arraste || evento.pointerId !== arraste.id) return;
    if (Math.abs(arraste.sobraX) > 0.01) atualizar('li-imagem-x', arraste.horizontal - (evento.clientX - arraste.x) * 100 / arraste.sobraX);
    if (Math.abs(arraste.sobraY) > 0.01) atualizar('li-imagem-y', arraste.vertical - (evento.clientY - arraste.y) * 100 / arraste.sobraY);
  });
  const terminar = evento => {
    if (!arraste || evento.pointerId !== arraste.id) return;
    arraste = null;
    canvas.classList.remove('arrastando');
  };
  for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(tipo, terminar);
  canvas.addEventListener('wheel', evento => {
    if (!imagemItem || !evento.deltaY) return;
    evento.preventDefault();
    const zoom = campo('li-imagem-zoom');
    const atual = Number(zoom.value);
    atualizar('li-imagem-zoom', atual * (evento.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
}

function selecionarImagemItem() {
  const arquivo = campo('li-arquivo-imagem').files[0];
  if (!arquivo) return;
  limparImagemSelecionada();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(arquivo.type) || arquivo.size > 10 * 1024 * 1024) {
    toast('Escolha uma imagem PNG, JPG ou WebP de até 10 MB.', 'error');
    return;
  }
  const versao = versaoImagem;
  const endereco = URL.createObjectURL(arquivo);
  const imagem = new Image();
  imagemCarregando = true;
  atualizarBotoesImagem();
  imagem.onload = () => {
    URL.revokeObjectURL(endereco);
    if (versao !== versaoImagem) return;
    imagemCarregando = false;
    imagemItem = imagem;
    prepararEnquadramentoItem();
    atualizarBotoesImagem();
    desenharImagemItem(campo('li-imagem-previa'));
  };
  imagem.onerror = () => {
    URL.revokeObjectURL(endereco);
    if (versao !== versaoImagem) return;
    imagemCarregando = false;
    atualizarBotoesImagem();
    toast('Não foi possível abrir essa imagem. Escolha outro arquivo.', 'error');
  };
  imagem.src = endereco;
}

function abrirEnquadramentoItem() {
  if (imagemCarregando) return toast('Aguarde a imagem terminar de carregar.', 'error');
  if (imagemItem) {
    campo('li-enquadramento').showModal();
    desenharImagemItem(campo('li-imagem-previa'));
    campo('li-imagem-zoom').focus();
    return;
  }
  const endereco = campo('li-imagem').value.trim();
  if (!urlDeImagem(endereco)) return toast('Escolha uma imagem antes de editar.', 'error');
  const versao = ++versaoImagem;
  const imagem = new Image();
  imagem.crossOrigin = 'anonymous';
  imagemCarregando = true;
  atualizarBotoesImagem();
  imagem.onload = () => {
    if (versao !== versaoImagem) return;
    imagemCarregando = false;
    imagemItem = imagem;
    prepararEnquadramentoItem();
    atualizarBotoesImagem();
    abrirEnquadramentoItem();
  };
  imagem.onerror = () => {
    if (versao !== versaoImagem) return;
    imagemCarregando = false;
    atualizarBotoesImagem();
    toast('Não foi possível editar essa imagem. Escolha um arquivo do computador.', 'error');
  };
  imagem.src = endereco;
}

async function enviarImagemItem() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  desenharImagemItem(canvas);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Não foi possível preparar a imagem.');
  const resposta = await fetch('/mestre/imagens-itens', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
  if (!resposta.ok) throw new Error('Não foi possível salvar a imagem no servidor.');
  const dados = await resposta.json();
  if (!urlDeImagem(dados.imagem)) throw new Error('O servidor não confirmou a imagem.');
  return dados.imagem;
}

function lerFormatoEditor() {
  try { return JSON.parse(campo('li-formato').value || '[]'); } catch { return []; }
}
function renderizarFormatoItem() {
  const grade = document.querySelector('.loot-formato-grade');
  const formato = lerFormatoEditor(), ocupados = new Set(formato.map(p=>p.join(',')));
  const tamanho = Math.max(6, ...formato.flat().map(n=>n+1));
  grade.style.gridTemplateColumns = `repeat(${tamanho}, 1fr)`;
  grade.style.gridTemplateRows = `repeat(${tamanho}, 1fr)`;
  grade.removeAttribute('role'); grade.setAttribute('aria-label','Desenhar formato na mochila');
  grade.replaceChildren();
  for (let y=0;y<tamanho;y++) for (let x=0;x<tamanho;x++) {
    const b = criar('button','loot-formato-celula'); b.type='button'; b.dataset.x=x; b.dataset.y=y;
    b.setAttribute('aria-label',`Coluna ${x+1}, linha ${y+1}`); b.setAttribute('aria-pressed',String(ocupados.has(`${x},${y}`))); grade.append(b);
  }
  atualizarResumoFormato();
  atualizarImagemFormato();
}
function atualizarResumoFormato() {
  const formato=lerFormatoEditor();
  document.querySelector('.loot-formato-medida').textContent = `${formato.length} quadrantes`;
  campo('li-formato-ajuda').textContent = normalizarFormatoItem(formato) ? 'Formato conectado. Clique ou arraste para alterar.' : 'Marque pelo menos um quadrante e mantenha todos conectados.';
}
function iniciarFormatoItem() {
  const grade=document.querySelector('.loot-formato-grade'); let pintar=null;
  const alterar=b=>{
    const formato=lerFormatoEditor(), x=Number(b.dataset.x), y=Number(b.dataset.y);
    const novos=formato.filter(p=>p[0]!==x || p[1]!==y);
    if(pintar) novos.push([x,y]);
    campo('li-formato').value=JSON.stringify(novos); b.setAttribute('aria-pressed',String(pintar)); atualizarResumoFormato();
    campo('li-formato').dispatchEvent(new Event('input',{bubbles:true}));
  };
  grade.addEventListener('pointerdown',e=>{const b=e.target.closest('button'); if(!b || e.button!==0)return; e.preventDefault(); pintar=b.getAttribute('aria-pressed')!=='true'; alterar(b);});
  grade.addEventListener('pointerover',e=>{const b=e.target.closest('button'); if(pintar!==null && b)alterar(b);});
  window.addEventListener('pointerup',()=>{pintar=null;}); window.addEventListener('pointercancel',()=>{pintar=null;});
  grade.addEventListener('click',e=>{const b=e.target.closest('button'); if(b && e.detail===0){pintar=b.getAttribute('aria-pressed')!=='true'; alterar(b); pintar=null;}});
  for(const [id,preencher] of [['li-formato-limpar',false],['li-formato-preencher',true]])campo(id).addEventListener('click',()=>{
    const tamanho=Number(grade.style.gridTemplateColumns.match(/\d+/)?.[0])||6;
    campo('li-formato').value=JSON.stringify(preencher?Array.from({length:tamanho*tamanho},(_,i)=>[i%tamanho,Math.floor(i/tamanho)]):[]);
    renderizarFormatoItem(); campo('li-formato').dispatchEvent(new Event('input',{bubbles:true}));
  });
}
function atualizarTamanhoItem() {
  const bloqueado = campo('li-impossivel-armazenar').checked;
  campo('li-w').disabled = bloqueado;
  campo('li-h').disabled = bloqueado;
  campo('li-largura-grupo').hidden = bloqueado;
  campo('li-altura-grupo').hidden = bloqueado;
  campo('li-quadrantes-legenda').hidden = bloqueado;
  document.querySelector('.loot-formato').hidden = bloqueado;
}

function atualizarRolagemItem() {
  const cura = campo('li-tipo-rolagem').value === 'cura';
  const ordem = cura ? ['tipo-rolagem','type','dice','tipo-cura','atributo','usos','categoria','tipoDano'] : ['tipo-rolagem','type','atributo','dice','categoria','tipoDano','tipo-cura','usos'];
  const foco = document.activeElement;
  ordem.forEach(id => { const label = campo(`li-${id}`).closest('label'); label.parentElement.append(label); });
  if (foco?.isConnected && document.activeElement !== foco) foco.focus();
  for (const [id, visivel] of [['li-tipoDano', !cura], ['li-categoria', !cura], ['li-tipo-cura', cura], ['li-usos', cura]]) {
    const input = campo(id); input.closest('label').hidden = !visivel; input.disabled = !visivel;
  }
  if (editoresAparenciaMestre.has('li')) atualizarAparenciaMestre('li');
}
async function abrirEditorItem(item) {
  if (campo("li-salvar").disabled || (editorMestreAlterado("loot-editor-item") && !await podeDescartarEditorMestre("loot-editor-item"))) return;
  limparImagemSelecionada();
  loot.editandoItem = { id: item?.id ?? null };
  const e = item || {};
  campo('li-tipos-existentes').replaceChildren(...[...new Set(loot.itens.map(i => i.type).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR')).map(tipo => new Option(tipo, tipo)));
  campo('li-tipo-rolagem').value = e.tipoRolagem || (/^cura$/i.test(e.tipoDano || '') ? 'cura' : 'dano');
  campo('li-tipo-cura').value = e.tipoCura || 'vida';
  campo('li-usos').value = e.usos ?? 1;
  campo("li-titulo").textContent = item ? "Editar item" : "Novo item";
  campo("li-name").value = e.name || "";
  campo("li-type").value = e.type || "";
  campo("li-tipoDano").value = e.tipoDano || "";
  campo('li-atributo').value = e.atributo || '';
  campo('li-categoria').value = e.categoria || '';
  campo("li-subtitulo").value = e.subtitulo || "";
  campo("li-imagem").value = e.imagem || "";
  atualizarBotoesImagem();
  campo("li-icon").value = e.icon || "";
  campo("li-dice").value = e.dice || "";
  campo("li-color").value = e.color || "";
  campo("li-weight").value = e.weight ?? 0;
  campo("li-maxStack").value = e.maxStack ?? 1;
  campo("li-w").value = e.w ?? 1;
  campo("li-h").value = e.h ?? 1;
  campo('li-formato').value = JSON.stringify(quadrantesItem(e));
  for (const [chave,padrao] of [['x',50],['y',50],['escala',100],['rotacao',0]]) campo(`li-formato-imagem-${chave}`).value = e.imagemFormato?.[chave] ?? padrao;
  renderizarFormatoItem();
  campo('li-tamanho').value = e.tamanho || '';
  campo('li-impossivel-armazenar').checked = e.impossivelArmazenar === true;
  atualizarTamanhoItem();
  campo("li-desc").value = e.desc || "";
  campo("li-twoHanded").checked = Boolean(e.twoHanded);
  campo("loot-editor-item").classList.remove("hidden");
  RPGUI.abrirModal('loot-editor-item-modal', 'li-name');
  atualizarAparenciaMestre('li');
  atualizarRolagemItem();
  protegerEditorMestre("loot-editor-item", () => Boolean(imagemItem || imagemCarregando), { chave: item?.id || "novo", aposRestaurar: () => { atualizarRolagemItem(); atualizarBotoesImagem(); atualizarTamanhoItem(); renderizarFormatoItem(); } });
  campo("li-name").focus();
}
async function fecharEditorItem(salvo = false) {
  if (!salvo && (campo("li-salvar").disabled || (editorMestreAlterado("loot-editor-item") && !await podeDescartarEditorMestre("loot-editor-item")))) return false;
  limparImagemSelecionada();
  loot.editandoItem = null;
  campo("loot-editor-item").classList.add("hidden");
  RPGUI.fecharModal('loot-editor-item-modal');
  limparProtecaoEditorMestre("loot-editor-item", salvo);
  campo("loot-novo-item").focus();
  return true;
}

async function salvarItem() {
  const formato = normalizarFormatoItem(lerFormatoEditor());
  if (!campo('li-impossivel-armazenar').checked && !formato) return toast('Desenhe pelo menos um quadrante e conecte todas as partes do item.', 'error');
  if (imagemCarregando) return toast('Aguarde a imagem terminar de carregar.', 'error');
  if (!validarCamposMestre('loot-editor-item', {
    'li-name': valor => !valor ? 'Dê um nome ao item.' : '',
    'li-dice': valor => valor && !dadoDePoderValido(valor) ? 'Dado inválido. Use 1d6 ou 1d10+1d4+2.' : '',
    'li-imagem': valor => valor && !urlDeImagem(valor) ? 'Use uma URL http/https ou um caminho iniciado por /.' : '',
  })) return;
  const item = {
    tipoRolagem: campo('li-tipo-rolagem').value,
    name: campo("li-name").value.trim(),
    type: campo("li-type").value.trim(),
    tipoDano: campo("li-tipoDano").value.trim(),
    atributo: campo('li-atributo').value.trim(),
    categoria: campo('li-categoria').value.trim(),
    subtitulo: campo("li-subtitulo").value.trim(),
    imagem: campo("li-imagem").value.trim(),
    icon: campo("li-icon").value.trim(),
    dice: campo("li-dice").value.trim(),
    color: campo("li-color").value.trim(),
    weight: Number(campo("li-weight").value) || 0,
    maxStack: Number(campo("li-maxStack").value) || 1,
    w: Number(campo("li-w").value) || 1,
    h: Number(campo("li-h").value) || 1,
    imagemFormato: Object.fromEntries(['x','y','escala','rotacao'].map(chave=>[chave,Number(campo(`li-formato-imagem-${chave}`).value)])),
    ...(formato ? {formato, w:Math.max(...formato.map(p=>p[0]))+1, h:Math.max(...formato.map(p=>p[1]))+1} : {}),
    tamanho: campo('li-tamanho').value.trim(),
    desc: campo("li-desc").value,
    twoHanded: campo("li-twoHanded").checked,
    impossivelArmazenar: campo('li-impossivel-armazenar').checked,
  };
  if (item.tipoRolagem === 'cura') {
    item.tipoCura = campo('li-tipo-cura').value; item.usos = Number(campo('li-usos').value);
    item.tipoDano = ''; item.categoria = '';
  }
  if (loot.editandoItem?.id) item.id = loot.editandoItem.id;
  if (!item.name) return toast("Dê um nome ao item.", "error");
  if (item.dice && !dadoDePoderValido(item.dice)) return toast("Dado inválido. Exemplos: 1d6, 1d10+1d4+2.", "error");
  marcarEnvioMestre("li-salvar", true);
  try {
    if (imagemItem) {
      try {
        item.imagem = await enviarImagemItem();
        campo('li-imagem').value = item.imagem;
      } catch (erro) {
        toast(erro.message || 'Não foi possível salvar a imagem.', 'error');
        return;
      }
    }
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: "itens", item }, { muda: true });
    if (item.formato && JSON.stringify(salvo?.formato) !== JSON.stringify(item.formato)) return toast('O servidor não confirmou o formato. Reinicie o servidor e salve novamente.', 'error');
    const campos = ['tipoRolagem', ...(item.tipoRolagem === 'cura' ? ['tipoCura', 'usos'] : []), 'name', 'type', 'dice', 'icon', 'color', 'tipoDano', 'atributo', 'categoria', 'subtitulo', 'imagem', 'desc', 'tamanho', 'impossivelArmazenar'];
    if (!salvo || campos.some(chave => (salvo[chave] || '') !== (chave === 'type' ? item.type || 'Item' : item[chave] || ''))) {
      if (salvo?.id) loot.editandoItem.id = salvo.id;
      toast('O servidor não confirmou todos os campos. O editor foi mantido aberto. Reinicie o servidor e confira o item antes de salvar novamente.', 'error');
      return;
    }
    toast(`Item salvo: ${salvo.name}`, "success");
    fecharEditorItem(true);
  } catch {
    /* erro já mostrado; o editor continua aberto */
  } finally {
    marcarEnvioMestre("li-salvar", false);
  }
}

async function duplicarItem(item) {
  const copia = { ...item, name: `${item.name} (cópia)`.slice(0, 80) };
  delete copia.id;
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: "itens", item: copia }, { muda: true });
    toast("Item duplicado.", "success");
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ baús ------------------------------ */
function criarCartaoBau(bau) {
  const c = criar("article", "master-catalog-card bg-dungeon-950 border border-dungeon-700 rounded-lg");
  c.dataset.id = bau.id;
  const topo = criar("div", "flex justify-between items-start gap-2");
  topo.append(criar("h4", "font-cinzel font-bold text-amber-200 text-sm break-words", bau.nome));
  const selo = criar("span", `px-1.5 py-0.5 rounded text-[10px] font-mono border ${bau.liberado ? "border-emerald-600 text-emerald-300" : "border-slate-600 text-slate-400"}`, bau.liberado ? "Liberado" : "Preparado");
  selo.dataset.estado = bau.liberado ? "liberado" : "preparado";
  topo.append(selo);
  c.append(topo);
  const lista = criar("ul", "text-[11px] text-slate-300 font-mono space-y-0.5");
  if (!bau.itens.length) lista.append(criar("li", "text-slate-500 italic", "Vazio."));
  for (const l of bau.itens) lista.append(criar("li", l.quantidade ? "" : "text-slate-500 line-through", `${l.quantidade} × ${l.item.name}`));
  c.append(lista);
  if (bau.historico.length) {
    const hist = criar("ul", "text-[10px] text-slate-500 font-mono border-t border-dungeon-800 pt-1 space-y-0.5");
    hist.dataset.historico = "1";
    const rotulo = { pegou: "pegou", sem_espaco: "sem espaço para", expirou: "não pegou (expirou):" };
    for (const h of bau.historico.slice(-5).reverse()) hist.append(criar("li", "", `${h.jogador || "?"} ${rotulo[h.resultado]} ${h.quantidade} × ${h.item}`));
    c.append(hist);
  }
  const acoes = criar("div", "flex flex-wrap gap-1.5");
  acoes.append(
    botaoDeAcao("liberar", bau.liberado ? "Recolher" : "Liberar", bau.liberado ? "" : "bg-amberGold-600 text-white"),
    botaoDeAcao("editar", "Editar"),
    botaoDeAcao("duplicar", "Duplicar"),
    botaoDeAcao("excluir", "Excluir", "text-rose-300"),
  );
  c.append(acoes);
  return c;
}

function renderizarBaus() {
  const lista = campo("loot-lista-baus");
  lista.replaceChildren();
  if (!loot.baus.length) lista.append(criar("p", "master-empty", 'Nenhum baú preparado. Use "+ Novo baú" e escolha os itens do catálogo.'));
  loot.baus.forEach((b) => lista.append(criarCartaoBau(b)));
  mostrarEstadoLeituraMestre(lista, loot, carregarLoot);
}

function renderizarSeletorDeItens() {
  const select = campo("lb-item");
  const atual = select.value;
  select.replaceChildren();
  if (!loot.itens.length) select.append(new Option("Crie itens primeiro", ""));
  loot.itens.forEach((i) => select.append(new Option(`${i.name} (${i.type})`, i.id)));
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
}

function renderizarLinhasDoEditor() {
  const area = campo("lb-linhas");
  area.replaceChildren();
  loot.editandoBau.linhas.forEach((linha, indice) => {
    const l = criar("div", "flex items-center gap-2 text-xs font-mono");
    l.dataset.indice = String(indice);
    l.append(criar("span", "flex-1 break-words", linha.item.name));
    const qtd = criar("input", "w-16 bg-dungeon-950 border border-dungeon-700 rounded px-1 py-0.5");
    qtd.id = `lb-linha-${indice}-quantidade`;
    qtd.type = "number";
    qtd.min = "0";
    qtd.max = "999";
    qtd.value = String(linha.quantidade);
    qtd.setAttribute("aria-label", `Quantidade de ${linha.item.name}`);
    qtd.addEventListener("input", () => {
      linha.quantidade = Math.max(0, Math.min(999, Math.floor(Number(qtd.value)) || 0));
    });
    const remover = botaoDeAcao("remover-linha", "✕", "text-rose-300");
    remover.setAttribute("aria-label", `Remover ${linha.item.name} do baú`);
    remover.addEventListener("click", () => {
      loot.editandoBau.linhas.splice(indice, 1);
      renderizarLinhasDoEditor();
    });
    l.append(qtd, remover);
    area.append(l);
  });
}

async function abrirEditorBau(bau) {
  if (campo("lb-salvar").disabled || (editorMestreAlterado("loot-editor-bau") && !await podeDescartarEditorMestre("loot-editor-bau"))) return;
  loot.editandoBau = { id: bau?.id ?? null, linhas: (bau?.itens || []).map((l) => ({ id: l.id, item: l.item, quantidade: l.quantidade })) };
  campo("lb-titulo").textContent = bau ? "Editar baú" : "Novo baú";
  campo("lb-nome").value = bau?.nome || "";
  campo("loot-editor-bau").classList.remove("hidden");
  renderizarSeletorDeItens();
  renderizarLinhasDoEditor();
  protegerEditorMestre("loot-editor-bau", () => loot.editandoBau?.linhas, {
    chave: bau?.id || "novo",
    restaurarExtra: linhas => { loot.editandoBau.linhas = Array.isArray(linhas) ? linhas : []; renderizarLinhasDoEditor(); },
  });
  campo("lb-nome").focus();
}
async function fecharEditorBau(salvo = false) {
  if (!salvo && (campo("lb-salvar").disabled || (editorMestreAlterado("loot-editor-bau") && !await podeDescartarEditorMestre("loot-editor-bau")))) return false;
  loot.editandoBau = null;
  campo("loot-editor-bau").classList.add("hidden");
  limparProtecaoEditorMestre("loot-editor-bau", salvo);
  campo("loot-novo-bau").focus();
  return true;
}

function adicionarLinhaAoBau() {
  if (!validarCamposMestre('loot-editor-bau', {
    'lb-qtd': valor => !valor ? 'Informe a quantidade.' : '',
  })) return;
  const item = loot.itens.find((i) => i.id === campo("lb-item").value);
  if (!item) return toast("Escolha um item do catálogo.", "error");
  const quantidade = Math.max(1, Math.min(999, Math.floor(Number(campo("lb-qtd").value)) || 1));
  const { criadoEm, atualizadoEm, ...copia } = item; // cópia do catálogo: mudar o catálogo depois não muda o baú
  loot.editandoBau.linhas.push({ item: copia, quantidade });
  renderizarLinhasDoEditor();
}

async function salvarBau() {
  if (!validarCamposMestre('loot-editor-bau', {
    'lb-nome': valor => !valor ? 'Dê um nome ao baú.' : '',
  })) return;
  const nome = campo("lb-nome").value.trim();
  if (!nome) return toast("Dê um nome ao baú.", "error");
  const item = { nome, itens: loot.editandoBau.linhas };
  if (loot.editandoBau.id) item.id = loot.editandoBau.id;
  marcarEnvioMestre("lb-salvar", true);
  try {
    const salvo = await pedirAoServidor("master_campanha_salvar", { tipo: "baus", item }, { muda: true });
    toast(`Baú salvo: ${salvo.nome}`, "success");
    fecharEditorBau(true);
  } catch { /* erro já mostrado (ex.: baú liberado não se edita) */ }
  finally { marcarEnvioMestre("lb-salvar", false); }
}

async function alternarLiberacao(bau) {
  try {
    await pedirAoServidor("master_bau_liberar", { id: bau.id, liberado: !bau.liberado }, { muda: true });
    toast(bau.liberado ? `Baú recolhido: ${bau.nome}` : `Baú liberado: ${bau.nome}`, "success");
  } catch { /* aviso já mostrado */ }
}

async function duplicarBau(bau) {
  const copia = { nome: `${bau.nome} (cópia)`.slice(0, 80), itens: bau.itens.map((l) => ({ item: l.item, quantidade: l.quantidade })) };
  try {
    await pedirAoServidor("master_campanha_salvar", { tipo: "baus", item: copia }, { muda: true });
    toast("Baú duplicado (preparado, não liberado).", "success");
  } catch { /* aviso já mostrado */ }
}

/* ------------------------------ carga e eventos ------------------------------ */
function renderizarTudo() {
  renderizarAbas();
  renderizarItens();
  renderizarBaus();
}

async function carregarLoot() {
  if (loot.carregando) return;
  loot.carregando = true; loot.erro = "";
  renderizarTudo();
  try {
    const itens = await pedirAoServidor("master_campanha_ler", { tipo: "itens" }, { silencioso: true });
    const baus = await pedirAoServidor("master_campanha_ler", { tipo: "baus" }, { silencioso: true });
    loot.itens = itens; loot.baus = baus;
    loot.carregou = true;
  } catch (erro) {
    loot.erro = `Não foi possível carregar o loot: ${erro.message}`;
  } finally { loot.carregando = false; }
  renderizarTudo();
}

socket.on("campanha_atualizada", ({ tipo, dados } = {}) => {
  if ((tipo !== "itens" && tipo !== "baus") || !Array.isArray(dados)) return;
  loot[tipo] = dados;
  loot.carregou = true;
  renderizarTudo();
});
socket.on("connect", () => setTimeout(carregarLoot, 0));

function achar(lista, cartao) {
  return lista.find((x) => x.id === cartao?.dataset.id);
}

document.addEventListener("DOMContentLoaded", () => {
  const contexto = lerContextoMestre("loot");
  if (["itens", "baus"].includes(contexto.aba)) loot.aba = contexto.aba;
  if (typeof contexto.busca === "string") loot.busca = campo("loot-busca-item").value = contexto.busca;
  if (typeof contexto.filtroTipo === "string") loot.filtroTipo = contexto.filtroTipo;
  window.addEventListener("pagehide", () => guardarContextoMestre("loot", { aba: loot.aba, busca: loot.busca, filtroTipo: loot.filtroTipo }));
  for (const aba of ["itens", "baus"]) {
    campo(`loot-aba-${aba}`).addEventListener("click", () => {
      loot.aba = aba;
      renderizarAbas();
    });
  }
  campo("loot-busca-item").addEventListener("input", (ev) => {
    loot.busca = ev.target.value;
    renderizarItens();
  });
  campo("loot-filtro-tipo").addEventListener("change", (ev) => {
    loot.filtroTipo = ev.target.value;
    renderizarItens();
  });
  campo("loot-novo-item").addEventListener("click", () => abrirEditorItem(null));
  campo('li-escolher-imagem').addEventListener('click', () => campo('li-arquivo-imagem').click());
  campo('li-impossivel-armazenar').addEventListener('change', atualizarTamanhoItem);
  iniciarFormatoItem();
  for (const chave of ['x','y','escala','rotacao']) campo(`li-formato-imagem-${chave}`).addEventListener('input', atualizarImagemFormato);
  campo('li-editar-imagem').addEventListener('click', abrirEnquadramentoItem);
  for (const id of ['li-fechar-enquadramento', 'li-concluir-enquadramento']) campo(id).addEventListener('click', () => campo('li-enquadramento').close());
  campo('li-enquadramento').addEventListener('close', atualizarMiniaturaItem);
  campo('li-arquivo-imagem').addEventListener('change', selecionarImagemItem);
  campo('li-imagem').addEventListener('input', () => { if (imagemItem || imagemCarregando) limparImagemSelecionada(); atualizarBotoesImagem(); });
  campo('li-imagem-cancelar').addEventListener('click', limparImagemSelecionada);
  for (const id of ['li-imagem-zoom', 'li-imagem-x', 'li-imagem-y']) campo(id).addEventListener('input', () => desenharImagemItem(campo('li-imagem-previa')));
  campo('li-imagem-rotacao').addEventListener('input', () => { campo('li-imagem-angulo').textContent = `${campo('li-imagem-rotacao').value}°`; atualizarMinimoZoomItem(); desenharImagemItem(campo('li-imagem-previa')); });
  ativarMouseEnquadramento();
  campo("li-salvar").addEventListener("click", salvarItem);
  campo('li-tipo-rolagem').addEventListener('change', atualizarRolagemItem);
  campo("li-cancelar").addEventListener("click", () => fecharEditorItem());
  campo("loot-lista-itens").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const item = b && achar(loot.itens, ev.target.closest("[data-id]"));
    if (!item) return;
    if (b.dataset.acao !== "excluir") b.closest("details").open = false;
    if (b.dataset.acao === "editar") abrirEditorItem(item);
    else if (b.dataset.acao === "duplicar") duplicarItem(item);
    else if (b.dataset.acao === "excluir") {
      confirmarNoBotao(b, () =>
        pedirAoServidor("master_campanha_remover", { tipo: "itens", id: item.id }, { muda: true })
          .then(() => toast("Item excluído (os baús que já o têm o mantêm).", "success"))
          .catch(() => {}), `Excluir ${item.name} do catálogo?`);
    }
  });

  campo("loot-novo-bau").addEventListener("click", () => abrirEditorBau(null));
  campo("lb-add").addEventListener("click", adicionarLinhaAoBau);
  campo("lb-salvar").addEventListener("click", salvarBau);
  campo("lb-cancelar").addEventListener("click", () => fecharEditorBau());
  campo("loot-lista-baus").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    const bau = b && achar(loot.baus, ev.target.closest("[data-id]"));
    if (!bau) return;
    if (b.dataset.acao === "liberar") alternarLiberacao(bau);
    else if (b.dataset.acao === "editar") {
      if (bau.liberado) toast("Recolha o baú antes de editar.", "error");
      else abrirEditorBau(bau);
    } else if (b.dataset.acao === "duplicar") duplicarBau(bau);
    else if (b.dataset.acao === "excluir") {
      confirmarNoBotao(b, () =>
        pedirAoServidor("master_campanha_remover", { tipo: "baus", id: bau.id }, { muda: true })
          .then(() => toast("Baú excluído.", "success"))
          .catch(() => {}), `Excluir o baú ${bau.nome}?`);
    }
  });
  renderizarTudo();
});

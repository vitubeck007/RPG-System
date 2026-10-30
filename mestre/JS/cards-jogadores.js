/* Cards compactos da Mesa. O conteúdo completo continua disponível na área expandida. */
const estadoCartaoMesa = new Map();
const ATRIBUTOS_MESA = [['FOR', 'Força'], ['DES', 'Destreza'], ['INT', 'Inteligência'], ['SAB', 'Sabedoria'], ['PRE', 'Presença'], ['VON', 'Vontade']];

function estadoDoCartaoMesa(id) {
  if (!estadoCartaoMesa.has(id)) estadoCartaoMesa.set(id, { tipo: 'magias', pagina: 0, fichaCompleta: false });
  return estadoCartaoMesa.get(id);
}

function botaoMesa(texto, rotulo, acao, chave) {
  const botao = criar('button', 'mesa-card-botao', texto);
  botao.type = 'button'; botao.setAttribute('aria-label', rotulo);
  if (chave) botao.dataset.focoMesa = chave;
  botao.addEventListener('click', acao); return botao;
}

function vitalMesa(id, nome, tipo, vital) {
  const linha = criar('div', `mesa-vital mesa-vital-${tipo}`); linha.dataset.vital = tipo;
  const atual = Number.isFinite(vital?.current) ? vital.current : 0;
  const maximo = Number.isFinite(vital?.max) ? vital.max : 0;
  const largura = maximo > 0 ? Math.max(0, Math.min(100, atual / maximo * 100)) : 0;
  linha.append(criar('span', 'mesa-vital-nome', nome));
  const menos = botaoMesa('−', `Diminuir ${nome} em 1`, ev => {
    if (!socket.connected || (players[id]?.vitals?.[tipo]?.current ?? 0) <= 0) return ajustarVital(id, tipo, -1);
    window.numeroFlutuante?.(ev.currentTarget, -1); ajustarVital(id, tipo, -1);
  }, `${tipo}-menos`);
  const barra = botaoMesa('', `Ajustar ${nome}: ${atual} de ${maximo}`, () => abrirAjusteVitalMestre(id, tipo), `${tipo}-ajustar`);
  barra.classList.add('mesa-vital-trilho');
  const preenchimento = criar('span', 'mesa-vital-preenchimento'); preenchimento.style.width = `${largura}%`;
  preenchimento.setAttribute('aria-hidden', 'true');
  barra.append(preenchimento, criar('span', 'mesa-vital-numero', `${atual}/${maximo}`));
  const mais = botaoMesa('+', `Aumentar ${nome} em 1`, ev => {
    const v = players[id]?.vitals?.[tipo];
    if (!socket.connected || !v || v.current >= v.max) return ajustarVital(id, tipo, 1);
    window.numeroFlutuante?.(ev.currentTarget, 1); ajustarVital(id, tipo, 1);
  }, `${tipo}-mais`);
  linha.append(menos, barra, mais); return linha;
}

function armaMesa(ficha) {
  const area = criar('div', 'mesa-arma');
  const arma = ficha.inventario?.equipped?.mainHand;
  const titulo = criar('span', 'mesa-secao-titulo', 'Arma'); area.append(titulo);
  if (!arma) { area.append(criar('span', 'mesa-texto-vazio', 'Nenhuma arma na mão principal.')); return area; }
  const icone = criar('span', 'mesa-arma-icone'); icone.setAttribute('aria-hidden', 'true');
  const classe = typeof arma.icon === 'string' && /^fa-[a-z0-9-]+$/i.test(arma.icon) ? arma.icon : 'fa-sword';
  const i = criar('i', `fa-solid ${classe}`); icone.append(i);
  area.append(icone, criar('strong', 'mesa-arma-nome', arma.name || 'Arma'),
    criar('span', 'mesa-arma-meta', arma.dice || 'Sem dano'),
    criar('span', 'mesa-arma-meta', arma.categoria || arma.category || arma.type || 'Sem categoria'));
  return area;
}

function poderesMesa(id, ficha) {
  const estado = estadoDoCartaoMesa(id), bloco = criar('section', 'mesa-poderes');
  bloco.setAttribute('aria-label', 'Poderes do personagem');
  const abas = criar('div', 'mesa-poder-abas');
  for (const [tipo, rotulo] of [['magias', 'Magias'], ['habilidades', 'Habilidades']]) {
    const itens = Array.isArray(ficha[tipo]?.items) ? ficha[tipo].items : [];
    const botao = botaoMesa(`${rotulo} (${itens.length})`, `Mostrar ${rotulo.toLowerCase()}`, () => {
      estado.tipo = tipo; estado.pagina = 0; renderizarCardsJogadores();
    }, `aba-${tipo}`);
    botao.setAttribute('aria-pressed', String(estado.tipo === tipo)); abas.append(botao);
  }
  bloco.append(abas);
  const itens = Array.isArray(ficha[estado.tipo]?.items) ? ficha[estado.tipo].items : [];
  const total = Math.max(1, Math.ceil(itens.length / 3));
  estado.pagina = Math.max(0, Math.min(estado.pagina, total - 1));
  const lista = criar('ul', 'mesa-poder-lista');
  if (!itens.length) lista.append(criar('li', 'mesa-texto-vazio', estado.tipo === 'magias' ? 'Nenhuma magia.' : 'Nenhuma habilidade.'));
  for (const poder of itens.slice(estado.pagina * 3, estado.pagina * 3 + 3)) {
    const linha = criar('li', 'mesa-poder-linha');
    linha.append(criar('strong', '', poder.nome || poder.name || 'Poder'),
      criar('span', '', poder.dice || '—'), criar('span', '', poder.tipoDano || '—'));
    {
      const descricao = typeof poder.desc === 'string' && poder.desc.trim() ? poder.desc :
        typeof poder.descricao === 'string' && poder.descricao.trim() ? poder.descricao : 'Sem descrição cadastrada.';
      const balao = criar('div', 'mesa-poder-balao');
      balao.id = `mesa-${estado.tipo}-descricao-${id}-${estado.pagina}-${lista.children.length}`;
      balao.setAttribute('role', 'tooltip');
      balao.append(criar('strong', 'mesa-balao-titulo', poder.nome || poder.name || 'Poder'), criar('p', '', descricao));
      linha.tabIndex = 0; linha.setAttribute('aria-describedby', balao.id); linha.append(balao);
    }
    lista.append(linha);
  }
  bloco.append(lista);
  if (total > 1) {
    const paginas = criar('nav', 'mesa-paginacao'); paginas.setAttribute('aria-label', 'Páginas de poderes');
    const anterior = botaoMesa('‹', 'Página anterior', () => { estado.pagina--; renderizarCardsJogadores(); }, 'pagina-anterior');
    const proxima = botaoMesa('›', 'Próxima página', () => { estado.pagina++; renderizarCardsJogadores(); }, 'pagina-proxima');
    anterior.disabled = estado.pagina === 0; proxima.disabled = estado.pagina >= total - 1;
    paginas.append(anterior, criar('span', '', `${estado.pagina + 1} / ${total}`), proxima); bloco.append(paginas);
  }
  return bloco;
}

function renderizarCardsJogadores() {
  const container = document.getElementById('players-cards-container');
  const anterior = document.activeElement?.closest('[data-player-id]');
  const foco = anterior && container.contains(anterior) ? [anterior.dataset.playerId, document.activeElement.dataset.focoMesa] : null;
  const ids = Object.keys(players);
  document.getElementById('connected-count').textContent = ids.length;
  container.replaceChildren();
  if (!ids.length) { container.append(criar('div', 'master-empty', 'Aguardando jogadores abrirem a ficha...')); return; }
  for (const id of ids) {
    const player = players[id], ficha = fichas[id], estado = estadoDoCartaoMesa(id);
    const nome = player.name || 'Personagem', card = criar('article', 'mesa-player-card'); card.dataset.playerId = id;
    const topo = criar('div', 'mesa-card-topo'), identidade = criar('div', 'mesa-card-identidade');
    const foto = criar('div', 'mesa-card-foto'); foto.setAttribute('aria-hidden', 'true');
    foto.append(criar('span', '', nome.trim().charAt(0).toLocaleUpperCase('pt-BR')));
    const imagem = miniaturaDeImagem(player.avatar); if (imagem) foto.append(imagem);
    const nomeEl = criar('strong', 'mesa-card-nome', nome); nomeEl.title = nome;
    identidade.append(foto, nomeEl);
    const conteudo = criar('div', 'mesa-card-conteudo'), vitais = criar('div', 'mesa-card-vitais');
    vitais.append(vitalMesa(id, 'Vida', 'hp', player.vitals?.hp));
    if (systemConfig.AtivarMana) vitais.append(vitalMesa(id, 'Energia', 'vigor', player.vitals?.vigor));
    vitais.append(vitalMesa(id, 'Sanidade', 'sanity', player.vitals?.sanity));
    const atributos = criar('dl', 'mesa-card-atributos'); atributos.setAttribute('aria-label', 'Atributos');
    for (const [sigla, descricao] of ATRIBUTOS_MESA) {
      const celula = criar('div'); celula.title = descricao;
      const valor = ficha?.atributos?.[sigla];
      celula.append(criar('dt', '', sigla), criar('dd', '', Number.isFinite(Number(valor)) && valor != null ? String(valor) : '—'));
      atributos.append(celula);
    }
    conteudo.append(vitais, atributos); topo.append(identidade, conteudo); card.append(topo);
    if (!ficha && fichasComErro.has(id)) {
      card.append(botaoMesa('Tentar carregar ficha', `Tentar carregar ficha de ${nome}`, () => { fichasComErro.delete(id); pedirFicha(id); renderizarCardsJogadores(); }, 'recarregar'));
    }
    const aberto = fichasAbertas.has(id);
    const expandir = botaoMesa(aberto ? 'Recolher' : 'Expandir', `${aberto ? 'Recolher' : 'Expandir'} ${nome}`, () => alternarFicha(id), 'expandir');
    expandir.classList.add('mesa-card-expandir'); expandir.setAttribute('aria-expanded', String(aberto));
    expandir.setAttribute('aria-controls', `mesa-detalhes-${id}`); card.append(expandir);
    if (aberto) {
      const detalhes = criar('div', 'mesa-card-expandido');
      detalhes.id = `mesa-detalhes-${id}`;
      if (!ficha) detalhes.append(criar('p', 'mesa-texto-vazio', fichasComErro.has(id) ? 'Não foi possível carregar a ficha.' : 'Carregando ficha…'));
      else {
        detalhes.append(armaMesa(ficha), poderesMesa(id, ficha));
        const completo = criar('details', 'mesa-ficha-completa'); completo.open = estado.fichaCompleta;
        completo.append(criar('summary', '', 'Ver ficha completa'));
        const conteudoFicha = criar('div', 'mesa-ficha-completa-conteudo'); conteudoFicha.innerHTML = htmlFicha(id); completo.append(conteudoFicha);
        completo.addEventListener('toggle', () => { estado.fichaCompleta = completo.open; }); detalhes.append(completo);
      }
      card.append(detalhes);
    }
    container.append(card);
  }
  if (foco?.[1]) [...container.querySelectorAll('[data-player-id]')].find(card => card.dataset.playerId === foco[0])
    ?.querySelector(`[data-foco-mesa="${foco[1]}"]`)?.focus({ preventScroll: true });
}

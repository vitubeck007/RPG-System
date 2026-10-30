/* Seletores visuais dos editores. Os campos icon/color e os payloads continuam iguais. */
const ICONES_APARENCIA_MESTRE = [
  ['', 'Padrão'], ['fa-khanda', 'Arma'], ['fa-shield-halved', 'Defesa'],
  ['fa-flask', 'Poção'], ['fa-fire', 'Fogo'], ['fa-bolt', 'Energia'],
  ['fa-wand-magic-sparkles', 'Magia'], ['fa-book', 'Livro'], ['fa-gem', 'Tesouro'],
  ['fa-leaf', 'Natureza'], ['fa-skull', 'Sombrio'], ['fa-bag-shopping', 'Bolsa'],
];
const CORES_APARENCIA_MESTRE = RPGUI.coresItens;
const editoresAparenciaMestre = new Map();

function atualizarAparenciaMestre(prefixo) {
  let atualizar = editoresAparenciaMestre.get(prefixo);
  if (!atualizar) {
    const area = document.getElementById(`${prefixo}-aparencia`);
    if (!area) return;
    const visual = area.querySelector('[data-aparencia-visual]');
    const icone = document.getElementById(`${prefixo}-icon`);
    const cor = document.getElementById(`${prefixo}-color`);
    const nome = document.getElementById(prefixo === 'li' ? 'li-name' : 'hm-nome');
    const pares = [];
    const seletor = (campo, opcoes, rotulo, sufixo) => {
      const label = criar('label', '', rotulo);
      const select = criar('select'); select.id = `${prefixo}-${sufixo}`;
      for (const [valor, texto] of opcoes) select.add(new Option(texto, valor));
      select.add(new Option('Personalizado (Avançado)', '__personalizado__'));
      select.addEventListener('change', () => {
        if (select.value === '__personalizado__') {
          area.querySelector('details').open = true; atualizar(); campo.focus();
          return;
        }
        campo.value = select.value;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
      });
      label.append(select); visual.append(label); pares.push({ campo, select, opcoes });
      campo.addEventListener('input', () => atualizar());
      return select;
    };
    const selectIcone = seletor(icone, ICONES_APARENCIA_MESTRE, 'Ícone', 'icone-visual');
    if (cor) seletor(cor, CORES_APARENCIA_MESTRE, 'Cor do item', 'cor-visual');
    const previa = criar('div', 'master-appearance-preview');
    previa.id = `${prefixo}-aparencia-previa`;
    previa.setAttribute('role', 'img');
    visual.append(previa);
    atualizar = () => {
      // Abrir uma entrada antiga nunca substitui automaticamente um valor personalizado.
      for (const { campo, select, opcoes } of pares) {
        select.value = opcoes.some(([valor]) => valor === campo.value) ? campo.value : '__personalizado__';
      }
      const corEscolhida = CORES_APARENCIA_MESTRE.find(([valor]) => valor === cor?.value);
      const rotuloCor = cor ? (corEscolhida?.[1] || 'Personalizada (prévia neutra)') : '';
      const rotuloIcone = ICONES_APARENCIA_MESTRE.find(([valor]) => valor === icone.value)?.[1] || 'Personalizado';
      previa.replaceChildren();
      if (prefixo === 'li') {
        previa.classList.add('loot-appearance-preview');
        const valor = sufixo => document.getElementById(`li-${sufixo}`)?.value.trim() || '';
        const card = criarCartaoItem({ name: valor('name') || 'Nome do item', type: valor('type') || 'Item',
          color: cor.value, icon: icone.value, dice: valor('dice'), atributo: valor('atributo'),
          tipoDano: valor('tipoDano'), categoria: valor('categoria'), subtitulo: valor('subtitulo'),
          tipoRolagem: valor('tipo-rolagem'), tipoCura: valor('tipo-cura'), usos: Number(valor('usos')),
          desc: valor('desc'), imagem: valor('imagem'), weight: Number(valor('weight')) || 0 });
        if (imagemItem) {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
          desenharImagemItem(canvas);
          card.querySelector('.loot-item-retrato').replaceChildren(canvas);
        }
        card.querySelector('.loot-item-base').remove();
        previa.append(card);
        previa.setAttribute('aria-label', `Prévia do card ${valor('name') || 'novo item'}, cor ${rotuloCor}`);
        return;
      }
      const desenho = criar('i'); desenho.setAttribute('aria-hidden', 'true');
      const classeIcone = /^[a-z0-9-]{1,40}$/i.test(icone.value) ? icone.value : (prefixo === 'li' ? 'fa-box-open' : 'fa-bolt');
      desenho.className = `fa-solid ${classeIcone}`;
      previa.append(desenho, criar('span', '', nome.value.trim() || 'Prévia'), criar('small', '', [rotuloIcone, rotuloCor].filter(Boolean).join(' · ')));
      previa.setAttribute('aria-label', `Prévia de ${nome.value.trim() || 'nova entrada'}: ícone ${rotuloIcone}${cor ? `, cor ${rotuloCor}` : ''}`);
      // O select já anuncia a escolha. A prévia não interrompe a digitação do nome.
      selectIcone.title = `Ícone: ${rotuloIcone}`;
    };
    nome.addEventListener('input', atualizar);
    if (prefixo === 'li') {
      for (const sufixo of ['type', 'dice', 'atributo', 'tipoDano', 'categoria', 'subtitulo', 'desc', 'imagem', 'tipo-cura', 'usos']) {
        document.getElementById(`li-${sufixo}`)?.addEventListener('input', atualizar);
      }
    }
    editoresAparenciaMestre.set(prefixo, atualizar);
  }
  atualizar();
}

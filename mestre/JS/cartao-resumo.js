/* Casca visual compartilhada: a página fornece retrato, recursos e comportamento de seleção. */
window.criarResumoTatico = function criarResumoTatico({ id, nome, selecionado = false, rotulo, aoSelecionar, retrato }) {
  const criarElemento = (tag, classe, texto = "") => {
    const elemento = document.createElement(tag);
    elemento.className = classe;
    elemento.textContent = texto;
    return elemento;
  };
  const card = criarElemento("li", `fig-resumo fig-tatico${selecionado ? " fig-resumo-ativo" : ""}`);
  card.dataset.id = id;
  card.dataset.uiChave = JSON.stringify(["resumo", id]);
  const escolher = criarElemento("button", "master-action px-2 py-1 rounded text-[11px] font-mono border border-dungeon-700 fig-resumo-selecionar");
  escolher.type = "button";
  escolher.dataset.acao = "selecionar-combatente";
  escolher.setAttribute("aria-label", rotulo || `Selecionar ${nome}`);
  escolher.setAttribute("aria-pressed", String(selecionado));
  escolher.title = nome;
  const foto = criarElemento("span", "fig-resumo-foto");
  foto.append(criarElemento("span", "fig-resumo-inicial", nome.slice(0, 1).toUpperCase()));
  if (retrato) foto.append(retrato);
  escolher.append(criarElemento("strong", "fig-resumo-nome", nome), foto);
  if (typeof aoSelecionar === "function") escolher.addEventListener("click", aoSelecionar);
  const recursos = criarElemento("div", "fig-resumo-recursos");
  card.append(escolher, recursos);
  return { card, escolher, recursos };
};

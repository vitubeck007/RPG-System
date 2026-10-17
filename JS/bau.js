/* =========================================================================
   JANELA DO BAÚ (Sprint 3)
   O mestre libera um baú: o servidor manda `baus_estado` (só baús liberados, com nome e itens
   disponíveis). "Pegar" pede ao servidor (jogador_pegar_item); o item chega como entrega e é aplicado
   por codice.js (aplicarEntregaDeItem). A janela só mostra; quem decide é sempre o servidor.
   Texto vindo do servidor entra na tela só por textContent.
   ========================================================================= */

let bausLiberados = [];
let bauJanelaRecolhida = false;

function novoPedidoId() {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function elementoBau(tag, classes = "", texto = "") {
  const el = document.createElement(tag);
  if (classes) el.className = classes;
  if (texto) el.textContent = texto;
  return el;
}

function pegarDoBau(bau, linha, quantidade) {
  const q = Math.floor(Number(quantidade));
  if (!Number.isInteger(q) || q < 1 || q > linha.quantidade) {
    toast(`Escolha de 1 a ${linha.quantidade}.`, "error");
    return;
  }
  if (!socket.connected) {
    toast("Sem conexão com o servidor.", "error");
    return;
  }
  socket.timeout(8000).emit("jogador_pegar_item", { bauId: bau.id, linhaId: linha.id, quantidade: q, pedidoId: novoPedidoId() }, (erro, resposta) => {
    if (erro) toast("O servidor não respondeu. Veja o baú de novo antes de tentar.", "error");
    else if (!resposta?.ok) toast(resposta?.mensagem || "Não foi possível pegar.", "error");
  });
}

function renderizarJanelaDoBau() {
  const janela = document.getElementById("bau-janela");
  if (!janela) return;
  janela.replaceChildren();
  janela.classList.toggle("hidden", bausLiberados.length === 0);
  if (!bausLiberados.length) return;

  const topo = elementoBau("div", "flex justify-between items-center");
  topo.append(elementoBau("span", "font-cinzel font-bold text-amber-200 text-sm", "Baú"));
  const alternar = elementoBau("button", "px-2 py-0.5 border border-dungeon-700 rounded text-[11px]", bauJanelaRecolhida ? "Abrir" : "Minimizar");
  alternar.type = "button";
  alternar.id = "bau-alternar";
  alternar.addEventListener("click", () => {
    bauJanelaRecolhida = !bauJanelaRecolhida;
    renderizarJanelaDoBau();
  });
  topo.append(alternar);
  janela.append(topo);
  if (bauJanelaRecolhida) return;

  for (const bau of bausLiberados) {
    const bloco = elementoBau("section", "space-y-1.5");
    bloco.dataset.bauId = bau.id;
    bloco.append(elementoBau("h4", "text-slate-300 font-bold break-words", bau.nome));
    if (!bau.itens.length) bloco.append(elementoBau("p", "text-slate-500 italic", "Vazio."));
    for (const linha of bau.itens) {
      const linhaEl = elementoBau("div", "bg-dungeon-950 border border-dungeon-700 rounded p-2 space-y-1");
      linhaEl.dataset.linhaId = linha.id;
      const nome = elementoBau("div", "flex justify-between gap-2");
      nome.append(elementoBau("span", "text-amber-100 break-words", linha.nome), elementoBau("span", "text-slate-400 whitespace-nowrap", `× ${linha.quantidade}`));
      linhaEl.append(nome);
      if (linha.tipo) linhaEl.append(elementoBau("div", "text-[10px] text-slate-500", linha.tipo));
      if (linha.desc) linhaEl.append(elementoBau("div", "text-[11px] text-slate-400", linha.desc));
      const acao = elementoBau("div", "flex gap-1.5 items-center");
      const qtd = elementoBau("input", "w-14 bg-dungeon-900 border border-dungeon-700 rounded px-1 py-0.5");
      qtd.type = "number";
      qtd.min = "1";
      qtd.max = String(linha.quantidade);
      qtd.value = "1";
      const pegar = elementoBau("button", "px-2 py-0.5 rounded bg-amberGold-600 text-white", "Pegar");
      pegar.type = "button";
      pegar.dataset.acao = "pegar";
      pegar.addEventListener("click", () => pegarDoBau(bau, linha, qtd.value));
      acao.append(qtd, pegar);
      linhaEl.append(acao);
      bloco.append(linhaEl);
    }
    janela.append(bloco);
  }
}

function dadosDeBausValidos(baus) {
  return (
    Array.isArray(baus) &&
    baus.every(
      (b) =>
        ehObjetoSimples(b) && typeof b.id === "string" && typeof b.nome === "string" && Array.isArray(b.itens) &&
        b.itens.every((l) => ehObjetoSimples(l) && typeof l.id === "string" && typeof l.nome === "string" && Number.isInteger(l.quantidade)),
    )
  );
}
const ehObjetoSimples = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

socket.on("baus_estado", ({ baus } = {}) => {
  if (!dadosDeBausValidos(baus)) return;
  bausLiberados = baus;
  renderizarJanelaDoBau();
});

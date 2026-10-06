/* =========================================================================
   INICIALIZAÇÃO
   Último arquivo carregado: roda quando a página abre. A ordem dos scripts está em index.html
   (cada arquivo é um script comum: tudo que declara é global, e o que um arquivo usa de outro só é
   chamado depois que todos carregaram).
   ========================================================================= */

window.addEventListener("DOMContentLoaded", () => {
  if (!CHARACTER || !AUTH_TOKEN) {
    window.location.replace(AUTH_TOKEN ? "/selecao" : "/login");
    return;
  }

  // 1) Eventos da conexão: não dependem da tela, então são registrados primeiro.
  socket.on("connect", () => {
    registrarNoTerminal("Conexão com o servidor estabelecida", {
      socketId: socket.id,
    });
    // Em reconexão o servidor não pode confundir esta aba com "outra aba" (o socket antigo pode ainda estar vivo lá).
    socket.emit("carregar_personagem", { ...CHARACTER, reconexao: jaCarregouAntes });
  });

  socket.on("disconnect", (reason) => {
    console.warn(`[RPG] Conexão com o servidor perdida: ${reason}`);
    aoDesconectarFicha();
  });

  socket.on("connect_error", (error) => {
    console.error("[RPG] Falha ao conectar ao servidor:", error.message);
  });

  // 2) Tela. Se algo aqui falhar, a ficha ainda conecta e carrega, e a faixa do topo mostra o erro.
  try {
    iniciarFichaBasica();
    atualizarEstadoFicha();
    atualizarBarras();
    renderizarPericias();
    renderizarSlotsEquipados();
    renderizarMochilaGrid();
    atualizarInterfaceCombo();

    ["char-name-input", "char-class-input", "progression-val-input"].forEach(
      (id) => {
        const input = document.getElementById(id);
        input?.addEventListener("change", () => {
          if (id === "progression-val-input") {
            STATE.progressionValues[STATE.progressionMode] = input.value;
          }
          registrarNoTerminal("Dados do personagem alterados", {
            campo: id,
            valor: input.value,
          });
          if (id === "char-name-input") syncPlayerToServer();
        });
      },
    );

    window.addEventListener("resize", () => {
      renderizarMochilaGrid();
    });
  } catch (erro) {
    console.error("[RPG] Falha ao iniciar a ficha:", erro);
    falhaDeInicializacao = erro?.message || String(erro);
    atualizarEstadoFicha();
  }

  // 3) Conecta sempre, mesmo com erro na tela (ver o comentário do socket em estado.js).
  socket.connect();
});

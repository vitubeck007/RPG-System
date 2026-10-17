/* =========================================================================
   COMANDOS DO MESTRE: CONVENÇÃO DOS EVENTOS master_*
   Todo evento novo do painel do mestre é registrado por aqui, e ganha de graça:
     1. formato: o pedido tem que ser um objeto e caber no limite de tamanho;
     2. autorização: `dados.token` tem que ser a senha do mestre (estar numa página /mestre não conta);
     3. idempotência (eventos que mudam estado): `dados.acaoId` obrigatório; repetir o mesmo acaoId
        (duplo clique, reenvio depois de um tempo esgotado) NÃO executa de novo: devolve a mesma
        resposta. Duas chegadas ao mesmo tempo também executam uma vez só;
     4. resposta padronizada pela confirmação do Socket.IO: { ok: true, dados } ou
        { ok: false, erro: "codigo", mensagem }. Erros inesperados nunca vazam detalhes.

   Como usar (em server.js, dentro do io.on("connection")):
     comandos.registrar(socket, "master_xxx", async (dados, { socket, acaoId }) => resultado);
     comandos.registrar(socket, "master_yyy", tratar, { mudaEstado: true });
   O tratador lança `new ErroCampanha(...)` (ou qualquer erro com `negocio = true`) para recusar com
   uma mensagem que o mestre pode ler.
   ========================================================================= */

const { ehIdSeguro, ehObjeto } = require("./personagem.js");

const falha = (erro, mensagem) => ({ ok: false, erro, mensagem });

function criarComandos({ senhaMestre, log = console, tamanhoMaximo = 60_000, maxAcoes = 500 }) {
  const concluidas = new Map(); // "evento:acaoId" -> resposta ok (para repetir a mesma resposta)
  const emCurso = new Map(); // "evento:acaoId" -> promessa da execução em andamento

  function memorizar(chave, resposta) {
    concluidas.set(chave, resposta);
    if (concluidas.size > maxAcoes) concluidas.delete(concluidas.keys().next().value);
  }

  function registrar(socket, evento, tratar, { mudaEstado = false } = {}) {
    socket.on(evento, async (dados, confirmar) => {
      const responder = (resposta) => {
        if (typeof confirmar === "function") confirmar(resposta);
      };

      let tamanho = 0;
      try {
        tamanho = JSON.stringify(dados ?? null).length;
      } catch {
        responder(falha("formato_invalido", "Pedido inválido."));
        return;
      }
      if (!ehObjeto(dados)) {
        responder(falha("formato_invalido", "Pedido inválido."));
        return;
      }
      if (tamanho > tamanhoMaximo) {
        responder(falha("pedido_grande", "Pedido grande demais."));
        return;
      }
      if (dados.token !== senhaMestre) {
        log.warn(`[SEGURANÇA] ${evento} recusado para o cliente ${socket.id}: token inválido.`);
        responder(falha("nao_autorizado", "Token/Senha do mestre incorreta!"));
        return;
      }
      if (mudaEstado && !ehIdSeguro(dados.acaoId)) {
        responder(falha("acao_id_obrigatorio", "Pedido sem identificador de ação."));
        return;
      }

      const executar = async () => {
        try {
          const resultado = await tratar(dados, { socket, acaoId: mudaEstado ? dados.acaoId : null });
          return { ok: true, dados: resultado ?? null };
        } catch (erro) {
          if (erro?.negocio === true && typeof erro.codigo === "string") return falha(erro.codigo, erro.message);
          log.error(`[COMANDO] ${evento} falhou:`, erro);
          return falha("erro_interno", "Erro interno do servidor.");
        }
      };

      if (!mudaEstado) {
        responder(await executar());
        return;
      }

      const chave = `${evento}:${dados.acaoId}`;
      if (concluidas.has(chave)) {
        responder(concluidas.get(chave));
        return;
      }
      let execucao = emCurso.get(chave);
      if (!execucao) {
        execucao = executar();
        emCurso.set(chave, execucao);
        execucao.then(() => emCurso.delete(chave));
      }
      const resposta = await execucao;
      if (resposta.ok) memorizar(chave, resposta); // só sucesso: uma falha pode ser tentada de novo
      responder(resposta);
    });
  }

  return { registrar };
}

module.exports = { criarComandos };

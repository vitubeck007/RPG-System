# Painel do Mestre: guia curto

Como o painel funciona, como criar uma **página** e um **evento** novos sem quebrar a segurança, e como recuperar dados.

## Mapa

| Parte | Arquivos |
|---|---|
| Servidor (eventos, rotas, salas) | `server.js` |
| Dados do mestre (inimigos, NPCs, baús, batalha, catálogos) | `campanha.js` → `campanha/*.json` e `catalogo/*.json` |
| Convenção dos eventos `master_*` | `comandos.js` |
| Entregas à ficha (habilidades, magias, itens de baú) | `entregas.js` → `players/<conta>/<personagem>/entregas.json` |
| Regras de batalha, rolagem e dano | `batalha.js`, `rolagem.js`, `dano.js` |
| Regras que a ficha, o painel e o servidor compartilham | `JS/regras.js` |
| Páginas do painel | `mestre/*.html` + `mestre/JS/*.js` (`comum.js` = menu, token, conexão, `pedirAoServidor`) |

## Regras de segurança (valem para tudo que for novo)

1. Todo evento `master_*` exige o token do mestre (`comandos.registrar` já faz isso).
2. Dado do mestre só vai para a sala `mestres` (`io.to(SALA_MESTRES)`). Nunca `io.emit` geral. O que o jogador pode ver sai por salas próprias (`SALA_BAUS`) e só em versão pública.
3. O mestre **nunca grava na ficha**: ele deixa uma entrega na caixa e a própria ficha aplica pelo salvamento central.
4. O servidor é a fonte da verdade (HP, baús, batalha). O navegador só mostra e pede.
5. Ação que muda estado leva `acaoId` (repetir não executa de novo).
6. Valide tudo no servidor: ids com `ehIdSeguro`, listas fechadas, limites de tamanho, campos desconhecidos descartados.
7. Gravação atômica, uma por vez, com backup (já pronta em `campanha.js`).
8. Nunca `innerHTML` com texto de usuário: use `textContent`.
9. Todo evento novo ganha teste negativo (jogador e anônimo recusados). O teste `fase2-integracao` varre o `server.js` e já cobre isso para qualquer `master_*` novo.
10. Sem dependências novas.

## Duas regras de código que evitam bugs (checkup geral)

- **`campanha.ver(tipo)` x `campanha.ler(tipo)`:** `ler` devolve uma CÓPIA (use para entregar a alguém ou alterar). `ver` devolve a estrutura viva, sem copiar: é só para consultar dentro do servidor (achar um item, montar uma resposta nova) e quem recebe NÃO pode alterá-la. Para alterar use sempre `campanha.atualizar(tipo, (lista) => { ...; return lista; })`.
- **Nenhum tratador de socket pode derrubar o servidor:** todo evento do cliente é registrado com `ouvir("evento", tratador)` (ou `comandos.registrar`), que captura qualquer exceção, e há `unhandledRejection`/`uncaughtException` como último recurso. Mesmo assim valide a entrada (o teste `robustez` joga lixo em todos os eventos e exige que a rede de segurança NUNCA dispare: o log não pode ter "FALHA EM EVENTO").

## Criar um evento novo

No `server.js`, dentro do `io.on("connection")`:

```js
comandos.registrar(socket, "master_meu_evento", async ({ id, valor }) => {
  if (!personagemModelo.ehIdSeguro(id)) throw new ErroCampanha("id_invalido", "Id inválido.");
  // ... altere via campanha.atualizar("npcs", (lista) => { ...; return lista; })
  return { ok: true };        // vira { ok: true, dados: ... } para a página
}, { mudaEstado: true });     // omita se só lê; com ele o pedido exige `acaoId`
```

- Para recusar com mensagem legível, lance `new ErroCampanha("codigo", "Mensagem.")`. Qualquer outro erro vira "erro interno" (sem vazar detalhes).
- Na página: `await pedirAoServidor("master_meu_evento", { id }, { muda: true })`. Erro vira aviso na tela e a promessa rejeita (`erro.codigo`).
- Teste: jogador e anônimo recusados, entrada inválida, `acaoId` repetido, e (se mexe em dados) persistência após reiniciar.

## Criar uma página nova

1. `mestre/minha.html`: copie o esqueleto de outra página (cabeçalho `data-pagina="minha"`, scripts `regras.js`, `comum.js` e `minha.js`). Os ajudantes de tela já vêm do `comum.js`: `criar`, `campo`, `semAcento`, `botaoDeAcao`, `confirmarNoBotao` (excluir com confirmação no botão) e `miniaturaDeImagem`; não redeclare esses nomes na página.
2. `server.js`: acrescente a rota em `PAGINAS_MESTRE`.
3. `mestre/JS/comum.js`: acrescente a página em `PAGINAS_MESTRE` (menu) com `pronta: true`.
4. `mestre/JS/minha.js`: carregue os dados no `connect` com `pedirAoServidor`, ouça `campanha_atualizada` para o tempo real e monte a tela com `textContent`.
5. Teste: abra com `abrirPaginaMestre(s, "minha", { real: true, tokenInicial: SENHA })`.

## Dados e recuperação

- `campanha/` (inimigos, NPCs, baús, batalha) e `catalogo/` (habilidades, magias, itens) são normalizados ao ligar. O que for editado à mão vale depois de reiniciar o servidor.
- Backup automático em `campanha/_backup/` ao ligar (os 7 últimos; não repete backup idêntico). Com arquivo corrompido o servidor liga, move o estragado para `campanha/_corrompidos/`, avisa o mestre ao entrar e **não** cria backup do estado incompleto.
- Restaurar (servidor parado): `node campanha.js backups` e `node campanha.js restaurar <nome>`. A restauração guarda antes o estado atual (`antes-de-restaurar`), então dá para desfazer.
- O "Desfazer" do dano vive só na memória: depois de reiniciar o servidor a aplicação anterior não pode mais ser desfeita.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `PORT` | porta do servidor |
| `SENHA_MESTRE` | senha/token do mestre (troque o padrão) |
| `RESERVA_EXPIRA_MS` | tempo (ms) para a reserva de item de baú expirar com o jogador fora (padrão 30000) |
| `CAMPANHA_DIR`, `CATALOGO_DIR` | só para `node campanha.js` (pastas de dados) |

## Testes

`npm test` (roda `testes/executar.js`, que lista os arquivos e funciona em qualquer sistema e versão do Node; cada arquivo sobe o seu servidor em pasta temporária; leva ~1,5 min). Um arquivo só: `node --test testes/loot.test.js`. `testes/ajuda/ambiente.js` traz `iniciarServidor`, `abrirFicha` (com `capturar` para auditar tudo que a ficha recebe) e `abrirPaginaMestre`.

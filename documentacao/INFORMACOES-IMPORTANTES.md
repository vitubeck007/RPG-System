# RPG System — Informações importantes

Consolidado em 20/10/2026. Projeto: `C:\Users\Vitor\Desktop\Projetos\RPG System`.

## Documentação mantida

- **ANALISE-UI-UX-DESIGN-GERAL.txt:** diagnóstico anterior à remodelação, diretrizes aprovadas e limites de avaliação.
- **PATCH-LOG-REMODELACAO-VISUAL.md:** histórico consolidado da remodelação e dos 21 ajustes de usabilidade.
- **INFORMACOES-IMPORTANTES.md:** este guia de operação, estrutura, manutenção e testes.

Relatórios de sprints/etapas concluídos, capturas, log antigo de testes e guias redundantes foram substituídos por estes três arquivos. O diagnóstico histórico não é uma lista de bugs atuais. O Patch Log descreve implementação, não certifica todo o funcionamento.

## Iniciar e acessar

Na raiz do projeto, com Node.js/npm e as dependências instaladas:

```powershell
npm start
```

- Porta padrão: **3000**, substituível pela variável de ambiente `PORT`.
- `/login`: acesso/criação de conta, servido por `login/entrar.html`.
- `/selecao`: seleção/criação/exclusão de personagens, servido por `login/login.html`.
- `/`: ficha do personagem selecionado, em `index.html`.
- `/mestre`: Mesa; demais áreas em `/mestre/rolagem`, `/mestre/figurantes`, `/mestre/loot` e `/mestre/habilidades-magias`.
- `/mestre/inimigos` e `/mestre/npc` são caminhos compatíveis da área unificada de figurantes.
- Use **Ctrl+F5** se o navegador ainda apresentar arquivos visuais antigos.

Defina `SENHA_MESTRE` no ambiente antes de expor a mesa na rede. Não trate a senha padrão como proteção adequada. A chave do mestre e a sessão de jogador são credenciais diferentes; não coloque credenciais em documentação pública ou imagens.

## Estrutura e responsabilidades

| Local | Responsabilidade |
|---|---|
| `server.js`, `acesso.js` | Servidor Express/Socket.IO, acesso, rotas e eventos |
| `personagem.js` | Formatos/normalização dos dados do personagem |
| `JS/`, `CSS/`, `index.html` | Ficha, componentes e estilos do jogador |
| `login/` | Login e seleção |
| `mestre/` | Páginas, scripts e estilos do mestre |
| `comandos.js` | Convenção de comandos autenticados `master_*` |
| `campanha.js`, `campanha/` | Estado persistente da campanha e recuperação |
| `catalogo/` | Catálogos de habilidades, magias e itens |
| `entregas.js` | Caixa de entregas para os personagens |
| `batalha.js`, `rolagem.js`, `dano.js` | Regras de combate, rolagem e dano |
| `JS/regras.js` | Regras compartilhadas entre cliente e servidor |
| `players/<player>/<nomePasta>/` | Arquivos de cada personagem |
| `figurantes.js`, `Figurante/` | Organização das cópias individuais de NPCs/inimigos |
| `testes/` | Testes e auxiliares de simulação/preview |

### Identidade e salvamento do personagem

- Use sempre `CHARACTER.player` + `CHARACTER.nomePasta`. Nome visível, índice da lista e socket id não substituem essa identidade.
- Fluxo: login → lista do player → seleção → `carregar_personagem` → `personagem_carregado` → preenchimento do `STATE`.
- Vitais: `hp`, `vigor` e `sanity`, cada um com `{ current, max }`; persistência em `status.json`.
- Perícias: `STATE.skills` corresponde a `pericias.json`; preservar a conversão para os identificadores usados pelo JSON.
- Poderes continuam separados em `habilidades.json` e `magias.json`.
- Inventário/equipamento usam o formato atual de `inventario.json`; não reintroduzir nomes legados de arquivos sem conferir o código.
- Reutilize os salvamentos centrais e a validação do servidor; não crie gravações paralelas por nome ou personagem fixo.
- O mestre pode ajustar vitais pelo fluxo existente: o servidor também grava o status e envia o delta à ficha. Não vale a afirmação antiga de que o mestre nunca provoca gravação de status.

### Configuração e conexão

- `config.json` e `sync_config` controlam `AtivarRiquezas`, `UsarEx`, `AtivarSlotMochila` e `AtivarMana`.
- Vigor da ficha depende de `AtivarMana`. A **Energia dos figurantes** é outro recurso; não unificar suas regras só por causa do nome.
- `rpg_mestre_token` fica no `sessionStorage` da aba. Trocar de página do mestre recria o socket e reaproveita a chave: pares de conexão/desconexão são esperados nesse modelo.
- Não foi implementada conexão única entre páginas. Mestre e jogador mantêm sessões/conexões separadas.
- Indicador online não comprova autorização. A criação/abertura de figurante valida a chave antes do preenchimento e o servidor verifica novamente as ações.

## Figurantes e entregas

```text
Figurante/
  Inimigos/<nome>_ini_<id>/figurante.json
  NPCs/<nome>_npc_<id>/figurante.json
```

- `campanha/inimigos.json` e `campanha/npcs.json` continuam sendo a referência interna. Os arquivos individuais são cópias organizadas, reconstruídas ao iniciar/restaurar: **edite pelo painel**, pois alterações manuais nessas cópias podem ser sobrescritas.
- Renomear pelo painel atualiza a pasta. A exclusão remove o JSON gerenciado e a pasta se estiver vazia; arquivos extras do usuário são preservados.
- Inimigos mantêm a vida do modelo em `hpMax` e notas em `nota`; NPCs usam `hp: { atual, max }` e `notas`. Energia usa `{ atual, max }`.
- Poderes de catálogo adicionados ao figurante são cópias independentes. Criar um poder com a opção de salvar no catálogo o grava nesse catálogo imediatamente, mesmo se a ficha do figurante for cancelada depois.
- `cost.vital: "vigor"` é apresentado como energia para figurantes. **Usar** desconta esse custo no servidor e recusa energia insuficiente; não aplica dano/efeitos automaticamente. Outros custos antigos não recebem consumo automático nessa tela.
- Cada cópia em batalha mantém seus recursos independentemente do modelo.
- Arma opcional dos figurantes: `arma: { nome, icone, alcance, dano, categoria }` ou `null`. Configure em **Criar/Editar → Possui arma**. Ícones locais: `sword`, `axe`, `bow`, `staff`, `dagger`; categorias `leve`, `media`, `pesada`, `natural`, `outra`. Dano aceita a expressão de dados já usada no sistema ou um inteiro como `5`; não aplica dano automaticamente.
- A arma é salva no JSON do modelo (`campanha/inimigos.json` / `campanha/npcs.json` e cópia em `Figurante/.../figurante.json`) e copiada para `campanha/batalha.json` ao adicionar combatentes. Editar o modelo não modifica automaticamente cópias anteriores. Quando a arma diverge, a ficha de batalha oferece **Atualizar arma do modelo**, pelo comando autenticado `master_batalha_arma_modelo`: atualiza só aquela arma, mantendo HP, energia, notas e demais cópias. Também permite remover a arma quando o modelo está sem arma. Dados anteriores continuam válidos; o inventário dos jogadores não foi alterado.
- Reinicie `node server.js` depois de alterações no backend: atualizar a página não recarrega módulos Node. Foi encontrado um servidor iniciado às 20:26 executando código anterior ao suporte à arma, salvo às 20:45 de 20/10/2026. Essa versão descartava o campo. O editor agora exige a capacidade `recursos.armaFigurante` de `master_entrar` e verifica a arma na resposta do salvamento; incompatibilidades não geram confirmação de sucesso nem fecham o formulário preenchido.
- Biblioteca: figurantes começam recolhidos, com retrato maior (60 × 64 px), nome, vida/energia atuais e máximas e os seis atributos por extenso na mesma linha no desktop, além de **Mais ações** (inclui editar). Os dois vitais usam o texto **Atual / máximo**. Clique no nome/retrato/seta para expandir os recursos editáveis, arma, descrição, lore, notas e poderes. O estado aberto é preservado nas atualizações e mudanças de tipo, mas não após recarregar a página.
- Atributos no cabeçalho de batalha: **FOR, DES, INT, SAB, PRE, VON**, com o nome completo acessível e no tooltip; ausentes mostram `—`, zero continua `0`. Vida/energia mais estreitas mantêm barras, botões e edição. Vigor continua sendo o recurso de energia, não um sétimo atributo. Na biblioteca inimigos continuam usando `hpMax` (vida cheia do modelo, atual = máximo); NPCs usam seus valores atuais reais. Não há novos campos ou mudanças nas regras/JSONs.
- A ficha em batalha reúne identidade, vida/energia e **Mais ações** no cabeçalho. Marcar como derrotado/reviver fica nesse menu. A arma aparece em um bloco próprio; a coluna lateral tem painel de fundo, títulos em faixa e retratos arredondados maiores.
- Anotações de combate: ficam numa camada acima dos poderes, ancorada embaixo. Arraste a barra superior para cima/baixo ou clique em **Expandir/Recolher**. Com foco nessa barra, setas ajustam a altura e **Escape** recolhe. A altura é lembrada por combatente durante a página, inclusive após atualizações/salvamento; não é persistida no JSON nem após F5. O texto continua com salvamento automático independente. A camada é limitada à área dos poderes, sem cobrir arma/cabeçalho ou esticar a ficha.
- Cards **Comando tático**: biblioteca com descrição/lore/anotações e poderes expansíveis; batalha com coluna de resumos à esquerda e uma ficha completa ao lado, escolhida pelo retrato/nome. Recursos são editáveis por menos/mais ou digitando o valor atual; confirme com Enter ou saindo do campo.
- Inimigos na biblioteca também têm menos/mais: alteram `hpMax` do modelo (mínimo 1), sem modificar combatentes existentes. NPCs e cópias em batalha continuam ajustando `hp.atual`. Reinicie o servidor após atualizar o código para carregar `master_inimigo_hp`.
- Escala compacta somente nesta página: resumo em linha na coluna lateral, controles menores nos resumos e área ampliada para toque. Vida e energia da ficha ficam no cabeçalho e mantêm as barras. Não foi alterado o zoom do navegador nem o tamanho da ficha dos jogadores.
- Se uma cópia antiga não tiver imagem, o card procura a URL do modelo. Se a URL não carregar, exibe `/CSS/retrato-padrao.svg`; confira o endereço em **Editar ficha**. Uma foto válida própria da cópia continua sendo respeitada.
- Os botões **NPCs / Inimigos** filtram o tipo sem sair da aba atual. A busca também funciona na batalha. Até cinco resumos ficam centralizados verticalmente; acima disso, somente a lista ganha rolagem vertical, com cinco posições visíveis. Setas cima/baixo, Home/End alternam a seleção; esquerda/direita continuam compatíveis. Cada grupo lembra seu selecionado nesta página.
- No desktop, a Batalha ocupa a altura disponível da janela sem rolar o documento. Poderes longos têm sua própria rolagem dentro da ficha; notas e controles ficam acessíveis. Abaixo de 761 px, as áreas se empilham e a página pode rolar para manter a leitura em telas pequenas.
- Caídos têm **Excluir / Reviver** no retrato. A exclusão confirmada remove somente a cópia em combate, não o modelo da biblioteca. Reviver recupera ao menos 1 HP, respeitando a máxima; não enche a vida. **Limpar batalha inteira** remove todas as cópias dos dois tipos.
- NPCs também entram em batalha como cópias, com os recursos atuais do modelo; inimigos continuam entrando com a vida cheia. Os IDs das cópias são independentes dos IDs da biblioteca.
- Notas rápidas são salvas automaticamente em `campanha/batalha.json` → `combatentes[]` → `notasCombate`, até 2000 caracteres. `nota`/`notas` da biblioteca não são alteradas. A última gravação confirmada prevalece se dois mestres editarem a mesma nota.
- Falha ao salvar notas mantém o texto nesta página e oferece **Salvar notas novamente**. Aguarde “Salvo na batalha” antes de sair. Remover o combatente/limpar batalha também remove suas notas; o rascunho da página não substitui backup.
- Os cards usam `mestre/JS/figurantes-cartoes.js` e `mestre/CSS/figurantes-cartoes.css`; os editores continuam em `mestre/JS/figurantes.js`. Ícones de espada/bola de fogo estão no SVG local.
- Entregas de poderes/itens usam os fluxos existentes de caixa de entregas e confirmação da ficha; não substitua por escrita direta em arquivos de outro personagem.
- Publicar, entregar, liberar baú e recolher baú são ações diferentes. Não exponha dados privados do mestre em respostas gerais para jogadores.

## Rascunhos, falhas e recuperação

- Alterações da ficha ainda não confirmadas podem ter cópia no `localStorage`, por personagem e abertura da página, sem credenciais.
- Restaurar uma cópia é uma escolha explícita e pode substituir dados mais novos dos arquivos envolvidos. Não há resolução automática de conflitos.
- Limpar dados do site, impedir armazenamento ou usar outro navegador/dispositivo pode impedir a recuperação. O rascunho local **não é backup da campanha**.
- Texto de um poder ainda não adicionado fica no rascunho da página ao fechar/reabrir o editor; não confundir isso com recuperação persistente após fechar o navegador.
- Timeout não significa que o servidor desfez a ação. Em criação/exclusão/entrega/dano sem confirmação, confira o estado antes de repetir.

### Backup da campanha

O sistema mantém backups em `campanha/_backup/`, com limite atual de sete. Arquivos corrompidos podem ser preservados em `campanha/_corrompidos/`, com aviso; não apague esses diretórios numa limpeza de documentação.

Com o **servidor parado**:

```powershell
node campanha.js backups
node campanha.js restaurar NOME_DO_BACKUP
```

A restauração guarda o estado anterior antes de restaurar. Não presuma que o backup da campanha cobre todos os personagens, configurações e credenciais: antes de uma intervenção arriscada, faça cópia separada dos dados relevantes, incluindo `players/`, `campanha/`, `catalogo/` e `config.json`.

O **Desfazer dano** é mantido em memória; reiniciar o servidor elimina a possibilidade de desfazer a aplicação anterior por esse comando.

## Manutenção do front-end e segurança

- Base: `CSS/rpg-ui.css`; acesso: `CSS/acesso.css`; ficha: `CSS/ficha.css`; mestre: `mestre/CSS/painel-visual.css`.
- `JS/interface.js` reúne foco/modais, mensagens, espera HTTP limitada e componentes compartilhados de apresentação. Não contém o `STATE` do personagem.
- `mestre/JS/comum.js` reúne navegação, chave, socket, `pedirAoServidor` e proteção dos editores. `mestre/JS/aparencia.js` alimenta os campos existentes de ícone/cor.
- Preserve IDs, atributos `data-campo`, ordem/dependências dos scripts e eventos quando alterar HTML.
- Não substitua fórmulas, formatos JSON, autenticação ou regras para resolver um problema visual.
- Use `textContent` para dados de usuário, nomes acessíveis nos botões e confirmação em ações destrutivas.
- Em modais, preserve foco, Escape, fundo inativo, rolagem e retorno ao controle de origem. Figurantes têm controle próprio de janelas empilhadas.
- Registre novos comandos autenticados pelo mecanismo existente, valide entradas no servidor e use o mesmo `acaoId` para repetir uma mesma ação quando o protocolo oferecer esse suporte. Há eventos legados; não presuma que todos usam o mesmo envelope.
- `campanha.ler()` devolve cópia. `campanha.ver()` expõe o estado vivo para consulta interna; não o altere diretamente. Gravações passam por `campanha.atualizar()`.
- Respeite as salas/versões públicas de dados. Dados privados do mestre não devem virar broadcast geral.
- Erros tratados não devem vazar pilhas internas. Mantenha os logs operacionais úteis; não esconda uma falha apenas parando de imprimir.
- Partes legadas da ficha/mestre ainda usam Tailwind/Font Awesome por CDN. Não há garantia de aparência completa sem esses serviços.

## Verificação local

Por preferência do usuário, executar apenas uma checagem básica por alteração, em proporção ao risco; as demais ficam para o teste local. Limpeza de documentação não exige rodar testes do jogo.

Um caso virtual básico:

```powershell
node --test testes/protecoes-ux-etapa-3.test.js
```

Outros arquivos focados existentes: `protecoes-ux-basico.test.js`, `protecoes-ux-etapa-2.test.js`, `figurantes.test.js`, `estabilidade.test.js` e `integracao.test.js`, dentro de `testes/`. Escolha o relevante, sem rodar tudo por padrão. `npm test` executa o runner geral e pode levar mais tempo.

Para a alteração mais recente dos cards, um único caso básico (servidor real em cópia temporária + DOM simulado):

```powershell
node --test testes/figurantes-cartoes.test.js
```

Conferência manual dos cards: abra `/mestre/figurantes` e use **Ctrl+F5**. Confira os três textos da biblioteca, expanda os poderes e adicione cópias de inimigos e NPCs. Na **Batalha**, alterne os tipos e selecione os resumos: somente a ficha escolhida deve aparecer à direita no desktop. Confira a centralização com 1, 3 e 5 resumos; adicione o sexto e role só a coluna para visualizar os resumos 2 a 6, sem mover o documento. Busque por nome, digite vida/energia e confira a barra da ficha; use os ícones dos poderes. Zere a vida e teste **Reviver** (1 HP). Exclua uma cópia e confira que o modelo permanece na biblioteca. Escreva uma nota, espere **Salvo na batalha** e recarregue para conferir a persistência. Confira também teclado e largura de celular. Remova as cópias fictícias ao terminar.

Conferência adicional da arma: reinicie o servidor, recarregue a página e confirme que a biblioteca começa recolhida. Expanda uma ficha, edite/salve a arma e reabra após F5. Em uma cópia antiga na batalha, use **Atualizar arma do modelo** e confira que só a arma muda, preservando HP, energia e notas. Para conferir a persistência completa, reinicie o servidor e reabra o mesmo figurante.

Para conferir apresentação em ambiente descartável:

```powershell
node testes/ajuda/preview-ui.js --ficha
```

Use a URL e as instruções do terminal; ao terminar, digite `sair`. Não dependa da cópia temporária para testar recuperação após encerrá-la: o helper a remove.

Checklist essencial, preferencialmente com dados fictícios:

1. Login, criação/seleção e exclusão de personagem descartável; recarregar e conferir a persistência.
2. Ajustar vitais/perícias, salvar e reabrir o mesmo personagem; não misturar identidades.
3. Mochila: buscar, abrir detalhes, alterar quantidade, equipar e descartar parcialmente; grade/lista/peso coerentes.
4. Grimório: filtrar, criar/editar cópia e conferir que o catálogo global não foi alterado indevidamente.
5. Mestre: chave ausente/inválida/correta antes de criar figurante; salvar/reabrir NPC/inimigo e conferir energia.
6. Entregas online/offline; baús liberados/recolhidos; privacidade de poderes e segredos.
7. Rolagem, alvo/multiplicador, dano/desfazer e sincronização com a ficha.
8. Interromper/reconectar o servidor com alteração pendente; ler o aviso e conferir antes de reenviar/restaurar.
9. Teclado e largura móvel, nomes/listas longas, janelas, foco, mensagens e dependências visuais.

**Limite conhecido:** os casos básicos virtuais das três etapas de UX passaram nas respectivas entregas. Não houve regressão completa da versão acumulada, validação integral em aparelhos físicos ou auditoria formal de acessibilidade. Logs antigos de testes não comprovam o estado atual; registre uma reprodução nova ao investigar um erro.

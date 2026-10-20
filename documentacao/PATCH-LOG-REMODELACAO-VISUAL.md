# Patch Log — Remodelação Visual do RPG System

Atualização acumulada · 19–20 de outubro de 2026  
Três rodadas de remodelação + os 21 ajustes de usabilidade.

## 🎨 Visual geral

- **Nova identidade visual:** azul-escuro, dourado suave e títulos serifados aplicados ao acesso, à ficha e ao painel do mestre.
- **Componentes padronizados:** botões, campos, cartões, abas, mensagens e janelas seguem a mesma base visual.
- **Leitura mais confortável:** valores importantes ganharam destaque; textos de apoio e ações ficaram mais legíveis.
- **Menos espaço desperdiçado:** cabeçalhos mais compactos e melhor distribuição do conteúdo durante a partida.
- **Cores de ação:** botões principais, ações destrutivas, estados selecionados e avisos passaram a ter identificação mais consistente.
- **Recursos locais:** login e seleção deixaram de depender de fontes e bibliotecas visuais por CDN. A ficha recebeu um retrato padrão em SVG local, preservando retratos personalizados.

## 🔑 Login e personagens

- **Login remodelado:** duas colunas no desktop e disposição empilhada em telas menores.
- **Seleção de personagens:** cartões mais claros, nomes longos sem cortes desnecessários e acesso por teclado.
- **Criação e exclusão:** janelas com mensagens junto à operação, foco controlado e retorno ao botão de origem.
- **Exclusão mais segura:** a confirmação começa com foco em **Manter personagem**, evitando priorizar a ação destrutiva.
- **Pedidos repetidos:** login e criação bloqueiam novos envios enquanto aguardam resposta.
- **Falha ao carregar personagens:** opção de tentar novamente sem encerrar uma sessão ainda válida.
- **Espera limitada:** login, listagem, criação e exclusão têm prazo de **12 segundos**, incluindo a leitura da resposta.
- **Resultado desconhecido:** uma criação ou exclusão sem confirmação exige atualizar a lista antes de repetir; não há reenvio automático.
- **Criação de conta sem confirmação:** o aviso orienta tentar **Entrar** com os mesmos dados antes de criar novamente.

## 📜 Ficha e perícias

- **Cabeçalho compacto:** nome e nível/experiência ocupam menos espaço; a edição de nome e classe permanece no perfil.
- **Navegação:** cinco abas com indicação da área ativa, atalhos de teclado e última área lembrada por personagem nesta aba do navegador.
- **Aviso de conexão:** continua visível sem encobrir a navegação.
- **Vitais:** valores atuais maiores, máximos editáveis e controles de ajuste mais confortáveis.
- **Ajustar…:** permite aplicar uma quantidade positiva ou negativa de uma vez, com prévia do valor final e respeito aos limites.
- **Mudança durante o ajuste:** se o vital for atualizado enquanto o diálogo estiver aberto, a prévia é renovada e pede nova conferência.
- **Perícias em duas colunas:** totais destacados e composição visível; telas menores usam uma coluna para manter a leitura.
- **Busca de perícias:** pesquisa por nome ou atributo, ignorando acentos, com indicação quando não há resultados.
- **Consulta compacta:** os controles de bônus ficam recolhidos até ativar **Editar bônus**. **Concluir edição de bônus** retorna à consulta.
- **Rolar perícia:** novo teste direto de **1d20 + total da perícia**, integrado ao resultado, histórico, log e envio ao mestre.
- **Ao combo:** continua disponível como alternativa, adicionando somente o bônus fixo da perícia.
- **Atributos no celular:** grupo inicialmente recolhido, mas disponível para expansão.

## ✨ Grimório

- **Filtros:** **Todos / Habilidades / Magias**, com contagem e identificação das categorias nos cartões.
- **Categorias separadas:** mesmo em **Todos**, habilidades e magias permanecem em seções próprias.
- **Tipo explícito:** criação e catálogo deixam claro se a entrada é habilidade ou magia.
- **Editar na ficha:** poderes existentes podem ter nome, custo, descrição e demais campos do editor alterados sem remover e recriar a entrada.
- **Identidade preservada:** editar mantém os identificadores, efeitos, duração e dados que não aparecem no formulário.
- **Catálogo independente:** editar a cópia da ficha não modifica o poder do catálogo global.
- **Rascunho de criação:** alternar **Criar/Catálogo** ou fechar e reabrir o editor preserva o preenchimento na mesma página.
- **Edição protegida:** fechar um poder com alterações pede confirmação; o rascunho de criação fica separado da edição de entradas existentes.

## 🎒 Mochila e equipamentos

- **Tetris preservado:** mesmas células, posições, dimensões, capacidade, pilhas, peso e regras de equipamento.
- **Grade rolável:** mochilas maiores têm rolagem própria, sem exigir que a página inteira acompanhe sua largura.
- **Detalhes centralizados:** itens abrem em uma janela fora da área rolável da grade, com ações acessíveis também em telas menores.
- **Teclado:** itens da grade podem ser abertos com **Enter** ou **Espaço**.
- **Buscar na mochila:** pesquisa por nome ou tipo, ignorando acentos e maiúsculas.
- **Lista auxiliar:** nome completo, quantidade, tipo e botão **Detalhes** para cada pilha, sincronizados com o inventário.
- **Resultados na grade:** itens encontrados ficam realçados e os demais atenuados, sem mudar sua posição ou capacidade.
- **Atualizações sincronizadas:** alterações de quantidade e mudanças no inventário atualizam também a lista, mantendo o texto da busca.
- **Descarte por quantidade:** permite remover apenas parte da pilha, com nome, quantidade e confirmação antes de concluir.
- **Retorno de foco:** fechar os detalhes retorna à ação correspondente, inclusive quando a lista foi redesenhada.

## 🎲 Dados e combo

- **Área de rolagem remodelada:** combo, resultado e histórico receberam a nova hierarquia visual e tipografia.
- **Remoção identificada:** botões informam qual componente e fórmula serão removidos, inclusive para leitores de tela.
- **Dica no foco:** a identificação da remoção também aparece ao navegar pelo teclado ou passar o mouse.
- **Continuidade pelo teclado:** remover um componente leva o foco à próxima remoção; no último, ao botão **Rolar combo**.
- **Fórmulas preservadas:** a remodelação não alterou os cálculos, a aleatoriedade ou a composição das rolagens.

## 🧙 Painel do mestre

- **Visual unificado:** Mesa, Rolagem, Inimigos/NPCs, Loot e Habilidades/Magias adotaram a identidade da ficha.
- **Menu móvel:** cinco atalhos com ícones locais e nomes curtos, mantendo as áreas principais acessíveis.
- **Chave do mestre:** campo em painel recolhível; conexão online e acesso autorizado recebem indicações distintas.
- **Mesa:** vitais maiores, nomes com quebra de linha, comandos identificados e recuperação de foco após atualização dos cartões.
- **Ajustar vitais:** edição por quantidade na Mesa e nos recursos editáveis dos figurantes, mantendo os atalhos anteriores.
- **Figurantes:** ficha central, catálogo e criação de poderes receberam cores, fontes e controles harmonizados, preservando a estrutura já existente.
- **Chave antes da criação:** **Novo inimigo/NPC** e **Abrir ficha** validam o acesso antes de abrir ou limpar o formulário.
- **Acesso recusado:** chave ausente, inválida ou falha de conexão não inicia o preenchimento; o campo da chave recebe foco para correção.
- **Atualizações em tempo real:** cartões de figurantes preservam detalhes de poderes abertos, quantidade de cópias e foco enquanto recebem novos valores.
- **Seleção de alvos:** clicar no nome também marca o alvo; a linha selecionada recebe destaque, sem interferir no multiplicador.
- **Rolagem:** foco, seleção e multiplicador são preservados durante a atualização dos alvos.
- **Entrega de poderes:** destinatário identificado por **player + nomePasta**, sem escolha automática de outro personagem ao reordenar a lista.
- **Destino explícito:** o botão informa **Entregar a [nome]**, com indicação de entrega offline quando aplicável.
- **Envios protegidos:** entregar, duplicar poderes e aplicar/desfazer dano exibem estado ocupado; pedidos mutantes idênticos em andamento compartilham o mesmo envio.
- **Catálogos:** estados separados de carregamento, catálogo vazio e erro, com **Tentar novamente**. Dados anteriores permanecem visíveis quando disponíveis.
- **Validação junto ao campo:** Loot e poderes mostram o erro no local, respeitam limites numéricos e levam o foco ao primeiro problema.
- **Ícones por nome:** seletores como **Arma, Defesa, Poção, Fogo, Magia e Tesouro**, com prévia, substituem a exigência de decorar classes técnicas.
- **Paleta do Loot:** opções nomeadas de cor com prévia para a peça na mochila.
- **Avançado:** ícones e cores personalizados continuam disponíveis e não são substituídos automaticamente ao abrir uma entrada antiga.

## 💾 Salvamento e proteção de alterações

- **Rascunhos dos editores:** aviso antes de descartar alterações ao fechar, cancelar ou substituir uma edição.
- **Campos durante o envio:** formulários ficam protegidos contra novas edições enquanto aguardam o salvamento; falhas mantêm o preenchimento.
- **Cópia local de pendências:** alterações da ficha ainda não confirmadas recebem uma cópia no navegador, identificada por personagem e abertura da página, sem incluir credenciais.
- **Recuperação explícita:** ao reencontrar uma cópia, é possível **Restaurar e salvar rascunho** ou **Manter versão do servidor**. Nada é aplicado automaticamente sobre a ficha recebida.
- **Erro de salvamento mais claro:** o indicador identifica a área afetada e oferece **Tentar salvar novamente**.
- **Troca de personagem:** pendências e erros de salvamento são sinalizados antes de sair da ficha.
- **Espera sem confirmação:** avisos deixam claro que a operação pode ter sido concluída, orientando conferir o estado antes de repetir.
- **Notificações:** erros permanecem até serem dispensados; avisos simples expiram e têm fechamento próprio. A pilha visível foi limitada para não cobrir a tela.

## 🔧 Correções

- **Máximo vital:** confirmar com **Enter** não reabre mais o campo ao devolver o foco ao botão.
- **Slot da Mochila:** desativá-lo com os detalhes de uma mochila abertos usa o fechamento completo da janela, restaurando foco, rolagem e interação do fundo.
- **Detalhes pela lista:** corrigido o clique que abria a janela do item e imediatamente a fechava como se fosse um clique externo.
- **Botões dourados dos figurantes:** texto escuro mantido também no hover e no foco, corrigindo o conflito com a regra antiga de cor clara.
- **Destinatário reordenado:** a atualização da lista não troca silenciosamente a pessoa que receberá o poder.
- **Resposta atrasada de acesso:** não abre uma ficha de figurante em um tipo, aba ou chave que já mudou durante a espera.
- **Falha de consulta:** não é mais apresentada como se o catálogo estivesse simplesmente vazio nas áreas ajustadas.
- **Testes antigos do menu:** expectativas atualizadas para as cinco áreas atuais do mestre, preservando os caminhos antigos de Inimigos/NPCs.

## 📱 Acessibilidade e telas menores

- **Áreas de toque:** botões e seleções importantes ampliados, com foco visível e identificação contextual.
- **Janelas:** títulos associados, foco inicial, navegação por **Tab/Shift+Tab**, **Escape**, fundo inativo e retorno de foco nas janelas ajustadas.
- **Abas:** navegação por setas, **Home** e **End** nas áreas adaptadas.
- **Formulários responsivos:** filtros quebram linha e editores do mestre se reorganizam abaixo do catálogo quando falta espaço.
- **Conteúdo sem cortes:** nomes longos, valores maiores e mensagens receberam melhor tratamento em telas estreitas.
- **Preferência de movimento:** a base visual respeita a redução de animações quando configurada no dispositivo.

## ⚖️ O que continua igual

- **Sem rebalanceamento:** regras de combate, fórmulas, custos e limites de jogo não foram reformulados.
- **Backend preservado:** contratos HTTP/Socket.IO, autenticação e formatos dos JSONs foram mantidos durante esta remodelação e os ajustes descritos.
- **Personagem correto:** a identidade continua sendo **player + nomePasta**.
- **Configuração global:** Mana/Vigor, Ex, riquezas e Slot da Mochila continuam obedecendo às configurações existentes.
- **Conexões separadas:** mestre e jogador mantêm seus próprios fluxos. Trocar de página do mestre ainda recria a conexão, reaproveitando a chave na mesma aba; não foi criada uma conexão única entre páginas.
- **Compatibilidade visual:** partes legadas da ficha e do mestre ainda usam Tailwind/Font Awesome por CDN. A independência de CDN não se aplica ao sistema inteiro.

## 🧪 Verificação

- **Rodadas iniciais:** foram realizadas verificações específicas e inspeções em navegador em cópias descartáveis; os relatórios individuais foram consolidados nesta documentação.
- **Rodada do mestre:** checagem básica de navegação e abertura de editores em cópia descartável.
- **Ajustes dos 21 pontos:** cada etapa terminou com seu caso básico virtual aprovado; não foi executada uma regressão completa da versão final acumulada.
- **Validação local pendente:** conferir o conjunto final com servidor real, salvamentos, combate, entregas e uso em celulares físicos. Melhorias de acessibilidade não equivalem a uma certificação.

---

Este arquivo consolida os antigos relatórios das três rodadas e das três etapas de UX, removidos na limpeza documental. Consulte [Informações importantes](INFORMACOES-IMPORTANTES.md) para comandos, segurança, recuperação e verificação local; o diagnóstico anterior à remodelação permanece em `ANALISE-UI-UX-DESIGN-GERAL.txt`. A criação original do sistema de Inimigos/NPCs e outras alterações anteriores à remodelação não são apresentadas aqui como novidades deste patch.

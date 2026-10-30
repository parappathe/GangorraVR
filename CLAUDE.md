# GangorraVR

Gangorra: jogo de tabuleiro de equilíbrio em VR para o Meta Quest 3 no navegador (WebXR), sem
instalar nada. Numa sala de jogos antiga à noite (lampião, lareira, estante, janela com lua), uma
mesa redonda tem um disco de madeira apoiado num pino de latão com mola. Você e o computador põem
peças de peso 1, 2 e 3 nas casas do disco; ele inclina de verdade (animado, com balanço) para o lado
do centro de massa e, passou do limite, as peças mais baixas escorregam e caem na calha da mesa.
Partida contra 3 adversários com personalidade e 10 desafios com 3 estrelas. Também joga no PC com
mouse e teclado. Tudo em português.

## Como rodar / jogar

**No Quest:** depois de publicado, abrir no navegador do óculos `https://parappathe.github.io/GangorraVR/`
e apertar "Entrar em VR". Para publicar/atualizar: commitar e rodar `python publicar.py GangorraVR` na
pasta `C:\claude code`. (Ainda não publicado.)

**No PC:** `python serve.py` nesta pasta e abrir `http://localhost:8821` (o painel de visualização usa
`.claude/launch.json`). O `serve.py` manda o navegador não guardar cache; `python serve.py --https`
serve para abrir no Quest pela rede de casa (porta 8443).

### Controles

| | VR (Quest) | PC |
|---|---|---|
| Pegar peça | Botão lateral (aperto) com a mão a até 8,5 cm de uma peça da sua bandeja (beira da mesa, na sua frente) | Clicar na peça da bandeja ou teclas 1, 2, 3 (clicar de novo ou Esc cancela) |
| Pôr na casa | Soltar o aperto com a peça em cima de uma casa livre; ou, de longe, apontar o controle para a casa e soltar. A casa escolhida fica marcada | Clicar na casa |
| Prévia | Enquanto segura: aro colorido mostra como o disco vai inclinar, anéis vermelhos nas peças que vão cair e uma placa com "Inclinação: 40% → 110%" e quem cai | Passar o mouse na casa: mesma prévia, mais a barra embaixo da tela |
| Girar a mesa | Manche para os lados (para alcançar o outro lado do disco) | A/D ou setas, ou arrastar com o botão direito (gira a câmera); W/S sobe e desce; rodinha: zoom |
| Só com as mãos | Pinça perto da peça pega, soltar a pinça põe | |
| Pausa | B ou Y | Esc ou P |
| Menu | Apontar com o controle e gatilho | Clique |
| FPS | Menu → FPS | Tecla F |

No VR você fica em pé de frente para a mesa; o adversário está sentado do outro lado e reage (pensa,
comemora, fica triste). Um nível de bolha na beira da mesa mostra para onde o disco pende.

### Regras

- Cada jogador tem 6 peças por rodada: pesos 1, 1, 2, 2, 3 e 3. Na sua vez põe uma (a que quiser)
  numa casa livre. Disco com 30 casas em 3 anéis: dentro (6 casas), meio (12) e borda (12).
- O disco inclina para o centro de massa: inclinação = torque (peso × distância do centro) dividido
  pelo limite. Passou do limite, o disco vai até o batente e as peças escorregam uma de cada vez,
  sempre a mais baixa primeiro (a que está mais longe do centro na direção da descida; empate: a mais
  leve), até o pino aguentar de novo. Peça do anel de dentro nunca escorrega.
- O limite cai com o peso em cima do disco (o pino tem mola; peso em cima amolece): 3,5 com o disco
  vazio, menos 0,07 por unidade de peso. No fim da rodada qualquer peça pode desequilibrar.
- Pontos: cada peça que está no disco no fim vale peso × anel (dentro ×1, meio ×2, borda ×3). Peça que
  cai não vale nada (quem perde peça perde os pontos dela). Pode derrubar a própria peça.
- Truque: pôr peso no anel do meio, atrás das peças do adversário na borda: as dele ficam mais baixas
  e caem primeiro.
- Partida: 2 rodadas, cada um começa uma (sorteio na primeira). Soma dos pontos; empate é empate.
- Adversários (em `js/ai.js`): **Dona Lurdes** (cuidadosa: mantém o disco reto, foge da borda, quase
  não ataca), **Zé Faísca** (arriscado: borda e peça pesada, derruba tudo que puder, confere só por
  cima a resposta), **Mestra Iara** (olha 2 jogadas à frente: a dela e a sua melhor resposta).
- Desafios (em `js/challenges.js`, só você joga, as azuis não se mexem): 1 Primeiro tombo, 2
  Equilibrista, 3 Três de uma vez, 4 Só a levinha, 5 Contrapeso, 6 Reação em cadeia, 7 Placar cheio,
  8 Dois tempos, 9 Terra arrasada, 10 Virada final. Cada um diz as metas das 3 estrelas. Passar um (1
  estrela) libera o próximo.
- Progresso salvo no navegador (localStorage, chave `gangorravr.v1`): vitórias e partidas por
  adversário, estrelas por desafio, som, prévia e FPS.

## Como testar

- `npm test` (ou `node tests/run.js`): tabuleiro (30 casas), física da inclinação (direção do centro
  de massa, proporcional ao torque, batente, limite cai com o peso, mola chega no alvo, balança pouco,
  igual em 30 ou 90 fps), queda (mais baixa primeiro, anel de dentro não cai, reação em cadeia,
  trajetória escorrega/voa/chega na calha), regras (mão, jogada inválida, pontos, prévia não mexe no
  jogo, fim de rodada, partida de 2 rodadas, modo desafio), IA (jogadas válidas, mestra derruba sem
  perder, estilos, tempo de pensar), Mestra contra Dona Lurdes em 12 partidas (tem que ganhar a
  maioria; mostra os placares), robô tira 3 estrelas nos 10 desafios (mostra a jogada), e fumaça do
  `main.js` (carrega o jogo no Node com navegador e WebGL de mentira, clica na bandeja e na casa com
  prévia, robô termina uma partida e os 10 desafios dentro do jogo, salva, pausa). Tem que terminar
  com "Tudo certo"; sai com código 1 se algo falhar. Não toca som. Leva uns 5 s.
- O teste de fumaça (`tests/smoke.js` + `tests/three-stub.js`) usa `module.registerHooks` do Node
  (Node 22.15 ou mais novo) para trocar só o `WebGLRenderer` do Three.js.
- No navegador (console): `dev.autoplay = true` faz o robô jogar por você (partidas seguem sozinhas),
  `dev.advance(5)` avança 5 s na hora, `dev.state()` mostra tela, fase, mãos, peças, pontos e prévia,
  `dev.loadLevel(3)` abre o desafio 3 (1 a 10), `dev.startMatch(2)` partida contra o adversário 2
  (1 a 3), `dev.cellScreen(n)` / `dev.trayScreen(w)` dão a posição na tela de uma casa / peça da
  bandeja, `dev.resetSave()` apaga o progresso. `window.gangorra` tem `match`, `challenge`, `save`,
  `camera`, `scene`, `renderer`, `world`.
- **Só dá para testar no óculos:** pegar com o aperto e com a pinça (distância de 8,5 cm), soltar em
  cima da casa e soltar apontando, girar a mesa com o manche, alcance do disco em pé, posição da
  bandeja e das placas, vibração, rastreamento de mãos e FPS.

## Estrutura

| Arquivo | O que tem |
|---|---|
| `index.html`, `css/style.css` | Página, botão "Entrar em VR", placar, barra de prévia e dica do PC |
| `js/physics.js` | Casas (`CELLS`, `RINGS`), torque, limite com mola (`limitFor`), inclinação (`tiltTarget`), quem escorrega (`resolve`), mola animada (`stepTilt`), trajetória da queda (`fallPath`). Sem navegador |
| `js/rules.js` | Rodada (`newRound`, `applyMove`, `preview`, `legalMoves`), pontos, `Match` (2 rodadas). Sem navegador |
| `js/ai.js` | Adversários (`OPPONENTS`), robô (`ROBOT`), avaliação, escolha em passos (`chooseMoveGen`), `playRound`. Sem navegador |
| `js/challenges.js` | Os 10 desafios (posição, mão, metas, nota) e o robô que resolve (`bestChallengeGen`, `solveChallenge`). Sem navegador |
| `js/main.js` | Liga tudo: render, VR (pegar, soltar, apontar, girar a mesa), mouse/teclado, prévia, animação dos lances e das quedas, turnos, menus, HUD, placar, `dev` |
| `js/scene.js` | Sala (piso, paredes, tapete, janela, estante, lareira, relógio), lampião, mesa com calha, pino com mola, disco (tampo desenhado em canvas), peças, bandejas, marcas da prévia, nível de bolha, placa do placar, adversário (boneco com enfeite por personalidade) |
| `js/ui.js` | Painel de menu 3D em canvas e placas de texto |
| `js/audio.js` | Sons sintetizados: toque de madeira, rangido do pino, batente, peça escorregando e caindo, lareira, fanfarras |
| `js/save.js` | Progresso e opções salvos |
| `tests/run.js`, `tests/smoke.js`, `tests/three-stub.js` | Testes |
| `docs/` | Prints do jogo rodando no PC |
| `serve.py` | Servidor local sem cache (porta 8821, `--https` para o Quest) |
| `vendor/three/three.module.js` | Three.js r170 (cópia local) |

Coordenadas do disco: raio 1, x = direita de quem joga, y = para o lado do adversário. No Three.js isso
vira (x·R, 0, -y·R) dentro do grupo inclinado (`world.tilt`), com R = 0,36 m. Mesa centrada em
(0; 0; -0,55), tampo a 0,80 m, disco a 0,985 m. No VR a cabeça fica em x = 0, z = 0,23 (de frente para a mesa).

## Regras e convenções do projeto

- `physics.js`, `rules.js`, `ai.js` e `challenges.js` não podem usar navegador nem Three.js: os testes
  rodam no Node.
- Mexeu em física, regras, IA ou desafios: rodar `npm test`. Desafio novo ou mudado: a posição inicial
  tem que estar parada e o robô tem que tirar 3 estrelas.
- A IA no navegador pensa em pedaços de até 6 ms por quadro (`chooseMoveGen` e `bestChallengeGen` são
  geradores).
- Testes nunca tocam som (o `Sfx` só liga com clique ou entrada no VR).

## Decisões

- Pontos = peso × anel, não só o peso: com só o peso todo mundo enchia o anel de dentro (seguro) e o
  jogo empatava. A borda vale mais mas cai primeiro: risco contra recompensa.
- Limite que cai com o peso em cima (pino com mola): com limite fixo, uma peça sozinha nunca derrubava
  nada a partir do disco equilibrado e as partidas entre IAs ficavam sem queda nenhuma. Valores (3,5 e
  0,07) escolhidos simulando partidas: a Mestra contra ela mesma fica perto de 50% para quem começa, e
  há de 1 a 3 quedas por rodada.
- 2 rodadas alternando quem começa, porque a ordem de jogar pesa numa rodada só.
- Peças escorregam uma de cada vez, a mais baixa primeiro, e o torque é recalculado depois de cada
  uma: dá reação em cadeia mas sempre termina.
- Desafios só com você jogando e no máximo 3 peças na mão: o robô faz busca completa (até ~100 mil
  sequências) e as metas foram calibradas contando quantas sequências dão cada nota.
- No VR o disco do outro lado fica longe da mão: por isso dá para soltar apontando e girar a mesa com o
  manche (a mesa gira, o adversário não).
- Prévia ligada por padrão (Menu → Prévia desliga).
- Porta do servidor local 8821.

## Pendências / problemas conhecidos

- Nada testado no Quest ainda: pegar e soltar (aperto e pinça), soltar apontando, girar a mesa,
  alcance, tamanho das peças na mão, conforto da altura da mesa (disco a 98,5 cm), placas, vibração,
  rastreamento de mãos e FPS (luz de ponto do lampião e da lareira, sem sombras).
- A dificuldade foi calibrada com IA contra IA; contra gente a Mestra pode estar difícil demais e o Zé
  fácil demais.
- No PC, com a câmera padrão, a cabeça do adversário fica um pouco cortada em cima (dá para ver
  girando com W/S).
- Ainda não publicado no site, nem listado na tabela da pasta raiz nem no `SiteJogos`.

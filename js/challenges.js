// Os 10 desafios: posição pronta, peças na mão, meta com 3 estrelas, e o robô que resolve.
// Sem navegador. Nos desafios só você joga (as azuis não se mexem).
import { CELLS, RINGS } from './physics.js';
import { newRound, legalMoves, applyMove, scoreOf, PLAYER, CPU } from './rules.js';

// Casa pelo anel (0 dentro, 1 meio, 2 borda) e setor. Borda: setor 0 = direita, 3 = longe,
// 6 = esquerda, 9 = perto (lado do jogador); cada setor anda 30° no sentido anti-horário.
export function C(ring, sector) {
  let base = 0;
  for (let r = 0; r < ring; r++) base += RINGS[r].n;
  return base + (((sector % RINGS[ring].n) + RINGS[ring].n) % RINGS[ring].n);
}
const B = (w, ring, sector) => ({ owner: CPU, w, cell: C(ring, sector) });
const R = (w, ring, sector) => ({ owner: PLAYER, w, cell: C(ring, sector) });

// ctx = { start, st, infos }: estado inicial, estado final e o que aconteceu em cada jogada
const blueLost = (ctx) => ctx.st.lost[CPU].length;
const redLost = (ctx) => ctx.st.lost[PLAYER].length;
const maxOneMove = (ctx) => Math.max(0, ...ctx.infos.map(i => i.lostBy[CPU].length));
const redScore = (ctx) => scoreOf(ctx.st.pieces, PLAYER);
const blueScore = (ctx) => scoreOf(ctx.st.pieces, CPU);
const finalFrac = (ctx) => ctx.infos.length ? ctx.infos[ctx.infos.length - 1].after.frac : 0;
const stars = (...conds) => { let n = 0; for (const c of conds) { if (!c) break; n++; } return n; };

export const CHALLENGES = [
  {
    name: 'Primeiro tombo', hand: [2],
    pieces: [B(2, 2, 0), B(1, 2, 1)],
    desc: 'O disco já pende para a direita. Dê o empurrão que falta.',
    goal: '★ derrube 1 azul · ★★ sem perder a sua · ★★★ e termine com mais pontos que as azuis',
    grade: (c) => stars(blueLost(c) >= 1, redLost(c) === 0, redScore(c) > blueScore(c)),
  },
  {
    name: 'Equilibrista', hand: [3, 2, 1],
    pieces: [R(3, 2, 4), R(2, 2, 0), R(1, 0, 0)],
    desc: 'Suas peças já fazem o disco pender. Ponha mais 3 sem derrubar nada.',
    goal: '★ nenhuma vermelha cai · ★★ e 24 pontos ou mais · ★★★ e o disco fica quase reto',
    grade: (c) => stars(redLost(c) === 0, redScore(c) >= 24, finalFrac(c) < 0.2),
  },
  {
    name: 'Três de uma vez', hand: [3],
    pieces: [B(1, 2, 4), B(1, 2, 7), B(1, 0, 1), B(2, 1, 5), R(1, 1, 4)],
    desc: 'As azuis se juntaram na esquerda. Uma peça só.',
    goal: '★ derrube 1 azul · ★★ derrube 2 · ★★★ derrube 3 de uma vez',
    grade: (c) => stars(blueLost(c) >= 1, maxOneMove(c) >= 2, maxOneMove(c) >= 3),
  },
  {
    name: 'Só a levinha', hand: [1],
    pieces: [B(3, 2, 3), B(1, 0, 3), B(1, 2, 4), R(2, 0, 4)],
    desc: 'Uma peça de peso 1 contra a pesada azul lá no fundo.',
    goal: '★ derrube a azul de peso 3 · ★★ sem perder a sua · ★★★ e termine com mais pontos que as azuis',
    grade: (c) => {
      const big = c.st.lost[CPU].some(p => p.w === 3);
      return stars(big, big && redLost(c) === 0, big && redLost(c) === 0 && redScore(c) > blueScore(c));
    },
  },
  {
    name: 'Contrapeso', hand: [2, 1],
    pieces: [R(3, 2, 5), B(2, 0, 0), B(2, 2, 9), B(1, 2, 8), B(1, 1, 9)],
    desc: 'Sua peça 3 está na beira. Derrube as azuis sem deixar ela cair.',
    goal: '★ derrube 1 azul · ★★ sem perder a sua peça 3 · ★★★ derrube 2 sem perder nenhuma',
    grade: (c) => {
      const big = c.st.pieces.some(p => p.owner === PLAYER && p.w === 3);
      return stars(blueLost(c) >= 1, big, blueLost(c) >= 2 && redLost(c) === 0);
    },
  },
  {
    name: 'Reação em cadeia', hand: [3, 1],
    pieces: [B(1, 2, 0), B(1, 2, 1), B(1, 2, 11), B(2, 1, 0), B(1, 1, 11), B(2, 2, 6)],
    desc: 'Uma peça puxa a outra. Faça a fila inteira cair.',
    goal: '★ derrube 1 azul · ★★ derrube 2 de uma vez · ★★★ derrube 3 sem perder nenhuma',
    grade: (c) => stars(blueLost(c) >= 1, maxOneMove(c) >= 2, blueLost(c) >= 3 && redLost(c) === 0),
  },
  {
    name: 'Placar cheio', hand: [3, 3, 2],
    pieces: [B(2, 2, 3), B(2, 2, 9), R(1, 1, 0), R(1, 1, 6)],
    desc: 'Disco reto. Encha de pontos, mas a borda é perigosa.',
    goal: '★ 15 pontos · ★★ 22 pontos · ★★★ 27 pontos (borda vale 3x, meio 2x, dentro 1x)',
    grade: (c) => stars(redScore(c) >= 15, redScore(c) >= 22, redScore(c) >= 27),
  },
  {
    name: 'Dois tempos', hand: [2, 2],
    pieces: [B(2, 2, 2), B(1, 2, 3), B(2, 2, 4), B(1, 1, 7), R(2, 2, 9)],
    desc: 'De uma vez só não dá. Prepare com a primeira e derrube com a segunda.',
    goal: '★ derrube 1 azul · ★★ derrube 2 · ★★★ derrube 2 sem perder a sua',
    grade: (c) => stars(blueLost(c) >= 1, blueLost(c) >= 2, blueLost(c) >= 2 && redLost(c) === 0),
  },
  {
    name: 'Terra arrasada', hand: [3, 2, 1],
    pieces: [B(1, 1, 5), B(2, 2, 11), B(1, 2, 0), B(2, 2, 1), B(1, 2, 2), B(3, 2, 5)],
    desc: 'Azuis espalhadas por todo lado. Limpe o disco.',
    goal: '★ derrube 2 azuis · ★★ derrube 3 · ★★★ derrube 4',
    grade: (c) => stars(blueLost(c) >= 2, blueLost(c) >= 3, blueLost(c) >= 4),
  },
  {
    name: 'Virada final', hand: [3, 2, 1],
    pieces: [B(3, 2, 2), B(2, 2, 5), B(2, 1, 8), B(3, 1, 11), B(1, 2, 7), R(1, 0, 0), R(2, 1, 4)],
    desc: 'As azuis estão bem na frente. Vire o placar.',
    goal: '★ fique a 5 pontos ou menos · ★★ empate ou passe · ★★★ vença por 8 ou mais',
    grade: (c) => { const d = redScore(c) - blueScore(c); return stars(d >= -5, d >= 0, d >= 8); },
  },
];

export function setupChallenge(ch) {
  return newRound({ starter: PLAYER, solo: true, hands: [ch.hand, []], pieces: ch.pieces });
}

// Robô dos desafios: procura a sequência de jogadas com mais estrelas (busca completa, em passos).
export function* bestChallengeGen(ch, startSt = null, done = []) {
  const start = setupChallenge(ch);
  const st0 = startSt || start;
  let best = { stars: -1, moves: [], tie: -Infinity };
  let n = 0;
  function* dfs(st, moves, infos) {
    if (best.stars === 3) return;
    if (st.over || st.hands[PLAYER].length === 0) {
      const ctx = { start, st, infos };
      const s = ch.grade(ctx);
      const tie = redScore(ctx) - blueScore(ctx) - 0.01 * redLost(ctx);
      if (s > best.stars || (s === best.stars && tie > best.tie)) best = { stars: s, moves: moves.slice(), tie };
      return;
    }
    for (const m of legalMoves(st, PLAYER)) {
      const r = applyMove(st, m);
      moves.push(m); infos.push(r.info);
      yield* dfs(r.st, moves, infos);
      moves.pop(); infos.pop();
      if (best.stars === 3) return;
      if (++n % 400 === 0) yield;
    }
  }
  yield* dfs(st0, [], done.slice());
  return best;
}

export function solveChallenge(ch) {
  const g = bestChallengeGen(ch);
  let x;
  do { x = g.next(); } while (!x.done);
  return x.value;
}

// Joga uma sequência e devolve a nota (testes)
export function gradeMoves(ch, moves) {
  let st = setupChallenge(ch);
  const start = st, infos = [];
  for (const m of moves) { const r = applyMove(st, m); st = r.st; infos.push(r.info); }
  return ch.grade({ start, st, infos });
}

// Quantas sequências dão cada nota (para medir se o desafio é fácil ou difícil)
export function starsSpread(ch) {
  const count = [0, 0, 0, 0];
  const start = setupChallenge(ch);
  (function dfs(st, infos) {
    if (st.over || st.hands[PLAYER].length === 0) { count[ch.grade({ start, st, infos })]++; return; }
    for (const m of legalMoves(st, PLAYER)) { const r = applyMove(st, m); infos.push(r.info); dfs(r.st, infos); infos.pop(); }
  })(start, []);
  return count;
}

export { CELLS };

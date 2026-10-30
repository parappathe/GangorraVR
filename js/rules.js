// Regras da Gangorra: peças, turnos, rodadas, pontos e o modo desafio. Sem navegador.
import { CELLS, resolve, torqueOf, tiltTarget, limitFor, weightOn, LIMIT } from './physics.js';

export const PLAYER = 0, CPU = 1;
export const HAND = [1, 1, 2, 2, 3, 3];     // peças de cada jogador por rodada
export const ROUNDS = 2;                    // cada um começa uma rodada

// Pontos de uma peça em cima do disco: peso × valor do anel (dentro 1, meio 2, borda 3).
export const pieceValue = (p) => p.w * CELLS[p.cell].mult;
export const scoreOf = (pieces, owner) => pieces.reduce((s, p) => s + (p.owner === owner ? pieceValue(p) : 0), 0);
export const weightOf = (pieces, owner) => pieces.reduce((s, p) => s + (p.owner === owner ? p.w : 0), 0);

// Estado de uma rodada (puro: dá para copiar e simular).
export function newRound({ starter = PLAYER, hands = null, pieces = [], solo = false } = {}) {
  return {
    pieces: pieces.map((p, k) => ({ id: p.id ?? k, owner: p.owner, w: p.w, cell: p.cell })),
    hands: hands ? [hands[0].slice(), hands[1].slice()] : [HAND.slice(), HAND.slice()],
    turn: starter, starter, solo, nextId: 100 + pieces.length,
    lost: [[], []],           // peças que caíram de cada jogador
    moves: 0, over: false,
  };
}

export const freeCells = (st) => {
  const used = new Set(st.pieces.map(p => p.cell));
  return CELLS.filter(c => !used.has(c.i)).map(c => c.i);
};
export const handWeights = (st, owner) => [...new Set(st.hands[owner])].sort((a, b) => a - b);

export function legalMoves(st, owner = st.turn) {
  if (st.over) return [];
  const out = [];
  const cells = freeCells(st);
  for (const w of handWeights(st, owner)) for (const cell of cells) out.push({ w, cell });
  return out;
}

export const isLegal = (st, m) => !st.over && st.hands[st.turn].includes(m.w) && CELLS[m.cell] && !st.pieces.some(p => p.cell === m.cell);

// Joga uma peça. Devolve um novo estado e o que aconteceu (inclinação antes/depois, quem caiu).
export function applyMove(st, m) {
  if (!isLegal(st, m)) throw new Error(`jogada inválida: peso ${m.w} na casa ${m.cell}`);
  const who = st.turn;
  const hands = [st.hands[0].slice(), st.hands[1].slice()];
  hands[who].splice(hands[who].indexOf(m.w), 1);
  const placed = { id: st.nextId, owner: who, w: m.w, cell: m.cell };
  const before = torqueOf(st.pieces);
  const res = resolve([...st.pieces, placed]);
  const lost = [st.lost[0].slice(), st.lost[1].slice()];
  for (const f of res.fallen) lost[f.owner].push(f);
  const other = 1 - who;
  let turn = st.solo ? who : (hands[other].length ? other : who);
  const over = hands[0].length === 0 && hands[1].length === 0;
  const next = { ...st, pieces: res.left, hands, turn, nextId: st.nextId + 1, lost, moves: st.moves + 1, over };
  const info = {
    by: who, placed, fallen: res.fallen, stuck: res.stuck,
    before: tiltTarget(before, limitFor(weightOn(st.pieces))), peak: tiltTarget(res.peak, res.peakLimit), after: tiltTarget(res.tau, res.limit),
    lostBy: [res.fallen.filter(f => f.owner === 0), res.fallen.filter(f => f.owner === 1)],
  };
  return { st: next, info };
}

// Prévia (PC e VR): o que acontece se puser esta peça nesta casa, sem jogar.
export function preview(st, m) {
  if (!isLegal(st, m)) return null;
  const { info } = applyMove(st, m);
  return info;
}

export const roundScore = (st) => [scoreOf(st.pieces, 0), scoreOf(st.pieces, 1)];

// Partida: ROUNDS rodadas, o primeiro a jogar alterna. Soma dos pontos; empate é empate.
export class Match {
  constructor({ starter = PLAYER, rounds = ROUNDS } = {}) {
    this.rounds = rounds;
    this.firstStarter = starter;
    this.results = [];         // [{ score: [a, b], lost: [n, n] }]
    this.round = newRound({ starter });
  }
  get index() { return this.results.length; }
  get turn() { return this.round.turn; }
  play(m) {
    const r = applyMove(this.round, m);
    this.round = r.st;
    return r.info;
  }
  get roundOver() { return this.round.over; }
  closeRound() {
    const st = this.round;
    this.results.push({ score: roundScore(st), lost: [st.lost[0].length, st.lost[1].length], weight: [weightOf(st.pieces, 0), weightOf(st.pieces, 1)] });
  }
  get over() { return this.results.length >= this.rounds; }
  nextRound() {
    const starter = (this.firstStarter + this.results.length) % 2;
    this.round = newRound({ starter });
  }
  total(team) { return this.results.reduce((s, r) => s + r.score[team], 0); }
  get winner() {
    if (!this.over) return null;
    const a = this.total(0), b = this.total(1);
    return a > b ? PLAYER : b > a ? CPU : -1;
  }
}

export { LIMIT };

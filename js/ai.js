// Adversários: cada um tem um jeito de escolher a jogada. Sem navegador.
import { CELLS, torqueOf, limitFor, weightOn } from './physics.js';
import { legalMoves, applyMove, scoreOf } from './rules.js';

export const OPPONENTS = [
  {
    id: 'cuidadoso', name: 'Dona Lurdes', title: 'Cuidadosa',
    desc: 'Mantém o disco em pé, foge da borda e quase nunca ataca',
    style: 'careful', noise: 1.2, blunder: 0.06, color: 0x6fa8dc, think: 1.2,
  },
  {
    id: 'arriscado', name: 'Zé Faísca', title: 'Arriscado',
    desc: 'Adora a borda e a peça pesada, derruba tudo que puder',
    style: 'risky', noise: 2.0, blunder: 0.04, color: 0xe08a3c, think: 0.9,
  },
  {
    id: 'mestre', name: 'Mestra Iara', title: 'Mestra',
    desc: 'Pensa duas jogadas à frente: a dela e a sua resposta',
    style: 'master', noise: 0.25, blunder: 0, color: 0x9a6fd0, think: 1.6,
  },
];
// robô do modo automático (joga pelo jogador): igual à mestra, sem erro
export const ROBOT = { id: 'robo', name: 'Robô', style: 'master', noise: 0, blunder: 0, think: 0.4 };

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

const handPot = (st, who) => st.hands[who].reduce((s, w) => s + w * 1.7, 0);

// Placar visto por "me": pontos em cima do disco mais o que ainda tem na mão.
export function evaluate(st, me) {
  const op = 1 - me;
  return scoreOf(st.pieces, me) - scoreOf(st.pieces, op) + handPot(st, me) - handPot(st, op);
}

// Quanto as minhas peças estão expostas: torque que falta para tombar para o lado delas.
function exposure(st, me) {
  const tau = torqueOf(st.pieces);
  const LIMIT = limitFor(weightOn(st.pieces) + 2);   // a próxima peça amolece o pino
  let risk = 0;
  for (const p of st.pieces) {
    if (p.owner !== me) continue;
    const c = CELLS[p.cell];
    if (c.r < 0.4) continue;
    const toward = (tau.x * c.x + tau.y * c.y) / c.r;      // torque que já puxa para o lado dela
    const margin = LIMIT - toward;                          // quanto falta (peso × distância)
    const threat = Math.max(0, 1 - margin / 2.6);           // uma peça 3 na borda vale ~2,6
    risk += threat * p.w * c.mult;
  }
  return risk;
}

function scoreCareful(st, me, m, r, info) {
  const op = 1 - me;
  let s = evaluate(st, me);
  s -= exposure(st, me) * 0.9;
  s -= Math.pow(info.after.frac, 2) * 4;
  if (CELLS[m.cell].ring === 2) s -= 1.5;            // não gosta da borda
  if (m.w === 3 && st.hands[me].length > 2) s -= 0.8; // guarda a pesada
  s += info.lostBy[op].length * 0.5;
  return s;
}

function scoreRisky(st, me, m, r, info) {
  const op = 1 - me;
  let s = evaluate(st, me);
  s += info.lostBy[op].reduce((a, f) => a + f.w * CELLS[f.cell].mult, 0) * 0.6; // adora derrubar
  if (CELLS[m.cell].ring === 2) s += 1.2;
  if (m.w === 3) s += 0.6;
  s -= exposure(st, me) * 0.15;
  return s;
}

// Mestra: para cada jogada, a melhor resposta do adversário (duas jogadas à frente).
function replyValue(st, me) {
  if (st.over) return evaluate(st, me);
  if (st.turn === me) return evaluate(st, me) - exposure(st, me) * 0.25;   // adversário sem peças
  let worst = Infinity;
  for (const m2 of legalMoves(st)) {
    const st2 = applyMove(st, m2).st;
    const v = evaluate(st2, me) - exposure(st2, me) * 0.25 + exposure(st2, 1 - me) * 0.25;
    if (v < worst) worst = v;
  }
  return worst;
}

// Escolha em passos (gerador): no navegador pensa alguns milissegundos por quadro.
export function* chooseMoveGen(st, who, opp, random = Math.random) {
  const moves = legalMoves(st, who);
  if (!moves.length) return null;
  const scored = [];
  let k = 0;
  for (const m of moves) {
    const { st: st1, info } = applyMove(st, m);
    let s;
    if (opp.style === 'master') s = replyValue(st1, who);
    else if (opp.style === 'risky') s = scoreRisky(st1, who, m, random, info);
    else s = scoreCareful(st1, who, m, random, info);
    s += gauss(random) * opp.noise;
    scored.push({ m, s });
    if (++k % (opp.style === 'master' ? 2 : 30) === 0) yield;
  }
  scored.sort((a, b) => b.s - a.s);
  // o arriscado ainda confere, nas melhores ideias dele, se o adversário não devolve na hora
  if (opp.style === 'risky' && !st.solo) {
    const top = scored.slice(0, 6);
    for (const c of top) {
      const st1 = applyMove(st, c.m).st;
      if (st1.over || st1.turn === who) continue;
      const base = evaluate(st1, who);
      let worst = 0;
      for (const m2 of legalMoves(st1)) worst = Math.min(worst, evaluate(applyMove(st1, m2).st, who) - base);
      c.s += worst * 0.7;
      yield;
    }
    top.sort((a, b) => b.s - a.s);
    scored.splice(0, top.length, ...top);
  }
  if (opp.blunder && random() < opp.blunder) {
    return scored[Math.min(scored.length - 1, 1 + Math.floor(random() * Math.min(8, scored.length - 1)))].m;
  }
  return scored[0].m;
}

export function chooseMove(st, who, opp, random = Math.random) {
  const g = chooseMoveGen(st, who, opp, random);
  let x;
  do { x = g.next(); } while (!x.done);
  return x.value;
}

// Joga uma rodada inteira entre dois estilos (testes e calibragem).
export function playRound(st, a, b, random) {
  let s = st;
  let falls = 0;
  while (!s.over) {
    const who = s.turn;
    const m = chooseMove(s, who, who === 0 ? a : b, random);
    const r = applyMove(s, m);
    falls += r.info.fallen.length;
    s = r.st;
  }
  return { st: s, falls };
}

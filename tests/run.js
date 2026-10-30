// Testes automáticos: node tests/run.js (ou npm test). Não tocam som e saem com código 1 se algo falhar.
import { CELLS, RINGS, LIMIT, limitFor, torqueOf, tiltTarget, resolve, stepTilt, fallPath, heightAt, TILT_LIMIT_DEG, TILT_STOP_DEG, SPRING } from '../js/physics.js';
import { newRound, legalMoves, applyMove, preview, scoreOf, Match, HAND, PLAYER, CPU } from '../js/rules.js';
import { OPPONENTS, ROBOT, rng, chooseMove, playRound, evaluate } from '../js/ai.js';
import { CHALLENGES, C, setupChallenge, solveChallenge, gradeMoves } from '../js/challenges.js';

let fails = 0, count = 0;
function ok(cond, msg) {
  count++;
  if (!cond) { fails++; console.log('  FALHOU:', msg); }
}
const P = (owner, w, ring, sector, id) => ({ id: id ?? Math.floor(Math.random() * 1e6), owner, w, cell: C(ring, sector) });
process.on('uncaughtException', (e) => { console.log('ERRO:', e); process.exit(1); });

console.log('Tabuleiro');
{
  ok(CELLS.length === RINGS.reduce((s, r) => s + r.n, 0) && CELLS.length === 30, `30 casas (${CELLS.length})`);
  ok(CELLS.every(c => Math.abs(Math.hypot(c.x, c.y) - c.r) < 1e-9 && c.r < 1), 'casas dentro do disco');
  let minD = Infinity;
  for (const a of CELLS) for (const b of CELLS) if (a !== b) minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y));
  ok(minD > 0.2, `casas não se encostam (menor distância ${minD.toFixed(2)})`);
  ok(C(2, 0) === 18 && Math.abs(CELLS[C(2, 3)].y - 0.86) < 1e-9 && CELLS[C(2, 9)].y < -0.8, 'setores da borda: 0 = direita, 3 = longe, 9 = perto');
}

console.log('Física da inclinação');
{
  ok(tiltTarget(torqueOf([])).deg === 0, 'disco vazio fica reto');
  const bal = [P(0, 2, 2, 0), P(1, 2, 2, 6)];
  ok(torqueOf(bal).m < 1e-9 && tiltTarget(torqueOf(bal)).deg < 1e-9, 'pesos iguais em lados opostos: reto');
  const one = [P(0, 2, 2, 3)];
  const t1 = tiltTarget(torqueOf(one), limitFor(2));
  ok(t1.y > 0 && Math.abs(t1.x) < 1e-9, 'inclina para o lado da peça (centro de massa)');
  const t3 = tiltTarget(torqueOf([P(0, 3, 2, 3)]), limitFor(2));
  ok(t3.deg > t1.deg, 'peça mais pesada inclina mais');
  const tin = tiltTarget(torqueOf([P(0, 2, 0, 1)]), limitFor(2));
  ok(tin.deg < t1.deg, 'mais perto do centro inclina menos');
  const mix = [P(0, 3, 2, 0), P(1, 1, 2, 3)];
  const tm = torqueOf(mix);
  const com = { x: (3 * CELLS[C(2, 0)].x + CELLS[C(2, 3)].x) / 4, y: (3 * CELLS[C(2, 0)].y + CELLS[C(2, 3)].y) / 4 };
  ok(Math.abs(Math.atan2(tm.y, tm.x) - Math.atan2(com.y, com.x)) < 1e-9, 'direção da inclinação = direção do centro de massa');
  ok(limitFor(20) < limitFor(5) && limitFor(0) === LIMIT, 'mais peso em cima: o pino aguenta menos torque');
  const tl = tiltTarget({ x: LIMIT * 0.5, y: 0, m: LIMIT * 0.5 }, LIMIT);
  ok(Math.abs(tl.deg - TILT_LIMIT_DEG / 2) < 1e-9, 'inclinação proporcional ao torque');
  ok(tiltTarget({ x: 9, y: 0, m: 9 }, LIMIT).deg === TILT_STOP_DEG, 'passou do limite: encosta no batente');
  ok(heightAt(1, 0, { x: 8, y: 0 }) < 0 && heightAt(-1, 0, { x: 8, y: 0 }) > 0, 'o lado da inclinação desce e o outro sobe');
  // mola: chega no alvo, balança pouco e não passa do batente
  const s = { x: 0, y: 0, vx: 0, vy: 0 };
  let peak = 0;
  for (let i = 0; i < 300; i++) { stepTilt(s, { x: 6, y: 0 }, 1 / 60); peak = Math.max(peak, s.x); }
  ok(Math.abs(s.x - 6) < 0.01 && Math.abs(s.vx) < 0.01, `mola chega no alvo (${s.x.toFixed(3)})`);
  ok(peak > 6 && peak < 6 * 1.2, `balanço pequeno (passa até ${peak.toFixed(2)}°)`);
  const s2 = { x: 0, y: 0, vx: 0, vy: 0 };
  let p2 = 0;
  for (let i = 0; i < 200; i++) { stepTilt(s2, { x: 0, y: TILT_STOP_DEG }, 1 / 60); p2 = Math.max(p2, Math.hypot(s2.x, s2.y)); }
  ok(p2 <= TILT_STOP_DEG + 1e-9, 'mola respeita o batente');
  const s3 = { x: 0, y: 0, vx: 0, vy: 0 }, s4 = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 30; i++) stepTilt(s3, { x: 5, y: 0 }, 1 / 30);
  for (let i = 0; i < 90; i++) stepTilt(s4, { x: 5, y: 0 }, 1 / 90);
  ok(Math.abs(s3.x - s4.x) < 0.05, 'mola igual com 30 ou 90 quadros por segundo');
  ok(SPRING.zeta > 0.4 && SPRING.zeta < 1, 'amortecimento suave');
}

console.log('Queda das peças');
{
  // abaixo do limite ninguém cai
  const calm = [P(1, 1, 2, 0, 1), P(1, 1, 2, 1, 2)];
  ok(resolve(calm).fallen.length === 0, 'abaixo do limite nada cai');
  // passou: a mais baixa (borda do lado da inclinação) cai primeiro
  const tip = [P(1, 2, 2, 0, 1), P(1, 1, 2, 1, 2), P(0, 3, 1, 0, 3)];
  const r = resolve(tip);
  ok(r.fallen.length >= 1 && r.fallen[0].id === 1, `cai a peça mais baixa primeiro (caiu ${r.fallen.map(f => f.id)})`);
  ok(r.tau.m <= limitFor(r.left.reduce((s, p) => s + p.w, 0)) + 1e-9, 'depois da queda o pino aguenta');
  ok(!r.left.some(p => p.id === 1) && r.left.some(p => p.id === 3), 'a do meio ficou, a da borda caiu');
  // anel de dentro nunca escorrega
  const inner = [P(0, 3, 0, 0, 1), P(0, 3, 0, 5, 2), P(0, 3, 1, 0, 3), P(0, 3, 2, 0, 4), P(0, 3, 2, 1, 5)];
  const ri = resolve(inner);
  ok(ri.fallen.length > 0 && !ri.fallen.some(f => CELLS[f.cell].ring === 0), 'peça do anel de dentro não escorrega');
  // reação em cadeia: várias caem de uma vez
  const chain = [P(1, 1, 2, 0, 1), P(1, 1, 2, 1, 2), P(1, 1, 2, 11, 3), P(1, 1, 1, 0, 4)];
  const before = resolve(chain);
  ok(before.fallen.length === 0, 'cadeia: começa parado');
  const rc = resolve([...chain, P(0, 3, 1, 11, 5)]);
  ok(rc.fallen.length >= 2, `cadeia: uma peça derruba várias (${rc.fallen.length})`);
  ok(rc.fallen.every((f, i) => i === 0 || f.dir), 'cada queda sabe para onde escorrega');
  // ordem: cada uma estava mais baixa que as que ficaram, na hora de cair
  // trajetória da queda: escorrega, sai pela borda e chega no chão, para fora
  const path = fallPath({ x: 0.86, y: 0 }, { x: 1, y: 0 }, { R: 0.42, h0: 1.0 });
  const last = path[path.length - 1];
  ok(path.some(p => p.phase === 'slide') && path.some(p => p.phase === 'fly'), 'queda: escorrega e depois voa');
  ok(Math.abs(last.z) < 1e-9 && last.x > 0.42 && last.t < 1.5, `chega no chão fora da mesa (x=${last.x.toFixed(2)} m em ${last.t.toFixed(2)} s)`);
  ok(path.every((p, i) => i === 0 || p.z <= path[i - 1].z + 1e-9), 'só desce');
}

console.log('Regras');
{
  const st = newRound({ starter: PLAYER });
  ok(st.hands[0].join() === HAND.join() && st.hands[1].join() === HAND.join(), 'cada um começa com 1, 1, 2, 2, 3 e 3');
  ok(legalMoves(st).length === 3 * 30, 'primeira jogada: 3 pesos × 30 casas');
  const a = applyMove(st, { w: 2, cell: C(2, 3) });
  ok(a.st.turn === CPU && a.st.hands[0].length === 5 && a.st.pieces.length === 1, 'jogou: passa a vez e sai da mão');
  let threw = false;
  try { applyMove(a.st, { w: 2, cell: C(2, 3) }); } catch { threw = true; }
  ok(threw, 'não deixa pôr em casa ocupada');
  threw = false;
  try { applyMove(newRound({ hands: [[1], [1]] }), { w: 3, cell: 0 }); } catch { threw = true; }
  ok(threw, 'não deixa jogar peça que não tem');
  ok(scoreOf([P(0, 2, 2, 0), P(0, 3, 1, 0), P(0, 1, 0, 0), P(1, 3, 2, 3)], 0) === 2 * 3 + 3 * 2 + 1, 'pontos: peso × anel (borda 3, meio 2, dentro 1)');
  // derrubar peça do adversário
  const st2 = newRound({ starter: PLAYER, pieces: [P(1, 2, 2, 0, 1), P(1, 1, 2, 1, 2)], hands: [[2], [1]] });
  const pv = preview(st2, { w: 2, cell: C(1, 0) });
  const b = applyMove(st2, { w: 2, cell: C(1, 0) });
  ok(b.info.lostBy[CPU].length >= 1 && b.st.lost[CPU].length === b.info.lostBy[CPU].length, `peso perto da azul derruba a azul (${b.info.lostBy[CPU].length})`);
  ok(pv && pv.fallen.length === b.info.fallen.length && st2.pieces.length === 2, 'prévia mostra o mesmo e não mexe no jogo');
  ok(b.info.peak.frac > 1 && b.info.after.frac <= 1 + 1e-9, 'passou do limite e voltou depois da queda');
  // fim da rodada
  let s = newRound({ starter: CPU });
  const r = rng(3);
  while (!s.over) s = applyMove(s, legalMoves(s)[Math.floor(r() * legalMoves(s).length)]).st;
  ok(s.moves === 12 && s.hands[0].length === 0 && s.hands[1].length === 0, 'rodada acaba quando as 12 peças foram jogadas');
  ok(s.pieces.length + s.lost[0].length + s.lost[1].length === 12, 'toda peça está no disco ou caiu');
  // partida
  const m = new Match({ starter: PLAYER });
  const order = [];
  while (!m.over) {
    order.push(m.round.starter);
    while (!m.roundOver) m.play(legalMoves(m.round)[0]);
    m.closeRound();
    if (!m.over) m.nextRound();
  }
  ok(order.join() === '0,1', 'partida: 2 rodadas, cada um começa uma');
  ok(m.winner !== null && m.total(0) === m.results[0].score[0] + m.results[1].score[0], 'soma das rodadas');
  // modo desafio: só o jogador joga
  const ch = setupChallenge(CHALLENGES[1]);
  const c1 = applyMove(ch, legalMoves(ch)[0]).st;
  ok(c1.turn === PLAYER && !c1.over, 'desafio: a vez continua sua');
}

console.log('IA');
{
  const r = rng(7);
  // situação em que dá para derrubar 2 azuis da borda: as três IAs acham alguma jogada
  for (const o of OPPONENTS) {
    const st = newRound({ starter: CPU, pieces: [P(0, 2, 2, 0, 1), P(0, 1, 2, 1, 2)], hands: [[1], [3]] });
    const m = chooseMove(st, CPU, { ...o, noise: 0, blunder: 0 }, r);
    ok(m && legalMoves(st, CPU).some(x => x.w === m.w && x.cell === m.cell), `${o.name} faz jogada válida`);
  }
  const st = newRound({ starter: CPU, pieces: [P(0, 2, 2, 0, 1), P(0, 1, 2, 1, 2), P(1, 1, 2, 6, 3)], hands: [[1], [2, 1]] });
  const mm = chooseMove(st, CPU, { ...OPPONENTS[2], noise: 0 }, r);
  const res = applyMove(st, mm);
  ok(res.info.lostBy[PLAYER].length >= 1 && res.info.lostBy[CPU].length === 0, `mestra derruba as suas sem perder as dela (${res.info.lostBy[PLAYER].length} x ${res.info.lostBy[CPU].length})`);
  const careful = chooseMove(newRound({ starter: CPU }), CPU, { ...OPPONENTS[0], noise: 0, blunder: 0 }, r);
  ok(CELLS[careful.cell].ring < 2, 'cuidadosa não começa na borda');
  const risky = chooseMove(newRound({ starter: CPU }), CPU, { ...OPPONENTS[1], noise: 0, blunder: 0 }, r);
  ok(CELLS[risky.cell].ring === 2, 'arriscado começa na borda');
  // a mestra não perde peça boba: nunca escolhe jogada que derruba a própria peça quando há outra
  let selfLoss = 0;
  for (let g = 0; g < 4; g++) {
    let s = newRound({ starter: g % 2 });
    while (!s.over) {
      const who = s.turn;
      const m = chooseMove(s, who, who === CPU ? OPPONENTS[2] : OPPONENTS[1], r);
      const x = applyMove(s, m);
      if (who === CPU && x.info.lostBy[CPU].length && legalMoves(s).some(m2 => applyMove(s, m2).info.lostBy[CPU].length === 0)) selfLoss++;
      s = x.st;
    }
  }
  ok(selfLoss <= 2, `mestra quase nunca derruba a própria peça sem precisar (${selfLoss} vezes em 4 rodadas)`);
  // tempo de pensar
  const t0 = performance.now();
  chooseMove(newRound({ starter: CPU }), CPU, OPPONENTS[2], r);
  const ms = performance.now() - t0;
  ok(ms < 400, `mestra pensa rápido (${ms.toFixed(0)} ms na primeira jogada)`);
  ok(evaluate(newRound(), 0) === 0, 'avaliação começa empatada');
}

console.log('Mestra contra cuidadosa');
{
  const r = rng(2026);
  let wins = 0, losses = 0;
  const N = 12, lines = [];
  for (let g = 0; g < N; g++) {
    let a = 0, b = 0;
    for (let rd = 0; rd < 2; rd++) {
      const res = playRound(newRound({ starter: (g + rd) % 2 }), OPPONENTS[2], OPPONENTS[0], r);
      a += scoreOf(res.st.pieces, 0); b += scoreOf(res.st.pieces, 1);
    }
    if (a > b) wins++; else if (b > a) losses++;
    lines.push(`${a}x${b}`);
  }
  console.log(`  ${OPPONENTS[2].name} ${wins} x ${losses} ${OPPONENTS[0].name}  (${lines.join(' ')})`);
  ok(wins > N / 2, `mestra vence a maioria (${wins} de ${N})`);
  // e o arriscado derruba mais peças que a cuidadosa
  let fr = 0, fc = 0;
  for (let g = 0; g < 6; g++) {
    fr += playRound(newRound({ starter: g % 2 }), OPPONENTS[1], OPPONENTS[1], r).falls;
    fc += playRound(newRound({ starter: g % 2 }), OPPONENTS[0], OPPONENTS[0], r).falls;
  }
  console.log(`  quedas por rodada: arriscado x arriscado ${(fr / 6).toFixed(1)}, cuidadosa x cuidadosa ${(fc / 6).toFixed(1)}`);
  ok(fr > fc, 'partida com o arriscado tem mais quedas');
}

console.log('Desafios');
{
  for (const [i, ch] of CHALLENGES.entries()) {
    const st = setupChallenge(ch);
    ok(resolve(st.pieces).fallen.length === 0, `desafio ${i + 1}: posição inicial parada`);
    ok(new Set(ch.pieces.map(p => p.cell)).size === ch.pieces.length, `desafio ${i + 1}: sem peças na mesma casa`);
    ok(ch.goal && ch.desc && ch.hand.length >= 1 && ch.hand.length <= 3, `desafio ${i + 1}: tem texto e 1 a 3 peças`);
    const t0 = performance.now();
    const best = solveChallenge(ch);
    const ms = performance.now() - t0;
    const again = gradeMoves(ch, best.moves);
    console.log(`  ${i + 1}. ${ch.name}: ${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)}  ${best.moves.map(m => `peso ${m.w} na casa ${m.cell}`).join(', ')}  (${ms.toFixed(0)} ms)`);
    ok(best.stars === 3 && again === 3, `robô tira 3 estrelas no desafio ${i + 1}`);
    ok(gradeMoves(ch, firstMoves(ch)) < 3, `desafio ${i + 1}: jogar na primeira casa livre não dá 3 estrelas`);
  }
}
function firstMoves(ch) {
  let st = setupChallenge(ch);
  const moves = [];
  while (st.hands[PLAYER].length) { const m = legalMoves(st)[0]; moves.push(m); st = applyMove(st, m).st; }
  return moves;
}

// Fumaça do main.js: carrega o jogo inteiro no Node com um navegador falso e joga sozinho.
console.log('Fumaça do main.js');
{
  const { smoke } = await import('./smoke.js');
  try {
    const out = await smoke();
    for (const [cond, msg] of out) ok(cond, msg);
  } catch (e) {
    ok(false, `main.js quebrou: ${e.stack || e}`);
  }
}

console.log(`\n${count - fails} de ${count} passaram`);
if (fails) { console.log(`${fails} FALHARAM`); process.exit(1); }
console.log('Tudo certo');
process.exit(0);

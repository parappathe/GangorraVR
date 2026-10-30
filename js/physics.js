// Física do disco de equilíbrio: casas, torque, inclinação, quem escorrega e a queda das peças.
// Sem navegador e sem Three.js (os testes rodam no Node).
//
// Coordenadas do disco (raio 1): x = direita de quem joga, y = para o lado do adversário.
// O jogador fica em y < 0 (perto) e o computador em y > 0 (longe).

export const RINGS = [
  { r: 0.30, n: 6, off: 30, mult: 1 },   // anel de dentro: seguro, vale 1x
  { r: 0.58, n: 12, off: 15, mult: 2 },  // anel do meio: vale 2x
  { r: 0.86, n: 12, off: 0, mult: 3 },   // borda: vale 3x, mas é a primeira a escorregar
];

export const CELLS = [];
RINGS.forEach((ring, ri) => {
  for (let k = 0; k < ring.n; k++) {
    const a = (ring.off + k * 360 / ring.n) * Math.PI / 180;
    CELLS.push({ i: CELLS.length, ring: ri, sector: k, r: ring.r, a, x: ring.r * Math.cos(a), y: ring.r * Math.sin(a), mult: ring.mult });
  }
});
export const CELL_R = 0.12;          // raio de uma casa (para achar a casa mais perto da mão/mouse)

// Torque (peso × distância) que o pino aguenta antes de tombar. O pino tem uma mola: com mais
// peso em cima, o conjunto fica mais mole (o peso alto empurra para tombar), então o limite cai.
export const LIMIT = 3.5;            // limite com o disco vazio
export const SOFTEN = 0.07;          // quanto o limite cai por unidade de peso em cima do disco
export const LIMIT_MIN = 1.2;
export const weightOn = (pieces) => pieces.reduce((s, p) => s + p.w, 0);
export const limitFor = (weight) => Math.max(LIMIT_MIN, LIMIT - SOFTEN * weight);
export const SLIDE_MIN = 0.35;       // só escorrega peça que está a mais que isto do centro, no lado baixo
export const TILT_LIMIT_DEG = 8;     // inclinação do disco quando o torque chega no limite
export const TILT_STOP_DEG = 10;     // batente: o disco não passa disto

export const torqueOf = (pieces) => {
  let x = 0, y = 0;
  for (const p of pieces) { const c = CELLS[p.cell]; x += p.w * c.x; y += p.w * c.y; }
  return { x, y, m: Math.hypot(x, y) };
};

// Inclinação que o disco procura: vetor (x, y) em graus, apontando para o lado que desce.
// Proporcional ao torque até o limite; passou do limite, o disco encosta no batente.
export function tiltTarget(tau, limit = LIMIT) {
  if (tau.m < 1e-9) return { x: 0, y: 0, deg: 0, frac: 0, limit };
  const frac = tau.m / limit;
  const deg = frac <= 1 ? frac * TILT_LIMIT_DEG : TILT_STOP_DEG;
  return { x: tau.x / tau.m * deg, y: tau.y / tau.m * deg, deg, frac, limit };
}

// Altura de cada ponto do disco com uma inclinação (metros, para um disco de raio R metros).
export function heightAt(x, y, tilt, R = 1) {
  const deg = Math.hypot(tilt.x, tilt.y);
  if (deg < 1e-9) return 0;
  const dx = tilt.x / deg, dy = tilt.y / deg;
  return -(x * dx + y * dy) * R * Math.tan(deg * Math.PI / 180);
}

// Passou do limite: as peças mais baixas escorregam, uma de cada vez (a mais baixa primeiro),
// até o pino aguentar de novo. Devolve as peças que ficaram e as que caíram, em ordem.
export function resolve(pieces) {
  let left = pieces.slice();
  const fallen = [];
  const peak = torqueOf(left);
  for (let guard = 0; guard < 64; guard++) {
    const tau = torqueOf(left);
    if (tau.m <= limitFor(weightOn(left)) + 1e-9) break;
    const dx = tau.x / tau.m, dy = tau.y / tau.m;
    // a mais baixa escorrega primeiro; empate: a mais leve (segura menos), depois a mais antiga
    let best = null, bestProj = -Infinity;
    for (const p of left) {
      const c = CELLS[p.cell];
      const proj = c.x * dx + c.y * dy;
      if (proj <= SLIDE_MIN) continue;
      const tie = best && Math.abs(proj - bestProj) < 1e-9;
      if (!best || (!tie && proj > bestProj) || (tie && (p.w < best.w || (p.w === best.w && p.id < best.id)))) { best = p; bestProj = proj; }
    }
    if (!best) break;   // nada mais escorrega: o disco fica apoiado no batente
    fallen.push({ ...best, dir: { x: dx, y: dy } });
    left = left.filter(p => p !== best);
  }
  const tau = torqueOf(left);
  return { left, fallen, peak, peakLimit: limitFor(weightOn(pieces)), tau, limit: limitFor(weightOn(left)), stuck: tau.m > limitFor(weightOn(left)) + 1e-9 };
}

// Mola da inclinação (animação suave, com um balanço pequeno). state = { x, y, vx, vy } em graus.
export const SPRING = { w: 7.5, zeta: 0.62 };
export function stepTilt(state, target, dt) {
  const { w, zeta } = SPRING;
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const ax = w * w * (target.x - state.x) - 2 * zeta * w * state.vx;
    const ay = w * w * (target.y - state.y) - 2 * zeta * w * state.vy;
    state.vx += ax * h; state.vy += ay * h;
    state.x += state.vx * h; state.y += state.vy * h;
    // batente: não deixa passar do máximo
    const d = Math.hypot(state.x, state.y);
    if (d > TILT_STOP_DEG) {
      state.x *= TILT_STOP_DEG / d; state.y *= TILT_STOP_DEG / d;
      const rv = (state.vx * state.x + state.vy * state.y) / TILT_STOP_DEG;
      if (rv > 0) { state.vx -= rv * state.x / TILT_STOP_DEG * 1.3; state.vy -= rv * state.y / TILT_STOP_DEG * 1.3; }
    }
  }
  return state;
}

// Queda de uma peça: escorrega pela rampa do disco até sair da borda e cai até o chão.
// Tudo em metros, no referencial da mesa (z para cima). Devolve a posição a cada passo.
// start = { x, y } no disco (raio 1), dir = direção da descida, R = raio do disco, h0 = altura do disco.
export const G = 9.81;
export function fallPath(start, dir, { R = 0.42, h0 = 1.0, deg = TILT_STOP_DEG, mu = 0.18, dt = 1 / 120, floor = 0 } = {}) {
  const th = deg * Math.PI / 180;
  const a = Math.max(0.6, G * (Math.sin(th) - mu * Math.cos(th)) + 1.2); // empurrãozinho do tombo
  let s = 0, v = 0;
  const r0 = start.x * dir.x + start.y * dir.y;           // já começa um pouco para fora
  const lat = { x: start.x - dir.x * r0, y: start.y - dir.y * r0 };
  const pts = [];
  let t = 0;
  // 1) escorrega no disco até a borda
  while (true) {
    const r = r0 + s / R;
    if (Math.hypot(lat.x + dir.x * r, lat.y + dir.y * r) >= 1.0 || t > 3) break;
    const z = h0 - (r * R) * Math.sin(th);
    pts.push({ t, x: (lat.x + dir.x * r) * R, y: (lat.y + dir.y * r) * R, z, phase: 'slide' });
    v += a * dt; s += v * dt; t += dt;
  }
  // 2) voa: sai da borda com a velocidade da rampa e cai
  const last = pts.length ? pts[pts.length - 1] : { x: start.x * R, y: start.y * R, z: h0 };
  let px = last.x, py = last.y, pz = last.z;
  let vx = dir.x * v * Math.cos(th) + dir.x * 0.25, vy = dir.y * v * Math.cos(th) + dir.y * 0.25, vz = -v * Math.sin(th);
  while (pz > floor && t < 6) {
    vz -= G * dt;
    px += vx * dt; py += vy * dt; pz += vz * dt; t += dt;
    pts.push({ t, x: px, y: py, z: Math.max(floor, pz), phase: 'fly' });
  }
  return pts;
}

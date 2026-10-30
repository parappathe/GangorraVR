// Liga as regras, a física e a IA à tela, ao Quest (controles e mãos) e ao mouse/teclado.
import * as THREE from '../vendor/three/three.module.js';
import { CELLS, CELL_R, TILT_STOP_DEG, stepTilt, tiltTarget, torqueOf, limitFor, weightOn, fallPath } from './physics.js';
import { Match, applyMove, preview, scoreOf, weightOf, PLAYER, CPU } from './rules.js';
import { OPPONENTS, ROBOT, rng, chooseMoveGen } from './ai.js';
import { CHALLENGES, setupChallenge, bestChallengeGen } from './challenges.js';
import { buildWorld, TABLE, DISC, TROUGH, PIECE, TRAY_R, trayAngle } from './scene.js';
import { Panel, Label } from './ui.js';
import { Sfx } from './audio.js';
import { loadSave, storeSave } from './save.js';

const save = loadSave();
const sfx = new Sfx();
sfx.on = save.sound;
const IS_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent || '');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const PIN_H = DISC.h - TABLE.top;
const VR_STAND = { x: TABLE.x, z: TABLE.z + 0.78 };   // onde a cabeça fica no VR (de frente para a mesa)
const GRAB_DIST = 0.085;                               // mão a até 8,5 cm da peça da bandeja pega
const TABLE_CENTER = new THREE.Vector3(TABLE.x, DISC.h, TABLE.z);

// ---------- Render e cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !IS_QUEST });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_QUEST ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const world = buildWorld(renderer);
const { scene } = world;
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.03, 40);
rig.add(camera);
const UP = new THREE.Vector3(0, 1, 0);

const panel = new Panel(0.9);
const fpsLabel = new Label(0.12);
fpsLabel.mesh.position.set(0.16, -0.14, -0.6);
fpsLabel.mesh.visible = false;
camera.add(fpsLabel.mesh);
// placa de status do VR (acima da mesa, do lado do adversário) e prévia perto da mão
const statusLabel = new Label(0.62, 1024, 200);
statusLabel.mesh.position.set(TABLE.x, 1.62, TABLE.z - 0.35);
statusLabel.mesh.rotation.x = -0.12;
statusLabel.mesh.visible = false;
scene.add(statusLabel.mesh);
const previewLabel = new Label(0.3, 768, 160);
previewLabel.mesh.visible = false;
scene.add(previewLabel.mesh);

// ---------- Estado do jogo ----------
let app = 'menu';            // 'menu' | 'play' | 'paused'
let mode = 'match';          // 'match' | 'challenge'
let match = null;
let ch = null;               // { i, st, start, infos, plan }
let oppIndex = 0;
let phase = 'idle';          // 'intro' | 'turn' | 'think' | 'anim' | 'roundEnd' | 'over'
let time = 0;
let msg = null;              // aviso { text, t }
let random = rng((Date.now() % 100000) + 1);
let selectedW = null;        // peso escolhido no PC
let hoverCell = -1;
let held = null;             // peça segurada no VR { entry, w, mesh, cell }
let thinker = null;
let thinkT = 0;
let chResult = null;
const opponent = () => OPPONENTS[oppIndex];
const cur = () => (mode === 'match' ? match?.round : ch?.st);

// Visual das peças
const boardMeshes = new Map();   // id → mesh em cima do disco
let trayMeshes = [];
const flying = [];               // peças em animação (indo para a casa ou caindo)
const timers = [];               // { at, fn }
const later = (sec, fn) => timers.push({ at: time + sec, fn });
const tiltState = { x: 0, y: 0, vx: 0, vy: 0 };
let tiltGoal = { x: 0, y: 0 };
let spinYaw = 0;

function cellLocal(cell, out = new THREE.Vector3()) {
  const c = CELLS[cell];
  return out.set(c.x * DISC.R, 0, -c.y * DISC.R);
}
function clearBoard() {
  for (const m of boardMeshes.values()) m.parent?.remove(m);
  boardMeshes.clear();
  for (const f of flying) f.mesh.parent?.remove(f.mesh);
  flying.length = 0;
  while (world.fallenGroup.children.length) world.fallenGroup.remove(world.fallenGroup.children[0]);
  timers.length = 0;
}
function syncBoard(st) {
  const ids = new Set(st.pieces.map(p => p.id));
  for (const [id, m] of boardMeshes) if (!ids.has(id)) { m.parent?.remove(m); boardMeshes.delete(id); }
  for (const p of st.pieces) {
    if (boardMeshes.has(p.id)) continue;
    const m = world.makePiece(p.owner, p.w);
    cellLocal(p.cell, m.position);
    m.rotation.y = random() * Math.PI * 2;
    world.piecesGroup.add(m);
    boardMeshes.set(p.id, m);
  }
}
function setTiltGoalFrom(pieces) {
  const t = tiltTarget(torqueOf(pieces), limitFor(weightOn(pieces)));
  tiltGoal = { x: t.x, y: t.y };
  return t;
}
function applyTiltVisual(state, obj) {
  const deg = Math.hypot(state.x, state.y);
  if (deg < 1e-6) { obj.quaternion.identity(); return; }
  const dx = state.x / deg, dy = state.y / deg;
  obj.quaternion.setFromAxisAngle(new THREE.Vector3(-dy, 0, -dx).normalize(), deg * Math.PI / 180);
}

// Bandejas: as peças que ainda estão na mão de cada um (menos a que está na mão do jogador)
function syncTrays() {
  for (const m of trayMeshes) m.parent?.remove(m);
  trayMeshes = [];
  const st = cur();
  if (!st || app === 'menu') return;
  for (const team of [PLAYER, CPU]) {
    const hand = st.hands[team].slice().sort((a, b) => a - b);
    if (team === PLAYER && held) hand.splice(hand.indexOf(held.w), 1);
    if (team === PLAYER && pendingTray != null) hand.splice(hand.indexOf(pendingTray), 1);
    hand.forEach((w, k) => {
      const m = world.makePiece(team, w);
      const a = trayAngle(team, k);
      m.position.set(Math.cos(a) * TRAY_R, TABLE.top + 0.006, -Math.sin(a) * TRAY_R);
      if (team === PLAYER && selectedW === w && !trayMeshes.some(t => t.userData.team === PLAYER && t.userData.sel)) { m.position.y += 0.035; m.userData.sel = true; }
      m.userData.tray = true;
      world.tableRoot.add(m);
      trayMeshes.push(m);
    });
  }
}
let pendingTray = null;   // peça que já saiu da bandeja e está voando (não mostrar duas vezes)

// ---------- Partidas e desafios ----------
function newMatch(i) {
  mode = 'match';
  oppIndex = clamp(i, 0, OPPONENTS.length - 1);
  const o = opponent();
  world.avatar.setStyle(o.style, o.color);
  match = new Match({ starter: random() < 0.5 ? PLAYER : CPU });
  ch = null;
  startRound();
  msg = { text: match.round.starter === PLAYER ? 'Sorteio: você começa.' : `Sorteio: ${o.name} começa.`, t: 3.5 };
}
function startRound() {
  app = 'play';
  panel.hide();
  clearBoard();
  tiltState.x = tiltState.y = tiltState.vx = tiltState.vy = 0;
  syncBoard(cur());
  setTiltGoalFrom(cur().pieces);
  held = null; selectedW = null; pendingTray = null;
  placeForPlay();
  beginTurn();
}
function newChallenge(i, skipIntro = false) {
  mode = 'challenge';
  const c = CHALLENGES[clamp(i, 0, CHALLENGES.length - 1)];
  const st = setupChallenge(c);
  ch = { i: clamp(i, 0, CHALLENGES.length - 1), st, start: st, infos: [], plan: null };
  match = null;
  world.avatar.setStyle('master', 0x8a6a4a);
  app = 'play';
  clearBoard();
  tiltState.x = tiltState.y = tiltState.vx = tiltState.vy = 0;
  syncBoard(st);
  setTiltGoalFrom(st.pieces);
  held = null; selectedW = null; pendingTray = null;
  msg = null;
  chResult = null;
  placeForPlay();
  if (skipIntro || dev.autoplay) { panel.hide(); beginTurn(); } else { phase = 'intro'; showScreen('chIntro'); }
  syncTrays();
}

function beginTurn() {
  const st = cur();
  thinker = null;
  hoverCell = -1;
  if (st.over || (mode === 'challenge' && st.hands[PLAYER].length === 0)) { endOfRound(); return; }
  if (st.turn === PLAYER) {
    phase = 'turn';
    thinkT = 0;
    if (selectedW != null && !st.hands[PLAYER].includes(selectedW)) selectedW = null;
  } else {
    phase = 'think';
    thinkT = 0;
    world.avatar.state.thinking = true;
    thinker = { gen: chooseMoveGen(st, CPU, opponent(), random), done: false, result: null };
  }
  syncTrays();
  updateHint();
}

function pumpThinker(budgetMs = 6) {
  if (!thinker || thinker.done) return;
  const t0 = performance.now();
  do {
    const x = thinker.gen.next();
    if (x.done) { thinker.done = true; thinker.result = x.value; return; }
  } while (performance.now() - t0 < budgetMs);
}

// Joga uma peça (de quem estiver na vez) e monta a animação: voa para a casa, o disco inclina,
// as que passaram do limite escorregam e caem, uma por vez.
function doMove(m, from = {}) {
  const st = cur();
  if (!st || st.over || phase === 'anim') return false;
  if (!st.hands[st.turn].includes(m.w) || st.pieces.some(p => p.cell === m.cell)) return false;
  const who = st.turn;
  const oldPieces = st.pieces.slice();
  const startW = from.pos ? from.pos.clone() : trayWorldPos(who, m.w);
  let info;
  if (mode === 'match') info = match.play(m);
  else { const r = applyMove(ch.st, m); ch.st = r.st; ch.infos.push(r.info); info = r.info; }
  phase = 'anim';
  selectedW = null; hoverCell = -1;
  hidePreview();
  // peça nova: sai da bandeja (ou da mão no VR) e voa para a casa
  const mesh = world.makePiece(who, m.w);
  mesh.rotation.y = random() * Math.PI * 2;
  world.piecesGroup.add(mesh);
  world.piecesGroup.worldToLocal(startW);
  mesh.position.copy(startW);
  boardMeshes.set(info.placed.id, mesh);
  pendingTray = null;
  syncTrays();
  const dest = cellLocal(m.cell);
  const dur = from.pos ? 0.22 : who === CPU ? 0.7 : 0.45;
  flying.push({ mesh, kind: 'place', t0: time, dur, a: startW.clone(), b: dest, arc: from.pos ? 0.02 : 0.16 });
  if (who === CPU) world.avatar.state.thinking = false;
  let t = dur;
  later(t, () => {
    sfx.knock(m.w);
    if (renderer.xr.isPresenting) pulse(held?.entry?.side || lastHandSide, 0.35, 30);
    // o disco procura a nova inclinação; passou do limite, vai até o batente
    const peak = info.peak;
    tiltGoal = { x: peak.x, y: peak.y };
    sfx.creak(Math.min(1, peak.frac));
  });
  t += 0.45;
  if (info.fallen.length) {
    later(t - 0.15, () => { sfx.clack(); if (renderer.xr.isPresenting) pulseAll(0.6, 60); });
    const remaining = [...oldPieces, info.placed];
    info.fallen.forEach((f, k) => {
      later(t + k * 0.32, () => {
        startFall(f);
        const idx = remaining.findIndex(p => p.id === f.id);
        if (idx >= 0) remaining.splice(idx, 1);
        const tt = tiltTarget(torqueOf(remaining), limitFor(weightOn(remaining)));
        if (k < info.fallen.length - 1) tiltGoal = { x: tt.x, y: tt.y };
        else later(0.35, () => { tiltGoal = { x: info.after.x, y: info.after.y }; sfx.creak(0.4); });
      });
    });
    t += info.fallen.length * 0.32 + 0.9;
  } else t += 0.35;
  later(t, () => afterMove(info));
  return true;
}
function trayWorldPos(team, w) {
  const st = cur();
  const hand = st.hands[team].slice().sort((a, b) => a - b);
  let k = hand.indexOf(w);
  if (k < 0) k = 0;
  const a = trayAngle(team, k);
  return world.tableRoot.localToWorld(new THREE.Vector3(Math.cos(a) * TRAY_R, TABLE.top + 0.006, -Math.sin(a) * TRAY_R));
}

function startFall(f) {
  const mesh = boardMeshes.get(f.id);
  if (!mesh) return;
  boardMeshes.delete(f.id);
  world.fallenGroup.attach(mesh);    // sai do disco inclinado, guarda a posição no mundo
  const c = CELLS[f.cell];
  const deg = Math.max(4, Math.hypot(tiltState.x, tiltState.y));
  const path = fallPath({ x: c.x, y: c.y }, f.dir, { R: DISC.R, h0: PIN_H + DISC.t, deg, floor: -TROUGH.depth + 0.001 });
  // a peça cai na calha: limita o raio do ponto final
  const pr = PIECE[f.w].r;
  for (const p of path) {
    const r = Math.hypot(p.x, p.y);
    const maxR = TROUGH.r1 - pr - 0.004;
    if (p.phase === 'fly' && r > maxR) { p.x *= maxR / r; p.y *= maxR / r; }
  }
  const spinAxis = new THREE.Vector3(f.dir.y, 0, f.dir.x).normalize();   // tomba para fora
  flying.push({ mesh, kind: 'fall', t0: time, path, w: f.w, owner: f.owner, spinAxis, q0: mesh.quaternion.clone(), p0: mesh.position.clone(), landed: false });
  sfx.slide();
  if (f.owner === PLAYER) world.avatar.react(1); else world.avatar.react(-1);
}

function updateFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    const e = time - f.t0;
    if (f.kind === 'place') {
      const k = clamp(e / f.dur, 0, 1);
      const s = k * k * (3 - 2 * k);
      f.mesh.position.lerpVectors(f.a, f.b, s);
      f.mesh.position.y += Math.sin(Math.PI * k) * f.arc;
      if (k >= 1) { f.mesh.position.copy(f.b); flying.splice(i, 1); }
    } else {
      const P = f.path;
      const last = P[P.length - 1];
      if (e >= last.t) {
        f.mesh.position.set(last.x, last.z, -last.y);
        if (!f.landed) { f.landed = true; sfx.thud(f.w); }
        flying.splice(i, 1);
        continue;
      }
      let j = 0;
      while (j < P.length - 1 && P[j + 1].t < e) j++;
      const a = P[j], b = P[Math.min(P.length - 1, j + 1)];
      const u = b.t > a.t ? (e - a.t) / (b.t - a.t) : 0;
      const pos = new THREE.Vector3(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, -(a.y + (b.y - a.y) * u));
      if (e < 0.08) pos.lerp(f.p0, 1 - e / 0.08);   // emenda com a posição em cima do disco inclinado
      f.mesh.position.copy(pos);
      if (a.phase === 'fly') {
        const flyT = e - (P.find(p => p.phase === 'fly')?.t ?? e);
        f.mesh.quaternion.copy(f.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(f.spinAxis, Math.min(1.4, flyT * 9)));
      }
    }
  }
}

function afterMove(info) {
  const st = cur();
  const lostP = info.lostBy[PLAYER], lostC = info.lostBy[CPU];
  const val = (l) => l.reduce((s, p) => s + p.w * CELLS[p.cell].mult, 0);
  const otherName = mode === 'match' ? opponent().name : 'as azuis';
  if (lostP.length || lostC.length) {
    const parts = [];
    if (lostC.length) parts.push(`${lostC.length} azu${lostC.length > 1 ? 'is' : 'l'} caiu${lostC.length > 1 ? 'ram' : ''} (−${val(lostC)})`);
    if (lostP.length) parts.push(`${lostP.length} sua${lostP.length > 1 ? 's' : ''} caiu${lostP.length > 1 ? 'ram' : ''} (−${val(lostP)})`);
    msg = { text: `${info.by === PLAYER ? 'Você passou do limite' : `${otherName} passou do limite`}: ${parts.join(', ')}.`, t: 4 };
    if (lostC.length > lostP.length) sfx.good(); else sfx.bad();
  } else {
    msg = { text: info.after.frac > 0.8 ? 'O disco está quase no limite!' : '', t: 2.5 };
  }
  syncBoard(st);
  if (mode === 'challenge' && st.hands[PLAYER].length === 0) { later(0.4, () => endOfRound()); phase = 'anim'; return; }
  if (st.over) { later(0.4, () => endOfRound()); phase = 'anim'; return; }
  beginTurn();
}

function endOfRound() {
  if (mode === 'challenge') { finishChallenge(); return; }
  match.closeRound();
  phase = match.over ? 'over' : 'roundEnd';
  const r = match.results[match.results.length - 1].score;
  if (match.over) {
    save.games[oppIndex]++;
    if (match.winner === PLAYER) { save.wins[oppIndex]++; sfx.fanfare(); world.avatar.react(-1); } else if (match.winner === CPU) { sfx.bad(); world.avatar.react(1); }
    storeSave(save);
    showScreen('over');
  } else {
    if (r[0] > r[1]) sfx.good(); else if (r[1] > r[0]) sfx.bad();
    showScreen('roundEnd');
  }
  timerAuto = 2.5;
  updateHint();
}
let timerAuto = 0;
function nextRound() {
  match.nextRound();
  startRound();
  msg = { text: match.round.starter === PLAYER ? 'Rodada 2: você começa.' : `Rodada 2: ${opponent().name} começa.`, t: 3 };
}

function finishChallenge() {
  phase = 'over';
  const c = CHALLENGES[ch.i];
  const stars = c.grade({ start: ch.start, st: ch.st, infos: ch.infos });
  chResult = { stars };
  const prev = save.ch[ch.i] || 0;
  save.ch[ch.i] = Math.max(prev, stars);
  storeSave(save);
  for (let k = 0; k < stars; k++) later(0.25 * k, () => sfx.star(k));
  if (stars === 3) later(0.8, () => sfx.fanfare());
  timerAuto = 2.5;
  showScreen('chResult');
}

function goMenu() {
  app = 'menu';
  phase = 'idle';
  match = null; ch = null;
  held = null; selectedW = null; pendingTray = null;
  clearBoard();
  // disco de enfeite no menu
  const demo = [
    { id: 1, owner: 0, w: 3, cell: 20 }, { id: 2, owner: 1, w: 2, cell: 26 }, { id: 3, owner: 0, w: 1, cell: 9 },
    { id: 4, owner: 1, w: 3, cell: 15 }, { id: 5, owner: 1, w: 1, cell: 1 }, { id: 6, owner: 0, w: 2, cell: 23 },
  ];
  syncBoard({ pieces: demo });
  setTiltGoalFrom(demo);
  world.avatar.setStyle('master', 0x9a6fd0);
  world.avatar.state.thinking = false;
  syncTrays();
  if (renderer.xr.isPresenting) placeRig(VR_STAND.x, VR_STAND.z);
  showScreen('main');
  updateHint();
}

function togglePause() {
  if (app === 'play' && !panel.visible) { app = 'paused'; showScreen('pause'); }
  else if (app === 'paused') { app = 'play'; panel.hide(); }
  updateHint();
}

// ---------- Menus ----------
const challengeUnlocked = (i) => i === 0 || (save.ch[i - 1] || 0) >= 1;
function showScreen(name) {
  const vr = renderer.xr.isPresenting;
  if (vr) placePanelVR();
  panel.show((p) => {
    if (name === 'main') {
      p.title('Gangorra', 72);
      p.text('Disco de equilíbrio: derrube as peças do adversário sem perder as suas', 512, 130, { size: 26, color: '#c9ad8c' });
      p.button('Partida contra o computador', () => showScreen('opponents'), 212, 172, 600, 92, { size: 36 });
      p.button('Desafios', () => showScreen('challenges'), 212, 280, 600, 80);
      p.button('Como jogar', () => showScreen('help'), 212, 376, 600, 80);
      p.button(`Som: ${save.sound ? 'sim' : 'não'}`, () => { save.sound = !save.sound; sfx.setOn(save.sound); storeSave(save); showScreen('main'); }, 212, 474, 190, 66, { size: 26 });
      p.button(`Prévia: ${save.preview ? 'sim' : 'não'}`, () => { save.preview = !save.preview; storeSave(save); showScreen('main'); }, 417, 474, 190, 66, { size: 26 });
      p.button(`FPS: ${save.fps ? 'sim' : 'não'}`, () => { save.fps = !save.fps; storeSave(save); showScreen('main'); }, 622, 474, 190, 66, { size: 26 });
      const stars = Object.values(save.ch).reduce((a, b) => a + b, 0);
      p.text(`Vitórias: ${save.wins.reduce((a, b) => a + b, 0)}   ·   Estrelas nos desafios: ${stars} de 30`, 512, 594, { size: 26, color: '#ffd25a' });
      p.text(vr ? 'Aponte com o controle e aperte o gatilho' : 'No Quest: abra esta página no navegador do óculos e aperte "Entrar em VR"', 512, 656, { size: 22, color: '#c9ad8c' });
    } else if (name === 'opponents') {
      p.title('Escolha o adversário', 62);
      OPPONENTS.forEach((o, i) => {
        const y = 116 + i * 156;
        p.button(`${o.name}  ·  ${o.title}`, () => newMatch(i), 112, y, 800, 136, { size: 36, sub: `${o.desc}   (vitórias: ${save.wins[i]} de ${save.games[i]})` });
      });
      p.text('2 rodadas de 6 peças para cada um (1, 1, 2, 2, 3 e 3). Cada um começa uma.', 512, 600, { size: 24, color: '#c9ad8c' });
      p.button('Voltar', () => showScreen('main'), 362, 632, 300, 66, { size: 28 });
    } else if (name === 'challenges') {
      p.title('Desafios', 56);
      CHALLENGES.forEach((c, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        p.tile(52 + col * 186, 110 + row * 200, 172, 176, {
          num: i + 1, name: c.name, stars: save.ch[i] || 0, done: save.ch[i] != null, locked: !challengeUnlocked(i),
          action: () => newChallenge(i),
        });
      });
      p.text('Passe um desafio (1 estrela) para liberar o próximo.', 512, 540, { size: 24, color: '#c9ad8c' });
      p.button('Voltar', () => showScreen(app === 'paused' ? 'pause' : 'main'), 362, 600, 300, 70, { size: 30 });
    } else if (name === 'help') {
      p.title('Como jogar', 60);
      const rows = [
        'Na sua vez, ponha uma peça (peso 1, 2 ou 3) numa casa livre do disco.',
        'O disco inclina para o lado mais pesado. Passou do limite: as peças',
        'mais baixas escorregam e caem na calha, até ele aguentar de novo.',
        'Quanto mais peso em cima, mais mole fica o pino: o limite vai caindo.',
        'Pontos no fim: peso × anel (dentro ×1, meio ×2, borda ×3).',
        'Truque: peso no anel do meio, atrás das peças dele na borda.',
        vr ? 'VR: aperto perto da peça pega; solte em cima da casa (ou aponte).' : 'PC: clique na peça (ou 1, 2, 3) e na casa. A/D giram a câmera.',
        vr ? 'Manche: gira a mesa. Mãos: pinça pega e solta. B ou Y: pausa.' : 'O aro colorido mostra quanto o disco vai inclinar. Esc: pausa.',
      ];
      rows.forEach((t, i) => p.text(t, 48, 124 + i * 54, { size: 26, align: 'left' }));
      p.button('Voltar', () => showScreen(app === 'paused' ? 'pause' : 'main'), 362, 586, 300, 80);
    } else if (name === 'pause') {
      p.title('Pausa', 66);
      p.text(mode === 'match' ? `Contra ${opponent().name} · Rodada ${match.index + 1} de 2` : `Desafio ${ch.i + 1}: ${CHALLENGES[ch.i].name}`, 512, 130, { size: 28, color: '#c9ad8c' });
      p.button('Continuar', () => togglePause(), 262, 176, 500, 84);
      p.button(mode === 'match' ? 'Recomeçar a partida' : 'Recomeçar o desafio', () => (mode === 'match' ? newMatch(oppIndex) : newChallenge(ch.i, true)), 262, 276, 500, 84);
      p.button('Como jogar', () => showScreen('help'), 262, 376, 245, 84, { size: 30 });
      p.button('Recentralizar', () => { togglePause(); placeForPlay(true); }, 517, 376, 245, 84, { size: 30, locked: !vr });
      p.button('Menu principal', () => goMenu(), 262, 476, 500, 84);
    } else if (name === 'roundEnd') {
      const r = match.results[match.results.length - 1];
      p.title('Fim da rodada 1', 66);
      p.text(`Você ${r.score[0]} x ${r.score[1]} ${opponent().name}`, 512, 150, { size: 40, bold: true, color: r.score[0] > r.score[1] ? '#ff9a8a' : r.score[1] > r.score[0] ? '#8ab8ff' : '#fbf1e1' });
      p.text(`Peças que caíram: suas ${r.lost[0]}, dele${opponent().style === 'risky' ? '' : 'a'} ${r.lost[1]}`, 512, 212, { size: 28, color: '#c9ad8c' });
      p.text(`Na rodada 2 começa: ${match.round.starter === PLAYER ? opponent().name : 'você'}`, 512, 262, { size: 26, color: '#c9ad8c' });
      p.button('Próxima rodada', () => nextRound(), 262, 320, 500, 96, { size: 38 });
      p.button('Menu principal', () => goMenu(), 262, 450, 500, 80);
    } else if (name === 'over') {
      const w = match.winner;
      p.title(w === PLAYER ? 'Você venceu!' : w === CPU ? `${opponent().name} venceu` : 'Empate!', 72);
      p.text(`Você ${match.total(0)} x ${match.total(1)} ${opponent().name}`, 512, 150, { size: 40, bold: true });
      p.text(`Rodadas: ${match.results.map(r => `${r.score[0]}-${r.score[1]}`).join('   ')}`, 512, 210, { size: 28, color: '#c9ad8c' });
      p.text(`Contra ${opponent().name}: ${save.wins[oppIndex]} vitória(s) em ${save.games[oppIndex]} partida(s)`, 512, 258, { size: 24, color: '#c9ad8c' });
      p.button('Jogar de novo', () => newMatch(oppIndex), 262, 310, 500, 92, { size: 36 });
      p.button('Outro adversário', () => showScreen('opponents'), 262, 420, 500, 80);
      p.button('Menu principal', () => goMenu(), 262, 520, 500, 80);
    } else if (name === 'chIntro') {
      const c = CHALLENGES[ch.i];
      p.title(`Desafio ${ch.i + 1}: ${c.name}`, 66);
      p.text(c.desc, 512, 150, { size: 28 });
      p.text(`Peças na mão: ${c.hand.join(', ')}. As azuis não se mexem.`, 512, 200, { size: 26, color: '#c9ad8c' });
      p.text(c.goal, 512, 252, { size: 23, color: '#ffd25a' });
      p.button('Começar', () => { panel.hide(); beginTurn(); }, 262, 320, 500, 96, { size: 38 });
      p.button('Desafios', () => showScreen('challenges'), 262, 440, 500, 80);
    } else if (name === 'chResult') {
      const c = CHALLENGES[ch.i];
      p.title(chResult.stars ? 'Desafio cumprido!' : 'Não foi dessa vez', 66);
      p.stars(chResult.stars, 512, 160, 80);
      p.text(c.goal, 512, 240, { size: 23, color: '#c9ad8c' });
      p.text(`Melhor: ${save.ch[ch.i] || 0} estrela(s)`, 512, 284, { size: 26 });
      p.button('Tentar de novo', () => newChallenge(ch.i, true), 262, 330, 245, 84, { size: 30 });
      p.button('Próximo', () => newChallenge(ch.i + 1), 517, 330, 245, 84, { size: 30, locked: ch.i >= CHALLENGES.length - 1 || !challengeUnlocked(ch.i + 1) });
      p.button('Desafios', () => showScreen('challenges'), 262, 434, 500, 80);
      p.button('Menu principal', () => goMenu(), 262, 534, 500, 80);
    }
  });
  hidePreview();
  updateHint();
}

// ---------- Painel no PC e no VR ----------
function fitPC() {
  if (renderer.xr.isPresenting) return;
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  if (panel.mesh.parent !== camera) camera.add(panel.mesh);
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const visH = 2 * 0.8 * Math.tan(half), visW = visH * aspect;
  panel.mesh.position.set(0, 0, -0.8);
  panel.mesh.quaternion.identity();
  panel.mesh.scale.setScalar(Math.min(1, visW * 0.94 / 0.9, visH * 0.92 / 0.633));
}
function placePanelVR() {
  const head = new THREE.Vector3(), hq = new THREE.Quaternion();
  camera.getWorldPosition(head);
  camera.getWorldQuaternion(hq);
  const yaw = new THREE.Euler().setFromQuaternion(hq, 'YXZ').y;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  panel.mesh.position.copy(head).addScaledVector(fwd, 0.95);
  panel.mesh.position.y = head.y - 0.05;
  panel.mesh.rotation.set(0, yaw, 0);
}
// Põe a cabeça do jogador no ponto (x, z), olhando para a mesa (-z).
function placeRig(x, z) {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  rig.rotation.set(0, -e.y, 0);
  const head = camera.position.clone().setY(0).applyAxisAngle(UP, rig.rotation.y);
  rig.position.set(x - head.x, 0, z - head.z);
  rig.updateMatrixWorld(true);
}
function placeForPlay(force = false) {
  if (renderer.xr.isPresenting && (force || !rigPlaced)) { placeRig(VR_STAND.x, VR_STAND.z); rigPlaced = true; }
  pcCamSnap = true;
}
let rigPlaced = false;

// ---------- Controles do VR ----------
const ctrls = [];
const markMat = new THREE.MeshStandardMaterial({ color: 0xf0c27a, roughness: 0.3, metalness: 0.5 });
let lastHandSide = 'right';
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand ? renderer.xr.getHand(i) : null;
  rig.add(ctrl, grip);
  if (hand) rig.add(hand);
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xf0c27a }));
  laser.visible = false;
  ctrl.add(laser);
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), markMat);
  grip.add(mark);
  // ponta da pinça (mãos rastreadas)
  const pinchDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 6), new THREE.MeshBasicMaterial({ color: 0xf0c27a }));
  pinchDot.visible = false;
  scene.add(pinchDot);
  const entry = { ctrl, grip, hand, laser, mark, pinchDot, source: null, side: null, prevButtons: [], hoverIndex: -1, trigger: false };
  ctrls.push(entry);
  ctrl.addEventListener('connected', (e) => { entry.source = e.data; entry.side = e.data.handedness; });
  ctrl.addEventListener('disconnected', () => { if (held?.entry === entry) dropHeld(); entry.source = null; entry.side = null; });
  ctrl.addEventListener('selectstart', () => { entry.trigger = true; onSelect(entry); });
  ctrl.addEventListener('selectend', () => { entry.trigger = false; if (entry.source?.hand && held?.entry === entry) releaseHeld(); });
  ctrl.addEventListener('squeezestart', () => { sfx.unlock(); if (!entry.source?.hand) tryGrab(entry); });
  ctrl.addEventListener('squeezeend', () => { if (!entry.source?.hand && held?.entry === entry) releaseHeld(); });
}
const entryFor = (side) => ctrls.find(e => e.side === side && e.source);
function pulse(side, v, ms) {
  try { entryFor(side)?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(clamp(v, 0, 1), ms); } catch { /* sem vibração */ }
}
const pulseAll = (v, ms) => { pulse('left', v, ms); pulse('right', v, ms); };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
// Ponto de pegar: no controle, a empunhadura; nas mãos, o meio entre o polegar e o indicador.
function grabPoint(entry, out = new THREE.Vector3()) {
  if (entry.source?.hand && entry.hand?.joints) {
    const a = entry.hand.joints['index-finger-tip'], b = entry.hand.joints['thumb-tip'];
    if (a && b && a.visible !== false) {
      a.getWorldPosition(out); b.getWorldPosition(_v2);
      return out.add(_v2).multiplyScalar(0.5);
    }
  }
  entry.grip.getWorldPosition(out);
  if (!entry.source?.hand) out.add(new THREE.Vector3(0, -0.02, -0.04).applyQuaternion(entry.grip.getWorldQuaternion(_q)));
  return out;
}

function tryGrab(entry) {
  if (app !== 'play' || phase !== 'turn' || held || panel.visible || dev.autoplay) return;
  const p = grabPoint(entry);
  let best = null, bd = GRAB_DIST;
  for (const m of trayMeshes) {
    if (m.userData.team !== PLAYER) continue;
    m.getWorldPosition(_v);
    _v.y += PIECE[m.userData.w].h / 2;
    const d = _v.distanceTo(p);
    if (d < bd) { bd = d; best = m; }
  }
  if (!best) return;
  const w = best.userData.w;
  const mesh = world.makePiece(PLAYER, w);
  scene.add(mesh);
  held = { entry, w, mesh, cell: -1, side: entry.side };
  lastHandSide = entry.side || lastHandSide;
  syncTrays();
  sfx.pick();
  pulse(entry.side, 0.3, 25);
}
// Casa mais perto de um ponto do mundo (no plano do tampo do disco), se estiver livre e perto.
function cellNearWorld(p, maxDisc = CELL_R * 1.25) {
  const local = world.piecesGroup.worldToLocal(p.clone());
  const x = local.x / DISC.R, y = -local.z / DISC.R;
  return cellNear(x, y, maxDisc, local.y);
}
function cellNear(x, y, maxDisc, h = 0) {
  if (Math.hypot(x, y) > 1.15) return -1;
  const st = cur();
  if (!st) return -1;
  const used = new Set(st.pieces.map(p => p.cell));
  let best = -1, bd = maxDisc;
  for (const c of CELLS) {
    if (used.has(c.i)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) { bd = d; best = c.i; }
  }
  return best;
}
const raycaster = new THREE.Raycaster();
function updateHeld() {
  if (!held) return;
  const e = held.entry;
  const p = grabPoint(e);
  held.mesh.position.copy(p).add(new THREE.Vector3(0, -PIECE[held.w].h / 2, 0));
  world.piecesGroup.getWorldQuaternion(held.mesh.quaternion);
  // 1) mão em cima do disco: a casa embaixo dela
  const local = world.piecesGroup.worldToLocal(p.clone());
  let cell = -1;
  if (local.y > -0.03 && local.y < 0.16) cell = cellNear(local.x / DISC.R, -local.z / DISC.R, CELL_R * 1.4);
  // 2) senão, a casa para onde o controle aponta
  if (cell < 0) {
    e.ctrl.getWorldPosition(_v);
    e.ctrl.getWorldQuaternion(_q);
    raycaster.set(_v, new THREE.Vector3(0, 0, -1).applyQuaternion(_q));
    const hit = raycaster.intersectObject(world.discHit)[0];
    if (hit) cell = cellNearWorld(hit.point, CELL_R * 1.4);
    e.laser.visible = !!hit;
    if (hit) e.laser.scale.z = hit.distance;
  } else e.laser.visible = false;
  if (cell !== held.cell) { held.cell = cell; if (cell >= 0) pulse(e.side, 0.12, 12); }
  showPreviewFor(held.w, cell);
}
function releaseHeld() {
  if (!held) return;
  const h = held;
  held = null;
  h.entry.laser.visible = false;
  const pos = h.mesh.position.clone();
  scene.remove(h.mesh);
  if (h.cell >= 0 && phase === 'turn' && cur().turn === PLAYER) {
    doMove({ w: h.w, cell: h.cell }, { pos });
  } else {
    msg = { text: 'Solte a peça em cima de uma casa livre (ou aponte para ela).', t: 2.5 };
    syncTrays();
    hidePreview();
  }
}
function dropHeld() { if (held) { scene.remove(held.mesh); held = null; syncTrays(); hidePreview(); } }

function onSelect(entry) {
  sfx.unlock();
  if (panel.visible) {
    if (entry.hoverIndex >= 0) {
      const a = panel.actionAt(entry.hoverIndex);
      if (a) { sfx.click(); a(); }
    }
    return;
  }
  if (entry.source?.hand) tryGrab(entry);   // mão rastreada: a pinça pega
}

function pollButtons(dt) {
  for (const e of ctrls) {
    const gp = e.source?.gamepad;
    if (!gp || e.source.hand) continue;
    const b = gp.buttons.map(x => x.pressed);
    if (b[5] && !e.prevButtons[5]) togglePause();   // B ou Y
    e.prevButtons = b;
    // manche: gira a mesa (o disco, a calha e as peças) para alcançar o outro lado
    const ax = gp.axes?.[2] ?? 0;
    if (Math.abs(ax) > 0.25 && app === 'play' && !panel.visible) spinYaw += -ax * 1.5 * dt;
  }
}

// ---------- Mouse e teclado (PC) ----------
const mouse = { ndc: new THREE.Vector2(-9, -9), right: false, lx: 0, ly: 0 };
const keys = new Set();
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  mouse.ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (e.button === 2) { mouse.right = true; mouse.lx = e.clientX; mouse.ly = e.clientY; return; }
  if (panel.visible) {
    raycaster.setFromCamera(mouse.ndc, camera);
    const a = panel.actionAt(panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv));
    if (a) { sfx.click(); a(); }
    return;
  }
  if (app !== 'play' || phase !== 'turn' || renderer.xr.isPresenting || dev.autoplay) return;
  raycaster.setFromCamera(mouse.ndc, camera);
  const tray = raycaster.intersectObjects(trayMeshes.filter(m => m.userData.team === PLAYER))[0];
  if (tray) { selectWeight(tray.object.userData.w); return; }
  const cell = pcCellUnderMouse();
  if (cell >= 0) {
    if (selectedW == null) { msg = { text: 'Primeiro escolha uma peça na sua bandeja (ou tecla 1, 2 ou 3).', t: 2.5 }; return; }
    doMove({ w: selectedW, cell });
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  mouse.ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (mouse.right) { pcOrbit.yaw -= (e.clientX - mouse.lx) * 0.006; pcOrbit.pitch = clamp(pcOrbit.pitch + (e.clientY - mouse.ly) * 0.004, 0.25, 1.35); mouse.lx = e.clientX; mouse.ly = e.clientY; }
});
window.addEventListener('pointerup', () => { mouse.right = false; });
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); pcOrbit.dist = clamp(pcOrbit.dist + e.deltaY * 0.001, 0.75, 2.4); }, { passive: false });
window.addEventListener('blur', () => { keys.clear(); mouse.right = false; });
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  const k = (e.key || '').toLowerCase();
  if (k === 'escape') {
    if (selectedW != null && app === 'play' && !panel.visible) { selectedW = null; syncTrays(); hidePreview(); return; }
    togglePause(); return;
  }
  if (k === 'p') { togglePause(); return; }
  if (k === 'f') { save.fps = !save.fps; storeSave(save); return; }
  if ((k === '1' || k === '2' || k === '3') && app === 'play' && phase === 'turn') selectWeight(+k);
  keys.add(k);
});
window.addEventListener('keyup', (e) => { keys.delete((e.key || '').toLowerCase()); });
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); fitPC(); });

function selectWeight(w) {
  const st = cur();
  if (!st || !st.hands[PLAYER].includes(w)) { msg = { text: `Você não tem mais peça de peso ${w}.`, t: 2 }; return; }
  selectedW = selectedW === w ? null : w;
  sfx.pick();
  syncTrays();
  updateHint();
}
function pcCellUnderMouse() {
  raycaster.setFromCamera(mouse.ndc, camera);
  const hit = raycaster.intersectObject(world.discHit)[0];
  return hit ? cellNearWorld(hit.point, CELL_R * 1.3) : -1;
}

// ---------- Prévia: casa marcada, peça fantasma, aro inclinado e peças que vão cair ----------
let ghost = null, previewKey = '', previewInfo = null;
function hidePreview() {
  world.cellMark.visible = false;
  world.ghostRim.visible = false;
  world.ghostArrow.visible = false;
  for (const d of world.dangerMarks) d.visible = false;
  if (ghost) ghost.visible = false;
  previewLabel.mesh.visible = false;
  previewInfo = null;
  previewKey = '';
  previewEl.style.display = 'none';
}
function showPreviewFor(w, cell) {
  const st = cur();
  if (!st || cell < 0 || w == null) { hidePreview(); return; }
  const key = `${w}:${cell}:${st.moves}`;
  if (key !== previewKey) { previewKey = key; previewInfo = preview(st, { w, cell }); }
  const info = previewInfo;
  if (!info) { hidePreview(); return; }
  cellLocal(cell, world.cellMark.position).y = 0.002;
  world.cellMark.visible = true;
  world.cellMark.material.color.set(info.fallen.length ? 0xff6a3a : 0x7dff9a);
  if (!held) {
    if (!ghost || ghost.userData.w !== w) { if (ghost) ghost.parent?.remove(ghost); ghost = world.makePiece(PLAYER, w, true); world.piecesGroup.add(ghost); }
    cellLocal(cell, ghost.position);
    ghost.visible = true;
  } else if (ghost) ghost.visible = false;
  if (!save.preview) { world.ghostRim.visible = world.ghostArrow.visible = false; for (const d of world.dangerMarks) d.visible = false; updatePreviewText(info); return; }
  // aro: como o disco fica logo depois de pôr a peça (no batente se passar do limite)
  const pk = info.peak;
  const fake = { x: pk.x, y: pk.y };
  world.ghostRim.visible = true;
  applyTiltVisual(fake, world.ghostRim);
  const col = pk.frac >= 1 ? 0xff4a3a : pk.frac > 0.75 ? 0xffc04a : 0x7dff9a;
  world.ghostRim.material.color.set(col);
  if (pk.deg > 0.4) {
    const dx = pk.x / pk.deg, dy = pk.y / pk.deg;
    world.ghostArrow.visible = true;
    world.ghostArrow.position.set(dx * (DISC.R + 0.045), PIN_H + DISC.t - (DISC.R + 0.045) * Math.tan(pk.deg * Math.PI / 180), -dy * (DISC.R + 0.045));
    world.ghostArrow.lookAt(world.spin.localToWorld(new THREE.Vector3(dx * 2, PIN_H - 0.2, -dy * 2)));
  } else world.ghostArrow.visible = false;
  // anéis vermelhos nas peças que vão cair
  world.dangerMarks.forEach((d, k) => {
    const f = info.fallen[k];
    d.visible = !!f;
    if (f) cellLocal(f.cell, d.position).y = 0.003;
  });
  updatePreviewText(info);
}
function previewText(info) {
  const val = (l) => l.reduce((s, p) => s + p.w * CELLS[p.cell].mult, 0);
  const pct = (f) => `${Math.round(Math.min(f, 1.5) * 100)}%`;
  const lp = info.lostBy[PLAYER], lc = info.lostBy[CPU];
  let a = `Inclinação: ${pct(info.before.frac)} → ${pct(info.peak.frac)}`;
  let b;
  if (!info.fallen.length) b = info.peak.frac > 0.85 ? 'Nada cai, mas fica no limite' : 'Nada cai';
  else {
    const parts = [];
    if (lc.length) parts.push(`${lc.length} azu${lc.length > 1 ? 'is' : 'l'} (−${val(lc)})`);
    if (lp.length) parts.push(`${lp.length} sua${lp.length > 1 ? 's' : ''} (−${val(lp)})`);
    b = `Passa do limite! Caem: ${parts.join(' e ')}`;
  }
  return [a, b, lp.length ? 'bad' : lc.length ? 'good' : 'ok'];
}
const previewEl = document.getElementById('preview');
function updatePreviewText(info) {
  const [a, b, kind] = previewText(info);
  const color = kind === 'bad' ? '#ff8a7a' : kind === 'good' ? '#9aff9a' : '#fbf1e1';
  if (renderer.xr.isPresenting) {
    previewLabel.set([{ text: a, size: 0.4, color: '#f0c27a' }, { text: b, size: 0.36, color }]);
    previewLabel.mesh.visible = true;
    world.piecesGroup.localToWorld(cellLocal(info.placed.cell, previewLabel.mesh.position));
    previewLabel.mesh.position.y += 0.16;
    camera.getWorldPosition(_v);
    previewLabel.mesh.lookAt(_v.x, previewLabel.mesh.position.y, _v.z);
  } else {
    previewEl.style.display = 'block';
    const fill = Math.min(1, info.peak.frac);
    const html = `<div class="bar"><div class="now" style="width:${(Math.min(1, info.before.frac) * 100).toFixed(0)}%"></div><div class="next ${info.peak.frac >= 1 ? 'over' : info.peak.frac > 0.75 ? 'warn' : ''}" style="width:${(fill * 100).toFixed(0)}%"></div><div class="limit"></div></div><div class="txt">${a}</div><div class="txt" style="color:${color}">${b}</div>`;
    if (previewEl.dataset.last !== html) { previewEl.innerHTML = html; previewEl.dataset.last = html; }
  }
}

// ---------- Câmera do PC ----------
const pcOrbit = { yaw: 0, pitch: 0.78, dist: 1.38 };
const pcCam = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
let pcCamSnap = true;
function updatePCCamera(dt) {
  if (renderer.xr.isPresenting) return;
  if (keys.has('a') || keys.has('arrowleft')) pcOrbit.yaw += 1.4 * dt;
  if (keys.has('d') || keys.has('arrowright')) pcOrbit.yaw -= 1.4 * dt;
  if (keys.has('w') || keys.has('arrowup')) pcOrbit.pitch = clamp(pcOrbit.pitch + 0.8 * dt, 0.25, 1.35);
  if (keys.has('s') || keys.has('arrowdown')) pcOrbit.pitch = clamp(pcOrbit.pitch - 0.8 * dt, 0.25, 1.35);
  let yaw = pcOrbit.yaw, pitch = pcOrbit.pitch, dist = pcOrbit.dist;
  let look = TABLE_CENTER.clone().add(new THREE.Vector3(0, -0.06, 0.13));
  if (app === 'menu') { yaw = Math.sin(time * 0.12) * 0.6; pitch = 0.5; dist = 1.6; look = new THREE.Vector3(TABLE.x, 1.05, TABLE.z - 0.3); }
  const pos = new THREE.Vector3(TABLE.x + Math.sin(yaw) * Math.cos(pitch) * dist, DISC.h + Math.sin(pitch) * dist, TABLE.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  if (pcCamSnap) { pcCam.pos.copy(pos); pcCam.look.copy(look); pcCamSnap = false; }
  pcCam.pos.lerp(pos, damp(6, dt));
  pcCam.look.lerp(look, damp(6, dt));
  camera.position.copy(pcCam.pos);
  camera.lookAt(pcCam.look);
}

// ---------- VR: sessão ----------
let recenterIn = 0;
renderer.xr.addEventListener('sessionstart', () => {
  recenterIn = 5;
  rigPlaced = false;
  if (panel.mesh.parent) panel.mesh.parent.remove(panel.mesh);
  scene.add(panel.mesh);
  panel.mesh.scale.setScalar(1);
  hidePreview();
  updateHint();
});
renderer.xr.addEventListener('sessionend', () => {
  dropHeld();
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  camera.position.set(0, 1.6, 0.5); camera.quaternion.identity();
  pcCamSnap = true;
  fitPC();
  updateHint();
});

// ---------- Raios dos menus ----------
const rayOrigin = new THREE.Vector3(), rayDir = new THREE.Vector3();
function updateMenuRays() {
  const vr = renderer.xr.isPresenting;
  let hover = -1;
  for (const e of ctrls) {
    e.hoverIndex = -1;
    if (held?.entry === e) continue;
    e.laser.visible = false;
    if (!vr || !e.source || !panel.visible) continue;
    e.ctrl.getWorldPosition(rayOrigin);
    e.ctrl.getWorldQuaternion(_q);
    rayDir.set(0, 0, -1).applyQuaternion(_q);
    raycaster.set(rayOrigin, rayDir);
    const hit = raycaster.intersectObject(panel.mesh)[0];
    e.laser.visible = true;
    e.laser.scale.z = hit ? hit.distance : 2;
    e.hoverIndex = panel.pick(hit?.uv);
    if (e.hoverIndex >= 0) hover = e.hoverIndex;
  }
  if (!vr) {
    if (panel.visible) {
      raycaster.setFromCamera(mouse.ndc, camera);
      hover = panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv);
      renderer.domElement.style.cursor = hover >= 0 && panel.actionAt(hover) ? 'pointer' : 'default';
    } else renderer.domElement.style.cursor = app === 'play' && phase === 'turn' ? 'pointer' : 'default';
  }
  if (panel.visible) panel.setHover(hover);
}

// PC: prévia da casa embaixo do mouse
function updatePCHover() {
  if (renderer.xr.isPresenting || held) return;
  if (app !== 'play' || phase !== 'turn' || panel.visible || dev.autoplay) { if (!held && previewKey) hidePreview(); return; }
  const cell = pcCellUnderMouse();
  hoverCell = cell;
  if (selectedW != null && cell >= 0) showPreviewFor(selectedW, cell);
  else if (previewKey || world.cellMark.visible) hidePreview();
  if (selectedW == null && cell >= 0) { cellLocal(cell, world.cellMark.position).y = 0.002; world.cellMark.material.color.set(0xf0c27a); world.cellMark.visible = true; }
}

// ---------- HUD ----------
const hintEl = document.getElementById('hint');
const hudEl = document.getElementById('hud');
const fpsEl = document.getElementById('fps');
function updateHint() {
  if (renderer.xr.isPresenting) { hintEl.textContent = ''; return; }
  let t;
  if (app !== 'play' || panel.visible) t = 'Clique nas opções do painel';
  else if (phase === 'turn') t = selectedW == null ? 'Clique numa peça da sua bandeja (ou 1, 2, 3) · A/D ou botão direito: girar a câmera · Esc: pausa' : `Peso ${selectedW}: clique numa casa do disco · Esc: cancelar · A/D: girar a câmera`;
  else t = 'A/D ou botão direito: girar a câmera · rodinha: zoom · Esc: pausa';
  hintEl.innerHTML = `<span>${t}</span>`;
}
function statusLines() {
  const st = cur();
  if (mode === 'challenge') {
    const c = CHALLENGES[ch.i];
    return [`Desafio ${ch.i + 1}: ${c.name} · peças na mão: ${st.hands[PLAYER].slice().sort().join(', ') || '-'}`, c.goal];
  }
  const o = opponent();
  const s = [scoreOf(st.pieces, 0), scoreOf(st.pieces, 1)];
  const prev = match.results.reduce((a, r) => [a[0] + r.score[0], a[1] + r.score[1]], [0, 0]);
  const head = `Você ${s[0]} x ${s[1]} ${o.name} · Rodada ${match.index + 1} de 2${match.index ? ` (total ${prev[0] + s[0]} x ${prev[1] + s[1]})` : ''}`;
  let line;
  if (phase === 'turn') line = renderer.xr.isPresenting ? 'Sua vez: aperte o botão lateral perto de uma peça da bandeja e solte numa casa.' : 'Sua vez.';
  else if (phase === 'think') line = `${o.name} está pensando...`;
  else line = '';
  return [head, line];
}
function updateHud(dt) {
  if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
  const vr = renderer.xr.isPresenting;
  const playing = app === 'play' && cur() && !panel.visible;
  if (!vr) {
    statusLabel.mesh.visible = false;
    hudEl.style.display = playing ? 'block' : 'none';
    if (playing) {
      const [a, b] = statusLines();
      const html = `<b>${a}</b>${b ? `<br>${b}` : ''}${msg && msg.text ? `<br><em>${msg.text}</em>` : ''}`;
      if (hudEl.dataset.last !== html) { hudEl.innerHTML = html; hudEl.dataset.last = html; }
    }
    return;
  }
  hudEl.style.display = 'none';
  statusLabel.mesh.visible = playing;
  if (!playing) return;
  const [a, b] = statusLines();
  statusLabel.set([
    { text: a, size: 0.34, color: '#f0c27a' },
    { text: msg?.text || b, size: 0.3, bold: false, color: msg?.text ? '#ffe3a0' : '#fbf1e1' },
  ]);
}
let boardKey = '';
function updateScoreboard() {
  let data;
  const st = cur();
  if (!st || app === 'menu') data = { names: ['Você', 'Adversário'], scores: [0, 0], round: '', footer: 'Escolha uma partida ou um desafio' };
  else if (mode === 'challenge') data = { names: ['Você', 'Azuis'], scores: [scoreOf(st.pieces, 0), scoreOf(st.pieces, 1)], round: `Desafio ${ch.i + 1}`, footer: CHALLENGES[ch.i].name };
  else {
    const prev = match.results.reduce((a, r) => [a[0] + r.score[0], a[1] + r.score[1]], [0, 0]);
    const live = match.roundOver ? [0, 0] : [scoreOf(st.pieces, 0), scoreOf(st.pieces, 1)];
    data = { names: ['Você', opponent().name], scores: [prev[0] + live[0], prev[1] + live[1]], round: `Rodada ${Math.min(2, match.index + (match.roundOver ? 0 : 1))}`, footer: `Peso no disco: ${weightOf(st.pieces, 0)} x ${weightOf(st.pieces, 1)}` };
  }
  const key = JSON.stringify(data);
  if (key !== boardKey) { boardKey = key; world.drawBoard(data); }
}

// ---------- Botão de VR ----------
const vrBtn = document.getElementById('vr');
async function setupVR() {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!ok) {
    vrBtn.textContent = window.isSecureContext ? 'VR não disponível neste navegador' : 'VR precisa de HTTPS';
    vrBtn.disabled = true;
    return;
  }
  vrBtn.textContent = 'Entrar em VR';
  vrBtn.disabled = false;
  vrBtn.onclick = async () => {
    sfx.unlock();
    if (renderer.xr.isPresenting) { renderer.xr.getSession()?.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      await renderer.xr.setSession(session);
      vrBtn.textContent = 'Sair do VR';
      session.addEventListener('end', () => { vrBtn.textContent = 'Entrar em VR'; });
    } catch (err) {
      vrBtn.textContent = 'Erro ao entrar em VR';
      console.error(err);
    }
  };
}
setupVR();

// ---------- Laço principal ----------
let lastT = performance.now();
let fpsFrames = 0, fpsTime = 0;

function tick(dt) {
  time += dt;
  const vr = renderer.xr.isPresenting;
  if (recenterIn > 0 && --recenterIn === 0) { placeRig(VR_STAND.x, VR_STAND.z); rigPlaced = true; if (panel.visible) placePanelVR(); }
  pollButtons(dt);
  rig.updateMatrixWorld(true);

  // tempos marcados (animação dos lances)
  if (app !== 'paused') {
    for (let i = 0; i < timers.length; i++) {
      if (timers[i].at <= time) { const t = timers.splice(i, 1)[0]; i--; t.fn(); }
    }
  }

  // Turno
  if (app === 'play' && cur()) {
    if (phase === 'turn') {
      updateHeld();
      if (dev.autoplay) robotTurn(dt);
    } else if (phase === 'think') {
      thinkT += dt;
      pumpThinker();
      if (thinkT >= opponent().think && thinker?.done) doMove(thinker.result);
    } else if ((phase === 'roundEnd' || phase === 'over') && dev.autoplay) {
      timerAuto -= dt;
      if (timerAuto <= 0) {
        if (phase === 'roundEnd') nextRound();
        else if (mode === 'match') newMatch(oppIndex);
      }
    }
  }

  // Visual
  spinYaw = ((spinYaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  world.spin.rotation.y = spinYaw;
  stepTilt(tiltState, tiltGoal, dt);
  applyTiltVisual(tiltState, world.tilt);
  updateFlying(dt);
  updateLevel();
  updatePCHover();
  // adversário olha para o disco quando pensa, para a peça na mão do jogador ou para o jogador
  camera.getWorldPosition(_v);
  const look = phase === 'think' ? TABLE_CENTER : held ? held.mesh.position : _v;
  world.avatar.update(dt, time, look);
  world.animate(dt, time);
  updatePCCamera(dt);
  updateHud(dt);
  updateMenuRays();
  updateScoreboard();
  for (const e of ctrls) {
    e.mark.visible = vr && !!e.source && !e.source.hand;
    e.pinchDot.visible = vr && !!e.source?.hand && app === 'play' && phase === 'turn';
    if (e.pinchDot.visible) grabPoint(e, e.pinchDot.position);
  }
  sfx.updateAmbience(dt);

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    const f = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
    fpsEl.style.display = save.fps && !vr ? 'block' : 'none';
    fpsEl.textContent = `${f} FPS`;
    fpsLabel.mesh.visible = save.fps && vr;
    fpsLabel.set(`${f} FPS`);
  }
}

// Nível de bolha: a bolha vai para o lado que sobe
function updateLevel() {
  const deg = Math.hypot(tiltState.x, tiltState.y);
  const k = Math.min(1, deg / TILT_STOP_DEG) * 0.042;
  const dx = deg > 1e-6 ? tiltState.x / deg : 0, dy = deg > 1e-6 ? tiltState.y / deg : 0;
  // direção no mundo (a mesa pode estar girada)
  const c = Math.cos(spinYaw), s = Math.sin(spinYaw);
  const wx = dx * c + (-dy) * s, wz = -dx * s + (-dy) * c;
  world.bubble.position.set(-wx * k, 0.013, -wz * k);
}

// Robô do modo automático
let robotT = 0;
function robotTurn(dt) {
  robotT += dt;
  if (!thinker) {
    robotT = 0;
    if (mode === 'challenge') {
      if (!ch.plan) thinker = { gen: bestChallengeGen(CHALLENGES[ch.i]), done: false, result: null, kind: 'ch' };
      else thinker = { done: true, result: null, kind: 'ch' };
    } else thinker = { gen: chooseMoveGen(cur(), PLAYER, ROBOT, random), done: false, result: null };
  }
  pumpThinker();
  if (!thinker.done || robotT < ROBOT.think) return;
  let m;
  if (thinker.kind === 'ch') {
    if (!ch.plan) ch.plan = thinker.result.moves.slice();
    m = ch.plan.shift();
  } else m = thinker.result;
  thinker = null;
  if (m) doMove(m);
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tick(dt);
  renderer.render(scene, camera);
}

// ---------- Depuração (console do navegador) ----------
// dev.autoplay = true     o robô joga por você (e as partidas continuam sozinhas)
// dev.advance(5)          avança 5 s de jogo na hora
// dev.state()             resumo: tela, fase, placar, peças
// dev.loadLevel(3)        abre o desafio 3 (1 a 10)
// dev.startMatch(2)       partida contra o adversário 2 (1 a 3)
// dev.resetSave()         apaga o progresso
const dev = {
  _auto: false,
  get autoplay() { return this._auto; },
  set autoplay(v) { this._auto = !!v; dropHeld(); if (phase === 'turn') thinker = null; },
  loadLevel(n) { newChallenge(n - 1, true); return this.state(); },
  startMatch(n = 1) { newMatch(n - 1); return this.state(); },
  advance(sec, step = 1 / 60) {
    const frames = Math.round(sec / step);
    for (let i = 0; i < frames; i++) tick(step);
    lastT = performance.now();
    renderer.render(scene, camera);
    return this.state();
  },
  // posição na tela (pixels) de uma casa do disco ou de uma peça da sua bandeja: para testar o mouse
  cellScreen(cell) {
    const p = world.piecesGroup.localToWorld(cellLocal(cell)).project(camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight };
  },
  trayScreen(w) {
    const m = trayMeshes.find(t => t.userData.team === PLAYER && t.userData.w === w);
    if (!m) return null;
    const p = m.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, PIECE[w].h * 0.6, 0)).project(camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight };
  },
  state() {
    const base = { tela: app, modo: mode, fase: phase, painel: panel.visible };
    const st = cur();
    if (!st) return base;
    return {
      ...base,
      adversario: mode === 'match' ? opponent().name : null,
      desafio: mode === 'challenge' ? `${ch.i + 1}: ${CHALLENGES[ch.i].name}` : null,
      rodada: mode === 'match' ? match.index + 1 : null,
      vez: st.turn === PLAYER ? 'você' : 'computador',
      maos: st.hands.map(h => h.join(',')),
      pontos: [scoreOf(st.pieces, 0), scoreOf(st.pieces, 1)],
      total: mode === 'match' ? [match.total(0), match.total(1)] : null,
      caidas: [st.lost[0].length, st.lost[1].length],
      pecas: st.pieces.map(p => `${p.owner === PLAYER ? 'V' : 'A'}${p.w}@${p.cell}`).join(' '),
      inclinacao: +Math.hypot(tiltState.x, tiltState.y).toFixed(2),
      escolhida: selectedW, previa: previewInfo ? previewText(previewInfo).slice(0, 2).join(' / ') : null,
      estrelas: mode === 'challenge' && chResult ? chResult.stars : null,
      vencedor: mode === 'match' && match.over ? (match.winner === PLAYER ? 'você' : match.winner === CPU ? opponent().name : 'empate') : null,
      animando: flying.length + timers.length,
      salvo: { vitorias: save.wins, desafios: save.ch },
    };
  },
  resetSave() { save.wins = [0, 0, 0]; save.games = [0, 0, 0]; save.ch = {}; storeSave(save); },
};
window.dev = dev;
window.gangorra = { dev, get match() { return match; }, get challenge() { return ch; }, save, camera, scene, renderer, world };

fitPC();
goMenu();
renderer.setAnimationLoop(frame);

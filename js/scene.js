// Cenário: sala de jogos antiga à noite, mesa redonda com o disco de madeira no pino de latão,
// calha para as peças que caem, bandejas, lampião, lareira, estante, janela com lua e o adversário.
import * as THREE from '../vendor/three/three.module.js';
import { CELLS, RINGS } from './physics.js';

export const TABLE = { x: 0, z: -0.55, top: 0.80, r: 0.64 };
export const DISC = { R: 0.36, h: 0.985, t: 0.03 };          // raio, altura do pino (embaixo do disco), espessura
export const TROUGH = { r0: 0.40, r1: 0.48, depth: 0.025 };  // calha onde caem as peças
export const PIECE = {
  1: { r: 0.034, h: 0.022 },
  2: { r: 0.043, h: 0.034 },
  3: { r: 0.051, h: 0.046 },
};
export const TEAM_COLOR = [0xc8372d, 0x2d6fc8];
export const TRAY_R = 0.555;
// lugar de cada peça da mão na bandeja (6 lugares), ângulo no referencial da mesa (0 = direita)
export const trayAngle = (team, k) => (team === 0 ? -1 : 1) * (Math.PI / 2) + (team === 0 ? 1 : -1) * (k - 2.5) * 0.24;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, { repeat = null, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}
function rand(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// Madeira com veios (para a mesa, o piso, a estante)
function woodCanvas(w, h, base, dark, seed = 1, planks = 0) {
  const c = canvas(w, h), g = c.getContext('2d'), r = rand(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(${dark},${0.05 + r() * 0.12})`;
    g.lineWidth = 1 + r() * 3;
    const y = r() * h;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 6 + (r() - 0.5) * 3);
    g.stroke();
  }
  if (planks) {
    g.strokeStyle = `rgba(${dark},0.55)`; g.lineWidth = 3;
    for (let k = 0; k <= planks; k++) { const y = k * h / planks; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let k = 0; k < planks; k++) { const x = (r() * w) | 0; g.beginPath(); g.moveTo(x, k * h / planks); g.lineTo(x, (k + 1) * h / planks); g.stroke(); }
  }
  return c;
}

// Tampo do disco: marchetaria com os 3 anéis, as casas e o valor de cada anel
function discCanvas() {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d'), m = S / 2;
  const wood = woodCanvas(S, S, '#b98a52', '70,40,15', 7);
  g.save(); g.beginPath(); g.arc(m, m, m, 0, Math.PI * 2); g.clip();
  g.drawImage(wood, 0, 0);
  // faixas dos anéis, alternando madeira clara e escura
  const bands = [[0.0, 0.16, 'rgba(60,30,10,0.55)'], [0.16, 0.44, 'rgba(255,230,190,0.10)'], [0.44, 0.72, 'rgba(90,50,20,0.28)'], [0.72, 1.0, 'rgba(255,220,170,0.12)']];
  for (const [a, b, col] of bands) {
    g.fillStyle = col; g.beginPath(); g.arc(m, m, b * m, 0, Math.PI * 2); g.arc(m, m, a * m, 0, Math.PI * 2, true); g.fill();
  }
  g.strokeStyle = 'rgba(50,25,8,0.8)'; g.lineWidth = 5;
  for (const r of [0.16, 0.44, 0.72, 0.985]) { g.beginPath(); g.arc(m, m, r * m, 0, Math.PI * 2); g.stroke(); }
  // filete de latão na borda
  g.strokeStyle = '#d8b25a'; g.lineWidth = 10; g.beginPath(); g.arc(m, m, 0.965 * m, 0, Math.PI * 2); g.stroke();
  // casas: buraquinho rebaixado
  for (const cell of CELLS) {
    const x = m + cell.x * m, y = m - cell.y * m;
    const rr = 0.105 * m;
    const gr = g.createRadialGradient(x, y, rr * 0.2, x, y, rr);
    gr.addColorStop(0, 'rgba(40,20,6,0.45)'); gr.addColorStop(0.85, 'rgba(40,20,6,0.25)'); gr.addColorStop(1, 'rgba(255,235,200,0.35)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,14,4,0.6)'; g.lineWidth = 2.5; g.stroke();
  }
  // valor de cada anel, pequeno, entre as casas
  g.fillStyle = 'rgba(255,240,210,0.85)'; g.font = 'bold 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  RINGS.forEach((ring, ri) => {
    for (let k = 0; k < ring.n; k += ri === 0 ? 2 : 3) {
      const a = (ring.off + (k + 0.5) * 360 / ring.n) * Math.PI / 180;
      g.fillText(`×${ring.mult}`, m + Math.cos(a) * ring.r * m, m - Math.sin(a) * ring.r * m);
    }
  });
  // rosa dos ventos no centro (o pino)
  g.fillStyle = '#d8b25a';
  g.beginPath();
  for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, rr = k % 2 ? 0.05 * m : 0.13 * m; g.lineTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr); }
  g.closePath(); g.fill();
  g.restore();
  return c;
}

// Tampa da peça: anel claro e pontinhos com o peso
function pieceTopCanvas(team, w) {
  const S = 128, c = canvas(S, S), g = c.getContext('2d'), m = S / 2;
  const col = '#' + TEAM_COLOR[team].toString(16).padStart(6, '0');
  g.fillStyle = col; g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(m * 0.8, m * 0.7, 4, m, m, m);
  gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,240,220,0.8)'; g.lineWidth = 6; g.beginPath(); g.arc(m, m, m * 0.8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff6e0';
  const pts = w === 1 ? [[0, 0]] : w === 2 ? [[-0.26, 0], [0.26, 0]] : [[0, -0.3], [-0.27, 0.17], [0.27, 0.17]];
  for (const [x, y] of pts) { g.beginPath(); g.arc(m + x * m, m + y * m, m * 0.15, 0, Math.PI * 2); g.fill(); }
  return c;
}

export function buildWorld(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120b07);
  scene.fog = new THREE.Fog(0x120b07, 6, 14);

  // Luz: lampião em cima da mesa, lareira à direita e um pouco de luz ambiente
  const hemi = new THREE.HemisphereLight(0x9a8a7a, 0x2a1a10, 0.75);
  scene.add(hemi);
  const lamp = new THREE.PointLight(0xffd59a, 5, 6, 1.6);
  lamp.position.set(TABLE.x, 2.05, TABLE.z);
  scene.add(lamp);
  const fireLight = new THREE.PointLight(0xff8a3a, 3.5, 6, 1.8);
  fireLight.position.set(2.6, 0.6, -1.2);
  scene.add(fireLight);
  const dir = new THREE.DirectionalLight(0xbfd2ff, 0.35);   // luar pela janela
  dir.position.set(-1.5, 3, -4);
  scene.add(dir);

  // Sala
  const room = new THREE.Group();
  scene.add(room);
  const floorTex = tex(woodCanvas(1024, 1024, '#6b4426', '35,18,6', 3, 8), { repeat: [3, 3] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.position.set(0, 0, -0.8);
  room.add(floor);
  const wallC = canvas(512, 512), wg = wallC.getContext('2d');
  wg.fillStyle = '#2f3d2a'; wg.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 64) { wg.fillStyle = 'rgba(210,180,110,0.10)'; wg.fillRect(x, 0, 6, 512); }
  for (let y = 32; y < 512; y += 128) for (let x = 32; x < 512; x += 64) {
    wg.fillStyle = 'rgba(220,190,120,0.14)'; wg.beginPath(); wg.moveTo(x, y - 14); wg.lineTo(x + 10, y); wg.lineTo(x, y + 14); wg.lineTo(x - 10, y); wg.fill();
  }
  const wallTex = tex(wallC, { repeat: [6, 2] });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 7), [
    new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.BackSide }), new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.BackSide }),
    new THREE.MeshLambertMaterial({ color: 0x1a120c, side: THREE.BackSide }), new THREE.MeshLambertMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0 }),
    new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.BackSide }), new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.BackSide }),
  ]);
  walls.position.set(0, 1.6, -0.8);
  room.add(walls);
  // rodapé
  const darkWood = new THREE.MeshLambertMaterial({ color: 0x3a2414 });
  for (const [x, z, w, rot] of [[0, -4.28, 7, 0], [0, 2.68, 7, 0], [-3.48, -0.8, 7, Math.PI / 2], [3.48, -0.8, 7, Math.PI / 2]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.04), darkWood);
    b.position.set(x, 0.08, z); b.rotation.y = rot; room.add(b);
  }
  // tapete redondo embaixo da mesa
  const rugC = canvas(512, 512), rg = rugC.getContext('2d');
  const rcol = ['#5a1a1a', '#8a3a22', '#c99a4a', '#5a1a1a', '#2d3a5a', '#8a3a22'];
  rcol.forEach((col, k) => { rg.fillStyle = col; rg.beginPath(); rg.arc(256, 256, 256 - k * 38, 0, Math.PI * 2); rg.fill(); });
  rg.fillStyle = '#c99a4a';
  for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12; rg.beginPath(); rg.arc(256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200, 8, 0, Math.PI * 2); rg.fill(); }
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex(rugC) }));
  rug.position.set(TABLE.x, 0.004, TABLE.z);
  room.add(rug);
  // janela com a lua (atrás do adversário)
  const winC = canvas(256, 384), wn = winC.getContext('2d');
  const sky = wn.createLinearGradient(0, 0, 0, 384); sky.addColorStop(0, '#0a1430'); sky.addColorStop(1, '#2a3a66');
  wn.fillStyle = sky; wn.fillRect(0, 0, 256, 384);
  const sr = rand(9);
  for (let i = 0; i < 60; i++) { wn.fillStyle = `rgba(255,255,255,${0.3 + sr() * 0.7})`; wn.fillRect(sr() * 256, sr() * 300, 2, 2); }
  wn.fillStyle = '#f6f0d8'; wn.beginPath(); wn.arc(180, 90, 34, 0, Math.PI * 2); wn.fill();
  wn.fillStyle = '#0d0a10'; wn.beginPath(); wn.moveTo(0, 384); for (let x = 0; x <= 256; x += 16) wn.lineTo(x, 320 - Math.sin(x * 0.05) * 20 - sr() * 18); wn.lineTo(256, 384); wn.fill();
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), new THREE.MeshBasicMaterial({ map: tex(winC), fog: false }));
  win.position.set(-0.9, 1.75, -4.27);
  room.add(win);
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x4a2c16 });
  for (const [x, y, w, h] of [[-0.9, 2.52, 1.12, 0.07], [-0.9, 0.98, 1.12, 0.07], [-1.43, 1.75, 0.07, 1.6], [-0.37, 1.75, 0.07, 1.6], [-0.9, 1.75, 0.04, 1.5], [-0.9, 1.75, 1.0, 0.04]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMat); f.position.set(x, y, -4.25); room.add(f);
  }
  // estante com livros (esquerda)
  const shelf = new THREE.Group();
  const shelfMat = new THREE.MeshLambertMaterial({ map: tex(woodCanvas(256, 256, '#5b3a20', '30,15,5', 5)) });
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.05), shelfMat); back.position.set(0, 1.1, -0.17); shelf.add(back);
  for (const x of [-0.8, 0.8]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2, 0.36), shelfMat); s.position.set(x, 1.1, 0); shelf.add(s); }
  for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.36), shelfMat); s.position.set(0, 0.06 + k * 0.52, 0); shelf.add(s); }
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), 70);
  const br = rand(4), bm = new THREE.Matrix4(), bcols = [0x7a2a1e, 0x2a4a6a, 0x3a5a2a, 0x8a6a2a, 0x5a2a4a, 0x2a2a2a, 0x9a8a6a];
  let bi = 0;
  for (let k = 0; k < 4; k++) {
    let x = -0.75;
    while (x < 0.72 && bi < 70) {
      const w = 0.03 + br() * 0.035, h = 0.3 + br() * 0.14;
      bm.compose(new THREE.Vector3(x + w / 2, 0.08 + k * 0.52 + h / 2, 0.02), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), br() < 0.1 ? 0.25 : 0), new THREE.Vector3(w, h, 0.24));
      books.setMatrixAt(bi, bm); books.setColorAt(bi, new THREE.Color(bcols[(br() * bcols.length) | 0]));
      bi++; x += w + 0.004 + (br() < 0.08 ? 0.12 : 0);
    }
  }
  books.count = bi;
  shelf.add(books);
  shelf.position.set(-3.25, 0, -1.4); shelf.rotation.y = Math.PI / 2;
  room.add(shelf);
  // lareira (direita), com brasas que piscam
  const fire = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x6a5a50 });
  const fb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.4), stone); fb.position.set(0, 0.6, 0); fire.add(fb);
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), darkWood); mantel.position.set(0, 1.24, 0.03); fire.add(mantel);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.05), new THREE.MeshBasicMaterial({ color: 0x0a0503 })); hole.position.set(0, 0.42, 0.18); fire.add(hole);
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  const embers = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(2, 0.6, 0.9), emberMat);
  embers.position.set(0, 0.14, 0.12); fire.add(embers);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb84a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const flames = [];
  for (let k = 0; k < 3; k++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 8), flameMat);
    f.position.set(-0.15 + k * 0.15, 0.3, 0.12); fire.add(f); flames.push(f);
  }
  fire.position.set(3.25, 0, -1.2); fire.rotation.y = -Math.PI / 2;
  room.add(fire);
  // quadro em cima da lareira e um relógio na parede do fundo
  const clockC = canvas(256, 256), cg = clockC.getContext('2d');
  cg.fillStyle = '#f2e6c8'; cg.beginPath(); cg.arc(128, 128, 120, 0, Math.PI * 2); cg.fill();
  cg.strokeStyle = '#4a2c16'; cg.lineWidth = 12; cg.stroke();
  cg.fillStyle = '#2a1a10'; cg.font = 'bold 26px Georgia'; cg.textAlign = 'center'; cg.textBaseline = 'middle';
  for (let k = 1; k <= 12; k++) { const a = k * Math.PI / 6 - Math.PI / 2; cg.fillText(String(k), 128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); }
  cg.lineWidth = 6; cg.beginPath(); cg.moveTo(128, 128); cg.lineTo(128 + 40, 128 - 30); cg.moveTo(128, 128); cg.lineTo(128 - 10, 128 - 75); cg.stroke();
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshLambertMaterial({ map: tex(clockC) }));
  clock.position.set(1.0, 2.1, -4.26);
  room.add(clock);

  // Lampião pendurado
  const lampG = new THREE.Group();
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.0), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  cord.position.y = 0.62; lampG.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 24, 1, true), new THREE.MeshLambertMaterial({ color: 0x2a4a2a, side: THREE.DoubleSide, emissive: 0x0a1a0a }));
  shade.position.y = 0.1; lampG.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
  bulb.position.y = 0.0; lampG.add(bulb);
  lampG.position.set(TABLE.x, 2.05, TABLE.z);
  scene.add(lampG);

  // ---------- Mesa ----------
  const tableRoot = new THREE.Group();
  tableRoot.position.set(TABLE.x, 0, TABLE.z);
  scene.add(tableRoot);
  const tableWood = tex(woodCanvas(1024, 1024, '#7a4a26', '40,20,6', 11));
  const topMat = new THREE.MeshStandardMaterial({ map: tableWood, roughness: 0.55, metalness: 0.0 });
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.r, TABLE.r, 0.05, 64), topMat);
  tableTop.position.y = TABLE.top - 0.025;
  tableRoot.add(tableTop);
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.r - 0.04, TABLE.r - 0.06, 0.1, 48, 1, true), darkWood);
  apron.position.y = TABLE.top - 0.1; tableRoot.add(apron);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, TABLE.top - 0.1, 16), darkWood);
  column.position.y = (TABLE.top - 0.1) / 2; tableRoot.add(column);
  for (let k = 0; k < 4; k++) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), darkWood);
    foot.position.set(Math.cos(k * Math.PI / 2 + Math.PI / 4) * 0.22, 0.03, Math.sin(k * Math.PI / 2 + Math.PI / 4) * 0.22);
    foot.rotation.y = -(k * Math.PI / 2 + Math.PI / 4); tableRoot.add(foot);
  }
  // sombra macia embaixo da mesa (pintada)
  const blobC = canvas(128, 128), bl = blobC.getContext('2d');
  const bgrd = bl.createRadialGradient(64, 64, 0, 64, 64, 64); bgrd.addColorStop(0, 'rgba(0,0,0,0.55)'); bgrd.addColorStop(1, 'rgba(0,0,0,0)');
  bl.fillStyle = bgrd; bl.fillRect(0, 0, 128, 128);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex(blobC), transparent: true, depthWrite: false }));
  blob.position.y = 0.008; tableRoot.add(blob);

  // Bandejas (fixas na mesa): seis buracos para as peças de cada um
  const trayMat = new THREE.MeshLambertMaterial({ color: 0x3a2414 });
  for (const team of [0, 1]) {
    for (let k = 0; k < 6; k++) {
      const a = trayAngle(team, k);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.008, 24), trayMat);
      cup.position.set(Math.cos(a) * TRAY_R, TABLE.top + 0.002, -Math.sin(a) * TRAY_R);
      tableRoot.add(cup);
    }
  }

  // Parte que gira (no VR dá para girar a mesa com o manche): calha, pino, disco e peças
  const spin = new THREE.Group();
  spin.position.y = TABLE.top;
  tableRoot.add(spin);
  const troughMat = new THREE.MeshStandardMaterial({ color: 0x2a170c, roughness: 0.8 });
  const trough = new THREE.Mesh(new THREE.RingGeometry(TROUGH.r0, TROUGH.r1, 64).rotateX(-Math.PI / 2), troughMat);
  trough.position.y = -TROUGH.depth + 0.001;
  spin.add(trough);
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a046, roughness: 0.3, metalness: 0.85 });
  for (const r of [TROUGH.r0, TROUGH.r1]) {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 64).rotateX(Math.PI / 2), brass);
    lip.position.y = 0.002; spin.add(lip);
  }
  const pinH = DISC.h - TABLE.top;
  const pinBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.03, 24), brass);
  pinBase.position.y = 0.015; spin.add(pinBase);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, pinH - 0.02, 16), brass);
  pin.position.y = (pinH - 0.02) / 2 + 0.02; spin.add(pin);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 10), brass);
  ball.position.y = pinH - 0.004; spin.add(ball);
  // mola em volta do pino
  const springPts = [];
  for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 14; springPts.push(new THREE.Vector3(Math.cos(a) * 0.04, 0.03 + i / 120 * (pinH - 0.06), Math.sin(a) * 0.04)); }
  const springM = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(springPts), 240, 0.004, 5), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.35 }));
  spin.add(springM);

  const tilt = new THREE.Group();
  tilt.position.y = pinH;
  spin.add(tilt);
  const discTex = tex(discCanvas());
  const sideTex = tex(woodCanvas(512, 64, '#8a5a30', '40,20,6', 2));
  const discMesh = new THREE.Mesh(new THREE.CylinderGeometry(DISC.R, DISC.R * 0.97, DISC.t, 72), [
    new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.42, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.7 }),
  ]);
  discMesh.position.y = DISC.t / 2;
  tilt.add(discMesh);
  // o raio do mouse/controle acerta este plano (o tampo do disco)
  const discHit = new THREE.Mesh(new THREE.CircleGeometry(DISC.R * 1.02, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  discHit.position.y = DISC.t + 0.001;
  tilt.add(discHit);
  const piecesGroup = new THREE.Group();
  piecesGroup.position.y = DISC.t;
  tilt.add(piecesGroup);
  const fallenGroup = new THREE.Group();
  spin.add(fallenGroup);

  // Peças: geometria e materiais compartilhados
  const pieceGeo = {}, pieceMats = [{}, {}], ghostMats = [{}, {}];
  for (const w of [1, 2, 3]) {
    const { r, h } = PIECE[w];
    pieceGeo[w] = new THREE.CylinderGeometry(r, r * 1.04, h, 28).translate(0, h / 2, 0);
    for (const team of [0, 1]) {
      const side = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.35, metalness: 0.05 });
      const top = new THREE.MeshStandardMaterial({ map: tex(pieceTopCanvas(team, w)), roughness: 0.35 });
      pieceMats[team][w] = [side, top, side];
      ghostMats[team][w] = new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.45, depthWrite: false });
    }
  }
  function makePiece(team, w, ghost = false) {
    const m = new THREE.Mesh(pieceGeo[w], ghost ? ghostMats[team][w] : pieceMats[team][w]);
    m.userData = { team, w };
    return m;
  }

  // Anel que marca a casa escolhida e anéis vermelhos nas peças que vão cair (prévia)
  const markGeo = new THREE.RingGeometry(0.044, 0.056, 32).rotateX(-Math.PI / 2);
  const cellMark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.9, depthWrite: false }));
  cellMark.visible = false; cellMark.renderOrder = 3;
  piecesGroup.add(cellMark);
  const dangerMarks = [];
  for (let k = 0; k < 12; k++) {
    const d = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.068, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.9, depthWrite: false }));
    d.visible = false; d.renderOrder = 3; piecesGroup.add(d); dangerMarks.push(d);
  }
  // Aro da prévia: mostra como o disco vai ficar (inclinação) antes de jogar
  const ghostRim = new THREE.Mesh(new THREE.TorusGeometry(DISC.R, 0.0045, 6, 72).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.85, depthWrite: false }));
  ghostRim.position.y = pinH + DISC.t;
  ghostRim.visible = false; ghostRim.renderOrder = 4;
  spin.add(ghostRim);
  const arrowGeo = new THREE.ConeGeometry(0.025, 0.07, 12).rotateX(Math.PI / 2);   // aponta para +z
  const ghostArrow = new THREE.Mesh(arrowGeo, ghostRim.material);
  ghostArrow.visible = false; ghostArrow.renderOrder = 4;
  spin.add(ghostArrow);

  // Nível de bolha na beira da mesa (perto de quem joga): a bolha vai para o lado alto
  const level = new THREE.Group();
  const lvBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.02, 32), brass);
  level.add(lvBase);
  const lvC = canvas(128, 128), lg = lvC.getContext('2d');
  lg.fillStyle = '#d8e8a0'; lg.fillRect(0, 0, 128, 128);
  lg.strokeStyle = '#2a3a10'; lg.lineWidth = 3;
  for (const r of [16, 40, 60]) { lg.beginPath(); lg.arc(64, 64, r, 0, Math.PI * 2); lg.stroke(); }
  lg.strokeStyle = '#c0301a'; lg.lineWidth = 4; lg.beginPath(); lg.arc(64, 64, 60, 0, Math.PI * 2); lg.stroke();
  const lvFace = new THREE.Mesh(new THREE.CircleGeometry(0.052, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex(lvC) }));
  lvFace.position.y = 0.0105; level.add(lvFace);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8).scale(1, 0.4, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  bubble.position.y = 0.013; level.add(bubble);
  level.position.set(-0.43, TABLE.top + 0.01, 0.30);
  tableRoot.add(level);

  // Placa do placar atrás do adversário: preenchida pelo main.js
  const boardC = canvas(1024, 384);
  const boardTex = tex(boardC);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5625), new THREE.MeshBasicMaterial({ map: boardTex }));
  board.position.set(0.95, 1.95, -4.24);
  room.add(board);
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.66, 0.04), frameMat);
  boardFrame.position.set(0.95, 1.95, -4.27); room.add(boardFrame);
  clock.position.set(-2.4, 2.25, -4.26);
  function drawBoard({ names, scores, round, footer, colors = ['#ff8a7a', '#8ab8ff'] }) {
    const g = boardC.getContext('2d');
    g.fillStyle = '#1e2a1e'; g.fillRect(0, 0, 1024, 384);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    for (let i = 0; i < 30; i++) { g.beginPath(); g.moveTo(Math.random() * 1024, Math.random() * 384); g.lineTo(Math.random() * 1024, Math.random() * 384); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f0ead8'; g.font = 'bold 44px Georgia, serif'; g.fillText('GANGORRA', 512, 50);
    for (const k of [0, 1]) {
      const x = k ? 768 : 256;
      g.fillStyle = colors[k]; g.font = 'bold 40px sans-serif'; g.fillText(names[k], x, 120);
      g.fillStyle = '#f0ead8'; g.font = 'bold 120px Georgia, serif'; g.fillText(String(scores[k]), x, 230);
    }
    g.fillStyle = '#d8d0b8'; g.font = '32px sans-serif'; g.fillText(round || '', 512, 230);
    g.font = '30px sans-serif'; g.fillText(footer || '', 512, 335);
    boardTex.needsUpdate = true;
  }

  // ---------- Adversário (do outro lado da mesa) ----------
  const avatar = makeAvatar();
  avatar.group.position.set(TABLE.x, 0, TABLE.z - 0.98);
  scene.add(avatar.group);
  const chair = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.45), darkWood); seat.position.y = 0.5; chair.add(seat);
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.05), darkWood); backrest.position.set(0, 0.88, -0.22); chair.add(backrest);
  for (const [x, z] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), darkWood); l.position.set(x, 0.25, z); chair.add(l); }
  chair.position.set(TABLE.x, 0, TABLE.z - 1.08);
  scene.add(chair);

  function animate(dt, time) {
    const f = 0.85 + 0.15 * Math.sin(time * 9) * Math.sin(time * 3.7) + 0.05 * Math.sin(time * 23);
    fireLight.intensity = 3.2 * f;
    emberMat.color.setRGB(1, 0.42 + 0.1 * f, 0.15);
    flames.forEach((fl, k) => { fl.scale.set(1, 0.8 + 0.4 * Math.abs(Math.sin(time * (5 + k) + k)), 1); });
    lampG.rotation.z = Math.sin(time * 0.6) * 0.01;
  }

  return {
    scene, tableRoot, spin, tilt, discMesh, discHit, piecesGroup, fallenGroup, makePiece, cellMark, dangerMarks,
    ghostRim, ghostArrow, level, bubble, avatar, drawBoard, animate, lamp,
  };
}

// Boneco do adversário: corpo, cabeça, olhos que piscam e um enfeite por personalidade.
function makeAvatar() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0b08a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x6fa8dc });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.55, 20), shirt);
  body.position.y = 0.82; group.add(body);
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.5, 0.8), shirt);
  shoulders.position.y = 1.08; group.add(shoulders);
  const headG = new THREE.Group();
  headG.position.y = 1.3; group.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), skin);
  head.scale.set(1, 1.08, 1); headG.add(head);
  const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff }), eyeB = new THREE.MeshBasicMaterial({ color: 0x1a1008 });
  const eyes = [];
  for (const x of [-0.045, 0.045]) {
    const e = new THREE.Group();
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), eyeW); e.add(w);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 6), eyeB); p.position.z = 0.018; e.add(p);
    e.position.set(x, 0.02, 0.11); headG.add(e); eyes.push(e);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x6a2a1a }));
  mouth.position.set(0, -0.055, 0.115); mouth.rotation.z = Math.PI; headG.add(mouth);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), skin); nose.position.set(0, -0.01, 0.13); headG.add(nose);
  // braços apoiados na mesa
  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 10), shirt);
    a.position.set(s * 0.2, 0.86, 0.17); a.rotation.x = Math.PI / 2.6; a.rotation.z = s * 0.25; group.add(a); arms.push(a);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), skin); h.position.set(s * 0.13, 0.8, 0.36); group.add(h);
  }
  // enfeites: coque grisalho e óculos (cuidadosa), boné (arriscado), turbante com joia (mestra)
  const parts = {};
  const hairGrey = new THREE.MeshLambertMaterial({ color: 0xc8c8c8 });
  parts.careful = new THREE.Group();
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hairGrey); hair.position.y = 0.02; hair.rotation.x = -0.25; parts.careful.add(hair);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), hairGrey); bun.position.set(0, 0.12, -0.08); parts.careful.add(bun);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });
  for (const x of [-0.045, 0.045]) { const g = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 20), glassMat); g.position.set(x, 0.02, 0.135); parts.careful.add(g); }
  headG.add(parts.careful);
  parts.risky = new THREE.Group();
  const capMat = new THREE.MeshLambertMaterial({ color: 0xd8401a });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.138, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), capMat); cap.position.y = 0.03; parts.risky.add(cap);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), capMat); brim.position.set(0, 0.04, 0.12); parts.risky.add(brim);
  const beard = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3a2412 })); beard.position.set(0, -0.05, 0.04); parts.risky.add(beard);
  headG.add(parts.risky);
  parts.master = new THREE.Group();
  const turban = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.05, 10, 24).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6a3aa0 })); turban.position.y = 0.08; parts.master.add(turban);
  const tTop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), turban.material); tTop.position.y = 0.09; parts.master.add(tTop);
  const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), new THREE.MeshBasicMaterial({ color: 0x5affc8 })); jewel.position.set(0, 0.09, 0.15); parts.master.add(jewel);
  const hairBlack = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, Math.PI / 2.4, Math.PI / 3), new THREE.MeshLambertMaterial({ color: 0x1a1010 })); hairBlack.rotation.x = 0.2; parts.master.add(hairBlack);
  headG.add(parts.master);
  // balão de "pensando"
  const dotsMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.9 });
  const dots = [];
  for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.018 + k * 0.006, 10, 8), dotsMat); d.position.set(0.16 + k * 0.05, 0.16 + k * 0.05, 0); headG.add(d); dots.push(d); }

  const state = { mood: 0, moodT: 0, thinking: false, look: new THREE.Vector3(), blink: 2 };
  function setStyle(style, color) {
    for (const k of Object.keys(parts)) parts[k].visible = k === style;
    shirt.color.set(color);
  }
  function react(mood) { state.mood = mood; state.moodT = 1.6; }   // +1 feliz, -1 triste
  function update(dt, time, lookAt) {
    state.blink -= dt;
    const blink = state.blink < 0.12;
    if (state.blink < 0) state.blink = 2 + Math.random() * 3;
    for (const e of eyes) e.scale.y = blink ? 0.15 : 1;
    state.moodT = Math.max(0, state.moodT - dt);
    const m = state.moodT > 0 ? state.mood : 0;
    // olhar
    if (lookAt) {
      const local = group.worldToLocal(lookAt.clone()).sub(headG.position);
      const yaw = Math.atan2(local.x, local.z), pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
      headG.rotation.y += (THREE.MathUtils.clamp(yaw, -0.8, 0.8) - headG.rotation.y) * Math.min(1, dt * 4);
      headG.rotation.x += (THREE.MathUtils.clamp(-pitch, -0.6, 0.6) - headG.rotation.x) * Math.min(1, dt * 4);
    }
    headG.rotation.z = state.thinking ? Math.sin(time * 1.5) * 0.12 : m < 0 ? Math.sin(time * 6) * 0.1 : 0;
    headG.position.y = 1.3 + Math.sin(time * 1.7) * 0.006 + (m > 0 ? Math.abs(Math.sin(time * 9)) * 0.04 : 0) - (m < 0 ? 0.03 : 0);
    mouth.rotation.z = m < 0 ? 0 : Math.PI;
    mouth.position.y = m < 0 ? -0.075 : -0.055;
    for (const a of arms) a.rotation.x = Math.PI / 2.6 + (m > 0 ? Math.sin(time * 9) * 0.25 : 0);
    dots.forEach((d, k) => { d.visible = state.thinking; d.position.y = 0.16 + k * 0.05 + Math.sin(time * 4 + k) * 0.01; });
  }
  return { group, setStyle, react, update, state, headG };
}

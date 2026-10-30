// Fumaça do main.js: carrega o jogo inteiro no Node com um navegador de mentira (sem WebGL, sem som)
// e confere que menu, partida (com o robô), clique do PC com prévia e desafios funcionam.
import * as nodeModule from 'node:module';

// ---- navegador de mentira ----
function fakeCtx() {
  const fn = () => proxy;
  const proxy = new Proxy(fn, {
    get(_, k) {
      if (k === 'measureText') return (t) => ({ width: String(t).length * 12 });
      if (k === 'canvas') return null;
      return fn;
    },
    set() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}
function fakeElement(tag = 'div') {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', width: 300, height: 150,
    listeners,
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    getContext() { return fakeCtx(); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    dispatch(t, e) { for (const f of listeners[t] || []) f(e); },
  };
}
function installDom() {
  const els = {};
  const winListeners = {};
  const store = new Map();
  const doc = {
    createElement: (t) => fakeElement(t),
    createElementNS: (_, t) => fakeElement(t),
    getElementById: (id) => (els[id] ||= fakeElement('div')),
    body: fakeElement('body'),
    addEventListener() {},
  };
  const win = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, isSecureContext: false,
    addEventListener(t, f) { (winListeners[t] ||= []).push(f); },
    removeEventListener() {},
    dispatch(t, e) { for (const f of winListeners[t] || []) f(e); },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.self = win;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-teste' }, configurable: true, writable: true });
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  return { els, win, store };
}

// Troca só o WebGLRenderer do Three.js por um de mentira (o resto do Three.js é o de verdade).
function installThreeStub() {
  const stub = new URL('./three-stub.js', import.meta.url).href;
  const resolve = (spec, ctx, next) => {
    if (spec.endsWith('vendor/three/three.module.js') && !String(ctx.parentURL || '').endsWith('three-stub.js')) return { url: stub, shortCircuit: true };
    return next(spec, ctx);
  };
  if (nodeModule.registerHooks) nodeModule.registerHooks({ resolve });
  else throw new Error('Node sem module.registerHooks (precisa do Node 22.15 ou mais novo)');
}

export async function smoke() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const { els, win, store } = installDom();
  installThreeStub();
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  await import('../js/main.js');
  const dev = window.dev;
  ok(dev && typeof dev.advance === 'function', 'main.js carregou e criou window.dev');
  let s = dev.advance(0.5);
  ok(s.tela === 'menu' && s.painel, 'abre no menu principal');
  ok(els.vr.textContent.includes('VR'), `botão de VR avisa que não tem VR aqui ("${els.vr.textContent}")`);

  // Partida: o jogador joga pelo mouse uma vez (clicar na peça e na casa, com prévia)
  s = dev.startMatch(1);
  ok(s.tela === 'play' && s.adversario === 'Dona Lurdes', 'partida contra a Dona Lurdes começou');
  for (let i = 0; i < 40 && dev.state().fase !== 'turn'; i++) dev.advance(0.5);
  s = dev.advance(2);   // espera o disco e a câmera pararem (a vez continua sua)
  ok(s.fase === 'turn' && s.vez === 'você', 'chega a sua vez');
  const canvasEl = window.gangorra.renderer.domElement;
  const tp = dev.trayScreen(3);
  ok(tp, 'peça 3 aparece na bandeja');
  canvasEl.dispatch('pointerdown', { clientX: tp.x, clientY: tp.y, button: 0 });
  ok(dev.state().escolhida === 3, 'clicar na peça da bandeja escolhe o peso');
  const used = new Set(window.gangorra.match.round.pieces.map(p => p.cell));
  const free = [...Array(30).keys()].find(c => c >= 6 && c < 18 && !used.has(c));
  const cp = dev.cellScreen(free);
  canvasEl.dispatch('pointermove', { clientX: cp.x, clientY: cp.y });
  s = dev.advance(0.05);
  ok(s.previa && s.previa.startsWith('Inclinação'), `passar o mouse na casa mostra a prévia ("${s.previa}")`);
  canvasEl.dispatch('pointerdown', { clientX: cp.x, clientY: cp.y, button: 0 });
  s = dev.state();
  ok(s.fase === 'anim' && s.maos[0].split(',').filter(x => x === '3').length === 1, 'clicar na casa joga a peça');
  s = dev.advance(3);
  ok(s.pecas.includes(`V3@${free}`) || s.caidas[0] > 0, `peça 3 ficou na casa ${free} (${s.pecas})`);

  // o resto da partida o robô joga sozinho
  dev.autoplay = true;
  let guard = 0;
  while (!dev.state().vencedor && guard++ < 400) dev.advance(1);
  s = dev.state();
  ok(s.vencedor, `partida terminou sozinha (${s.total?.join(' x ')}, vencedor: ${s.vencedor})`);
  ok(s.salvo.vitorias.reduce((a, b) => a + b, 0) >= 0 && JSON.parse(store.get('gangorravr.v1')).games[0] === 1, 'resultado salvo no localStorage');
  ok(window.gangorra.match.results.length === 2, 'jogou as 2 rodadas');

  // Desafios: o robô resolve todos dentro do jogo
  let stars = [];
  for (let n = 1; n <= 10; n++) {
    dev.loadLevel(n);
    let g = 0;
    while (dev.state().estrelas == null && g++ < 120) dev.advance(0.5);
    stars.push(dev.state().estrelas);
  }
  ok(stars.every(x => x === 3), `robô tira 3 estrelas nos 10 desafios dentro do jogo (${stars.join(' ')})`);
  ok(Object.keys(JSON.parse(store.get('gangorravr.v1')).ch).length === 10, 'estrelas dos desafios salvas');

  // Pausa e menu pelo teclado
  dev.autoplay = false;
  dev.startMatch(3);
  dev.advance(0.2);
  win.dispatch('keydown', { key: 'Escape' });
  ok(dev.state().tela === 'paused', 'Esc pausa');
  win.dispatch('keydown', { key: 'Escape' });
  ok(dev.state().tela === 'play', 'Esc de novo continua');
  // laço de animação roda (renderer de mentira)
  const loop = window.gangorra.renderer._loop;
  for (let i = 0; i < 5; i++) loop?.(performance.now() + i * 16);
  ok(typeof loop === 'function', 'laço de animação ligado');
  console.error = origErr;
  ok(errors.length === 0, `sem erros no console (${errors.slice(0, 2).join(' | ')})`);
  return out;
}

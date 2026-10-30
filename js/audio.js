// Sons sintetizados na hora (sem arquivos): toque de madeira, rangido do pino, batente,
// peça escorregando e caindo, lareira ao fundo, cliques e fanfarras.
// Só liga depois de um clique ou da entrada no VR. Os testes nunca chamam unlock (não toca nada).
export class Sfx {
  constructor() { this.ctx = null; this.on = true; }

  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.9 : 0;
      this.master.connect(this.ctx.destination);
      this.white = this.makeNoise(3, false);
      this.brown = this.makeNoise(3, true);
      // lareira: chiado grave bem baixinho, com estalos soltos (updateAmbience)
      this.fire = this.loop(this.brown, 'lowpass', 380, 0.7);
      this.fire.g.gain.value = 0.035;
      this.popT = 0;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setOn(v) {
    this.on = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  makeNoise(sec, brown) {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { b = 0.98 * b + 0.02 * w; d[i] = b * 7; } else d[i] = w * 0.5;
    }
    return buf;
  }

  loop(buf, type, freq, q) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return { f, g };
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0, attack = 0.004 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.1, freq = 1200, q = 1, at = 0, type = 'bandpass', attack = 0, sweep = 0 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.white;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    g.gain.setValueAtTime(attack ? 0.0001 : vol, t);
    if (attack) g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
  }

  // Peça de madeira pousando na casa: mais grave quanto mais pesada.
  knock(w = 1, at = 0) {
    const f = 330 - 55 * w;
    this.noise(0.03, { vol: 0.35, freq: 2400, q: 1.4, at });
    this.tone(f, 0.16, { vol: 0.32, type: 'triangle', slide: 0.75, at });
    this.tone(f * 2.7, 0.06, { vol: 0.08, at });
  }
  pick() { this.tone(520, 0.06, { vol: 0.1, type: 'triangle', slide: 1.3 }); }
  // Rangido do pino quando o disco mexe: força 0..1
  creak(s = 0.5) {
    if (!this.ctx) return;
    const v = 0.03 + 0.07 * Math.min(1, s);
    this.tone(95 + Math.random() * 30, 0.35 + 0.3 * s, { vol: v, type: 'sawtooth', slide: 1.25 + 0.3 * Math.random(), attack: 0.06 });
    this.noise(0.4, { vol: v * 0.8, freq: 700, q: 6, attack: 0.05, sweep: 1.6 });
  }
  // Disco batendo no batente (passou do limite)
  clack() { this.noise(0.05, { vol: 0.4, freq: 1700, q: 2 }); this.tone(410, 0.22, { vol: 0.18, type: 'square', slide: 0.6 }); }
  // Peça escorregando pela madeira
  slide(at = 0) { this.noise(0.32, { vol: 0.16, freq: 1400, q: 1.2, at, attack: 0.04, sweep: 0.5 }); }
  // Peça caindo na calha da mesa
  thud(w = 1, at = 0) { this.tone(140 - 18 * w, 0.2, { vol: 0.3, type: 'sine', slide: 0.6, at }); this.noise(0.08, { vol: 0.2, freq: 600, q: 0.8, type: 'lowpass', at }); }
  click() { this.tone(880, 0.05, { vol: 0.07, type: 'square' }); }
  good() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, { vol: 0.1, type: 'triangle', at: i * 0.08 })); }
  bad() { this.tone(330, 0.5, { vol: 0.1, type: 'triangle', slide: 0.7 }); this.tone(262, 0.6, { vol: 0.06, type: 'sine', slide: 0.7, at: 0.12 }); }
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i === 5 ? 0.7 : 0.18, { vol: 0.12, type: 'triangle', at: i * 0.12 })); }
  star(n) { this.tone(784 * (1 + n * 0.26), 0.35, { vol: 0.12, type: 'triangle' }); }

  // Lareira: estalos de vez em quando
  updateAmbience(dt) {
    if (!this.ctx) return;
    this.popT -= dt;
    if (this.popT <= 0) {
      this.popT = 0.25 + Math.random() * 1.6;
      this.noise(0.02 + Math.random() * 0.03, { vol: 0.03 + Math.random() * 0.05, freq: 1500 + Math.random() * 2500, q: 2 });
    }
  }
}

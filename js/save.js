// Progresso e opções, salvos no navegador.
const KEY = 'gangorravr.v1';
const DEFAULTS = {
  wins: [0, 0, 0],      // vitórias contra cada adversário
  games: [0, 0, 0],     // partidas jogadas contra cada um
  ch: {},               // desafios: { 0: 3, 1: 2, ... } = melhor número de estrelas
  sound: true,
  fps: false,
  preview: true,        // mostrar a prévia da inclinação
};

export function loadSave() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (!Array.isArray(s.wins) || s.wins.length !== 3) s.wins = [0, 0, 0];
    if (!Array.isArray(s.games) || s.games.length !== 3) s.games = [0, 0, 0];
    if (typeof s.ch !== 'object' || !s.ch) s.ch = {};
    return s;
  } catch { return { ...DEFAULTS, wins: [0, 0, 0], games: [0, 0, 0], ch: {} }; }
}

export function storeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sem armazenamento: segue sem salvar */ }
}

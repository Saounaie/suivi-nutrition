// Petits bruitages synthétisés (Web Audio, aucun fichier). Désactivables dans les Réglages.
// Sur iPhone, le commutateur silencieux coupe aussi ces sons.
let ctx = null;
let enabled = true;

export function setSoundEnabled(v) { enabled = !!v; }

function ac() {
  if (!enabled) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (_) { return null; }
}

function tone(freq, start, dur, { type = 'sine', gain = 0.07, slideTo = null } = {}) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export const sfx = {
  tap() { tone(520, 0, 0.05, { gain: 0.035 }); },
  success() { tone(660, 0, 0.12, { gain: 0.06 }); tone(990, 0.09, 0.2, { gain: 0.06 }); },
  remove() { tone(420, 0, 0.16, { gain: 0.05, slideTo: 240 }); },
  error() { tone(200, 0, 0.14, { type: 'triangle', gain: 0.06 }); tone(170, 0.12, 0.18, { type: 'triangle', gain: 0.06 }); },
  goal() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.28, { gain: 0.05 })); },
};

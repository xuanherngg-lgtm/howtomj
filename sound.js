/* HowToMJ sound effects, synthesised with Web Audio (no audio files). Exposes window.Sound. */
(function () {
  'use strict';
  const KEY = 'howtomj.sound.v1';
  let ctx = null;
  let enabled = (function () { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } })();

  function audio() {
    if (!enabled) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  /** A short noise burst through a band-pass filter: the "clack" of tiles. */
  function clack(when, freq, gain, length) {
    const a = audio();
    if (!a) return;
    const n = Math.floor(a.sampleRate * (length || 0.05));
    const buf = a.createBuffer(1, n, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq || 2200;
    filter.Q.value = 1.4;
    const g = a.createGain();
    g.gain.value = gain || 0.5;
    src.connect(filter).connect(g).connect(a.destination);
    src.start(a.currentTime + (when || 0));
  }

  /** A soft sine/triangle note. */
  function note(when, freq, dur, type, gain) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime + (when || 0);
    const osc = a.createOscillator();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.18, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const effects = {
    draw: () => clack(0, 3000, 0.25, 0.03),
    discard: () => { clack(0, 1800, 0.6, 0.06); clack(0.025, 2600, 0.25, 0.04); },
    deal: () => { clack(0, 2400, 0.3, 0.04); clack(0.06, 2000, 0.3, 0.04); },
    flower: () => { note(0, 880, 0.18, 'sine', 0.12); note(0.08, 1320, 0.25, 'sine', 0.1); },
    pong: () => { note(0, 523, 0.14); note(0.1, 784, 0.22); },
    chi: () => { note(0, 587, 0.12); note(0.08, 698, 0.12); note(0.16, 880, 0.2); },
    kong: () => { note(0, 392, 0.14); note(0.1, 523, 0.14); note(0.2, 784, 0.3); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => note(i * 0.11, f, 0.45, 'triangle', 0.2)),
    lose: () => { note(0, 392, 0.25, 'sine', 0.12); note(0.18, 311, 0.4, 'sine', 0.12); },
    chips: () => [0, 0.05, 0.1].forEach((w, i) => clack(w, 4200 - i * 400, 0.22, 0.03)),
    dice: () => { for (let i = 0; i < 7; i++) clack(i * 0.07 + Math.random() * 0.03, 1400 + Math.random() * 800, 0.35, 0.05); },
    tap: () => clack(0, 3600, 0.15, 0.02),
  };

  window.Sound = {
    play(name) { try { if (enabled && effects[name]) effects[name](); } catch (e) { /* audio is optional */ } },
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (on) effects.tap();
    },
  };
})();

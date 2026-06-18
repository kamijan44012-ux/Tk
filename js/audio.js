/* ============================================================
   AUDIO ENGINE — fully procedural (Web Audio API)
   No external files: all SFX & music are synthesized at runtime,
   so the game stays tiny and loads instantly on mobile.
   ============================================================ */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = false;
    this._musicTimer = null;
    this._musicStep = 0;
  }

  /* Must be called from a user gesture (tap/click) to satisfy
     mobile autoplay policies. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.28;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.85;
    this.sfxGain.connect(this.master);

    this.enabled = true;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /* ---------- low level helpers ---------- */
  _osc(type, freq, t0, t1, gain, dest) {
    if (!this.enabled) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t0); o.stop(t1 + 0.02);
    return o;
  }

  _noise(t0, dur, gain, filterFreq, dest) {
    if (!this.enabled) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filterFreq || 1200;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(bp); bp.connect(g); g.connect(dest || this.sfxGain);
    src.start(t0);
    return src;
  }

  /* ---------- SFX library ---------- */
  punch() {
    const t = this.now;
    this._osc('sine', 160, t, t + 0.12, 0.5);
    this._osc('triangle', 90, t, t + 0.16, 0.4);
    this._noise(t, 0.09, 0.35, 1700);
  }

  kick() {
    const t = this.now;
    this._osc('sine', 110, t, t + 0.18, 0.6);
    this._osc('square', 70, t, t + 0.14, 0.25);
    this._noise(t, 0.12, 0.4, 900);
  }

  special() {
    const t = this.now;
    // rising energy "woosh + blast"
    const o = this.ctx && this.ctx.createOscillator();
    if (o) {
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 0.6);
    }
    this._noise(t + 0.3, 0.3, 0.45, 2200);
    this._osc('sine', 70, t + 0.32, t + 0.6, 0.6);
  }

  block() {
    const t = this.now;
    this._noise(t, 0.06, 0.3, 3200);
    this._osc('square', 320, t, t + 0.05, 0.18);
  }

  whiff() {
    const t = this.now;
    this._noise(t, 0.12, 0.18, 2600);
  }

  hurt() {
    const t = this.now;
    this._osc('sawtooth', 240, t, t + 0.12, 0.25);
    this._osc('triangle', 180, t + 0.02, t + 0.18, 0.3);
  }

  grunt(pitch = 1) {
    const t = this.now;
    this._osc('triangle', 150 * pitch, t, t + 0.16, 0.35);
    this._osc('sawtooth', 90 * pitch, t, t + 0.12, 0.15);
  }

  ko() {
    const t = this.now;
    this._osc('sine', 200, t, t + 0.8, 0.6);
    this._osc('sine', 100, t + 0.05, t + 0.9, 0.5);
    this._noise(t, 0.5, 0.4, 600);
  }

  bell() { // round start
    const t = this.now;
    this._osc('sine', 880, t, t + 0.5, 0.4);
    this._osc('sine', 1320, t, t + 0.4, 0.2);
  }

  uiClick() {
    const t = this.now;
    this._osc('square', 520, t, t + 0.05, 0.15);
  }

  /* ---------- Background music (procedural loop) ----------
     A driving minor-key arpeggio + bass, scheduled step by step. */
  startMusic() {
    if (!this.enabled || this._musicTimer) return;
    const bpm = 140;
    const step = 60 / bpm / 2; // eighth notes
    // A minor pentatonic-ish riff (Hz)
    const bass = [55, 55, 73.4, 65.4];          // A1 A1 D2 C2
    const lead = [220, 261.6, 329.6, 392, 329.6, 261.6, 293.6, 220];
    this._musicStep = 0;
    const tick = () => {
      if (!this.enabled) return;
      const t = this.now + 0.02;
      const s = this._musicStep;
      // bass every 4 steps
      if (s % 4 === 0) {
        const f = bass[(s / 4) % bass.length];
        this._osc('triangle', f, t, t + step * 3.2, 0.5, this.musicGain);
        this._osc('sawtooth', f, t, t + step * 1.5, 0.12, this.musicGain);
      }
      // lead arpeggio
      const lf = lead[s % lead.length];
      this._osc('square', lf, t, t + step * 0.9, 0.10, this.musicGain);
      // hi-hat
      this._noise(t, 0.03, s % 2 ? 0.05 : 0.09, 6000, this.musicGain);
      // kick on downbeats
      if (s % 4 === 0) {
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.18);
      }
      this._musicStep = (s + 1) % 32;
    };
    tick();
    this._musicTimer = setInterval(tick, step * 1000);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }

  setMusicVolume(v) { if (this.musicGain) this.musicGain.gain.value = v; }
}

export const audio = new AudioEngine();

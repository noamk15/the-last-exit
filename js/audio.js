// Procedural sound via Web Audio API. No audio files.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.drone = null;
    this._stepT = 0;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  startDrone() {
    if (!this.ensure() || this.drone) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.16, c.currentTime, 3);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.8;
    const oscs = [];
    for (const [f, type] of [[46, 'sawtooth'], [46.6, 'triangle'], [92.3, 'sine'], [69, 'sine']]) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = f;
      o.connect(lp);
      o.start();
      oscs.push(o);
    }
    // slow breathing LFO on the filter
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 70;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    // soft noise bed
    const noise = this._noise(c, 4);
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.5;
    const ng = c.createGain(); ng.gain.value = 0.025;
    noise.connect(nf).connect(ng).connect(g);
    noise.start();
    lp.connect(g).connect(this.master);
    this.drone = { g, oscs, lfo, noise };
  }

  stopDrone() {
    if (!this.drone) return;
    const { g, oscs, lfo, noise } = this.drone;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, t, 0.8);
    setTimeout(() => { oscs.forEach(o => o.stop()); lfo.stop(); noise.stop(); }, 3000);
    this.drone = null;
  }

  _noise(c, seconds) {
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  _tone(freq, dur, type = 'sine', vol = 0.3, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pickup() {
    if (!this.ensure()) return;
    this._tone(880, 0.5, 'sine', 0.18);
    this._tone(1320, 0.7, 'sine', 0.12, 0.06);
    this._tone(1760, 1.1, 'triangle', 0.06, 0.12);
  }

  unlock() {
    if (!this.ensure()) return;
    // deep metallic thud + rising shimmer
    this._tone(55, 1.4, 'sawtooth', 0.25);
    this._tone(110, 1.0, 'square', 0.08, 0.05);
    for (let i = 0; i < 5; i++) this._tone(440 * Math.pow(1.5, i), 0.8, 'sine', 0.05, 0.3 + i * 0.12);
  }

  win() {
    if (!this.ensure()) return;
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 2.2, 'sine', 0.12, i * 0.18));
  }

  // call every frame; plays a soft step while moving
  footsteps(dt, moving) {
    if (!this.ctx || this.muted) return;
    if (!moving) { this._stepT = 0.25; return; }
    this._stepT -= dt;
    if (this._stepT > 0) return;
    this._stepT = 0.48;
    const c = this.ctx, t = c.currentTime;
    const src = this._noise(c, 0.2);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320 + Math.random() * 120;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.2);
  }
}

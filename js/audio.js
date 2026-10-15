// Procedural horror sound design via Web Audio API. No audio files.
// music: tense bass pulse + dissonant pad + random stingers, intensity 0..1
// heartbeat: speeds up with tension; footsteps; chimes; game-over boom.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.drone = null;
    this.music = null;
    this._stepT = 0;
    this._beatT = 0;
    this._stingT = 8;
    this._tension = 0;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      // gentle limiter so stingers never clip
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
      this.comp.connect(this.master);
      this.bus = this.comp;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  duck(on) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : (on ? 0.25 : 0.8), this.ctx.currentTime, 0.2);
  }

  _noise(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  _tone(freq, dur, type = 'sine', vol = 0.3, delay = 0, dest = null, sweepTo = null) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest || this.bus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- menu drone
  startDrone() {
    if (!this.ensure() || this.drone) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.14, c.currentTime, 3);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.8;
    const oscs = [];
    for (const [f, type] of [[46, 'sawtooth'], [46.6, 'triangle'], [92.3, 'sine'], [69, 'sine']]) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = f;
      o.connect(lp); o.start(); oscs.push(o);
    }
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 70;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    lp.connect(g).connect(this.bus);
    this.drone = { g, oscs, lfo };
  }
  stopDrone() {
    if (!this.drone) return;
    const { g, oscs, lfo } = this.drone;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
    setTimeout(() => { oscs.forEach(o => o.stop()); lfo.stop(); }, 3000);
    this.drone = null;
  }

  // ---------------------------------------------------------------- tense music
  startMusic() {
    if (!this.ensure() || this.music) return;
    this.stopDrone();
    const c = this.ctx, t = c.currentTime;
    const out = c.createGain(); out.gain.value = 0; out.gain.setTargetAtTime(1, t, 2);
    out.connect(this.bus);

    // 1. bass pulse (heart of the tension)
    const bass = c.createOscillator(); bass.type = 'sine'; bass.frequency.value = 41.2;
    const bassG = c.createGain(); bassG.gain.value = 0.22;
    const pulse = c.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 1.1;
    const pulseG = c.createGain(); pulseG.gain.value = 0.11;
    pulse.connect(pulseG).connect(bassG.gain);
    bass.connect(bassG).connect(out);
    bass.start(); pulse.start();

    // 2. dissonant pad: detuned saws, minor second, slow filter sweep
    const padF = c.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 260; padF.Q.value = 2;
    const padG = c.createGain(); padG.gain.value = 0.05;
    const padOscs = [];
    for (const f of [110, 110.9, 116.5, 220.6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(padF); o.start(); padOscs.push(o);
    }
    const padLfo = c.createOscillator(); padLfo.frequency.value = 0.05;
    const padLfoG = c.createGain(); padLfoG.gain.value = 120;
    padLfo.connect(padLfoG).connect(padF.frequency); padLfo.start();
    padF.connect(padG).connect(out);

    // 3. high eerie whistle with vibrato, very quiet
    const hi = c.createOscillator(); hi.type = 'sine'; hi.frequency.value = 1567;
    const hiG = c.createGain(); hiG.gain.value = 0.012;
    const vib = c.createOscillator(); vib.frequency.value = 5.5;
    const vibG = c.createGain(); vibG.gain.value = 9;
    vib.connect(vibG).connect(hi.frequency); vib.start();
    const hiTrem = c.createOscillator(); hiTrem.frequency.value = 0.21;
    const hiTremG = c.createGain(); hiTremG.gain.value = 0.012;
    hiTrem.connect(hiTremG).connect(hiG.gain); hiTrem.start();
    hi.connect(hiG).connect(out); hi.start();

    // 4. wind / breath bed
    const wind = this._noise(3);
    const windF = c.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 500; windF.Q.value = 0.6;
    const windG = c.createGain(); windG.gain.value = 0.03;
    const windLfo = c.createOscillator(); windLfo.frequency.value = 0.13;
    const windLfoG = c.createGain(); windLfoG.gain.value = 300;
    windLfo.connect(windLfoG).connect(windF.frequency); windLfo.start();
    wind.connect(windF).connect(windG).connect(out); wind.start();

    this.music = { out, bass, bassG, pulse, pulseG, padF, padG, padOscs, padLfo, hi, hiG, vib, hiTrem, wind, windF, windG, windLfo };
    this._stingT = 6 + Math.random() * 6;
    this._beatT = 0;
    this._tension = 0;
  }

  stopMusic() {
    if (!this.music) return;
    const m = this.music;
    m.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    setTimeout(() => {
      [m.bass, m.pulse, m.padLfo, m.hi, m.vib, m.hiTrem, m.wind, m.windLfo, ...m.padOscs].forEach(n => { try { n.stop(); } catch { /* already stopped */ } });
      m.out.disconnect();
    }, 2500);
    this.music = null;
  }

  // tension 0..1 : raises tempo, filter, stinger rate, heartbeat
  setTension(t) {
    this._tension = Math.max(0, Math.min(1, t));
    if (!this.music) return;
    const m = this.music, now = this.ctx.currentTime;
    m.pulse.frequency.setTargetAtTime(1.1 + this._tension * 3.2, now, 0.5);
    m.bassG.gain.setTargetAtTime(0.22 + this._tension * 0.16, now, 0.5);
    m.padG.gain.setTargetAtTime(0.05 + this._tension * 0.09, now, 0.5);
    m.padF.Q.setTargetAtTime(2 + this._tension * 8, now, 0.5);
    m.windG.gain.setTargetAtTime(0.03 + this._tension * 0.06, now, 0.5);
  }

  // called every frame while playing (dt in seconds)
  tick(dt) {
    if (!this.ctx || !this.music || this.muted) return;
    // random stingers
    this._stingT -= dt;
    if (this._stingT <= 0) {
      this._stingT = (7 + Math.random() * 10) * (1 - this._tension * 0.6);
      this.stinger();
    }
    // heartbeat when tension rises
    if (this._tension > 0.05) {
      this._beatT -= dt;
      if (this._beatT <= 0) {
        const bpm = 60 + this._tension * 100;
        this._beatT = 60 / bpm;
        this.heartbeat(0.5 + this._tension * 0.5);
      }
    }
  }

  stinger() {
    const r = Math.random();
    if (r < 0.35) {
      // metallic hit far away
      this._tone(180, 1.6, 'square', 0.05, 0, null, 60);
      this._tone(1230, 0.9, 'triangle', 0.03, 0.01, null, 400);
      const n = this._noise(0.5), f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 4;
      const g = this.ctx.createGain(); const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      n.connect(f).connect(g).connect(this.bus); n.start(t); n.stop(t + 0.7);
    } else if (r < 0.7) {
      // riser: tension sweep
      this._tone(160, 2.6, 'sawtooth', 0.025, 0, null, 900);
      this._tone(161.5, 2.6, 'sawtooth', 0.025, 0, null, 905);
    } else {
      this.whisper();
    }
  }

  whisper() {
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(1.5);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9;
    f.frequency.setValueAtTime(900, t);
    for (let i = 1; i <= 8; i++) f.frequency.linearRampToValueAtTime(600 + Math.random() * 1800, t + i * 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.3);
    g.gain.linearRampToValueAtTime(0, t + 1.5);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; n.connect(f).connect(g).connect(pan).connect(this.bus); }
    else n.connect(f).connect(g).connect(this.bus);
    n.start(t); n.stop(t + 1.6);
  }

  heartbeat(vol) {
    const c = this.ctx, t = c.currentTime;
    for (const [d, v] of [[0, 1], [0.16, 0.7]]) {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t + d); o.frequency.exponentialRampToValueAtTime(38, t + d + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.5 * vol * v, t + d + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.16);
      o.connect(g).connect(this.bus); o.start(t + d); o.stop(t + d + 0.2);
    }
  }

  flashlightClick() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(0.05), g = c.createGain();
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000;
    n.connect(f).connect(g).connect(this.bus); n.start(t); n.stop(t + 0.06);
  }

  pickup() {
    if (!this.ensure()) return;
    this._tone(880, 0.5, 'sine', 0.18);
    this._tone(1320, 0.7, 'sine', 0.12, 0.06);
    this._tone(1760, 1.1, 'triangle', 0.06, 0.12);
  }

  unlock() {
    if (!this.ensure()) return;
    this._tone(55, 1.4, 'sawtooth', 0.25);
    this._tone(110, 1.0, 'square', 0.08, 0.05);
    for (let i = 0; i < 5; i++) this._tone(440 * Math.pow(1.5, i), 0.8, 'sine', 0.05, 0.3 + i * 0.12);
  }

  win() {
    if (!this.ensure()) return;
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 2.2, 'sine', 0.12, i * 0.18));
  }

  gameOver() {
    if (!this.ensure()) return;
    const c = this.ctx, t = c.currentTime;
    this._tone(60, 3.0, 'sine', 0.5, 0, null, 25);
    this._tone(120, 2.0, 'sawtooth', 0.12, 0, null, 30);
    const n = this._noise(2.5), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    n.connect(f).connect(g).connect(this.bus); n.start(t); n.stop(t + 2.6);
    setTimeout(() => this.whisper(), 600);
  }

  footsteps(dt, moving) {
    if (!this.ctx || this.muted) return;
    if (!moving) { this._stepT = 0.25; return; }
    this._stepT -= dt;
    if (this._stepT > 0) return;
    this._stepT = 0.46;
    const c = this.ctx, t = c.currentTime;
    const src = this._noise(0.2);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320 + Math.random() * 120;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t); src.stop(t + 0.2);
  }
}

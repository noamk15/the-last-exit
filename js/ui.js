// DOM overlays: start / HUD / pause / victory. No framework.

const $ = id => document.getElementById(id);

export function formatTime(ms) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export class UI {
  constructor() {
    this.start = $('start');
    this.hud = $('hud');
    this.pause = $('pause');
    this.win = $('win');
    this.nowebgl = $('nowebgl');
    this.fade = $('fade');
    this.hudKeys = Array.from(this.hud.querySelectorAll('.key'));
    this.hudCount = $('hud-count');
    this.hudTimer = $('hud-timer');
    this.hudTimerValue = $('hud-timer-value');
    this.gameover = $('gameover');
    this.deadKeys = $('dead-keys');
    this.danger = $('danger');
    this.hudMessage = $('hud-message');
    this.hudHint = $('hud-hint');
    this.seedValue = $('seed-value');
    this.bestLine = $('best-line');
    this.bestValue = $('best-value');
    this.winTime = $('win-time');
    this.winBest = $('win-best');
    this.buttons = {
      start: $('btn-start'),
      resume: $('btn-resume'),
      restart: $('btn-restart'),
      again: $('btn-again'),
      fullscreen: $('btn-fullscreen'),
      menu: $('btn-menu'),
      menuWin: $('btn-menu-win'),
      retry: $('btn-retry'),
      menuDead: $('btn-menu-dead'),
    };
    this._msgTimer = 0;
  }

  show(el) { el.classList.remove('hidden'); }
  hide(el) { el.classList.add('hidden'); }

  showStart() { this.show(this.start); this.hide(this.hud); this.hide(this.pause); this.hide(this.win); this.hide(this.gameover); this.setDanger(0); }
  showHud()   { this.hide(this.start); this.show(this.hud); this.hide(this.pause); this.hide(this.win); this.hide(this.gameover); }
  showPause() { this.show(this.pause); }
  hidePause() { this.hide(this.pause); }
  showWin()   { this.hide(this.hud); this.hide(this.pause); this.show(this.win); this.setDanger(0); }
  showGameOver(keys, total) { this.deadKeys.textContent = `${keys} / ${total}`; this.hide(this.hud); this.hide(this.pause); this.show(this.gameover); this.setDanger(0); }
  setDanger(v) { this.danger.style.opacity = String(Math.max(0, Math.min(1, v))); }
  showNoWebGL() { this.hide(this.start); this.show(this.nowebgl); }

  setSeed(seed) { this.seedValue.textContent = seed; }

  setKeys(n, total) {
    this.hudKeys.forEach((k, i) => {
      const lit = i < n;
      if (lit && !k.classList.contains('lit')) {
        k.classList.add('pulse');
        setTimeout(() => k.classList.remove('pulse'), 800);
      }
      k.classList.toggle('lit', lit);
    });
    this.hudCount.textContent = `${n} / ${total}`;
  }

  // countdown display: red + blinking under warnMs, bigger under criticalMs
  setCountdown(remainingMs, warnMs = 30000, criticalMs = 10000) {
    this.hudTimerValue.textContent = formatTime(remainingMs);
    this.hudTimer.classList.toggle('warn', remainingMs <= warnMs);
    this.hudTimer.classList.toggle('critical', remainingMs <= criticalMs);
  }

  setHint(text) { this.hudHint.textContent = text; }

  message(text) {
    const el = this.hudMessage;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
  }

  setBest(ms) {
    if (ms == null) { this.bestLine.classList.add('hidden'); return; }
    this.bestLine.classList.remove('hidden');
    this.bestValue.textContent = formatTime(ms);
  }

  setWinStats(ms, bestMs) {
    this.winTime.textContent = formatTime(ms);
    this.winBest.textContent = bestMs == null ? '—' : formatTime(bestMs);
  }

  // fade to black (or to light with flood=true) and back
  fadeOut(flood = false) {
    this.fade.classList.toggle('flood', flood);
    this.fade.classList.remove('instant');
    this.fade.classList.add('on');
    return new Promise(res => setTimeout(res, flood ? 1500 : 900));
  }
  fadeIn() {
    this.fade.classList.remove('on');
    return new Promise(res => setTimeout(res, 900));
  }
}

export function loadBest() {
  try {
    const v = localStorage.getItem('tle_best_ms');
    return v == null ? null : Number(v);
  } catch { return null; }
}
export function saveBest(ms) {
  try { localStorage.setItem('tle_best_ms', String(ms)); } catch { /* private mode */ }
}

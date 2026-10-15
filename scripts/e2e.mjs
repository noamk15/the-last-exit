// End-to-end smoke test: drives headless Chrome through the DevTools protocol.
// Usage: node scripts/e2e.mjs [baseUrl]   (default http://127.0.0.1:8000/)
// Checks: no console errors / failed requests, menu reveal, movement + collisions,
// key pickup, door unlock, victory screen.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000/').replace(/\/?$/, '/');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'tle-e2e-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 1;
const pending = new Map();
const problems = [];
const events = [];

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = ev => {
          const msg = JSON.parse(ev.data);
          if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
          else if (msg.method) events.push(msg);
          if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
          if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
            const text = msg.params.args.map(a => a.value ?? a.description).join(' ');
            if (!/GL Driver Message/.test(text)) problems.push(`console.${msg.params.type}: ${text}`);
          }
          if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/GL Driver/.test(msg.params.entry.text)) problems.push('log: ' + msg.params.entry.text);
          if (msg.method === 'Network.loadingFailed') problems.push('request failed: ' + msg.params.errorText);
          if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) problems.push(`HTTP ${msg.params.response.status}: ${msg.params.response.url}`);
        };
        return;
      }
    } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('could not connect to Chrome');
}
function send(method, params = {}) {
  return new Promise(res => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}
async function navigate(url) {
  await send('Page.navigate', { url });
  await sleep(2500);
}
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) problems.push('check failed: ' + label);
}
async function key(code, down) {
  const keyName = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: keyName });
}

try {
  await connect();
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');

  // 1. menu page: files load, reveal animation ends, menu camera moves
  await navigate(`${BASE}?seed=266`);
  const camA = await evaluate('document.title');
  check(camA === 'The Last Exit', 'page title');
  await sleep(4000);
  const vis = await evaluate(`(() => { const o = s => getComputedStyle(document.querySelector(s)).opacity; return { btn: o('#btn-start'), hints: o('.hints'), meta: o('.meta'), title: o('.title') }; })()`);
  check(Number(vis.btn) > 0.9 && Number(vis.hints) > 0.9 && Number(vis.meta) > 0.9, `menu reveal finished (${JSON.stringify(vis)})`);
  check(await evaluate(`document.getElementById('seed-value').textContent`) === '266', 'seed shown');

  // 2. autostart: play through the level with the test hook
  await navigate(`${BASE}?seed=266&autostart=1`);
  check(await evaluate('window.__tle && window.__tle.state') === 'playing', 'autostart puts game in playing state');
  const p0 = await evaluate('[__tle.player.x, __tle.player.z]');
  await key('KeyW', true); await sleep(900); await key('KeyW', false); await sleep(100);
  const p1 = await evaluate('[__tle.player.x, __tle.player.z]');
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  check(moved > 1.0, `W moves the player forward (${moved.toFixed(2)} units)`);
  const p1b = await evaluate('[__tle.player.x, __tle.player.z]');
  await key('ArrowUp', true); await sleep(600); await key('ArrowUp', false); await sleep(100);
  const p2 = await evaluate('[__tle.player.x, __tle.player.z]');
  check(Math.hypot(p2[0] - p1b[0], p2[1] - p1b[1]) > 0.3 || moved > 3, 'ArrowUp moves the player too');
  // keep walking into the wall for a while: must stay in an open cell
  await key('KeyW', true); await sleep(2500); await key('KeyW', false); await sleep(100);
  const inWall = await evaluate(`(() => { const c = __tle.player.cell(); return __tle.maze.isWall(c.x, c.y); })()`);
  check(!inWall, 'player never ends up inside a wall');

  // collect keys by teleporting onto them
  for (let i = 0; i < 3; i++) {
    await evaluate(`__tle.teleport(__tle.maze.keys[${i}].x, __tle.maze.keys[${i}].y)`);
    await sleep(250);
    check(await evaluate('__tle.keys') === i + 1, `key ${i + 1} collected`);
  }
  check(await evaluate(`document.querySelectorAll('#hud .key.lit').length`) === 3, 'HUD shows 3 lit keys');
  check(await evaluate(`document.getElementById('hud-message').textContent`) === 'THE EXIT IS OPEN', 'unlock message shown');
  await sleep(2000);
  check(await evaluate('__tle.maze.doorOpen') === true, 'door is open after animation');
  await evaluate('__tle.teleport(__tle.maze.door.x, __tle.maze.door.y)');
  await sleep(2500);
  check(await evaluate('__tle.state') === 'won', 'entering the door wins');
  check(await evaluate(`!document.getElementById('win').classList.contains('hidden')`), 'victory screen visible');
  check(await evaluate(`localStorage.getItem('tle_best_ms') !== null`), 'best time saved');
  // play again resets
  await evaluate(`document.getElementById('btn-again').click()`);
  await sleep(1500);
  check(await evaluate('__tle.state') === 'playing' && await evaluate('__tle.keys') === 0, 'play again resets the level');
  await evaluate(`document.getElementById('btn-menu').click()`);
  await sleep(1500);
  check(await evaluate('__tle.state') === 'menu' && await evaluate(`!document.getElementById('start').classList.contains('hidden')`), 'menu button returns to the start screen');

  // 3. countdown, death, random mazes
  await navigate(`${BASE}?autostart=1`);
  const seedA = await evaluate('__tle.seed');
  check(/^\d+$/.test(seedA), `random seed generated without ?seed (${seedA})`);
  await evaluate('__tle.setElapsed(120000 - 25000)');
  await sleep(400);
  check(await evaluate(`document.getElementById('hud-timer').classList.contains('warn')`), 'timer turns red under 30 s');
  await evaluate('__tle.setElapsed(120000 - 300)');
  await sleep(1800);
  check(await evaluate('__tle.state') === 'dead', 'time out kills the player');
  check(await evaluate(`!document.getElementById('gameover').classList.contains('hidden')`), 'game over screen visible');
  await evaluate(`document.getElementById('btn-retry').click()`);
  await sleep(1800);
  const seedB = await evaluate('__tle.seed');
  check(await evaluate('__tle.state') === 'playing' && await evaluate('__tle.remaining') > 118000, 'try again restarts with a full timer');
  check(seedB !== seedA, `try again builds a new random maze (${seedA} -> ${seedB})`);
  const walls = await evaluate(`(() => { let n = 0; const m = __tle.maze; for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (m.isWall(x, y)) n++; return n; })()`);
  check(walls > 40, 'new maze has walls');
} catch (e) {
  problems.push('script error: ' + e.message);
} finally {
  chrome.kill();
}

if (problems.length) {
  console.log('\nPROBLEMS:'); for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('\nALL GOOD');

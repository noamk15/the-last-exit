// THE LAST EXIT — main game loop, scene, state machine.
import * as THREE from 'three';
import { buildLevel, hashSeed, bfs, pathTo, WALL, mulberry32 } from './maze.js';
import { Player } from './player.js';
import { UI, loadBest, saveBest } from './ui.js';
import { AudioSys } from './audio.js';

const S = 2;            // cell size (world units)
const H = 3;            // wall height
const COLS = 13, ROWS = 13;
const TOTAL_KEYS = 3;
const PICKUP_DIST = 1.0;

// ---------------------------------------------------------------- seed + level
const params = new URLSearchParams(location.search);
const seedStr = params.get('seed') || String(Math.floor(Math.random() * 100000));
const seedValue = /^\d+$/.test(seedStr) ? (Number(seedStr) >>> 0) : hashSeed(seedStr);

const ui = new UI();
ui.setSeed(seedStr);
ui.setBest(loadBest());

const maze = buildLevel(seedValue, COLS, ROWS);
const player = new Player(maze, S);
const audio = new AudioSys();

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  ui.showNoWebGL();
  console.error('WebGL unavailable', err);
}

if (renderer) boot();

function boot() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(0x05070a);
  scene.background = bgColor;
  scene.fog = new THREE.FogExp2(0x05070a, 0.075);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 80);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  scene.add(new THREE.AmbientLight(0x8fa0b0, 0.14));

  // flashlight: spotlight carried by the camera, slightly off-centre like a hand-held torch
  const flashlight = new THREE.SpotLight(0xfff0d2, 60, 28, 0.62, 0.9, 1.75);
  flashlight.position.set(0.18, -0.12, 0.1);
  flashlight.target.position.set(0, -0.08, -1);
  camera.add(flashlight);
  camera.add(flashlight.target);

  // ------------------------------------------------------------- textures (procedural)
  const texRng = mulberry32(1234);
  function makeTexture(w, h, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return { tex: t, canvas: c };
  }
  function noise(g, w, h, base, amp) {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (texRng() - 0.5) * amp;
      d[i] = Math.max(0, Math.min(255, base[0] + n));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + n));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + n));
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  // low-frequency mottling: draw coarse noise and scale it up smoothly
  function mottle(g, w, h, base, amp, scale) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w / scale); c.height = Math.ceil(h / scale);
    noise(c.getContext('2d'), c.width, c.height, base, amp);
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, w, h);
  }
  function drawWall(g, w, h) {
    mottle(g, w, h, [74, 78, 76], 50, 10);
    // fine grain
    g.globalAlpha = 0.35;
    const grain = document.createElement('canvas'); grain.width = w; grain.height = h;
    noise(grain.getContext('2d'), w, h, [128, 128, 128], 120);
    g.globalCompositeOperation = 'overlay';
    g.drawImage(grain, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // stone blocks (subtle luminance variation per block)
    const bw = w / 3, bh = h / 6;
    for (let row = 0; row < 6; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * bw + off, y = row * bh;
        const l = texRng() < 0.5 ? 0 : 255;
        g.fillStyle = `rgba(${l},${l},${l},${0.03 + texRng() * 0.06})`;
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 3;
        g.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    // grime at the bottom
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(10,12,8,0.6)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // cracks
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      let x = texRng() * w, y = texRng() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (texRng() - 0.5) * 30; y += texRng() * 22; g.lineTo(x, y); }
      g.stroke();
    }
  }
  function drawFloor(g, w, h) {
    mottle(g, w, h, [50, 50, 47], 34, 8);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke();
    }
    for (let i = 0; i < 10; i++) {
      const x = texRng() * w, y = texRng() * h, r = 20 + texRng() * 60;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(8,10,6,0.55)');
      rg.addColorStop(1, 'rgba(8,10,6,0)');
      g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const wall = makeTexture(256, 384, drawWall);
  const wallBump = new THREE.CanvasTexture(wall.canvas);
  wallBump.wrapS = wallBump.wrapT = THREE.RepeatWrapping;
  const floor = makeTexture(256, 256, drawFloor);
  floor.tex.repeat.set(COLS, ROWS);
  const ceilTex = makeTexture(256, 256, drawFloor);
  ceilTex.tex.repeat.set(COLS, ROWS);

  // ------------------------------------------------------------- geometry
  const wallMat = new THREE.MeshStandardMaterial({ map: wall.tex, bumpMap: wallBump, bumpScale: 0.9, roughness: 0.93, metalness: 0.02 });
  const wallGeo = new THREE.BoxGeometry(S, H, S);
  const wallCells = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (maze.get(x, y) === WALL) wallCells.push([x, y]);
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
  const m4 = new THREE.Matrix4();
  wallCells.forEach(([x, y], i) => {
    m4.makeTranslation((x + 0.5) * S, H / 2, (y + 0.5) * S);
    walls.setMatrixAt(i, m4);
  });
  walls.instanceMatrix.needsUpdate = true;
  scene.add(walls);

  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * S, ROWS * S),
    new THREE.MeshStandardMaterial({ map: floor.tex, roughness: 0.95, color: 0xb8b8b0 })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(COLS * S / 2, 0, ROWS * S / 2);
  scene.add(floorMesh);

  const ceilMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * S, ROWS * S),
    new THREE.MeshStandardMaterial({ map: ceilTex.tex, roughness: 1, color: 0x55554f })
  );
  ceilMesh.rotation.x = Math.PI / 2;
  ceilMesh.position.set(COLS * S / 2, H, ROWS * S / 2);
  scene.add(ceilMesh);

  // ------------------------------------------------------------- keys
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xa8ffbb, emissive: 0x47d676, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.6 });
  const ringGeo = new THREE.TorusGeometry(0.16, 0.045, 10, 26);
  const shaftGeo = new THREE.BoxGeometry(0.44, 0.06, 0.06);
  const toothGeo = new THREE.BoxGeometry(0.06, 0.14, 0.06);
  const keyObjs = maze.keys.map((k, i) => {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, keyMat);
    const shaft = new THREE.Mesh(shaftGeo, keyMat); shaft.position.x = 0.36;
    const t1 = new THREE.Mesh(toothGeo, keyMat); t1.position.set(0.52, -0.09, 0);
    const t2 = new THREE.Mesh(toothGeo, keyMat); t2.position.set(0.41, -0.08, 0);
    const light = new THREE.PointLight(0x6fe08a, 7, 7, 2);
    group.add(ring, shaft, t1, t2, light);
    group.position.set((k.x + 0.5) * S, 1.1, (k.y + 0.5) * S);
    scene.add(group);
    return { group, light, cell: k, phase: i * 2.1, collected: false };
  });

  // ------------------------------------------------------------- exit door
  const door = maze.door;
  const alongX = door.dir[0] !== 0;
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.55, metalness: 0.8, emissive: 0x5a120e, emissiveIntensity: 0.9 });
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.3 : S * 0.94, H * 0.96, alongX ? S * 0.94 : 0.3), doorMat);
  const doorCenter = new THREE.Vector3((door.x + 0.5) * S, H / 2, (door.y + 0.5) * S);
  doorMesh.position.copy(doorCenter);
  scene.add(doorMesh);
  // door frame (two posts + lintel) in dark metal
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6, metalness: 0.7 });
  const postGeo = new THREE.BoxGeometry(alongX ? 0.4 : 0.14, H, alongX ? 0.14 : 0.4);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.copy(doorCenter);
    if (alongX) post.position.z += side * (S / 2 - 0.07); else post.position.x += side * (S / 2 - 0.07);
    scene.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.4 : S, 0.16, alongX ? S : 0.4), frameMat);
  lintel.position.copy(doorCenter); lintel.position.y = H - 0.08;
  scene.add(lintel);
  // the light beyond the door
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(S * 4, H * 2.5), new THREE.MeshBasicMaterial({ color: 0xdffbe6, fog: true }));
  beyond.position.copy(doorCenter).add(new THREE.Vector3(door.dir[0] * S * 1.6, 0.6, door.dir[1] * S * 1.6));
  beyond.lookAt(doorCenter);
  beyond.visible = false;
  scene.add(beyond);
  const beyondLight = new THREE.PointLight(0xc8ffd6, 0, 16, 1.6);
  beyondLight.position.copy(doorCenter).add(new THREE.Vector3(door.dir[0] * S * 0.9, 0.4, door.dir[1] * S * 0.9));
  scene.add(beyondLight);
  const exitLight = new THREE.PointLight(0xff3a2a, 6, 7, 2);
  exitLight.position.set((maze.exit.x + 0.5) * S, 2.3, (maze.exit.y + 0.5) * S);
  scene.add(exitLight);

  // ------------------------------------------------------------- menu glide path
  const fromStart = bfs(maze, maze.start.x, maze.start.y);
  let farIdx = 0;
  for (let i = 0; i < fromStart.dist.length; i++) if (fromStart.dist[i] > fromStart.dist[farIdx]) farIdx = i;
  const glidePath = pathTo(maze, fromStart, farIdx % COLS, Math.floor(farIdx / COLS))
    .map(c => new THREE.Vector3((c.x + 0.5) * S, 1.5, (c.y + 0.5) * S));
  const glide = { i: 0, dir: 1, pos: glidePath[0].clone(), yaw: 0, t: 0 };
  if (glidePath.length > 1) {
    const d0 = glidePath[1].clone().sub(glidePath[0]);
    glide.yaw = Math.atan2(-d0.x, -d0.z);
  }

  // ------------------------------------------------------------- state
  let state = 'menu';       // menu | playing | paused | won
  let keysCollected = 0;
  let elapsed = 0;          // ms of play time
  let doorAnim = -1;        // -1 idle, else seconds since unlock
  let wantResume = false;
  let time = 0;
  const input = { forward: false, back: false, left: false, right: false };

  function resetLevel() {
    keysCollected = 0;
    elapsed = 0;
    doorAnim = -1;
    maze.doorOpen = false;
    doorMesh.position.copy(doorCenter);
    doorMat.emissive.setHex(0x5a120e);
    exitLight.color.setHex(0xff3a2a);
    exitLight.intensity = 6;
    beyond.visible = false;
    beyondLight.intensity = 0;
    keyObjs.forEach(k => { k.collected = false; k.group.visible = true; });
    player.reset(maze.start.x, maze.start.y);
    for (const k in input) input[k] = false;
    ui.setKeys(0, TOTAL_KEYS);
    ui.setTimer(0);
    ui.setHint('FIND THE THREE KEYS');
  }

  // requestPointerLock may throw or return a rejecting promise (cooldown after Esc,
  // unsupported option, headless browser): never let that surface as an error.
  function tryLock(opts) {
    try {
      const p = opts ? canvas.requestPointerLock(opts) : canvas.requestPointerLock();
      if (p && p.catch) return p.then(() => true, () => false);
      return Promise.resolve(true);
    } catch { return Promise.resolve(false); }
  }
  function lockPointer() {
    tryLock({ unadjustedMovement: true }).then(ok => { if (!ok) tryLock(); });
  }

  async function startGame() {
    audio.ensure();
    audio.startDrone();
    lockPointer();
    await ui.fadeOut();
    resetLevel();
    ui.showHud();
    state = 'playing';
    if (document.pointerLockElement !== canvas) lockPointer();
    ui.fadeIn();
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    for (const k in input) input[k] = false;
    ui.showPause();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    wantResume = true;
    lockPointer();
    // fallback for browsers that lock synchronously without an event
    setTimeout(() => { if (wantResume && document.pointerLockElement === canvas) doResume(); }, 50);
  }
  function doResume() {
    wantResume = false;
    if (state !== 'paused') return;
    state = 'playing';
    ui.hidePause();
  }

  async function restartGame() {
    lockPointer();
    await ui.fadeOut();
    resetLevel();
    ui.showHud();
    state = 'playing';
    audio.startDrone();
    if (document.pointerLockElement !== canvas) lockPointer();
    ui.fadeIn();
  }

  async function goToMenu() {
    if (state === 'menu') return;
    if (document.pointerLockElement) document.exitPointerLock();
    audio.stopDrone();
    await ui.fadeOut();
    state = 'menu';
    resetLevel();
    glide.i = 0; glide.dir = 1; glide.pos.copy(glidePath[0]);
    ui.setBest(loadBest());
    ui.showStart();
    ui.fadeIn();
  }

  async function winGame() {
    state = 'won';
    for (const k in input) input[k] = false;
    audio.win();
    audio.stopDrone();
    const prevBest = loadBest();
    const best = prevBest == null ? elapsed : Math.min(prevBest, elapsed);
    saveBest(best);
    ui.setBest(best);
    ui.setWinStats(elapsed, best);
    if (document.pointerLockElement) document.exitPointerLock();
    await ui.fadeOut(true);
    ui.showWin();
    ui.fadeIn();
  }

  function collectKey(k) {
    k.collected = true;
    k.group.visible = false;
    keysCollected++;
    ui.setKeys(keysCollected, TOTAL_KEYS);
    audio.pickup();
    if (keysCollected >= TOTAL_KEYS) unlockExit();
    else ui.setHint(`${TOTAL_KEYS - keysCollected} KEY${TOTAL_KEYS - keysCollected > 1 ? 'S' : ''} LEFT`);
  }

  function unlockExit() {
    doorAnim = 0;
    audio.unlock();
    ui.message('THE EXIT IS OPEN');
    ui.setHint('FOLLOW THE GREEN LIGHT');
    exitLight.color.setHex(0x8ff0a4);
    exitLight.intensity = 10;
    doorMat.emissive.setHex(0x2f9a52);
    beyond.visible = true;
  }

  // ------------------------------------------------------------- events
  const onClick = (btn, fn) => btn.addEventListener('click', () => { btn.blur(); fn(); });
  onClick(ui.buttons.start, startGame);
  onClick(ui.buttons.resume, resumeGame);
  onClick(ui.buttons.restart, restartGame);
  onClick(ui.buttons.again, restartGame);
  onClick(ui.buttons.menu, goToMenu);
  onClick(ui.buttons.menuWin, goToMenu);
  ui.buttons.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked && wantResume) doResume();
    else if (!locked && state === 'playing') pauseGame();
  });
  document.addEventListener('pointerlockerror', () => { wantResume = false; });

  document.addEventListener('mousemove', e => {
    if (state !== 'playing' || document.pointerLockElement !== canvas) return;
    const dx = Math.max(-150, Math.min(150, e.movementX));
    const dy = Math.max(-150, Math.min(150, e.movementY));
    player.look(dx, dy);
  });

  const codeMap = {
    KeyW: 'forward', ArrowUp: 'forward', KeyZ: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left', KeyQ: 'left',
    KeyD: 'right', ArrowRight: 'right',
  };
  const keyNameMap = {
    arrowup: 'forward', w: 'forward', z: 'forward', up: 'forward',
    arrowdown: 'back', s: 'back', down: 'back',
    arrowleft: 'left', a: 'left', q: 'left', left: 'left',
    arrowright: 'right', d: 'right', right: 'right',
  };
  const actionFor = e => codeMap[e.code] || keyNameMap[String(e.key || '').toLowerCase()];
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyM' || e.key === 'm') { audio.setMuted(!audio.muted); return; }
    if ((e.code === 'KeyP' || e.key === 'p') && state === 'playing') { if (document.pointerLockElement) document.exitPointerLock(); pauseGame(); return; }
    const k = actionFor(e);
    if (!k) return;
    e.preventDefault();
    if (state === 'playing') input[k] = true;
  });
  window.addEventListener('keyup', e => {
    const k = actionFor(e);
    if (k) input[k] = false;
  });
  window.addEventListener('blur', () => { for (const k in input) input[k] = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pauseGame(); });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------- loop
  const lerpAngle = (a, b, t) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  function updateMenuCamera(dt) {
    const next = glidePath[glide.i + glide.dir];
    if (!next) { glide.dir *= -1; return; }
    const to = next.clone().sub(glide.pos);
    const dist = to.length();
    const step = 1.0 * dt;
    if (dist <= step) { glide.pos.copy(next); glide.i += glide.dir; }
    else glide.pos.addScaledVector(to.normalize(), step);
    const targetYaw = Math.atan2(-to.x, -to.z);
    glide.yaw = lerpAngle(glide.yaw, targetYaw, Math.min(1, dt * 1.6));
    camera.position.set(glide.pos.x, 1.5 + Math.sin(time * 1.3) * 0.03, glide.pos.z);
    camera.rotation.set(Math.sin(time * 0.5) * 0.02, glide.yaw + Math.sin(time * 0.3) * 0.03, 0);
  }

  function updateGame(dt, realDt) {
    player.update(dt, input);
    audio.footsteps(dt, player.moving);
    camera.position.set(player.x, player.height + (player.moving ? Math.sin(time * 9) * 0.03 : 0), player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    for (const k of keyObjs) {
      if (k.collected) continue;
      const dx = k.group.position.x - player.x, dz = k.group.position.z - player.z;
      if (dx * dx + dz * dz < PICKUP_DIST * PICKUP_DIST) collectKey(k);
    }

    if (doorAnim >= 0) {
      doorAnim += realDt; // real time so the door opens at the same pace on slow machines
      const t = Math.min(1, doorAnim / 1.8);
      const ease = t * t * (3 - 2 * t);
      doorMesh.position.y = doorCenter.y - ease * (H + 0.2);
      beyondLight.intensity = 14 * ease;
      if (doorAnim > 1.2) maze.doorOpen = true;
    }

    if (maze.doorOpen) {
      const c = player.cell();
      if (c.x === door.x && c.y === door.y) winGame();
    }
  }

  // adaptive resolution: if the machine cannot hold ~30 fps, lower the pixel ratio
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let slowFrames = 0, perfFrames = 0;
  function adaptResolution(rawDt) {
    perfFrames++;
    if (rawDt > 0.04) slowFrames++;
    if (perfFrames >= 90) {
      if (slowFrames > 45 && pixelRatio > 0.75) {
        pixelRatio = Math.max(0.75, pixelRatio - 0.5);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
      perfFrames = 0; slowFrames = 0;
    }
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    adaptResolution(rawDt);
    const dt = Math.min(0.05, rawDt);
    time += dt;

    // ambient animation (always)
    keyObjs.forEach((k, i) => {
      if (k.collected) return;
      k.group.rotation.y += dt * 1.1;
      k.group.position.y = 1.1 + Math.sin(time * 2 + k.phase) * 0.08;
      k.light.intensity = 6.5 + Math.sin(time * 5 + i) * 0.8;
    });
    const flick = 1 - 0.05 * Math.abs(Math.sin(time * 17.3) * Math.sin(time * 3.1)) - (Math.random() < 0.004 ? 0.45 : 0);
    flashlight.intensity = 60 * flick;
    exitLight.intensity = (maze.doorOpen || doorAnim >= 0 ? 10 : 6) * (0.9 + 0.1 * Math.sin(time * 7.7));

    if (state === 'menu') updateMenuCamera(dt);
    else if (state === 'playing') { updateGame(dt, rawDt); elapsed += rawDt * 1000; ui.setTimer(elapsed); }

    renderer.render(scene, camera);
  }

  resetLevel();
  ui.showStart();
  requestAnimationFrame(frame);

  // ?autostart=1 : skip the menu (used for automated screenshots / tests, no pointer lock)
  if (params.get('autostart')) {
    ui.showHud();
    state = 'playing';
    // test hook (only with ?autostart): lets scripts/e2e.mjs drive the game
    window.__tle = {
      maze, player,
      get state() { return state; },
      get keys() { return keysCollected; },
      get doorAnim() { return doorAnim; },
      teleport(cx, cy) { player.x = (cx + 0.5) * S; player.z = (cy + 0.5) * S; },
    };
  }
}

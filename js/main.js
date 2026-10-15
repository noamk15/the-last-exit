// THE LAST EXIT — main game loop, scene, state machine.
import * as THREE from 'three';
import { buildLevel as generateLevel, hashSeed, bfs, pathTo, WALL, mulberry32 } from './maze.js?v=mv9dr1pe';
import { Player } from './player.js?v=mv9dr1pe';
import { UI, loadBest, saveBest } from './ui.js?v=mv9dr1pe';
import { AudioSys } from './audio.js?v=mv9dr1pe';
import { Minimap } from './minimap.js?v=mv9dr1pe';

const S = 2;            // cell size (world units)
const H = 3;            // wall height
const COLS = 13, ROWS = 13;
const TOTAL_KEYS = 3;
const PICKUP_DIST = 1.0;
const TIME_LIMIT = 90;       // seconds to escape
const MONSTER_COUNT = 2;
const MONSTER_PATROL_SPEED = 1.5, MONSTER_CHASE_SPEED = 3.1;
const MONSTER_SENSE_CELLS = 6;   // BFS distance at which a monster starts chasing
const MONSTER_LOSE_CELLS = 11;   // BFS distance at which it gives up
const CATCH_DIST = 1.0;
const WARN_AT = 30;          // timer turns red
const CRITICAL_AT = 10;      // timer gets frantic

// ---------------------------------------------------------------- seed
// Random maze every game. `?seed=` pins a layout (useful for the demo).
const params = new URLSearchParams(location.search);
const fixedSeed = params.get('seed');
const newSeedStr = () => fixedSeed || String(Math.floor(Math.random() * 100000));
const seedToValue = str => (/^\d+$/.test(str) ? (Number(str) >>> 0) : hashSeed(str));

const ui = new UI();
ui.setBest(loadBest());

const audio = new AudioSys();
const minimap = new Minimap(document.getElementById('minimap'), S);

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
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);
  scene.fog = new THREE.FogExp2(0x05070a, 0.075);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 80);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  scene.add(new THREE.AmbientLight(0x8fa0b0, 0.14));

  // flashlight: spotlight carried by the camera, slightly off-centre like a hand-held torch
  const FLASH_INTENSITY = 60;
  const flashlight = new THREE.SpotLight(0xfff0d2, FLASH_INTENSITY, 28, 0.62, 0.9, 1.75);
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
  function mottle(g, w, h, base, amp, scale) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w / scale); c.height = Math.ceil(h / scale);
    noise(c.getContext('2d'), c.width, c.height, base, amp);
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, w, h);
  }
  function drawWall(g, w, h) {
    mottle(g, w, h, [74, 78, 76], 50, 10);
    g.globalAlpha = 0.35;
    const grain = document.createElement('canvas'); grain.width = w; grain.height = h;
    noise(grain.getContext('2d'), w, h, [128, 128, 128], 120);
    g.globalCompositeOperation = 'overlay';
    g.drawImage(grain, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
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
    // dark stains (old blood, dried)
    for (let i = 0; i < 3; i++) {
      const x = texRng() * w, y = texRng() * h, r = 14 + texRng() * 30;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(60,10,8,0.55)');
      rg.addColorStop(1, 'rgba(60,10,8,0)');
      g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
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

  // ------------------------------------------------------------- shared geometry / materials
  const wallMat = new THREE.MeshStandardMaterial({ map: wall.tex, bumpMap: wallBump, bumpScale: 0.9, roughness: 0.93, metalness: 0.02 });
  const wallGeo = new THREE.BoxGeometry(S, H, S);
  const floorMat = new THREE.MeshStandardMaterial({ map: floor.tex, roughness: 0.95, color: 0xb8b8b0 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex.tex, roughness: 1, color: 0x55554f });
  const planeGeo = new THREE.PlaneGeometry(COLS * S, ROWS * S);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xa8ffbb, emissive: 0x47d676, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.6 });
  const ringGeo = new THREE.TorusGeometry(0.16, 0.045, 10, 26);
  const shaftGeo = new THREE.BoxGeometry(0.44, 0.06, 0.06);
  const toothGeo = new THREE.BoxGeometry(0.06, 0.14, 0.06);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6, metalness: 0.7 });
  const DOOR_LOCKED = 0x5a120e, DOOR_OPEN = 0x2f9a52;
  // monster: wet black skin that catches the torch, glowing eyes and mouth
  const monsterMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.15 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x8a0f0a });
  const torsoGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.3, 8);
  const legGeo = new THREE.CylinderGeometry(0.045, 0.07, 1.25, 6);
  const armGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.55, 6);
  const neckGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
  const headGeo = new THREE.SphereGeometry(0.19, 12, 10);
  const eyeGeo = new THREE.SphereGeometry(0.045, 8, 6);
  const clawGeo = new THREE.ConeGeometry(0.018, 0.16, 5);
  const mouthGeo = new THREE.BoxGeometry(0.13, 0.05, 0.03);
  function makeClawHand() {
    const hand = new THREE.Group();
    for (let i = -1; i <= 1; i++) {
      const claw = new THREE.Mesh(clawGeo, monsterMat);
      claw.position.set(i * 0.035, -0.08, 0.02);
      claw.rotation.x = Math.PI - 0.3; claw.rotation.z = i * 0.25;
      hand.add(claw);
    }
    return hand;
  }

  // floor + ceiling never change between levels
  const floorMesh = new THREE.Mesh(planeGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(COLS * S / 2, 0, ROWS * S / 2);
  scene.add(floorMesh);
  const ceilMesh = new THREE.Mesh(planeGeo, ceilMat);
  ceilMesh.rotation.x = Math.PI / 2;
  ceilMesh.position.set(COLS * S / 2, H, ROWS * S / 2);
  scene.add(ceilMesh);

  // dust motes drifting around the camera
  const DUST_N = 350, DUST_R = 6;
  const dustPos = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N * 3; i++) dustPos[i] = (Math.random() - 0.5) * DUST_R * 2;
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xcfd8d2, size: 0.022, transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true }));
  scene.add(dust);

  // ------------------------------------------------------------- level (rebuilt for every new maze)
  const player = new Player(null, S);
  let level = null;
  let seedStr = '';

  function disposeLevel() {
    if (!level) return;
    scene.remove(level.group);
    level.walls.dispose();
    level.group.traverse(o => { if (o.geometry && o.geometry !== wallGeo && ![ringGeo, shaftGeo, toothGeo].includes(o.geometry)) o.geometry.dispose(); });
    level = null;
  }

  function createLevel(seed) {
    disposeLevel();
    seedStr = seed;
    ui.setSeed(seedStr);
    const maze = generateLevel(seedToValue(seedStr), COLS, ROWS);
    player.maze = maze;
    const group = new THREE.Group();

    // walls
    const wallCells = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (maze.get(x, y) === WALL) wallCells.push([x, y]);
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    const m4 = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => {
      m4.makeTranslation((x + 0.5) * S, H / 2, (y + 0.5) * S);
      walls.setMatrixAt(i, m4);
    });
    walls.instanceMatrix.needsUpdate = true;
    group.add(walls);

    // keys
    const keyObjs = maze.keys.map((k, i) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, keyMat);
      const shaft = new THREE.Mesh(shaftGeo, keyMat); shaft.position.x = 0.36;
      const t1 = new THREE.Mesh(toothGeo, keyMat); t1.position.set(0.52, -0.09, 0);
      const t2 = new THREE.Mesh(toothGeo, keyMat); t2.position.set(0.41, -0.08, 0);
      const light = new THREE.PointLight(0x6fe08a, 7, 7, 2);
      g.add(ring, shaft, t1, t2, light);
      g.position.set((k.x + 0.5) * S, 1.1, (k.y + 0.5) * S);
      group.add(g);
      return { group: g, light, cell: k, phase: i * 2.1, collected: false };
    });

    // exit door
    const door = maze.door;
    const alongX = door.dir[0] !== 0;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.55, metalness: 0.8, emissive: DOOR_LOCKED, emissiveIntensity: 0.9 });
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.3 : S * 0.94, H * 0.96, alongX ? S * 0.94 : 0.3), doorMat);
    const doorCenter = new THREE.Vector3((door.x + 0.5) * S, H / 2, (door.y + 0.5) * S);
    doorMesh.position.copy(doorCenter);
    group.add(doorMesh);
    const postGeo = new THREE.BoxGeometry(alongX ? 0.4 : 0.14, H, alongX ? 0.14 : 0.4);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.copy(doorCenter);
      if (alongX) post.position.z += side * (S / 2 - 0.07); else post.position.x += side * (S / 2 - 0.07);
      group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.4 : S, 0.16, alongX ? S : 0.4), frameMat);
    lintel.position.copy(doorCenter); lintel.position.y = H - 0.08;
    group.add(lintel);
    const beyond = new THREE.Mesh(new THREE.PlaneGeometry(S * 4, H * 2.5), new THREE.MeshBasicMaterial({ color: 0xdffbe6, fog: true }));
    beyond.position.copy(doorCenter).add(new THREE.Vector3(door.dir[0] * S * 1.6, 0.6, door.dir[1] * S * 1.6));
    beyond.lookAt(doorCenter);
    beyond.visible = false;
    group.add(beyond);
    const beyondLight = new THREE.PointLight(0xc8ffd6, 0, 16, 1.6);
    beyondLight.position.copy(doorCenter).add(new THREE.Vector3(door.dir[0] * S * 0.9, 0.4, door.dir[1] * S * 0.9));
    group.add(beyondLight);
    const exitLight = new THREE.PointLight(0xff3a2a, 6, 7, 2);
    exitLight.position.set((maze.exit.x + 0.5) * S, 2.3, (maze.exit.y + 0.5) * S);
    group.add(exitLight);

    // monsters: spawn far from the start, not on a key
    const fromStart = bfs(maze, maze.start.x, maze.start.y);
    const spawnCells = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (!maze.isOpen(x, y)) continue;
      const d = fromStart.dist[maze.idx(x, y)];
      if (d < 10) continue;
      if (maze.keys.some(k => k.x === x && k.y === y)) continue;
      spawnCells.push({ x, y, d });
    }
    spawnCells.sort(() => Math.random() - 0.5);
    const monsters = [];
    for (let i = 0; i < MONSTER_COUNT && spawnCells.length; i++) {
      const cell = spawnCells.pop();
      const g = new THREE.Group();
      // legs (too long, slightly bent outward)
      const legL = new THREE.Mesh(legGeo, monsterMat); legL.position.set(-0.11, 0.62, 0); legL.rotation.z = 0.06;
      const legR = new THREE.Mesh(legGeo, monsterMat); legR.position.set(0.11, 0.62, 0); legR.rotation.z = -0.06;
      // hunched torso leaning toward you
      const torso = new THREE.Mesh(torsoGeo, monsterMat); torso.position.set(0, 1.85, 0.08); torso.rotation.x = 0.32;
      // arms hanging to the floor with claws
      const armL = new THREE.Group(); armL.position.set(-0.26, 2.3, 0.1);
      const armLMesh = new THREE.Mesh(armGeo, monsterMat); armLMesh.position.y = -0.78; armL.add(armLMesh);
      const handL = makeClawHand(); handL.position.y = -1.58; armL.add(handL); armL.rotation.z = 0.12;
      const armR = new THREE.Group(); armR.position.set(0.26, 2.3, 0.1);
      const armRMesh = new THREE.Mesh(armGeo, monsterMat); armRMesh.position.y = -0.78; armR.add(armRMesh);
      const handR = makeClawHand(); handR.position.y = -1.58; armR.add(handR); armR.rotation.z = -0.12;
      // neck + head tilted, eyes uneven, open mouth
      const neck = new THREE.Mesh(neckGeo, monsterMat); neck.position.set(0, 2.55, 0.22); neck.rotation.x = 0.35;
      const head = new THREE.Group(); head.position.set(0, 2.76, 0.3); head.rotation.z = 0.32;
      const skull = new THREE.Mesh(headGeo, monsterMat); skull.scale.set(0.85, 1.25, 0.9); head.add(skull);
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.075, 0.04, 0.15); head.add(eyeL);
      const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.07, 0.07, 0.15); eyeR.scale.setScalar(0.8); head.add(eyeR);
      const mouth = new THREE.Mesh(mouthGeo, mouthMat); mouth.position.set(0, -0.12, 0.16); head.add(mouth);
      const glow = new THREE.PointLight(0xff2a1a, 1.8, 4, 2); glow.position.set(0, 0.05, 0.3); head.add(glow);
      g.add(legL, legR, torso, armL, armR, neck, head);
      const pos = new THREE.Vector3((cell.x + 0.5) * S, 0, (cell.y + 0.5) * S);
      g.position.copy(pos);
      group.add(g);
      monsters.push({ group: g, head, mouth, armL, armR, pos, cell: { x: cell.x, y: cell.y }, path: [], state: 'patrol', repathT: 0, lostT: 0, stepT: Math.random() * 0.5, bob: Math.random() * 6, twitchT: 0, twitch: { x: 0, z: 0.32 } });
    }

    // menu glide path: start -> farthest cell
    let farIdx = 0;
    for (let i = 0; i < fromStart.dist.length; i++) if (fromStart.dist[i] > fromStart.dist[farIdx]) farIdx = i;
    const glidePath = pathTo(maze, fromStart, farIdx % COLS, Math.floor(farIdx / COLS))
      .map(c => new THREE.Vector3((c.x + 0.5) * S, 1.5, (c.y + 0.5) * S));

    scene.add(group);
    level = { maze, group, walls, keyObjs, door, doorMesh, doorMat, doorCenter, beyond, beyondLight, exitLight, glidePath, monsters, spawnCells };
    minimap.setMaze(maze);
    resetGlide();
    return level;
  }

  const glide = { i: 0, dir: 1, pos: new THREE.Vector3(), yaw: 0 };
  function resetGlide() {
    const p = level.glidePath;
    glide.i = 0; glide.dir = 1; glide.pos.copy(p[0]);
    if (p.length > 1) { const d0 = p[1].clone().sub(p[0]); glide.yaw = Math.atan2(-d0.x, -d0.z); }
  }

  // ------------------------------------------------------------- state
  let state = 'menu';       // menu | playing | paused | won | dead
  let keysCollected = 0;
  let elapsed = 0;          // ms of play time
  let doorAnim = -1;        // -1 idle, else seconds since unlock
  let wantResume = false;
  let time = 0;
  let tension = 0;
  let brownout = { t: 0, next: 10 + Math.random() * 10, active: false };
  let lastSecond = -1;
  let monstersEnabled = true;
  let monsterTension = 0;
  const input = { forward: false, back: false, left: false, right: false };

  function resetLevel() {
    const L = level;
    keysCollected = 0;
    elapsed = 0;
    doorAnim = -1;
    tension = 0;
    L.maze.doorOpen = false;
    L.doorMesh.position.copy(L.doorCenter);
    L.doorMat.emissive.setHex(DOOR_LOCKED);
    L.exitLight.color.setHex(0xff3a2a);
    L.exitLight.intensity = 6;
    L.beyond.visible = false;
    L.beyondLight.intensity = 0;
    L.keyObjs.forEach(k => { k.collected = false; k.group.visible = true; });
    L.monsters.forEach(mo => {
      mo.pos.set((mo.cell.x + 0.5) * S, 0, (mo.cell.y + 0.5) * S);
      mo.group.position.copy(mo.pos);
      mo.path = []; mo.state = 'patrol'; mo.repathT = 0; mo.lostT = 0;
      mo.home = { x: mo.cell.x, y: mo.cell.y };
    });
    minimap.reset();
    lastSecond = -1;
    monsterTension = 0;
    player.reset(L.maze.start.x, L.maze.start.y);
    for (const k in input) input[k] = false;
    ui.setKeys(0, TOTAL_KEYS);
    ui.setCountdown(TIME_LIMIT * 1000, WARN_AT * 1000, CRITICAL_AT * 1000);
    ui.setHint('FIND THE THREE KEYS BEFORE THE TIME RUNS OUT');
    ui.setDanger(0);
    audio.setTension(0);
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

  // newMaze=true regenerates a random layout (unless ?seed= is pinned)
  async function beginRun(newMaze) {
    audio.ensure();
    lockPointer();
    await ui.fadeOut();
    if (newMaze) createLevel(newSeedStr());
    resetLevel();
    ui.showHud();
    state = 'playing';
    audio.startMusic();
    if (document.pointerLockElement !== canvas) lockPointer();
    ui.fadeIn();
  }
  const startGame = () => beginRun(true);
  const restartSame = () => beginRun(false);
  const playAgain = () => beginRun(true);

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    for (const k in input) input[k] = false;
    audio.duck(true);
    ui.showPause();
  }
  function resumeGame() {
    if (state !== 'paused') return;
    wantResume = true;
    lockPointer();
    setTimeout(() => { if (wantResume && document.pointerLockElement === canvas) doResume(); }, 50);
  }
  function doResume() {
    wantResume = false;
    if (state !== 'paused') return;
    state = 'playing';
    audio.duck(false);
    ui.hidePause();
  }

  async function goToMenu() {
    if (state === 'menu') return;
    if (document.pointerLockElement) document.exitPointerLock();
    audio.stopMusic();
    audio.duck(false);
    await ui.fadeOut();
    state = 'menu';
    createLevel(newSeedStr());
    resetLevel();
    ui.setBest(loadBest());
    ui.showStart();
    audio.startDrone();
    ui.fadeIn();
  }

  async function winGame() {
    state = 'won';
    for (const k in input) input[k] = false;
    audio.stopMusic();
    audio.win();
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

  async function die(cause) {
    state = 'dead';
    deathCause = cause;
    for (const k in input) input[k] = false;
    audio.stopMusic();
    if (cause === 'caught') audio.scream(); else audio.gameOver();
    if (cause !== 'caught') flashlight.intensity = 0;
    ui.setDanger(1);
    if (document.pointerLockElement) document.exitPointerLock();
    if (cause === 'caught') await new Promise(r => setTimeout(r, 900)); // let the jump scare land
    await ui.fadeOut();
    ui.showGameOver(keysCollected, TOTAL_KEYS, cause);
    ui.fadeIn();
  }
  let deathCause = '';

  // jump scare: the monster steps in front of the camera, the camera snaps to it
  function caught(mo) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    // place the monster where the player is looking so it fills the view
    const dx = mo.pos.x - player.x, dz = mo.pos.z - player.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = d > 0.1 ? dx / d : fx, uz = d > 0.1 ? dz / d : fz;
    mo.pos.set(player.x + ux * 0.85, 0, player.z + uz * 0.85);
    mo.group.position.copy(mo.pos);
    mo.group.lookAt(player.x, 0, player.z);
    player.yaw = Math.atan2(-ux, -uz);
    player.pitch = 0.25;
    camera.position.set(player.x, player.height, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    flashlight.intensity = FLASH_INTENSITY * 1.5;
    die('caught');
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
    const L = level;
    doorAnim = 0;
    audio.unlock();
    ui.message('THE EXIT IS OPEN');
    ui.setHint('FOLLOW THE GREEN LIGHT');
    L.exitLight.color.setHex(0x8ff0a4);
    L.exitLight.intensity = 10;
    L.doorMat.emissive.setHex(DOOR_OPEN);
    L.beyond.visible = true;
  }

  // ------------------------------------------------------------- events
  const onClick = (btn, fn) => btn.addEventListener('click', () => { btn.blur(); fn(); });
  onClick(ui.buttons.start, startGame);
  onClick(ui.buttons.resume, resumeGame);
  onClick(ui.buttons.restart, restartSame);
  onClick(ui.buttons.again, playAgain);
  onClick(ui.buttons.retry, playAgain);
  onClick(ui.buttons.menu, goToMenu);
  onClick(ui.buttons.menuWin, goToMenu);
  onClick(ui.buttons.menuDead, goToMenu);
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
    const path = level.glidePath;
    const next = path[glide.i + glide.dir];
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
    const L = level;
    player.update(dt, input);
    audio.footsteps(dt, player.moving);
    // camera: bob while walking, tremble when the clock runs down
    const tremble = tension * 0.012;
    camera.position.set(
      player.x + (Math.random() - 0.5) * tremble,
      player.height + (player.moving ? Math.sin(time * 9) * 0.03 : 0) + (Math.random() - 0.5) * tremble,
      player.z + (Math.random() - 0.5) * tremble
    );
    camera.rotation.set(player.pitch + (Math.random() - 0.5) * tremble * 0.6, player.yaw + (Math.random() - 0.5) * tremble * 0.6, 0);

    for (const k of L.keyObjs) {
      if (k.collected) continue;
      const dx = k.group.position.x - player.x, dz = k.group.position.z - player.z;
      if (dx * dx + dz * dz < PICKUP_DIST * PICKUP_DIST) collectKey(k);
    }

    if (doorAnim >= 0) {
      doorAnim += realDt;
      const t = Math.min(1, doorAnim / 1.8);
      const ease = t * t * (3 - 2 * t);
      L.doorMesh.position.y = L.doorCenter.y - ease * (H + 0.2);
      L.beyondLight.intensity = 14 * ease;
      if (doorAnim > 1.2) L.maze.doorOpen = true;
    }

    if (L.maze.doorOpen) {
      const c = player.cell();
      if (c.x === L.door.x && c.y === L.door.y) { winGame(); return; }
    }

    // monsters
    if (monstersEnabled) { updateMonsters(dt); if (state !== 'playing') return; }

    // memory minimap
    minimap.update(dt, player);
    minimap.draw(player, L.keyObjs, monstersEnabled ? L.monsters : [], L.maze.exit, L.door, L.maze.doorOpen);

    // countdown
    elapsed += realDt * 1000;
    const remaining = TIME_LIMIT * 1000 - elapsed;
    ui.setCountdown(Math.max(0, remaining), WARN_AT * 1000, CRITICAL_AT * 1000);
    // sound reminders at important moments
    const sec = Math.ceil(remaining / 1000);
    if (sec !== lastSecond) {
      if (lastSecond !== -1) {
        if (sec === 60) { audio.bell(1); ui.message('ONE MINUTE'); }
        else if (sec === 30) { audio.bell(2); ui.message('THIRTY SECONDS'); }
        else if (sec === 10) { audio.bell(3); ui.message('TEN SECONDS'); }
      }
      lastSecond = sec;
    }
    const timeTension = Math.max(0, Math.min(1, 1 - remaining / (WARN_AT * 1000 * 1.5)));
    const newTension = Math.max(timeTension, monsterTension);
    if (Math.abs(newTension - tension) > 0.01) { tension = newTension; audio.setTension(tension); }
    // red pulse synced with the heartbeat pace
    const beat = tension > 0.05 ? Math.pow(Math.max(0, Math.sin(time * (1 + tension * 1.7) * Math.PI * 2)), 6) : 0;
    ui.setDanger(tension * (0.25 + 0.55 * beat));
    audio.tick(dt);
    if (remaining <= 0) die('time');
  }

  // ------------------------------------------------------------- monsters
  const monsterTmp = new THREE.Vector3();
  function updateMonsters(dt) {
    const L = level, maze = L.maze;
    const pc = player.cell();
    const fromPlayer = bfs(maze, pc.x, pc.y);
    let nearest = Infinity;
    for (const mo of L.monsters) {
      const bfsDist = fromPlayer.dist[maze.idx(mo.cell.x, mo.cell.y)];
      const worldDist = Math.hypot(mo.pos.x - player.x, mo.pos.z - player.z);
      nearest = Math.min(nearest, worldDist);

      // state changes
      if (mo.state === 'patrol') {
        if (bfsDist >= 0 && bfsDist <= MONSTER_SENSE_CELLS) {
          mo.state = 'chase'; mo.path = []; mo.repathT = 0; mo.lostT = 0;
          const rel = relativePan(mo);
          audio.roar(rel);
          ui.message('RUN');
        }
      } else if (bfsDist < 0 || bfsDist > MONSTER_LOSE_CELLS) {
        mo.lostT += dt;
        if (mo.lostT > 2.5) { mo.state = 'patrol'; mo.path = []; }
      } else mo.lostT = 0;

      // pathing
      mo.repathT -= dt;
      if (mo.state === 'chase' && mo.repathT <= 0) {
        mo.repathT = 0.4;
        const p = pathTo(maze, fromPlayer, mo.cell.x, mo.cell.y).reverse(); // monster -> player
        mo.path = p.slice(1);
      } else if (mo.state === 'patrol' && mo.path.length === 0) {
        const choices = L.spawnCells.length ? L.spawnCells : [maze.start];
        const target = choices[Math.floor(Math.random() * choices.length)];
        const own = bfs(maze, mo.cell.x, mo.cell.y);
        mo.path = pathTo(maze, own, target.x, target.y).slice(1);
      }

      // movement along the path (cell centre to cell centre)
      const speed = mo.state === 'chase' ? MONSTER_CHASE_SPEED : MONSTER_PATROL_SPEED;
      let budget = speed * dt;
      while (budget > 0 && mo.path.length) {
        const next = mo.path[0];
        monsterTmp.set((next.x + 0.5) * S, 0, (next.y + 0.5) * S).sub(mo.pos);
        const d = monsterTmp.length();
        if (d <= budget) { mo.pos.set((next.x + 0.5) * S, 0, (next.y + 0.5) * S); mo.cell = { x: next.x, y: next.y }; mo.path.shift(); budget -= d; }
        else { mo.pos.addScaledVector(monsterTmp.normalize(), budget); budget = 0; }
        const dirX = monsterTmp.x, dirZ = monsterTmp.z;
        if (d > 0.001) mo.group.lookAt(mo.pos.x + dirX, 0, mo.pos.z + dirZ);
      }
      // same cell as the player (no path left): close in directly
      if (mo.state === 'chase' && mo.path.length === 0 && budget > 0) {
        monsterTmp.set(player.x - mo.pos.x, 0, player.z - mo.pos.z);
        const d = monsterTmp.length();
        if (d > 0.001) mo.pos.addScaledVector(monsterTmp.normalize(), Math.min(d, budget));
      }
      mo.cell = { x: Math.floor(mo.pos.x / S), y: Math.floor(mo.pos.z / S) };
      mo.bob += dt * (mo.state === 'chase' ? 9 : 4);
      mo.group.position.set(mo.pos.x, Math.abs(Math.sin(mo.bob)) * 0.06, mo.pos.z);
      // nervous head twitches, arms rise when hunting, mouth gapes
      mo.twitchT -= dt;
      if (mo.twitchT <= 0) {
        mo.twitchT = 0.12 + Math.random() * (mo.state === 'chase' ? 0.3 : 0.9);
        mo.twitch = { x: (Math.random() - 0.5) * 0.5, z: 0.32 + (Math.random() - 0.5) * 0.7 };
      }
      mo.head.rotation.x += (mo.twitch.x - mo.head.rotation.x) * Math.min(1, dt * 18);
      mo.head.rotation.z += (mo.twitch.z - mo.head.rotation.z) * Math.min(1, dt * 18);
      const reach = mo.state === 'chase' ? -1.3 : 0;
      mo.armL.rotation.x += (reach - mo.armL.rotation.x) * Math.min(1, dt * 4);
      mo.armR.rotation.x += (reach - mo.armR.rotation.x) * Math.min(1, dt * 4);
      mo.mouth.scale.y = mo.state === 'chase' ? 2.2 + Math.sin(mo.bob * 2) * 0.8 : 1;
      if (mo.state === 'chase') mo.group.lookAt(player.x, 0, player.z);

      // spatialised footsteps: one step per stride while it moves, louder when close
      const moving = mo.path.length > 0 || mo.state === 'chase';
      if (moving) {
        mo.stepT -= dt;
        if (mo.stepT <= 0) {
          mo.stepT = mo.state === 'chase' ? 0.3 : 0.6;
          const vol = Math.pow(Math.max(0, 1 - worldDist / 12), 2.2) * (mo.state === 'chase' ? 1.4 : 0.9);
          audio.monsterStep(vol, relativePan(mo), mo.state === 'chase');
        }
      }

      if (worldDist < CATCH_DIST) { caught(mo); return; }
    }
    monsterTension = Math.max(0, Math.min(1, 1 - (nearest - 1.5) / 8));
    // the torch stutters when something is close
    if (nearest < 5 && Math.random() < 0.25) flashlight.intensity *= 0.35;
  }
  // -1 (left) .. 1 (right) relative to where the player looks
  function relativePan(mo) {
    const dx = mo.pos.x - player.x, dz = mo.pos.z - player.z;
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw); // right vector
    const d = Math.hypot(dx, dz) || 1;
    return (dx * rx + dz * rz) / d;
  }

  // flashlight: subtle hum + occasional brownouts (more frequent under tension)
  function updateFlashlight(dt) {
    let f = 1 - 0.05 * Math.abs(Math.sin(time * 17.3) * Math.sin(time * 3.1));
    brownout.t += dt;
    if (!brownout.active && brownout.t > brownout.next) {
      brownout.active = true; brownout.t = 0; brownout.dur = 0.25 + Math.random() * 0.9;
      if (state === 'playing') audio.flashlightClick();
    }
    if (brownout.active) {
      f *= (Math.random() < 0.6 ? 0.12 : 0.7);
      if (brownout.t > brownout.dur) {
        brownout.active = false; brownout.t = 0;
        brownout.next = (10 + Math.random() * 14) * (1 - tension * 0.7);
      }
    }
    flashlight.intensity = FLASH_INTENSITY * f;
  }

  function updateDust(dt) {
    const p = dustGeo.attributes.position.array;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < DUST_N; i++) {
      const j = i * 3;
      p[j] += Math.sin(time * 0.7 + i) * 0.0015;
      p[j + 1] += -0.02 * dt + Math.cos(time * 0.5 + i * 1.3) * 0.0012;
      p[j + 2] += Math.cos(time * 0.6 + i * 0.7) * 0.0015;
      // wrap inside a box around the camera
      if (p[j] - cx > DUST_R) p[j] -= DUST_R * 2; else if (p[j] - cx < -DUST_R) p[j] += DUST_R * 2;
      if (p[j + 1] - cy > DUST_R) p[j + 1] -= DUST_R * 2; else if (p[j + 1] - cy < -DUST_R) p[j + 1] += DUST_R * 2;
      if (p[j + 2] - cz > DUST_R) p[j + 2] -= DUST_R * 2; else if (p[j + 2] - cz < -DUST_R) p[j + 2] += DUST_R * 2;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // adaptive resolution: if the machine cannot hold ~30 fps, lower the pixel ratio
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
    const rawDt = Math.min(0.25, (now - last) / 1000);
    last = now;
    adaptResolution(rawDt);
    const dt = Math.min(0.05, rawDt);
    time += dt;

    const L = level;
    L.keyObjs.forEach((k, i) => {
      if (k.collected) return;
      k.group.rotation.y += dt * 1.1;
      k.group.position.y = 1.1 + Math.sin(time * 2 + k.phase) * 0.08;
      k.light.intensity = 6.5 + Math.sin(time * 5 + i) * 0.8;
    });
    if (state !== 'dead') updateFlashlight(dt);
    L.exitLight.intensity = (L.maze.doorOpen || doorAnim >= 0 ? 10 : 6) * (0.9 + 0.1 * Math.sin(time * 7.7));

    if (state === 'menu') updateMenuCamera(dt);
    else if (state === 'playing') updateGame(dt, rawDt);
    updateDust(dt);

    renderer.render(scene, camera);
  }

  createLevel(newSeedStr());
  resetLevel();
  ui.showStart();
  requestAnimationFrame(frame);

  // ?autostart=1 : skip the menu (used for automated tests, no pointer lock)
  if (params.get('autostart')) {
    ui.showHud();
    state = 'playing';
    window.__tle = {
      get maze() { return level.maze; }, player,
      get state() { return state; },
      get keys() { return keysCollected; },
      get seed() { return seedStr; },
      get remaining() { return TIME_LIMIT * 1000 - elapsed; },
      setElapsed(ms) { elapsed = ms; },
      teleport(cx, cy) { player.x = (cx + 0.5) * S; player.z = (cy + 0.5) * S; },
      get limit() { return TIME_LIMIT * 1000; },
      get monsters() { return level.monsters; },
      get deathCause() { return deathCause; },
      setMonsters(on) { monstersEnabled = on; },
    };
  }
}

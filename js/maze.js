// Maze generation + grid helpers (pure JS, no Three.js, testable in node)

export const OPEN = 0;
export const WALL = 1;
export const DOOR = 2;

// Seeded PRNG (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Maze {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.grid = new Uint8Array(cols * rows).fill(WALL);
    this.doorOpen = false;
    this.start = { x: 1, y: 1 };
    this.exit = null;  // open cell next to the door
    this.door = null;  // border cell holding the door mesh
    this.keys = [];    // [{x,y}]
  }
  idx(x, y) { return y * this.cols + x; }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return WALL;
    return this.grid[this.idx(x, y)];
  }
  set(x, y, v) { this.grid[this.idx(x, y)] = v; }
  // Collision query: door counts as a wall until it opens.
  isWall(x, y) {
    const v = this.get(x, y);
    return v === WALL || (v === DOOR && !this.doorOpen);
  }
  // Pathing query: door is never walkable for BFS placement purposes.
  isOpen(x, y) { return this.get(x, y) === OPEN; }
}

// Recursive backtracker on an odd grid, plus light "braiding" (a few loops).
export function generateMaze(cols, rows, rng, braid = 0.08) {
  const m = new Maze(cols, rows);
  const stack = [[1, 1]];
  m.set(1, 1, OPEN);
  const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && m.get(nx, ny) === WALL) options.push([dx, dy]);
    }
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy] = options[Math.floor(rng() * options.length)];
    m.set(x + dx / 2, y + dy / 2, OPEN);
    m.set(x + dx, y + dy, OPEN);
    stack.push([x + dx, y + dy]);
  }
  // Braiding: knock down a few inner walls between two open cells to create loops.
  if (braid > 0) {
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (m.get(x, y) !== WALL) continue;
        const h = m.get(x - 1, y) === OPEN && m.get(x + 1, y) === OPEN && m.get(x, y - 1) === WALL && m.get(x, y + 1) === WALL;
        const v = m.get(x, y - 1) === OPEN && m.get(x, y + 1) === OPEN && m.get(x - 1, y) === WALL && m.get(x + 1, y) === WALL;
        if ((h || v) && rng() < braid) m.set(x, y, OPEN);
      }
    }
  }
  return m;
}

export function bfs(maze, sx, sy) {
  const { cols, rows } = maze;
  const dist = new Int32Array(cols * rows).fill(-1);
  const prev = new Int32Array(cols * rows).fill(-1);
  const startIdx = maze.idx(sx, sy);
  const queue = [startIdx];
  dist[startIdx] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    const x = c % cols, y = (c - x) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!maze.isOpen(nx, ny)) continue;
      const n = maze.idx(nx, ny);
      if (dist[n] !== -1) continue;
      dist[n] = dist[c] + 1;
      prev[n] = c;
      queue.push(n);
    }
  }
  return { dist, prev };
}

export function pathTo(maze, bfsResult, tx, ty) {
  const path = [];
  let c = maze.idx(tx, ty);
  if (bfsResult.dist[c] < 0) return path;
  while (c !== -1) {
    const x = c % maze.cols;
    path.push({ x, y: (c - x) / maze.cols });
    c = bfsResult.prev[c];
  }
  return path.reverse();
}

function openNeighbours(maze, x, y) {
  let n = 0;
  if (maze.isOpen(x + 1, y)) n++;
  if (maze.isOpen(x - 1, y)) n++;
  if (maze.isOpen(x, y + 1)) n++;
  if (maze.isOpen(x, y - 1)) n++;
  return n;
}

// Places the exit (far cell on the outer ring) and 3 keys (spread-out dead ends),
// verifying everything is reachable from the start by BFS.
export function placeObjectives(maze, rng) {
  const { cols, rows } = maze;
  const start = maze.start;
  const fromStart = bfs(maze, start.x, start.y);

  // --- exit: reachable open cell on the outer ring, far from start
  let best = null, bestD = -1;
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!maze.isOpen(x, y)) continue;
      const onRing = x === 1 || y === 1 || x === cols - 2 || y === rows - 2;
      if (!onRing || (x === start.x && y === start.y)) continue;
      const d = fromStart.dist[maze.idx(x, y)];
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  }
  maze.exit = best;
  // door cell = border wall beyond the exit cell
  let door;
  if (best.x === cols - 2) door = { x: cols - 1, y: best.y, dir: [1, 0] };
  else if (best.y === rows - 2) door = { x: best.x, y: rows - 1, dir: [0, 1] };
  else if (best.x === 1) door = { x: 0, y: best.y, dir: [-1, 0] };
  else door = { x: best.x, y: 0, dir: [0, -1] };
  maze.door = door;
  maze.set(door.x, door.y, DOOR);

  // --- keys: spread out, prefer dead ends, never start/exit
  const taken = [start, best];
  const candidates = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!maze.isOpen(x, y)) continue;
      if (taken.some(t => t.x === x && t.y === y)) continue;
      const d = fromStart.dist[maze.idx(x, y)];
      if (d < 3) continue;
      candidates.push({ x, y, deadEnd: openNeighbours(maze, x, y) === 1, d });
    }
  }
  const distMaps = [fromStart, bfs(maze, best.x, best.y)];
  const keys = [];
  while (keys.length < 3 && candidates.length) {
    // score = min BFS distance to every already-taken point (start, exit, keys)
    for (const c of candidates) {
      let minD = Infinity;
      for (const dm of distMaps) minD = Math.min(minD, dm.dist[maze.idx(c.x, c.y)]);
      c.score = minD + (c.deadEnd ? 2 : 0);
    }
    candidates.sort((a, b) => b.score - a.score);
    const topN = Math.min(3, candidates.length);
    const pick = candidates.splice(Math.floor(rng() * topN), 1)[0];
    keys.push({ x: pick.x, y: pick.y });
    distMaps.push(bfs(maze, pick.x, pick.y));
  }
  maze.keys = keys;

  // --- verify reachability
  for (const k of keys) {
    if (fromStart.dist[maze.idx(k.x, k.y)] < 0) throw new Error('key unreachable');
  }
  if (fromStart.dist[maze.idx(best.x, best.y)] < 0) throw new Error('exit unreachable');
  return maze;
}

export function buildLevel(seedValue, cols = 13, rows = 13) {
  const rng = mulberry32(seedValue);
  const maze = generateMaze(cols, rows, rng);
  placeObjectives(maze, rng);
  return maze;
}

// Rough estimate of the shortest tour start -> 3 keys (any order) -> exit, in cells.
export function tourLength(maze) {
  const pts = [maze.start, ...maze.keys];
  const maps = pts.map(p => bfs(maze, p.x, p.y));
  const d = (i, j) => maps[i].dist[maze.idx(pts[j].x, pts[j].y)];
  const dExit = i => maps[i].dist[maze.idx(maze.exit.x, maze.exit.y)];
  let bestLen = Infinity;
  const perms = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
  for (const p of perms) {
    const len = d(0, p[0]) + d(p[0], p[1]) + d(p[1], p[2]) + dExit(p[2]);
    bestLen = Math.min(bestLen, len);
  }
  return bestLen;
}

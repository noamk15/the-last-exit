// node scripts/check-maze.mjs [seedsToTest]
// Verifies for many seeds that the maze is connected and that all keys + exit are reachable.
import { buildLevel, bfs, tourLength, OPEN } from '../js/maze.js';

const N = Number(process.argv[2] || 500);
let worst = 0, sum = 0;
for (let seed = 1; seed <= N; seed++) {
  const m = buildLevel(seed);
  const r = bfs(m, m.start.x, m.start.y);
  let open = 0, reached = 0;
  for (let i = 0; i < m.grid.length; i++) if (m.grid[i] === OPEN) { open++; if (r.dist[i] >= 0) reached++; }
  if (open !== reached) throw new Error(`seed ${seed}: maze not connected (${reached}/${open})`);
  if (m.keys.length !== 3) throw new Error(`seed ${seed}: ${m.keys.length} keys`);
  for (const k of m.keys) {
    if (r.dist[m.idx(k.x, k.y)] < 0) throw new Error(`seed ${seed}: key unreachable`);
    if (m.grid[m.idx(k.x, k.y)] !== OPEN) throw new Error(`seed ${seed}: key inside wall`);
    if (k.x === m.start.x && k.y === m.start.y) throw new Error(`seed ${seed}: key on start`);
  }
  const uniq = new Set(m.keys.map(k => `${k.x},${k.y}`));
  if (uniq.size !== 3) throw new Error(`seed ${seed}: duplicate key cells`);
  if (r.dist[m.idx(m.exit.x, m.exit.y)] < 0) throw new Error(`seed ${seed}: exit unreachable`);
  const t = tourLength(m);
  sum += t; worst = Math.max(worst, t);
}
console.log(`OK: ${N} seeds verified. Shortest tour (cells): avg ${(sum / N).toFixed(1)}, worst ${worst}`);

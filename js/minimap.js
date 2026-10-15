// Memory minimap: cells you have seen light up, then fade as if forgotten.

export class Minimap {
  constructor(canvas, cellSize, fadeSeconds = 22) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.S = cellSize;
    this.fade = fadeSeconds;
    this.maze = null;
    this.memory = null;
    this.pulse = 0;
  }

  setMaze(maze) {
    this.maze = maze;
    this.memory = new Float32Array(maze.cols * maze.rows);
  }

  reset() { if (this.memory) this.memory.fill(0); }

  // straight-line visibility on the grid, sampled every 0.2 units
  _visible(px, pz, cx, cy) {
    const tx = (cx + 0.5) * this.S, tz = (cy + 0.5) * this.S;
    const dx = tx - px, dz = tz - pz;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (let i = 1; i < steps; i++) {
      const x = px + dx * i / steps, z = pz + dz * i / steps;
      if (this.maze.isWall(Math.floor(x / this.S), Math.floor(z / this.S))) return false;
    }
    return true;
  }

  update(dt, player, radius = 3) {
    const m = this.maze, mem = this.memory;
    if (!m) return;
    this.pulse += dt;
    const decay = dt / this.fade;
    for (let i = 0; i < mem.length; i++) if (mem[i] > 0) mem[i] = Math.max(0, mem[i] - decay);
    const c = player.cell();
    for (let y = c.y - radius; y <= c.y + radius; y++) {
      for (let x = c.x - radius; x <= c.x + radius; x++) {
        if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
        if (m.get(x, y) === 1) continue; // walls are revealed through their open neighbours
        if (!this._visible(player.x, player.z, x, y)) continue;
        mem[m.idx(x, y)] = 1;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue;
          if (m.get(nx, ny) === 1) mem[m.idx(nx, ny)] = Math.max(mem[m.idx(nx, ny)], 1);
        }
      }
    }
  }

  draw(player, keys, monsters, exit, door, doorOpen) {
    const m = this.maze, mem = this.memory, g = this.ctx;
    if (!m) return;
    const W = this.canvas.width, Hh = this.canvas.height;
    const cp = Math.min(W / m.cols, Hh / m.rows);
    const ox = (W - cp * m.cols) / 2, oy = (Hh - cp * m.rows) / 2;
    g.clearRect(0, 0, W, Hh);

    for (let y = 0; y < m.rows; y++) {
      for (let x = 0; x < m.cols; x++) {
        const v = mem[m.idx(x, y)];
        if (v <= 0) continue;
        const a = Math.pow(v, 1.4);
        const t = m.get(x, y);
        if (t === 1) g.fillStyle = `rgba(190, 196, 190, ${0.06 + 0.3 * a})`;
        else if (t === 2) g.fillStyle = doorOpen ? `rgba(143, 240, 164, ${0.3 + 0.6 * a})` : `rgba(176, 58, 46, ${0.3 + 0.6 * a})`;
        else g.fillStyle = `rgba(143, 240, 164, ${0.05 + 0.22 * a})`;
        g.fillRect(ox + x * cp, oy + y * cp, cp + 0.5, cp + 0.5);
      }
    }

    // keys (only where remembered)
    const blink = 0.6 + 0.4 * Math.sin(this.pulse * 4);
    for (const k of keys) {
      if (k.collected) continue;
      const v = mem[m.idx(k.cell.x, k.cell.y)];
      if (v <= 0) continue;
      g.fillStyle = `rgba(143, 240, 164, ${Math.min(1, v + 0.2) * blink})`;
      g.beginPath(); g.arc(ox + (k.cell.x + 0.5) * cp, oy + (k.cell.y + 0.5) * cp, cp * 0.22, 0, Math.PI * 2); g.fill();
    }

    // monsters: shown when close enough to be heard
    for (const mo of monsters) {
      const d = Math.hypot(mo.pos.x - player.x, mo.pos.z - player.z) / this.S;
      if (d > 7) continue;
      const a = Math.min(1, (7 - d) / 5) * (0.5 + 0.5 * Math.abs(Math.sin(this.pulse * (mo.state === 'chase' ? 9 : 3))));
      g.fillStyle = `rgba(255, 60, 40, ${a})`;
      g.beginPath(); g.arc(ox + mo.pos.x / this.S * cp, oy + mo.pos.z / this.S * cp, cp * 0.28, 0, Math.PI * 2); g.fill();
    }

    // player: dot + heading
    const px = ox + player.x / this.S * cp, pz = oy + player.z / this.S * cp;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    g.strokeStyle = 'rgba(232, 230, 223, 0.9)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, pz); g.lineTo(px + fx * cp * 0.8, pz + fz * cp * 0.8); g.stroke();
    g.fillStyle = 'rgba(232, 230, 223, 1)';
    g.beginPath(); g.arc(px, pz, cp * 0.2, 0, Math.PI * 2); g.fill();
  }
}

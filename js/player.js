// First-person player: movement relative to yaw, circle-vs-grid collisions.

const HALF_PI = Math.PI / 2;

export class Player {
  constructor(maze, cellSize) {
    this.maze = maze;
    this.S = cellSize;
    this.radius = 0.42;
    this.speed = 4.0;
    this.height = 1.6;
    this.x = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.sensitivity = 0.0022;
    this.moving = false;
    this.distanceWalked = 0;
  }

  // Place at a cell centre, facing the first open neighbour.
  reset(cx, cy) {
    this.x = (cx + 0.5) * this.S;
    this.z = (cy + 0.5) * this.S;
    this.pitch = 0;
    const m = this.maze;
    if (m.isOpen(cx + 1, cy)) this.yaw = -HALF_PI;      // face +X
    else if (m.isOpen(cx, cy + 1)) this.yaw = Math.PI;  // face +Z
    else if (m.isOpen(cx - 1, cy)) this.yaw = HALF_PI;  // face -X
    else this.yaw = 0;                                  // face -Z
    this.moving = false;
    this.distanceWalked = 0;
  }

  look(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    const lim = HALF_PI - 0.08;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  update(dt, input) {
    let fx = 0, fz = 0;
    if (input.forward) fz -= 1;
    if (input.back) fz += 1;
    if (input.left) fx -= 1;
    if (input.right) fx += 1;
    this.moving = fx !== 0 || fz !== 0;
    if (!this.moving) return;
    const len = Math.hypot(fx, fz);
    fx /= len; fz /= len;
    // local (fx, fz) -> world using yaw (camera looks down -Z at yaw 0)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const dirX = fx * cos + fz * sin;
    const dirZ = -fx * sin + fz * cos;
    const step = this.speed * dt;
    this.moveAxis('x', dirX * step);
    this.moveAxis('z', dirZ * step);
    this.distanceWalked += step;
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    this[axis] += delta;
    const S = this.S, r = this.radius, m = this.maze;
    const cx = Math.floor(this.x / S), cz = Math.floor(this.z / S);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        if (!m.isWall(gx, gz)) continue;
        const minX = gx * S, maxX = minX + S, minZ = gz * S, maxZ = minZ + S;
        const nx = Math.max(minX, Math.min(this.x, maxX));
        const nz = Math.max(minZ, Math.min(this.z, maxZ));
        const dx = this.x - nx, dz = this.z - nz;
        if (dx * dx + dz * dz >= r * r) continue;
        if (axis === 'x') {
          const clear = Math.sqrt(Math.max(0, r * r - dz * dz));
          this.x = this.x < (minX + maxX) / 2 ? minX - clear : maxX + clear;
        } else {
          const clear = Math.sqrt(Math.max(0, r * r - dx * dx));
          this.z = this.z < (minZ + maxZ) / 2 ? minZ - clear : maxZ + clear;
        }
      }
    }
  }

  cell() {
    return { x: Math.floor(this.x / this.S), y: Math.floor(this.z / this.S) };
  }
}

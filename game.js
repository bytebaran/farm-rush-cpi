import { sweepVehicle } from "./source-level.js";
import { feederPosition, handoffDuration } from "./conveyor-motion.js";
// Single-level fruit loading puzzle.
export const mod = (x, n) => ((x % n) + n) % n;
export function polyline(points, closed = false) {
  const p = points.map((p) => ({ ...p }));
  if (closed && Math.hypot(p[0].x - p.at(-1).x, p[0].z - p.at(-1).z) > 1e-6)
    p.push({ ...p[0] });
  const distances = [0];
  for (let i = 1; i < p.length; i++)
    distances.push(
      distances.at(-1) + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z),
    );
  const length = distances.at(-1);
  return {
    points: p,
    distances,
    length,
    sample(s) {
      s = closed ? mod(s, length) : Math.max(0, Math.min(length - 0.000001, s));
      let i = 1;
      while (i < distances.length - 1 && distances[i] < s) i++;
      const a = p[i - 1],
        b = p[i],
        len = distances[i] - distances[i - 1],
        t = (s - distances[i - 1]) / len;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        dx: (b.x - a.x) / len,
        dz: (b.z - a.z) / len,
      };
    },
    nearest(point) {
      let best = { distance: Infinity, arc: 0 };
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1],
          b = p[i],
          dx = b.x - a.x,
          dz = b.z - a.z,
          l2 = dx * dx + dz * dz,
          t = Math.max(
            0,
            Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / l2),
          ),
          d = Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
        if (d < best.distance)
          best = { distance: d, arc: distances[i - 1] + t * Math.sqrt(l2) };
      }
      return best.arc;
    },
  };
}
export class Game {
  constructor(level) {
    this.level = level;
    this.ring = polyline(level.queue.ringPoints, true);
    this.mouthArc = this.ring.nearest(level.queue.mouthPosition);
    this.reset();
  }
  reset() {
    this.time = 0;
    this.fruitTime = 0;
    this.multiplier = 1;
    this.phase = 0;
    this.credit = 0;
    this.servingRow = -1;
    this.totalLoaded = 0;
    this.won = false;
    this.events = [];
    this.cars = this.level.cars.map((c) => ({
      ...c,
      state: "jammed",
      slot: null,
      loaded: 0,
      reserved: 0,
      arrived: 0,
      dockTime: 0,
    }));
    this.slots = Array(5).fill(null);
    this.cells = this.level.queue.initialPlacements
      .filter((p) => !p.waiting)
      .map((p, i) => ({
        color: p.colorId,
        key: i,
        lane: i % 4,
        arc: (this.ring.length * Math.floor(i / 4)) / 56,
      }));
    this.feeds = this.level.queue.spec.feeders.map((f) => ({
      ...f,
      path: polyline(f.channelPoints),
      lanes: f.lanes.map((l) => polyline(l.points)),
      pending: f.initialPending.map((p) => ({ ...p })),
      advanced: 0,
    }));
    this.flights = [];
    this.nextFruitId = 1000;
  }
  blockers(id) {
    return this.contacts(id).map((c) => c.id);
  }
  contacts(id) {
    const car = this.cars[id];
    return this.cars
      .filter((c) => c.id !== id && c.state === "jammed")
      .map((c) => ({ id: c.id, distance: sweepVehicle(car, c) }))
      .filter((c) => c.distance !== null)
      .sort((a, b) => a.distance - b.distance);
  }
  freeIds() {
    return this.cars
      .filter((c) => c.state === "jammed" && !this.blockers(c.id).length)
      .map((c) => c.id);
  }
  tap(id) {
    if (!Number.isInteger(id) || !this.cars[id])
      return { ok: false, reason: "invalid" };
    const c = this.cars[id];
    if (c.state !== "jammed") return { ok: false, reason: "unavailable" };
    const contacts = this.contacts(id),
      blockers = contacts.map((c) => c.id);
    if (blockers.length) {
      this.events.push({
        type: "bump",
        id,
        blockers,
        distance: contacts[0].distance,
      });
      return { ok: false, reason: "blocked", blockers };
    }
    const slot = this.slots.indexOf(null);
    if (slot < 0) {
      this.events.push({ type: "full", id });
      return { ok: false, reason: "full" };
    }
    c.state = "exiting";
    c.slot = slot;
    c.dockTime = this.time;
    this.slots[slot] = id;
    this.events.push({ type: "exit", id, slot });
    return { ok: true, id, slot };
  }
  arrive(id) {
    const c = this.cars[id];
    if (c?.state !== "exiting") return;
    c.state = "docked";
    c.arrived = this.time;
    this.events.push({ type: "arrive", id });
  }
  target(color) {
    return this.slots
      .map((id) => (id === null ? null : this.cars[id]))
      .filter(
        (c) =>
          c &&
          c.state === "docked" &&
          c.colorId === color &&
          c.capacity - c.reserved >= 4,
      )
      .sort((a, b) => a.dockTime - b.dockTime || a.slot - b.slot)[0];
  }
  tick(dt, boost = false) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    if (this.won) return;
    this.multiplier = !this.cars.some((c) => c.state === "jammed")
      ? 3
      : boost
        ? 2
        : 1;
    this.fruitTime += dt * this.multiplier;
    for (const cell of this.cells)
      if (cell.transfer && this.time >= cell.transfer.end)
        cell.transfer = null;
    const move = dt * this.level.queue.speed * this.multiplier,
      steps = Math.max(1, Math.ceil(move / (this.ring.length / 112)));
    for (let step = 0; step < steps; step++) {
      const distance = move / steps,
        previous = this.phase;
      this.phase = mod(this.phase + distance, this.ring.length);
      const candidates = [];
      for (let row = 0; row < 56; row++) {
        const cells = this.cells.slice(row * 4, row * 4 + 4);
        if (cells.some((c) => c.color === null || c.reserved || c.transfer))
          continue;
        const dist = Math.abs(
          mod(
            cells[0].arc + this.phase - this.mouthArc + this.ring.length / 2,
            this.ring.length,
          ) -
            this.ring.length / 2,
        );
        if (dist <= this.ring.length / 56) candidates.push({ cells, dist });
      }
      for (const { cells } of candidates.sort((a, b) => a.dist - b.dist)) {
        const target = this.target(cells[0].color);
        if (!target) continue;
        const base = target.reserved;
        target.reserved += 4;
        for (let lane = 0; lane < 4; lane++) {
          const cell = cells[lane];
          cell.reserved = true;
          this.flights.push({
            id: this.nextFruitId++,
            carId: target.id,
            color: cell.color,
            cellKey: cell.key,
            formation: cell.formation ?? Math.floor(cell.key / 4),
            lane,
            start: this.fruitTime + lane * 0.15,
            end: this.fruitTime + lane * 0.15 + 0.5,
            index: base + lane,
            launched: false,
          });
        }
      }
      // Refill only at an inlet crossing, preserving the reference's single-color rows.
      for (const f of this.feeds) {
        for (let row = 0; row < 56; row++) {
          const arc = mod(this.cells[row * 4].arc + previous, this.ring.length);
          if (mod(f.insertionArc - arc, this.ring.length) >= distance) continue;
          const cells = this.cells.slice(row * 4, row * 4 + 4);
          if (cells.some((c) => c.reserved || c.transfer)) continue;
          if (cells.every((c) => c.color !== null)) continue;
          const color =
            cells.find((c) => c.color !== null)?.color ?? f.pending[0]?.colorId;
          if (color === undefined) continue;
          const waiting = f.pending.slice(),
            transfers = [];
          for (const cell of cells) {
            if (cell.color !== null || cell.reserved) continue;
            const index = f.pending.findIndex((p) => p.colorId === color);
            if (index < 0) break;
            const [piece] = f.pending.splice(index, 1);
            const sourceIndex = waiting.indexOf(piece),
              from = feederPosition(f, sourceIndex);
            cell.color = piece.colorId;
            cell.formation = Math.floor((piece.id ?? sourceIndex) / 4);
            cell.transfer = {
              key: f.q + ":" + piece.id,
              from,
              sourceLane: from.lane,
              start: this.time,
            };
            transfers.push(cell);
            f.advanced++;
          }
          // Keep the whole formation together while following its moving slots.
          const duration = Math.max(0, ...transfers.map((cell) =>
            handoffDuration(
              cell.transfer.from, this.cellPosition(cell), this.level.queue.speed,
            ),
          ));
          for (const cell of transfers)
            cell.transfer.end = this.time + duration;
        }
      }
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      if (!f.launched && f.start <= this.fruitTime) {
        const cell = this.cells[f.cellKey];
        f.position = this.cellPosition(cell);
        f.launched = true;
        cell.color = null;
        cell.reserved = false;
        this.events.push({ type: "fruit", ...f });
      }
      if (f.end > this.fruitTime) continue;
      this.flights.splice(i, 1);
      const c = this.cars[f.carId];
      c.loaded++;
      this.totalLoaded++;
      this.events.push({ type: "land", id: c.id, index: f.index });
      if (c.loaded === c.capacity) {
        c.state = "departed";
        this.slots[c.slot] = null;
        this.events.push({ type: "depart", id: c.id, slot: c.slot });
      }
    }
    if (this.cars.every((c) => c.state === "departed")) {
      this.won = true;
      this.events.push({ type: "win" });
    }
  }
  cellPosition(cell) {
    const p = this.ring.sample(cell.arc + this.phase),
      offset = (cell.lane - 1.5) * 0.52;
    return {
      x: p.x + p.dz * offset,
      z: p.z - p.dx * offset,
      angle: Math.atan2(p.dx, p.dz),
    };
  }
  remainingByColor() {
    const counts = { 4: 0, 6: 0 };
    for (const c of this.cells) if (c.color !== null) counts[c.color]++;
    for (const f of this.feeds) for (const p of f.pending) counts[p.colorId]++;
    for (const f of this.flights) if (f.launched) counts[f.color]++;
    return counts;
  }
  snapshot() {
    return {
      level: this.level.id,
      completed: this.won,
      loaded: this.totalLoaded,
      total: 912,
      freeSlots: this.slots.filter((x) => x === null).length,
      cars: this.cars.map((c) => ({
        id: c.id,
        color: c.color,
        capacity: c.capacity,
        state: c.state,
        remaining: c.capacity - c.loaded,
        slot: c.slot,
        blockedBy: c.state === "jammed" ? this.blockers(c.id) : [],
      })),
    };
  }
}

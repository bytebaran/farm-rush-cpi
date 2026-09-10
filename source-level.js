// Keep the reference's authored layout, in the original game's vehicle units.
// The Cocos ad used collision boxes much smaller than its visible vehicles.
export function sourceLevel(reference) {
  const level = structuredClone(reference);
  for (const c of level.cars) {
    const rawX = (c.model.x - level.fit.offset.x) / (2 * level.fit.scale);
    const rawZ = (c.model.z - level.fit.offset.z) / (2 * level.fit.scale);
    c.world.x = -rawX * 1.5;
    c.world.z = rawZ * 1.5 - 7.5;
    c.collisionDimensions = {
      width: 0.93,
      length: [0, 2.032442, 2.29, 3][c.shapeId],
      centerZ: [0, 0.108784914, 0.1, 0][c.shapeId],
    };
    c.rootScale = 1;
  }
  level.dock.slotsWorld = Array.from({ length: 5 }, (_, i) => ({
    x: (i - 2.5) * 1.4,
    y: 0,
    z: -4.684,
  }));
  level.dock.lockedWorld = { x: 3.5, y: 0, z: -4.684 };
  level.dock.slotWorldYaw = 195.2;
  level.queue.speed = 3;
  return level;
}

export function sweepVehicle(a, b, maxDistance = 15) {
  const basis = (c) => {
    const theta = (c.world.yaw * Math.PI) / 180;
    return {
      f: { x: Math.sin(theta), z: Math.cos(theta) },
      r: { x: Math.cos(theta), z: -Math.sin(theta) },
    };
  };
  const A = basis(a),
    B = basis(b),
    dot = (u, v) => u.x * v.x + u.z * v.z;
  const center = (c) => {
    const f = basis(c).f,
      z = c.collisionDimensions.centerZ ?? 0;
    return { x: c.world.x + f.x * z, z: c.world.z + f.z * z };
  };
  const ca = center(a),
    cb = center(b),
    delta = { x: cb.x - ca.x, z: cb.z - ca.z };
  let enter = 0,
    exit = maxDistance;
  for (const axis of [A.f, A.r, B.f, B.r]) {
    const extent = (c, C) =>
      (Math.abs(dot(C.r, axis)) * c.collisionDimensions.width +
        Math.abs(dot(C.f, axis)) * c.collisionDimensions.length) /
      2;
    const radius = extent(a, A) + extent(b, B),
      d = dot(delta, axis),
      speed = dot(A.f, axis);
    if (Math.abs(speed) < 1e-8) {
      if (Math.abs(d) > radius) return null;
      continue;
    }
    let lo = (d - radius) / speed,
      hi = (d + radius) / speed;
    if (lo > hi) [lo, hi] = [hi, lo];
    enter = Math.max(enter, lo);
    exit = Math.min(exit, hi);
    if (enter > exit) return null;
  }
  return enter <= maxDistance && exit >= 0 ? Math.max(0, enter) : null;
}

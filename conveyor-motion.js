export const FRUIT_SPACING = 0.52;
export const FEEDER_SPEED_MULTIPLIER = 2.5;

export function feederPosition(feed, index) {
  const lane = index % 4;
  const distance = (Math.floor(index / 4) + 1) * FRUIT_SPACING;
  const p = feed.lanes[lane].sampleFrame(distance);
  return { x: p.x, z: p.z, angle: Math.atan2(p.dx, p.dz), lane, distance };
}

export function handoffDuration(start, target, beltSpeed) {
  return Math.hypot(target.x - start.x, target.z - start.z) /
    Math.max(0.0001, beltSpeed * FEEDER_SPEED_MULTIPLIER);
}

export function advanceFeederDistance(current, target, dt, speed) {
  const step = Math.max(0, dt * speed);
  return current + Math.max(-step, Math.min(step, target - current));
}

export function blendConveyorPose(start, target, progress) {
  const t = Math.max(0, Math.min(1, progress));
  return {
    position: start.position.clone().lerp(target.position, t),
    quaternion: start.quaternion.clone().slerp(target.quaternion, t),
    scale: start.scale,
  };
}

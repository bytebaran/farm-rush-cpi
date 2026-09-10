import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Game, polyline, mod } from "./game.js?v=2";
import { sourceLevel } from "./source-level.js";
import { sourceMaterial, slicedSprite } from "./source-style.js";
import { registerTools } from "./web-tools.js";
import { createInputRedirect } from "./ad-redirect.js";
import {
  FRUIT_SPACING,
  FEEDER_SPEED_MULTIPLIER,
  feederPosition,
  advanceFeederDistance,
  blendConveyorPose,
} from "./conveyor-motion.js";
import { createTruckVisual, prepareTruckDataTexture } from "./truck-visual.js";

const $ = (id) => document.getElementById(id),
  rad = Math.PI / 180;
const inputRedirect = createInputRedirect();
addEventListener("pageshow", (event) => {
  if (event.persisted) inputRedirect.reset();
});
const renderer = new THREE.WebGLRenderer({
  canvas: $("scene"),
  antialias: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor("#f7dca9");
renderer.autoClear = false;
const scene = new THREE.Scene(),
  ground = new THREE.Scene(),
  overlays = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(10, 1, 0.1, 1000);
const dynamic = new THREE.Group();
scene.add(dynamic);
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  temp = new THREE.Object3D();
const loader = new GLTFLoader(),
  textureLoader = new THREE.TextureLoader();
const clamp = THREE.MathUtils.clamp,
  lerp = THREE.MathUtils.lerp;
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1)),
  outQuad = (t) => 1 - (1 - t) ** 2;
const outBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
let game,
  level,
  models,
  textures,
  materialConfig,
  poses,
  lidShadows,
  carViews = [],
  animations = [],
  particles = [],
  held = false,
  started = false,
  ready = false,
  lastTime = 0,
  winTimeout;
let stageWidth = 1,
  stageHeight = 1;
const bayHighlights = [];
function resize() {
  stageWidth = $("game").clientWidth;
  stageHeight = $("game").clientHeight;
  const aspect = stageWidth / stageHeight,
    halfHeight = Math.max(17.8, 9.4 / aspect),
    distance = halfHeight / Math.tan(5 * rad),
    pitch = 68 * rad;
  camera.aspect = aspect;
  camera.position.set(
    0,
    distance * Math.sin(pitch),
    1.1 + distance * Math.cos(pitch),
  );
  camera.lookAt(0, 0, 1.1);
  camera.updateProjectionMatrix();
  renderer.setSize(stageWidth, stageHeight, false);
}
addEventListener("resize", resize);
resize();
function project(position) {
  const p = position.clone().project(camera);
  return {
    x: (p.x * 0.5 + 0.5) * stageWidth,
    y: (0.5 - p.y * 0.5) * stageHeight,
  };
}
function hint(message, ms = 2400) {
  $("hint").textContent = message;
  clearTimeout(hint.timer);
  if (ms) hint.timer = setTimeout(() => ($("hint").textContent = ""), ms);
}
function meshGeometry(root) {
  let result;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh && !result) result = o;
  });
  return result.geometry.clone().applyMatrix4(result.matrixWorld);
}
function groundArt(root, order = 0) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.depthWrite = false;
      o.material.toneMapped = false;
      o.material.side = THREE.DoubleSide;
      o.renderOrder = (o.userData.unitySortingOrder ?? order) + 10;
    }
  });
  return root;
}
function mat(key, map = null) {
  return sourceMaterial(materialConfig, key, map);
}

// Floor SpriteRenderers have an ordered ground pass, independent of 3D depth.
function buildEnvironment() {
  const floor = groundArt(models.source_floor.clone(true));
  // Extend the authored sand seam for this unusually tall 40-truck layout.
  floor.traverse((o) => {
    if (o.isMesh && o.userData.sourceLocalPosition?.[2] < -15)
      o.position.z -= 10;
  });
  floor.scale.z = -1;
  floor.position.z = -4.684;
  ground.add(floor);
  const bridge = slicedSprite(textures.Floor03, {
    pixels: [1024, 1024],
    width: 24.30766,
    height: 10.006,
  });
  for (let i = 0; i < bridge.geometry.attributes.uv.count; i++)
    bridge.geometry.attributes.uv.setY(i, 0.5 / 1024);
  bridge.geometry.attributes.uv.needsUpdate = true;
  bridge.position.set(-0.0911, -0.00002, 14.046);
  bridge.renderOrder = 8;
  ground.add(bridge);
  for (let i = 0; i < 6; i++) {
    const slot = i < 5 ? level.dock.slotsWorld[i] : level.dock.lockedWorld,
      bay = groundArt(models.parking_bay.clone(true), 0);
    bay.scale.z = -1;
    bay.rotation.y = 15.2 * rad;
    bay.position.set(slot.x, 0, slot.z);
    ground.add(bay);
    if (i < 5) {
      const highlight = slicedSprite(textures.Slote01_Outline, {
        pixels: [688, 1024],
        width: 1.440608,
        height: 2.074645,
      });
      const offset = new THREE.Vector3(-0.0387, 0.0198, 0.0279).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        15.2 * rad,
      );
      highlight.position.copy(offset).add(new THREE.Vector3(slot.x, 0, slot.z));
      highlight.rotation.y = 195.2 * rad;
      highlight.renderOrder = 9;
      highlight.visible = false;
      ground.add(highlight);
      bayHighlights.push(highlight);
    }
    if (i === 5) {
      const lock = slicedSprite(textures.lock, {
        pixels: [147, 185],
        width: 0.59535,
        height: 0.74925,
      });
      lock.position.set(slot.x, 0.18, slot.z);
      lock.rotation.y = 195.2 * rad;
      scene.add(lock);
    }
  }
  road(game.ring, true);
  for (const feed of game.feeds) road(feed.path, false);
}
function road(path, closed) {
  const surface = meshGeometry(models.conveyor_surface_strip),
    edge = meshGeometry(models.conveyor_edge),
    cap = meshGeometry(models.conveyor_edge_cap);
  const center = path.points.reduce(
    (a, p) => ({
      x: a.x + p.x / path.points.length,
      z: a.z + p.z / path.points.length,
    }),
    { x: 0, z: 0 },
  );
  let outer = 1;
  if (closed) {
    const distances = [-1, 1].map((side) =>
      path.points.reduce((sum, _, i) => {
        const p = path.sample((path.length * i) / path.points.length);
        return (
          sum +
          Math.hypot(p.x + p.dz * side - center.x, p.z - p.dx * side - center.z)
        );
      }, 0),
    );
    outer = distances[0] > distances[1] ? -1 : 1;
  }
  const gap = (s, side) => {
    if (!side) return false;
    if (closed) {
      if (side !== outer) return false;
      const d = (arc) =>
        Math.abs(mod(s - arc + path.length / 2, path.length) - path.length / 2);
      return (
        d(game.mouthArc) < 0.85 ||
        game.feeds.some((f) => d(f.insertionArc) < 1.05)
      );
    }
    const start = path.sample(0),
      end = path.sample(path.length),
      a = game.ring.sample(game.ring.nearest(start)),
      b = game.ring.sample(game.ring.nearest(end));
    return Math.hypot(start.x - a.x, start.z - a.z) <
      Math.hypot(end.x - b.x, end.z - b.z)
      ? s < 1.05
      : s > path.length - 1.05;
  };
  for (const side of [0, -1, 1]) {
    const source = side ? edge : surface,
      segments = [],
      count = Math.ceil(path.length / (side ? 0.1 : 0.2)),
      step = path.length / count;
    for (let i = 0; i < count; i++) {
      if (gap(i * step, side) || gap((i + 1) * step, side)) continue;
      const g = source.clone(),
        p = g.attributes.position;
      for (let j = 0; j < p.count; j++) {
        const sample = path.sample(
            (i + 0.5) * step + p.getZ(j) * step * (side ? 1.4 : 1),
          ),
          offset = p.getX(j) + (side ? side * 1.073 : 0);
        p.setXYZ(
          j,
          sample.x + sample.dz * offset,
          p.getY(j),
          sample.z - sample.dx * offset,
        );
      }
      g.computeVertexNormals();
      segments.push(g);
      if (side) {
        for (const start of [true, false]) {
          const neighbor = start ? i - 1 : i + 1;
          const endpointOutside =
            !closed && (neighbor < 0 || neighbor >= count);
          const neighborIndex = mod(neighbor, count);
          if (
            !endpointOutside &&
            !gap(neighborIndex * step, side) &&
            !gap((neighborIndex + 1) * step, side)
          )
            continue;
          const end = (start ? i : i + 1) * step + (start ? -0.2 : 0.2) * step,
            cg = cap.clone(),
            cp = cg.attributes.position;
          for (let j = 0; j < cp.count; j++) {
            const sample = path.sample(
                end + (start ? -1 : 1) * (0.10156363 - cp.getZ(j)),
              ),
              offset = side * 1.073 + (start ? 1 : -1) * cp.getX(j);
            cp.setXYZ(
              j,
              sample.x + sample.dz * offset,
              cp.getY(j),
              sample.z - sample.dx * offset,
            );
          }
          cg.computeVertexNormals();
          segments.push(cg);
        }
      }
    }
    scene.add(
      new THREE.Mesh(
        mergeGeometries(segments),
        mat(side ? "road_edge" : "road_surface"),
      ),
    );
    segments.forEach((g) => g.dispose());
  }
  surface.dispose();
  edge.dispose();
  cap.dispose();
}
const variantNames = ["", "Bus", "Bus_02", "Bus_03"];
function createCar(c) {
  const { group, visual, body, arrow, lid, lidShadow, shadow, morphs } =
    createTruckVisual(c, { models, textures, materialConfig, lidShadows });
  const paint = c.colorId === 4 ? "yellow" : "purple";
  group.position.set(c.world.x, 0, c.world.z);
  group.rotation.y = c.world.yaw * rad;
  dynamic.add(group);
  const label = document.createElement("span");
  label.className = "truck-label";
  label.hidden = true;
  label.dataset.color = paint;
  $("labels").append(label);
  const pill = slicedSprite(textures["Slot-text-bg"], {
    pixels: [134, 79],
    width: 1.103855885325,
    height: 0.65296521513,
  });
  pill.material.color.setRGB(
    ...(c.colorId === 4
      ? [1, 0.9072689, 0.08018869]
      : [0.75881875, 0.23584905, 0.9433962]),
    THREE.SRGBColorSpace,
  );
  pill.rotation.y = Math.PI;
  pill.visible = false;
  overlays.add(pill);
  const button = document.createElement("button");
  button.textContent = `${c.color} ${c.capacity}-fruit truck ${c.id + 1}`;
  button.addEventListener("click", () => tap(c.id));
  $("vehicles").append(button);
  group.traverse((o) => (o.userData.carId = c.id));
  return {
    group,
    visual,
    body,
    arrow,
    lid,
    lidShadow,
    shadow,
    morphs,
    label,
    pill,
    button,
    bump: null,
    tilt: null,
    hitTime: -10,
    hidden: false,
  };
}

const fruitPools = {};
function createFruitPool(color, model) {
  const parts = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (o.isMesh) {
      const mesh = new THREE.InstancedMesh(
        o.geometry.clone().applyMatrix4(o.matrixWorld),
        mat(color === 4 ? "lemon" : "eggplant", o.material.map),
        1400,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      parts.push(mesh);
    }
  });
  fruitPools[color] = { parts, count: 0 };
}
function fruit(color, pose) {
  const pool = fruitPools[color];
  if (!pool || pool.count >= 1400) return;
  temp.position.copy(pose.position);
  temp.quaternion.copy(pose.quaternion);
  temp.scale.setScalar(pose.scale);
  temp.updateMatrix();
  for (const mesh of pool.parts) mesh.setMatrixAt(pool.count, temp.matrix);
  pool.count++;
}
const up = new THREE.Vector3(0, 1, 0),
  quaternion = (q) => new THREE.Quaternion(q.x, q.y, q.z, q.w);
function beltPose(position, row, lane) {
  const slot = poses.formations[row % 4].runtimeSlotsForWidth2_1[lane],
    q = new THREE.Quaternion().setFromAxisAngle(up, position.angle),
    local = new THREE.Vector3(
      0,
      slot.position.y,
      slot.position.z,
    ).applyQuaternion(q);
  return {
    position: new THREE.Vector3(position.x, 0.5, position.z).add(local),
    quaternion: q.multiply(quaternion(slot.quaternion)),
    scale: 0.624,
  };
}
function cargoPose(id, index) {
  const c = game.cars[id],
    v = carViews[id],
    seat = poses.buses[variantNames[c.shapeId]].seats[index];
  return {
    position: v.group.localToWorld(
      new THREE.Vector3(
        seat.position.x,
        seat.position.y * v.body.scale.y,
        seat.position.z,
      ),
    ),
    quaternion: v.group.quaternion
      .clone()
      .multiply(quaternion(seat.quaternion)),
    scale: seat.scale.x * (c.colorId === 4 ? 1.2 : 1.25) * v.group.scale.x,
  };
}
const feederVisuals = new Map();
function renderFruit(dt) {
  for (const pool of Object.values(fruitPools)) pool.count = 0;
  for (const cell of game.cells) {
    if (cell.color === null) continue;
    const formation = cell.formation ?? Math.floor(cell.key / 4),
      target = beltPose(game.cellPosition(cell), formation, cell.lane),
      transfer = cell.transfer;
    if (transfer) {
      transfer.startPose ??=
        feederVisuals.get(transfer.key)?.pose ??
        beltPose(transfer.from, formation, transfer.sourceLane);
      fruit(cell.color, blendConveyorPose(
        transfer.startPose,
        target,
        (game.time - transfer.start) / Math.max(0.0001, transfer.end - transfer.start),
      ));
    } else fruit(cell.color, target);
  }
  const alive = new Set();
  for (const feed of game.feeds) {
    const limit = Math.min(
      feed.pending.length,
      Math.floor(Math.min(...feed.lanes.map((p) => p.length)) / FRUIT_SPACING) * 4,
    );
    for (let j = 0; j < limit; j++) {
      const item = feed.pending[j],
        key = feed.q + ":" + item.id;
      alive.add(key);
      const target = feederPosition(feed, j);
      let v = feederVisuals.get(key);
      if (!v) {
        v = { distance: target.distance };
        feederVisuals.set(key, v);
      }
      v.distance = advanceFeederDistance(
        v.distance, target.distance, dt,
        level.queue.speed * FEEDER_SPEED_MULTIPLIER * game.multiplier,
      );
      const p = feed.lanes[target.lane].sample(v.distance);
      v.pose = beltPose(
        { x: p.x, z: p.z, angle: Math.atan2(p.dx, p.dz) },
        Math.floor(item.id / 4), target.lane,
      );
      fruit(item.colorId, v.pose);
    }
  }
  for (const key of feederVisuals.keys())
    if (!alive.has(key)) feederVisuals.delete(key);
  for (const c of game.cars) {
    if (carViews[c.id].hidden) continue;
    for (let i = 0; i < c.loaded; i++) fruit(c.colorId, cargoPose(c.id, i));
  }
  for (const f of game.flights) {
    if (!f.launched) continue;
    const t = clamp((game.fruitTime - f.start) / 0.5, 0, 1),
      ease = sine(t),
      target = cargoPose(f.carId, f.index),
      start = beltPose(f.position, f.formation, f.lane),
      midpoint = start.position
        .clone()
        .add(target.position)
        .multiplyScalar(0.5);
    midpoint.y += Math.max(1, start.position.distanceTo(target.position) * 0.4);
    const curve = new THREE.CatmullRomCurve3([
      start.position,
      midpoint,
      target.position,
    ]);
    fruit(f.color, {
      position: curve.getPoint(t),
      quaternion: start.quaternion.slerp(target.quaternion, ease),
      scale: lerp(start.scale, target.scale, ease),
    });
  }
  for (const pool of Object.values(fruitPools))
    for (const mesh of pool.parts) {
      mesh.count = pool.count;
      mesh.instanceMatrix.needsUpdate = true;
    }
}

function roundedPath(points) {
  const clean = points.filter(
      (p, i) => !i || p.distanceTo(points[i - 1]) > 0.005,
    ),
    sampled = [clean[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1],
      b = clean[i],
      c = clean[i + 1],
      r = Math.min(2, a.distanceTo(b) * 0.5, b.distanceTo(c) * 0.5),
      entry = b.clone().add(a.clone().sub(b).normalize().multiplyScalar(r)),
      exit = b.clone().add(c.clone().sub(b).normalize().multiplyScalar(r));
    sampled.push(
      ...new THREE.QuadraticBezierCurve3(entry, b, exit).getPoints(6),
    );
  }
  sampled.push(clean.at(-1));
  return polyline(sampled);
}
function routeFor(id, slotIndex) {
  const c = game.cars[id],
    start = new THREE.Vector3(c.world.x, 0, c.world.z),
    dx = Math.sin(c.world.yaw * rad),
    dz = Math.cos(c.world.yaw * rad),
    slot = level.dock.slotsWorld[slotIndex];
  const rest = game.cars
      .filter(
        (x) => x.state === "jammed" || x.state === "docked" || x.id === id,
      )
      .map((x) =>
        x.state === "docked" ? level.dock.slotsWorld[x.slot] : x.world,
      ),
    all = [...rest, ...level.dock.slotsWorld];
  const bounds = {
    left: Math.min(...all.map((p) => p.x)) - 1,
    right: Math.max(...all.map((p) => p.x)) + 1,
    front: Math.max(...level.dock.slotsWorld.map((p) => p.z)) + 3,
    back: Math.max(...all.map((p) => p.z)) + 3.5,
  };
  const tx =
      Math.abs(dx) < 1e-5
        ? Infinity
        : ((dx > 0 ? bounds.right : bounds.left) - start.x) / dx,
    tz =
      Math.abs(dz) < 1e-5
        ? Infinity
        : ((dz > 0 ? bounds.back : bounds.front) - start.z) / dz,
    t = Math.max(0, Math.min(tx, tz)),
    edge = new THREE.Vector3(start.x + dx * t, 0, start.z + dz * t),
    points = [start, edge];
  if (edge.z > bounds.front + 0.15) {
    const side =
      edge.z >= bounds.back - 0.15
        ? slot.x >= start.x
          ? bounds.right
          : bounds.left
        : edge.x > 0
          ? bounds.right
          : bounds.left;
    if (edge.z >= bounds.back - 0.15)
      points.push(new THREE.Vector3(side, 0, bounds.back));
    points.push(new THREE.Vector3(side, 0, bounds.front));
  }
  const yaw = level.dock.slotWorldYaw * rad,
    entryX = slot.x - (Math.sin(yaw) / Math.cos(yaw)) * (slot.z - bounds.front);
  points.push(
    new THREE.Vector3(entryX, 0, bounds.front),
    new THREE.Vector3(slot.x, 0, slot.z),
  );
  return roundedPath(points);
}
function sourceEase(t) {
  if (t <= 0.7) return t;
  const u = (t - 0.7) / 0.3;
  return (
    (2 * u ** 3 - 3 * u * u + 1) * 0.7 +
    (u ** 3 - 2 * u * u + u) * 0.3 +
    (-2 * u ** 3 + 3 * u * u)
  );
}
function tap(id, countInput = true) {
  if (!ready || game.won || !carViews[id])
    return { ok: false, reason: "unavailable" };
  if (countInput && !inputRedirect.record())
    return { ok: false, reason: "redirecting" };
  if (carViews[id].bump || carViews[id].tilt)
    return { ok: false, reason: "unavailable" };
  const result = game.tap(id);
  if (result.ok) {
    started = true;
    $("tutorial").classList.add("hidden");
    hint("", 0);
  }
  processEvents();
  return result;
}
function processEvents() {
  for (const event of game.events.splice(0)) {
    const v = carViews[event.id];
    if (event.type === "exit") {
      v.arrow.visible = v.lid.visible = v.lidShadow.visible = false;
      v.button.disabled = true;
      const path = routeFor(event.id, event.slot);
      animations.push({
        id: event.id,
        type: "park",
        path,
        start: game.time,
        duration: path.length / 32 + 0.55,
      });
    } else if (event.type === "bump")
      v.bump = {
        start: game.time,
        gap: event.distance,
        approach:
          event.distance > 0.01 ? Math.max(0.04, event.distance / 16) : 0,
        hit: false,
        blocker: event.blockers[0],
      };
    else if (event.type === "full") {
      v.bump = { start: game.time, full: true };
      const p = project(
          v.group.position.clone().add(new THREE.Vector3(0, 1.8, 1)),
        ),
        popup = document.createElement("div");
      popup.className = "slot-popup";
      popup.textContent = "Slots Full!";
      popup.style.left = p.x + "px";
      popup.style.top = p.y + "px";
      $("game").append(popup);
      setTimeout(() => popup.remove(), 1050);
    } else if (event.type === "arrive") v.label.hidden = false;
    else if (event.type === "land") v.hitTime = game.time;
    else if (event.type === "depart") {
      v.label.hidden = true;
      const start = v.group.position.clone(),
        yaw = v.group.rotation.y,
        front = Math.max(...level.dock.slotsWorld.map((p) => p.z)) + 3;
      animations.push({
        id: event.id,
        type: "depart",
        start: game.time,
        position: start,
        yaw,
        reverse: new THREE.Vector3(
          start.x + Math.tan(yaw) * (front - start.z),
          0,
          front,
        ),
      });
      confetti(start);
    } else if (event.type === "win")
      winTimeout = setTimeout(
        () => $("result").classList.remove("hidden"),
        1200,
      );
  }
}
function confetti(position) {
  for (let i = 0; i < 16; i++) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.18),
      new THREE.MeshBasicMaterial({
        color: [0xffd62b, 0xb662ff, 0xff4a8d, 0x8cdb42][i % 4],
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(position).y += 1;
    scene.add(mesh);
    particles.push({
      mesh,
      start: game.time,
      origin: mesh.position.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        3 + Math.random() * 3,
        (Math.random() - 0.5) * 3,
      ),
    });
  }
}
function animateVehicles(dt) {
  for (let i = animations.length - 1; i >= 0; i--) {
    const a = animations[i],
      v = carViews[a.id],
      elapsed = game.time - a.start;
    if (a.type === "park") {
      const t = clamp(elapsed / a.duration, 0, 1),
        p = a.path.sample(a.path.length * sourceEase(t)),
        target = Math.atan2(p.dx, p.dz);
      v.group.position.set(p.x, 0, p.z);
      v.group.rotation.y += clamp(
        mod(target - v.group.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
        -2000 * rad * dt,
        2000 * rad * dt,
      );
      v.group.scale.setScalar(lerp(1, 0.9, sine(t)));
      if (t >= 1) {
        v.group.rotation.y = level.dock.slotWorldYaw * rad;
        animations.splice(i, 1);
        game.arrive(a.id);
      }
    } else {
      if (elapsed <= 0.35) {
        v.group.position.lerpVectors(
          a.position,
          a.reverse,
          sine(elapsed / 0.35),
        );
        v.group.rotation.y = a.yaw;
      } else {
        const t = clamp((elapsed - 0.35) / 0.6, 0, 1);
        v.group.position.copy(a.reverse);
        v.group.position.x += 25 * t * t;
        const turn = clamp((elapsed - 0.35) / 0.25, 0, 1);
        v.group.rotation.y =
          a.yaw + (Math.PI / 2 - a.yaw) * Math.sin((turn * Math.PI) / 2);
      }
      if (elapsed >= 0.95) {
        v.group.visible = false;
        v.hidden = true;
        animations.splice(i, 1);
      }
    }
  }
  for (const c of game.cars) {
    const v = carViews[c.id];
    v.visual.position.z = 0;
    v.visual.rotation.set(0, 0, 0);
    if (v.bump) {
      const b = v.bump,
        t = game.time - b.start;
      if (b.full) {
        const keys = [0, 0.18, -0.108, 0.0648, -0.03888, 0],
          seg = Math.min(4, Math.floor(t / 0.06));
        v.visual.position.z = lerp(
          keys[seg],
          keys[seg + 1],
          sine((t - seg * 0.06) / 0.06),
        );
        if (t >= 0.3) v.bump = null;
      } else {
        if (t < b.approach) v.visual.position.z = (b.gap * t) / b.approach;
        else {
          if (!b.hit) {
            b.hit = true;
            carViews[b.blocker].tilt = {
              start: game.time,
              direction: c.world.yaw * rad,
            };
          }
          v.visual.position.z =
            b.gap * (1 - outQuad(clamp((t - b.approach) / 0.12, 0, 1)));
        }
        if (t >= b.approach + 0.12) v.bump = null;
      }
    }
    if (v.tilt) {
      const elapsed = game.time - v.tilt.start,
        t =
          elapsed < 0.08
            ? outQuad(elapsed / 0.08)
            : 1 - outBack(clamp((elapsed - 0.08) / 0.25, 0, 1)),
        relative = v.tilt.direction - v.group.rotation.y;
      v.visual.rotation.x = Math.cos(relative) * 24 * rad * t;
      v.visual.rotation.z = -Math.sin(relative) * 24 * rad * t;
      if (elapsed >= 0.33) v.tilt = null;
    }
    const hit = game.time - v.hitTime,
      pop = hit < 0.2 ? outQuad(hit / 0.2) : 1 - sine((hit - 0.2) / 0.3);
    v.body.scale.y = 1 + 0.2 * (hit < 0.5 ? pop : 0);
    const inflation =
      ([0, 0.35, 0.42, 0.5][c.shapeId] * c.loaded) / c.capacity +
      (hit < 0.5 ? 0.2 * (1 - outQuad(hit / 0.5)) : 0);
    for (const mesh of v.morphs) mesh.morphTargetInfluences[0] = inflation;
    v.group.updateMatrixWorld(true);
    v.pill.visible = !v.label.hidden;
    if (!v.label.hidden) {
      const slot = level.dock.slotsWorld[c.slot],
        position = new THREE.Vector3(-0.0324, -0.324, 1.53)
          .applyAxisAngle(up, 15.2 * rad)
          .add(new THREE.Vector3(slot.x, 0, slot.z)),
        p = project(position),
        pixelsPerUnit =
          project(position.clone().add(new THREE.Vector3(1, 0, 0))).x - p.x;
      v.pill.position
        .copy(position)
        .add(new THREE.Vector3(0.008379, 0, 0.007011));
      v.label.style.fontSize = pixelsPerUnit * 0.5643855 + "px";
      v.label.style.left = p.x + "px";
      v.label.style.top = p.y + "px";
      v.label.textContent = String(c.capacity - c.loaded);
      if (c.loaded === c.capacity) v.label.hidden = true;
    }
  }
  const free = game.slots
    .map((id, i) => (id === null || game.cars[id].state === "exiting" ? i : -1))
    .filter((i) => i >= 0);
  for (let i = 0; i < bayHighlights.length; i++) {
    const h = bayHighlights[i],
      show = free.length === 1 && free[0] === i;
    if (show && !h.visible) h.userData.since = game.time;
    h.visible = show;
    const u = mod(game.time - (h.userData.since ?? 0), 1.2) / 0.6;
    h.material.opacity = 0.15 + 0.85 * outQuad(u <= 1 ? u : 2 - u);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i],
      t = game.time - p.start;
    p.mesh.position.copy(p.origin).addScaledVector(p.velocity, t);
    p.mesh.position.y -= 4 * t * t;
    p.mesh.rotation.set(t * 5, t * 8, t * 6);
    if (t > 1.5) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
  if (!started) {
    const p = project(carViews[1].arrow.getWorldPosition(new THREE.Vector3()));
    $("tutorial").style.left = p.x + "px";
    $("tutorial").style.top = p.y + "px";
  }
}
function restart() {
  clearTimeout(winTimeout);
  inputRedirect.reset();
  for (const v of carViews) {
    v.label.remove();
    overlays.remove(v.pill);
    v.pill.geometry.dispose();
    v.pill.material.dispose();
    v.button.remove();
    v.group.traverse((o) => {
      if (o.isMesh) o.material.dispose();
    });
  }
  for (const p of particles) {
    scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  }
  particles = [];
  dynamic.clear();
  animations = [];
  feederVisuals.clear();
  game.reset();
  carViews = game.cars.map(createCar);
  started = held = false;
  $("result").classList.add("hidden");
  $("tutorial").classList.remove("hidden");
  hint("", 0);
}
$("restart").addEventListener("click", () => ready && restart());
$("replay").addEventListener("click", restart);
$("scene").addEventListener("pointerdown", (event) => {
  if (!ready || game.won || !event.isPrimary || event.button !== 0) return;
  if (!inputRedirect.record()) return;
  $("scene").setPointerCapture(event.pointerId);
  const rect = $("scene").getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((event.clientY - rect.top) / rect.height) * 2,
  );
  raycaster.setFromCamera(pointer, camera);
  let selected;
  for (const preferClear of [true, false]) {
    for (let step = 0; step < 10 && !selected; step++) {
      const radius = (step * (preferClear ? 0.33333335 : 0.66)) / 9,
        candidates = [];
      for (const c of game.cars) {
        if (c.state !== "jammed" || (preferClear && game.blockers(c.id).length))
          continue;
        const v = carViews[c.id],
          inverse = v.group.matrixWorld.clone().invert(),
          ray = raycaster.ray.clone().applyMatrix4(inverse),
          d = c.collisionDimensions,
          center = d.centerZ ?? 0,
          box = new THREE.Box3(
            new THREE.Vector3(
              -d.width / 2 - radius,
              0,
              center - d.length / 2 - radius,
            ),
            new THREE.Vector3(
              d.width / 2 + radius,
              1.3,
              center + d.length / 2 + radius,
            ),
          ),
          hit = ray.intersectBox(box, new THREE.Vector3());
        if (hit)
          candidates.push({
            id: c.id,
            distance: hit
              .applyMatrix4(v.group.matrixWorld)
              .distanceTo(camera.position),
          });
      }
      selected = candidates.sort((a, b) => a.distance - b.distance)[0];
    }
    if (selected) break;
  }
  held = !selected;
  // The canvas gesture was already counted; button/tool activations count in tap.
  if (selected) tap(selected.id, false);
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  $("scene").addEventListener(name, () => (held = false));
addEventListener("blur", () => (held = false));
document.addEventListener("visibilitychange", () => {
  held = false;
  lastTime = 0;
});
function frame(time) {
  requestAnimationFrame(frame);
  if (!ready) return;
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  if (!document.hidden) {
    game.tick(dt, held);
    processEvents();
    animateVehicles(dt);
    processEvents();
    renderFruit(dt);
  }
  renderer.clear();
  renderer.render(ground, camera);
  renderer.clearDepth();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(overlays, camera);
}
requestAnimationFrame(frame);
try {
  const names = [
    "bus_inflatable",
    "bus_medium_inflatable",
    "bus_long_inflatable",
    "source_floor",
    "parking_bay",
    "conveyor_surface_strip",
    "conveyor_edge",
    "conveyor_edge_cap",
    "lemon",
    "eggplant",
  ];
  const images = [
    "PickupArrow",
    "PickupShadow",
    "PickupKasa",
    "PickupRollicShadow",
    "lock",
    "Picup01_AO",
    "Picup02_AO",
    "Picup01_N",
    "Picup02_N",
    "Slote01_Outline",
    "Slot-text-bg",
    "Floor03",
  ];
  const json = async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw Error("Asset unavailable: " + path);
    return response.json();
  };
  const [reference, config, seatData, shadows, gltfs, maps] = await Promise.all(
    [
      json("./level.json"),
      json("./assets/source-materials.json"),
      json("./assets/source-seat-formations.json"),
      json("./assets/lid-shadow-flat.json"),
      Promise.all(
        names.map((name) => loader.loadAsync("./assets/" + name + ".glb")),
      ),
      Promise.all(
        images.map((name) =>
          textureLoader.loadAsync("./assets/" + name + ".png"),
        ),
      ),
    ],
  );
  materialConfig = config;
  poses = seatData;
  lidShadows = shadows;
  level = sourceLevel(reference);
  models = Object.fromEntries(names.map((name, i) => [name, gltfs[i].scene]));
  textures = Object.fromEntries(
    images.map((name, i) => {
      if (name.endsWith("_AO") || name.endsWith("_N"))
        prepareTruckDataTexture(maps[i]);
      else maps[i].colorSpace = THREE.SRGBColorSpace;
      maps[i].anisotropy = renderer.capabilities.getMaxAnisotropy();
      return [name, maps[i]];
    }),
  );
  game = new Game(level);
  buildEnvironment();
  createFruitPool(4, models.lemon);
  createFruitPool(6, models.eggplant);
  restart();
  ready = true;
  $("loading").classList.add("hidden");
  registerTools(game, tap, restart);
} catch (error) {
  console.error(error);
  $("loading").textContent = "Unable to load the playable. Please reload.";
}

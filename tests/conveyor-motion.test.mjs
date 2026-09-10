import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Game, polyline } from "../game.js";
import { feederPosition } from "../conveyor-motion.js?v=3";
import { sourceLevel } from "../source-level.js";

const level = sourceLevel(JSON.parse(readFileSync(new URL("../level.json", import.meta.url))));
const epsilon = 1e-7;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const paths = () => {
  const game = new Game(level);
  return [game.ring, ...game.feeds.flatMap((feed) => feed.lanes)];
};

test("all four ring lanes stay continuous at every corner and the loop seam", () => {
  const game = new Game(level);
  for (const arc of game.ring.distances) {
    for (let lane = 0; lane < 4; lane++) {
      game.phase = arc - epsilon;
      const before = game.cellPosition({ arc: 0, lane });
      game.phase = arc + epsilon;
      const after = game.cellPosition({ arc: 0, lane });
      assert.ok(distance(before, after) < 1e-5, `lane ${lane} jumps at arc ${arc}`);
      assert.ok(angleDistance(before.angle, after.angle) < 1e-5, `lane ${lane} snaps at arc ${arc}`);
    }
  }
});

test("every feeder lane has a continuous unit heading, including angle wraparound", () => {
  for (const path of paths().slice(1)) {
    for (const arc of path.distances.slice(1, -1)) {
      const before = path.sampleFrame(arc - epsilon);
      const after = path.sampleFrame(arc + epsilon);
      assert.ok(distance(before, after) < 1e-5);
      assert.ok(Math.hypot(before.dx - after.dx, before.dz - after.dz) < 1e-5);
      assert.ok(Math.abs(Math.hypot(after.dx, after.dz) - 1) < 1e-12);
    }
  }
});

test("smooth frames retain the authored centerline and the road's raw segment directions", () => {
  for (const path of paths()) {
    for (let i = 1; i < path.points.length; i++) {
      const arc = (path.distances[i - 1] + path.distances[i]) / 2;
      const frame = path.sampleFrame(arc);
      const raw = path.sample(arc);
      const a = path.points[i - 1], b = path.points[i];
      assert.equal(frame.x, raw.x);
      assert.equal(frame.z, raw.z);
      assert.ok(Math.abs(raw.x - (a.x + b.x) / 2) < 1e-12);
      assert.ok(Math.abs(raw.z - (a.z + b.z) / 2) < 1e-12);
      assert.ok(Math.abs(raw.dx * (b.z - a.z) - raw.dz * (b.x - a.x)) < 1e-12);
      assert.ok(Math.abs(Math.hypot(frame.dx, frame.dz) - 1) < 1e-12);
    }
  }
});

test("corner smoothing keeps rows centered and lane spacing at 0.52 units", () => {
  const game = new Game(level);
  for (let i = 0; i < 1000; i++) {
    game.phase = game.ring.length * i / 1000;
    const center = game.ring.sample(game.phase);
    const lanes = [0, 1, 2, 3].map((lane) => game.cellPosition({ arc: 0, lane }));
    assert.ok(Math.abs((lanes[0].x + lanes[3].x) / 2 - center.x) < 1e-12);
    assert.ok(Math.abs((lanes[0].z + lanes[3].z) / 2 - center.z) < 1e-12);
    for (let lane = 1; lane < 4; lane++)
      assert.ok(Math.abs(distance(lanes[lane - 1], lanes[lane]) - 0.52) < 1e-12);
  }
});

test("fruit poses do not depend on frame rate or boost history", () => {
  const games = [30, 60, 144].map((fps) => {
    const game = new Game(level);
    for (let i = 0; i < 4 * fps; i++) game.tick(1 / fps);
    return game;
  });
  const boosted = new Game(level);
  for (let i = 0; i < 120; i++) boosted.tick(1 / 60, true);
  games.push(boosted);
  for (const game of games.slice(1)) {
    for (const cell of game.cells) {
      const expected = games[0].cellPosition(cell), actual = game.cellPosition(cell);
      assert.ok(distance(actual, expected) < 1e-9);
      assert.ok(angleDistance(actual.angle, expected.angle) < 1e-9);
    }
  }
});

test("feeder transfer sources use the same continuous pose as advancing items", () => {
  const game = new Game(level);
  for (const feed of game.feeds) {
    for (let i = 0; i < feed.pending.length; i++) {
      const pose = feederPosition(feed, i);
      const frame = feed.lanes[pose.lane].sampleFrame(pose.distance);
      assert.equal(pose.x, frame.x);
      assert.equal(pose.z, frame.z);
      assert.equal(pose.angle, Math.atan2(frame.dx, frame.dz));
    }
  }
});

test("straight paths and open endpoints retain their direction", () => {
  const path = polyline([{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 5 }]);
  for (const arc of [-10, 0, 1, 2, 4, 5, 10]) {
    assert.deepEqual(path.sampleFrame(arc), path.sample(arc));
  }
});

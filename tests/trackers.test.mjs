/**
 * Tracker swarm flight.
 *
 * The failure this file exists to prevent is a swarm that folds into one
 * formation. Twelve trackers launched from one point, at one speed, homing on
 * one point can only ever produce a V: the ones behind the pilot turn hard, the
 * ones ahead barely turn, and the whole thing arrives as a single mass. Slowing
 * them down produces a slower V; varying only the turn rate produces a slightly
 * softer V, because every tracker is still solving for the same destination.
 *
 * So the assertions below are about *spread*, not about any one number: at a
 * given moment the swarm must occupy a range of headings and a range of
 * positions, and it must still connect in the end.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TRACKER_LANE_FRACTION,
  TRACKER_COMMIT_DISTANCE,
  TRACKER_LAUNCH_JITTER,
  TRACKER_SCATTER_TICKS,
  TRACKER_SPEED,
  TRACKER_SPEED_SPREAD,
  TRACKER_TURN_MAX_DEG,
  TRACKER_TURN_MIN_DEG,
  steerTracker,
  trackerAimPoint,
  trackerNoise,
  trackerSpeed,
  trackerTurnRadians,
} from "../app/trackers.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** Launch a swarm the way makeEnemy does: evenly spaced around the circle. */
function launchSwarm(count = 12, x = 0, y = 0) {
  return Array.from({ length: count }, (_unused, index) => {
    const phase = (index / count) * Math.PI * 2;
    const speed = trackerSpeed(phase);
    return { x, y, vx: Math.cos(phase) * speed, vy: Math.sin(phase) * speed, phase, age: 0 };
  });
}

function flySwarm(swarm, targetX, targetY, ticks) {
  for (let tick = 0; tick < ticks; tick += 1) {
    for (const tracker of swarm) {
      const steered = steerTracker(tracker, targetX, targetY);
      tracker.vx = steered.vx;
      tracker.vy = steered.vy;
      tracker.x += tracker.vx;
      tracker.y += tracker.vy;
      tracker.age += 1;
    }
  }
  return swarm;
}

test("a tracker's profile is stable for its whole life", () => {
  // Re-rolling per tick would average straight back out to a uniform swarm.
  const phase = 1.234;
  assert.equal(trackerSpeed(phase), trackerSpeed(phase));
  assert.equal(trackerTurnRadians(phase), trackerTurnRadians(phase));
  assert.deepEqual(trackerAimPoint(phase, 0, 0, 900, 0), trackerAimPoint(phase, 0, 0, 900, 0));
});

test("speed, turn rate and aim bearing are independent of each other", () => {
  // Three views of one number would move together, and the fastest tracker
  // would always also be the widest-turning one.
  const phases = Array.from({ length: 40 }, (_unused, i) => i * 0.37);
  const speeds = phases.map((p) => trackerNoise(p, 1));
  const turns = phases.map((p) => trackerNoise(p, 2));
  const bearings = phases.map((p) => trackerNoise(p, 3));
  assert.ok(speeds.some((value, i) => Math.abs(value - turns[i]) > 0.2));
  assert.ok(turns.some((value, i) => Math.abs(value - bearings[i]) > 0.2));
  for (const set of [speeds, turns, bearings]) {
    for (const value of set) assert.ok(value >= 0 && value <= 1, `out of range: ${value}`);
  }
});

test("every tracker flies at its own speed, within the stated spread", () => {
  const speeds = launchSwarm().map((tracker) => trackerSpeed(tracker.phase));
  const low = TRACKER_SPEED * (1 - TRACKER_SPEED_SPREAD);
  const high = TRACKER_SPEED * (1 + TRACKER_SPEED_SPREAD);
  for (const speed of speeds) assert.ok(speed >= low && speed <= high, `${speed} outside ${low}..${high}`);
  // And they are genuinely different, so the swarm strings out in time.
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > TRACKER_SPEED * 0.2, "speeds are too alike");
});

test("turn rates sit inside the stated band and differ across the swarm", () => {
  const rates = launchSwarm().map((tracker) => trackerTurnRadians(tracker.phase) * (180 / Math.PI));
  for (const rate of rates) {
    assert.ok(rate >= TRACKER_TURN_MIN_DEG - 1e-9 && rate <= TRACKER_TURN_MAX_DEG + 1e-9, `${rate} out of band`);
  }
  assert.ok(Math.max(...rates) - Math.min(...rates) > 1, "turn rates are too alike");
});

test("trackers fly straight before they hunt, so the swarm fans out first", () => {
  const swarm = flySwarm(launchSwarm(), 1200, 0, TRACKER_SCATTER_TICKS - 1);
  // Still on their launch bearings: the heading spread is the launch spread.
  for (const tracker of swarm) {
    const heading = Math.atan2(tracker.vy, tracker.vx);
    let delta = heading - tracker.phase;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(Math.abs(delta) < 1e-6, "a tracker turned during the scatter window");
  }
  // And they have actually separated in space.
  const spread = Math.max(...swarm.map((t) => Math.hypot(t.x, t.y)));
  assert.ok(spread > TRACKER_SPEED * TRACKER_SCATTER_TICKS * 0.5, "the swarm did not travel");
});

test("far from the pilot each tracker aims at its own point, not the pilot", () => {
  const swarm = launchSwarm();
  const aims = swarm.map((tracker) => trackerAimPoint(tracker.phase, 0, 0, 1400, 0));
  // No two trackers are solving for the same destination.
  const unique = new Set(aims.map((aim) => `${aim.x.toFixed(3)},${aim.y.toFixed(3)}`));
  assert.equal(unique.size, swarm.length, "trackers share an aim point");
  // One tracker may legitimately run straight up the middle. What matters is
  // that the swarm SPANS the lane range: a token offset is only a few degrees
  // at arena distance, and a swarm that all fans one way is still a formation.
  const offsets = aims.map((aim) => aim.y);
  const span = Math.max(...offsets) - Math.min(...offsets);
  assert.ok(span > 1400 * TRACKER_LANE_FRACTION, `lane span ${span.toFixed(0)} is too narrow to bend the routes`);
  assert.ok(Math.max(...offsets) > 0 && Math.min(...offsets) < 0, "the swarm only fans one way");
});

test("closing in, the offset collapses so the approach becomes a real intercept", () => {
  const phase = 0.9;
  const far = trackerAimPoint(phase, 0, 0, 1400, 0);
  const near = trackerAimPoint(phase, 0, 0, TRACKER_COMMIT_DISTANCE * 0.5, 0);
  assert.ok(Math.hypot(far.x - 1400, far.y) > Math.hypot(near.x - TRACKER_COMMIT_DISTANCE * 0.5, near.y));
  // Inside the commit range it aims exactly at the pilot.
  assert.deepEqual(trackerAimPoint(phase, 0, 0, 10, 0), { x: 10, y: 0 });
});

test("a hunting swarm holds a spread of headings instead of folding into one", () => {
  // The V this whole file exists to prevent: every tracker on nearly the same
  // heading, arriving as a single mass.
  const swarm = flySwarm(launchSwarm(12, 0, 0), 1400, 0, TRACKER_SCATTER_TICKS + 60);
  const headings = swarm.map((tracker) => Math.atan2(tracker.vy, tracker.vx));
  const spread = Math.max(...headings) - Math.min(...headings);
  // A radian is about 57 degrees of heading spread across the swarm. The old
  // uniform model managed 0.44 here and read on screen as a V; the lane model
  // clears 1.1. The bar is set below what it achieves so ordinary tuning of the
  // lane width does not fail the suite, but well above any formation.
  assert.ok(spread > 1.0, `headings collapsed into a formation (spread ${spread.toFixed(2)} rad)`);

  // And they are spread across the arena, not stacked on one line.
  const ys = swarm.map((tracker) => tracker.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 200, "the swarm is flying single file");
});

test("the swarm still closes: routes differ, the intercept still happens", () => {
  // Spread is worthless if nothing ever arrives.
  const swarm = flySwarm(launchSwarm(12, 0, 0), 900, 0, 600);
  const closest = Math.min(...swarm.map((tracker) => Math.hypot(tracker.x - 900, tracker.y)));
  assert.ok(closest < 90, `nothing reached the pilot (closest ${closest.toFixed(0)})`);
});

test("the swarm arrives strung out in time, not all at once", () => {
  const swarm = launchSwarm(12, 0, 0);
  const arrivals = [];
  for (let tick = 0; tick < 900; tick += 1) {
    for (const tracker of swarm) {
      if (tracker.arrived) continue;
      const steered = steerTracker(tracker, 900, 0);
      tracker.vx = steered.vx;
      tracker.vy = steered.vy;
      tracker.x += tracker.vx;
      tracker.y += tracker.vy;
      tracker.age += 1;
      if (Math.hypot(tracker.x - 900, tracker.y) < 60) {
        tracker.arrived = true;
        arrivals.push(tick);
      }
    }
  }
  assert.ok(arrivals.length >= 2, "too few trackers arrived to judge the spacing");
  assert.ok(arrivals[arrivals.length - 1] - arrivals[0] > 25, "the swarm arrived as one wall");
});

test("the loop uses the module and keeps no flight numbers of its own", () => {
  assert.ok(game.includes("const steered = steerTracker(enemy, enemy.x + dx, enemy.y + dy);"));
  assert.ok(game.includes("trackerSpeed(angle)"), "launch speed comes from the profile");
  assert.ok(!game.includes("const TRACKER_SPEED ="), "no second copy of the speed");
  assert.ok(!game.includes("trackerTurnRate("), "the superseded helper is gone");
  assert.ok(TRACKER_LAUNCH_JITTER > 0.18, "a swarm launches wider than an ordinary spawn");
});

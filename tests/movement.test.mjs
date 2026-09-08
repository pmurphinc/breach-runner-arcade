/**
 * Movement intent: the one model both keyboard and touch feed.
 *
 * Directions are screen-space degrees — 0 right, 90 down, -90 up — because the
 * canvas Y axis grows downward.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS } from "../app/game-data.ts";
import { FORM_SHIFT_PROFILES } from "../app/game-data.ts";
import {
  ENGINE_MAX_LEVEL,
  IDLE_DRAG,
  LATERAL_DRAG,
  REVERSE_DRAG,
  RETRO_IDLE_DRAG_PER_LEVEL,
  NO_INTENT,
  RETRO_MAX_LEVEL,
  STOP_SPEED,
  applyIntent,
  engineHandling,
  facingFor,
  intentFromKeys,
  intentFromStick,
  keysFrom,
  resolveIntent,
  retroBrakeAssist,
  retroIdleDrag,
  retroLevel,
  retroReverseDrag,
} from "../app/movement.ts";

const none = { up: false, down: false, left: false, right: false };
const keys = (partial) => ({ ...none, ...partial });
const speedOf = (v) => Math.hypot(v.vx, v.vy);
const still = { vx: 0, vy: 0 };

test("each direction key requests that world-space direction", () => {
  assert.equal(intentFromKeys(keys({ right: true })).heading, 0, "D moves right");
  assert.equal(intentFromKeys(keys({ down: true })).heading, 90, "S moves down");
  assert.equal(intentFromKeys(keys({ up: true })).heading, -90, "W moves up");
  assert.equal(Math.abs(intentFromKeys(keys({ left: true })).heading), 180, "A moves left");
});

test("arrow keys request exactly the same directions as WASD", () => {
  const pairs = [
    [{ KeyW: true }, { ArrowUp: true }],
    [{ KeyS: true }, { ArrowDown: true }],
    [{ KeyA: true }, { ArrowLeft: true }],
    [{ KeyD: true }, { ArrowRight: true }],
  ];
  for (const [wasd, arrows] of pairs) {
    assert.deepEqual(
      intentFromKeys(keysFrom(wasd)),
      intentFromKeys(keysFrom(arrows)),
      `${JSON.stringify(wasd)} should match ${JSON.stringify(arrows)}`
    );
  }
});

test("diagonals point between their two cardinals", () => {
  assert.equal(intentFromKeys(keys({ up: true, right: true })).heading, -45);
  assert.equal(intentFromKeys(keys({ down: true, right: true })).heading, 45);
  assert.equal(intentFromKeys(keys({ down: true, left: true })).heading, 135);
  assert.equal(intentFromKeys(keys({ up: true, left: true })).heading, -135);
});

test("diagonal movement is not faster than cardinal movement", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const cardinal = applyIntent(still, intentFromKeys(keys({ right: true })), ship);
  const diagonal = applyIntent(still, intentFromKeys(keys({ up: true, right: true })), ship);

  assert.ok(Math.abs(speedOf(cardinal) - speedOf(diagonal)) < 1e-9,
    `cardinal ${speedOf(cardinal)} vs diagonal ${speedOf(diagonal)}`);

  // And it stays true once the ship is at full speed.
  let fast = still;
  let fastDiagonal = still;
  for (let i = 0; i < 200; i += 1) {
    fast = applyIntent(fast, intentFromKeys(keys({ right: true })), ship);
    fastDiagonal = applyIntent(fastDiagonal, intentFromKeys(keys({ up: true, right: true })), ship);
  }
  assert.ok(Math.abs(speedOf(fast) - speedOf(fastDiagonal)) < 1e-9, "top speed must match on the diagonal");
  assert.ok(Math.abs(speedOf(fastDiagonal) - ship.maxSpeed) < 1e-9, "diagonal must still reach max speed");
});

test("opposing keys cancel their axis instead of picking a winner", () => {
  assert.deepEqual(intentFromKeys(keys({ up: true, down: true })), NO_INTENT);
  assert.deepEqual(intentFromKeys(keys({ left: true, right: true })), NO_INTENT);
  assert.deepEqual(intentFromKeys(keys({ up: true, down: true, left: true, right: true })), NO_INTENT);

  // One axis cancelling must leave the other axis working.
  assert.equal(intentFromKeys(keys({ up: true, down: true, right: true })).heading, 0);
  assert.equal(intentFromKeys(keys({ left: true, right: true, up: true })).heading, -90);
});

test("no input is no intent", () => {
  assert.deepEqual(intentFromKeys(none), NO_INTENT);
  assert.equal(intentFromKeys(none).active, false);
  assert.equal(intentFromKeys(none).magnitude, 0);
});

test("magnitude is always exactly one when moving", () => {
  for (const held of [{ up: true }, { right: true }, { up: true, right: true }, { down: true, left: true }]) {
    assert.equal(intentFromKeys(keys(held)).magnitude, 1, JSON.stringify(held));
  }
});

test("the touch stick wins while it is engaged", () => {
  const stick = intentFromStick(120);
  const keyboard = intentFromKeys(keys({ up: true }));
  assert.equal(resolveIntent(stick, keyboard).heading, 120, "an engaged stick beats a stray key");
  assert.equal(resolveIntent(intentFromStick(null), keyboard).heading, -90, "keys work when the stick is idle");
  assert.deepEqual(resolveIntent(intentFromStick(null), intentFromKeys(none)), NO_INTENT);
});

test("each ship keeps its own acceleration and top speed", () => {
  const intent = intentFromKeys(keys({ right: true }));
  for (const ship of SHIPS) {
    const first = applyIntent(still, intent, ship);
    assert.ok(
      Math.abs(speedOf(first) - ship.acceleration) < 1e-9,
      `${ship.id} should gain exactly its acceleration on the first tick`
    );

    let velocity = still;
    for (let i = 0; i < 500; i += 1) velocity = applyIntent(velocity, intent, ship);
    assert.ok(
      Math.abs(speedOf(velocity) - ship.maxSpeed) < 1e-9,
      `${ship.id} should settle at its own max speed, got ${speedOf(velocity)}`
    );
  }
});

test("ships still handle differently from one another", () => {
  const intent = intentFromKeys(keys({ right: true }));
  const ticksToTopSpeed = (ship) => {
    let velocity = still;
    for (let i = 0; i < 2000; i += 1) {
      velocity = applyIntent(velocity, intent, ship);
      if (Math.abs(speedOf(velocity) - ship.maxSpeed) < 1e-9) return i + 1;
    }
    return Infinity;
  };
  const squid = SHIPS.find((s) => s.id === "squid");
  const flagship = SHIPS.find((s) => s.id === "flagship");
  assert.ok(
    ticksToTopSpeed(squid) < ticksToTopSpeed(flagship),
    "the Squid must still reach speed sooner than the Flagship"
  );
  assert.notEqual(squid.maxSpeed, flagship.maxSpeed, "top speeds must not be flattened");
});

test("thrust upgrades still raise acceleration and top speed", () => {
  const base = SHIPS.find((s) => s.id === "wing");
  const upgraded = { acceleration: base.acceleration + 0.035, maxSpeed: base.maxSpeed + 0.25 };
  const intent = intentFromKeys(keys({ right: true }));

  assert.ok(speedOf(applyIntent(still, intent, upgraded)) > speedOf(applyIntent(still, intent, base)));

  let plain = still;
  let boosted = still;
  for (let i = 0; i < 500; i += 1) {
    plain = applyIntent(plain, intent, base);
    boosted = applyIntent(boosted, intent, upgraded);
  }
  assert.ok(speedOf(boosted) > speedOf(plain), "upgraded thrust must reach a higher top speed");
});

test("touch, PC and hybrid all fly the one shared model", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const movingRight = { vx: 3, vy: 0 };

  // The stick and the keys only differ in how they name a heading. Once they
  // agree on one, the physics underneath must be identical in every mode.
  assert.deepEqual(
    applyIntent(movingRight, intentFromStick(-90), ship),
    applyIntent(movingRight, intentFromKeys(keys({ up: true })), ship),
    "a stick pointed up must fly exactly like W held"
  );

  const firstTouchTick = applyIntent(still, intentFromStick(37), ship);
  assert.ok(Math.abs(speedOf(firstTouchTick) - ship.acceleration) < 1e-9,
    "touch sensitivity must retain the original first-tick acceleration");
});

test("changing direction bends momentum instead of snapping to a grid axis", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const movingRight = { vx: 3, vy: 0 };
  const turningUp = applyIntent(movingRight, intentFromKeys(keys({ up: true })), ship);

  assert.ok(turningUp.vx > 0, "existing rightward momentum should survive the first upward thrust tick");
  assert.ok(turningUp.vy < 0, "upward thrust should begin curving the flight path");
  assert.ok(Math.abs(turningUp.vx) > Math.abs(turningUp.vy), "the ship should arc instead of making an instant 90-degree turn");
  assert.ok(speedOf(turningUp) <= ship.maxSpeed, "curved flight must still respect top speed");
});

/**
 * An unupgraded hull never slows down.
 *
 * This is the whole of "zero gravity", and the original is unambiguous: a
 * sprite moves by its vector every cycle and nothing anywhere reduces that
 * vector. Only two things change a ship's speed -- thrust, and a wall.
 *
 * The assertion this replaces required the ship to be *stopped inside a
 * second*. That was the complaint.
 */
test("with no retros a released hull coasts forever", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  let velocity = { vx: 3, vy: 0 };
  for (let i = 0; i < 5_000; i += 1) velocity = applyIntent(velocity, NO_INTENT, ship, { retros: 0 });
  assert.equal(velocity.vx, 3, "drift must be carried exactly, not merely slowly");
  assert.equal(velocity.vy, 0);
});

/**
 * A turn with the throttle shut costs nothing.
 *
 * The rule Classic depends on. There the left stick aims the hull inside its
 * deadzone and only opens the throttle past it, so tracking a target that is
 * circling you is an *active* intent carrying a magnitude of zero. Treating
 * that as thrusting ran the engine's drag with the engine off and took the
 * pilot's drift away for the crime of aiming -- which is precisely what made
 * Classic impossible to fight in.
 */
test("holding a heading with the throttle shut is coasting, not thrusting", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const drifting = { vx: 3, vy: 0 };

  // Sweeping the nose right round while the throttle stays closed must land
  // in exactly the same place as holding nothing at all.
  let turning = drifting;
  let idling = drifting;
  for (let i = 0; i < 40; i += 1) {
    turning = applyIntent(turning, { active: true, heading: i * 9, magnitude: 0 }, ship);
    idling = applyIntent(idling, NO_INTENT, ship);
  }
  assert.ok(Math.abs(turning.vx - idling.vx) < 1e-9, `turning cost speed: ${turning.vx} vs ${idling.vx}`);
  assert.ok(Math.abs(turning.vy - idling.vy) < 1e-9, "and it must not push the ship sideways either");
  assert.ok(speedOf(turning) > 0, "the drift survives the turn");
});

/**
 * Thrust adds to your course rather than replacing it.
 *
 * The original computes `v += unit(angle) * accel` and clamps the total. No
 * term scrubs the part of your momentum that is not going where the nose
 * points, which is why a burn curves a flight path instead of steering it
 * like a car -- and why a part-open throttle adds proportionally less.
 */
test("thrust is added as a vector, in proportion to the throttle", () => {
  const ship = { acceleration: 0.5, maxSpeed: 8 };
  const drifting = { vx: 3, vy: 0 };
  const burn = (magnitude) => applyIntent(drifting, { active: true, heading: -90, magnitude }, ship, { retros: 0 });

  assert.equal(burn(1).vx, 3, "the rightward drift is untouched by an upward burn");
  assert.ok(Math.abs(burn(1).vy + ship.acceleration) < 1e-9, "a full burn adds its own axis");
  assert.ok(Math.abs(burn(0.5).vy + ship.acceleration / 2) < 1e-9, "half throttle adds half of it");
});

test("retro thrusters still brake harder than the shared drag", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const moving = { vx: 3, vy: 0 };

  const plain = applyIntent(moving, NO_INTENT, ship);
  const braking = applyIntent(moving, NO_INTENT, ship, { retros: true });
  assert.ok(braking.vx < plain.vx, "retros must beat the baseline drag");
  assert.ok(braking.vx > 0, "retros slow the ship without stopping it dead");
});

/* -------------------------------------------------- ENGINE UPGRADE ------ */

/** Ticks of a straight burn from a standstill before the ship is at its cap. */
function ticksToTop(handling) {
  let velocity = { vx: 0, vy: 0 };
  const intent = intentFromKeys(keys({ right: true }));
  for (let tick = 1; tick <= 2000; tick += 1) {
    velocity = applyIntent(velocity, intent, handling);
    if (speedOf(velocity) >= handling.maxSpeed - 1e-9) return tick;
  }
  return Infinity;
}

/** Distance covered in `ticks` of a straight burn from a standstill. */
function burnDistance(handling, ticks) {
  let velocity = { vx: 0, vy: 0 };
  const intent = intentFromKeys(keys({ right: true }));
  let travelled = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    velocity = applyIntent(velocity, intent, handling);
    travelled += speedOf(velocity);
  }
  return travelled;
}

test("an engine mark measurably raises both top speed and acceleration", () => {
  for (const ship of SHIPS) {
    const base = engineHandling(ship, 0);
    const mark = engineHandling(ship, 1);
    assert.ok(mark.maxSpeed > base.maxSpeed, `${ship.id} top speed must move`);
    assert.ok(mark.acceleration > base.acceleration, `${ship.id} acceleration must move`);
    // "Too weak to perceive" is the bug being fixed. A tenth is the floor for
    // a change a player notices without a stopwatch.
    assert.ok(
      mark.maxSpeed / base.maxSpeed > 1.1,
      `${ship.id} gains only ${(mark.maxSpeed / base.maxSpeed - 1) * 100}% top speed`,
    );
    assert.ok(
      mark.acceleration / base.acceleration > 1.25,
      `${ship.id} gains only ${(mark.acceleration / base.acceleration - 1) * 100}% acceleration`,
    );
    // ...and not so much that the frame becomes unflyable.
    assert.ok(mark.maxSpeed / base.maxSpeed < 1.6, `${ship.id} top speed runs away in one mark`);
  }
});

test("engine marks are linear, capped, and never compound", () => {
  const ship = { acceleration: 0.1, maxSpeed: 3 };
  const step = engineHandling(ship, 1).maxSpeed - ship.maxSpeed;
  for (let level = 1; level <= ENGINE_MAX_LEVEL; level += 1) {
    const fitted = engineHandling(ship, level);
    assert.ok(
      Math.abs(fitted.maxSpeed - (ship.maxSpeed + step * level)) < 1e-9,
      "each mark must be worth the same as the first, not more",
    );
  }
  // Past the cap nothing further is granted, and junk never becomes a bonus.
  assert.deepEqual(engineHandling(ship, 9), engineHandling(ship, ENGINE_MAX_LEVEL));
  assert.deepEqual(engineHandling(ship, -4), engineHandling(ship, 0));
  assert.deepEqual(engineHandling(ship, Number.NaN), engineHandling(ship, 0));
});

test("engine marks scale a frame rather than flattening the fleet", () => {
  // A flat bonus converges the fleet: the slowest frame gains the most in
  // relative terms and every hull ends up flying the same. The upgrade has to
  // keep the fastest frame the fastest, by a wider margin than before.
  const fastest = SHIPS.find((ship) => ship.id === "squid");
  const slowest = SHIPS.find((ship) => ship.id === "flagship");
  const gap = fastest.maxSpeed - slowest.maxSpeed;
  const upgraded =
    engineHandling(fastest, ENGINE_MAX_LEVEL).maxSpeed
    - engineHandling(slowest, ENGINE_MAX_LEVEL).maxSpeed;
  assert.ok(upgraded > gap, `fully upgraded frames must stay apart, ${upgraded} vs ${gap}`);
});

test("no frame loses handling it used to have at the same mark", () => {
  // The old model was a flat +0.25 top speed and +0.035 acceleration a mark.
  // Every hull starts at its own mark, so a rework that took anything away
  // would silently nerf seven of the eight frames on the launch pad.
  const hulls = [...SHIPS, ...Object.values(FORM_SHIFT_PROFILES)];
  for (const hull of hulls) {
    for (let level = 0; level <= ENGINE_MAX_LEVEL; level += 1) {
      const fitted = engineHandling(hull, level);
      assert.ok(fitted.maxSpeed >= hull.maxSpeed + level * 0.25 - 1e-9, "top speed regressed");
      assert.ok(fitted.acceleration >= hull.acceleration + level * 0.035 - 1e-9, "acceleration regressed");
    }
  }
});

test("an upgraded engine actually reaches speed sooner in the flight model", () => {
  for (const ship of SHIPS) {
    const base = engineHandling(ship, 0);
    const upgraded = engineHandling(ship, 1);
    assert.ok(
      ticksToTop(upgraded) <= ticksToTop(base),
      `${ship.id} must not take longer to reach a higher cap`,
    );
    assert.ok(
      burnDistance(upgraded, 45) > burnDistance(base, 45) * 1.1,
      `${ship.id} must cross visibly more ground in the same burn`,
    );
  }
});

/* ------------------------------------------------- RETRO THRUSTERS ------ */

/** Ticks and distance spent coasting to a stop from top speed. */
function coastToStop(handling, retros) {
  let velocity = { vx: handling.maxSpeed, vy: 0 };
  let ticks = 0;
  let travelled = 0;
  while (speedOf(velocity) > 0 && ticks < 600) {
    velocity = applyIntent(velocity, NO_INTENT, handling, { retros });
    travelled += speedOf(velocity);
    ticks += 1;
  }
  return { ticks, travelled };
}

/** Ticks spent flying flat out one way before moving the other way. */
function ticksToReverse(handling, retros) {
  const intent = intentFromKeys(keys({ left: true }));
  let velocity = { vx: handling.maxSpeed, vy: 0 };
  for (let tick = 1; tick <= 600; tick += 1) {
    velocity = applyIntent(velocity, intent, handling, { retros });
    if (velocity.vx <= 0) return tick;
  }
  return Infinity;
}

test("a retro mark measurably shortens braking, on every frame", () => {
  for (const ship of SHIPS) {
    const one = coastToStop(ship, 1);
    const three = coastToStop(ship, RETRO_MAX_LEVEL);
    assert.ok(three.travelled < one.travelled * 0.75, `${ship.id} braking distance barely moved`);
    assert.ok(three.ticks < one.ticks, `${ship.id} must come to rest sooner`);
    // Inertia is reduced, never removed: the ship still glides.
    assert.ok(three.travelled > 0);
    assert.ok(three.ticks > 1, `${ship.id} must not stop dead the tick input is released`);
  }
});

test("a retro mark measurably shortens a direction reversal", () => {
  for (const ship of SHIPS) {
    const none = ticksToReverse(ship, 0);
    const full = ticksToReverse(ship, RETRO_MAX_LEVEL);
    assert.ok(full < none, `${ship.id} reversal did not improve: ${full} vs ${none}`);
    assert.ok(full >= 1, "a reversal is still a manoeuvre, not a teleport");
  }
});

test("engine and retro marks do different jobs and coexist", () => {
  const ship = { acceleration: 0.1, maxSpeed: 3 };

  // Retros never raise the ceiling...
  assert.equal(engineHandling(ship, 0).maxSpeed, ship.maxSpeed);
  const coasting = { vx: 3, vy: 0 };
  assert.equal(
    applyIntent(coasting, NO_INTENT, engineHandling(ship, 3), { retros: 0 }).vx,
    applyIntent(coasting, NO_INTENT, ship, { retros: 0 }).vx,
    "an engine mark must not shorten a coast",
  );
  // ...and engines never shorten a stop.
  assert.ok(
    coastToStop(engineHandling(ship, ENGINE_MAX_LEVEL), 0).ticks
      >= coastToStop(ship, 0).ticks,
  );

  // Fitted together, both effects are still present.
  const both = engineHandling(ship, ENGINE_MAX_LEVEL);
  assert.ok(both.maxSpeed > ship.maxSpeed);
  assert.ok(coastToStop(both, RETRO_MAX_LEVEL).ticks < coastToStop(both, 0).ticks);
  assert.ok(ticksToReverse(both, RETRO_MAX_LEVEL) < ticksToReverse(both, 0));
});

test("retro marks are linear, capped, and read the old boolean", () => {
  // The field used to be a boolean; `true` has to keep meaning one mark so
  // nothing that still passes one silently loses its braking.
  assert.equal(retroLevel(true), 1);
  assert.equal(retroLevel(false), 0);
  assert.equal(retroLevel(undefined), 0);
  assert.equal(retroLevel(9), RETRO_MAX_LEVEL);
  assert.equal(retroLevel(-2), 0);

  for (let level = 0; level < RETRO_MAX_LEVEL; level += 1) {
    assert.ok(retroIdleDrag(level + 1) > retroIdleDrag(level));
    assert.ok(retroReverseDrag(level + 1) > retroReverseDrag(level));
    assert.ok(retroBrakeAssist(level + 1) > retroBrakeAssist(level));
  }
  // Mark zero is the untouched shared model, and no mark ever removes inertia.
  assert.equal(retroIdleDrag(0), IDLE_DRAG);
  assert.equal(retroBrakeAssist(0), 1);
  assert.ok(retroIdleDrag(RETRO_MAX_LEVEL) < 1);
  assert.ok(retroReverseDrag(RETRO_MAX_LEVEL) < 1);
});

test("a retro mark never raises top speed on any heading", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const intent = intentFromKeys(keys({ right: true, down: true }));
  let plain = { vx: 0, vy: 0 };
  let braked = { vx: 0, vy: 0 };
  for (let tick = 0; tick < 300; tick += 1) {
    plain = applyIntent(plain, intent, ship, { retros: 0 });
    braked = applyIntent(braked, intent, ship, { retros: RETRO_MAX_LEVEL });
  }
  assert.ok(speedOf(braked) <= speedOf(plain) + 1e-9, "retros are brakes, not an engine");
  assert.ok(speedOf(braked) <= ship.maxSpeed + 1e-9);
});

/**
 * Reversing takes thrust, and retros are what make it quick.
 *
 * Without them a flick to the opposite direction does not bite: it spends the
 * ship's own acceleration undoing momentum, which is the honest cost of having
 * no friction. With them it bites, because that is exactly what they are for.
 */
test("reversing costs thrust, and retros pay it down faster", () => {
  const intent = intentFromKeys(keys({ left: true }));
  const ticksToTurnAround = (ship, retros) => {
    let velocity = { vx: ship.maxSpeed, vy: 0 };
    let ticks = 0;
    while (velocity.vx > 0 && ticks < 4000) { velocity = applyIntent(velocity, intent, ship, { retros }); ticks += 1; }
    return ticks;
  };

  for (const ship of SHIPS) {
    const bare = ticksToTurnAround(ship, 0);
    assert.ok(bare > 1, `${ship.id}: with no friction, turning around is work`);
    assert.ok(bare < 400, `${ship.id}: the engine must still win, took ${bare} ticks`);
    assert.ok(ticksToTurnAround(ship, 3) < bare, `${ship.id}: retros must make a reversal snap`);
  }
});

/**
 * The model reduces to the original's, exactly.
 *
 * Written out rather than described, because "copy the original" only means
 * something if something checks. Its cycle is 15ms, the same as this game's
 * tick, so the constants cross over with no conversion.
 *
 * This replaces an assertion that sideways momentum is scrubbed under thrust.
 * It is not, and it never was in the original -- that scrub is what made a
 * burn steer like a car.
 */
test("an unupgraded hull matches the original model tick for tick", () => {
  const ship = { acceleration: 0.13, maxSpeed: 3.5 };

  /** thrust: v += unit(angle) * accel, then clamp the total to top speed. */
  const theirs = (v, degrees) => {
    const r = (degrees * Math.PI) / 180;
    let vx = Math.cos(r) * ship.acceleration + v.vx;
    let vy = Math.sin(r) * ship.acceleration + v.vy;
    const hyp = Math.hypot(vx, vy);
    if (hyp > ship.maxSpeed) { vx = (ship.maxSpeed * vx) / hyp; vy = (ship.maxSpeed * vy) / hyp; }
    return { vx, vy };
  };

  let mine = { vx: 0, vy: 0 };
  let match = { vx: 0, vy: 0 };
  for (let i = 0; i < 400; i += 1) {
    // Half the run one way, half at a right angle, so both the vector
    // addition and the top-speed clamp are exercised.
    const degrees = i < 200 ? 0 : 90;
    mine = applyIntent(mine, { active: true, heading: degrees, magnitude: 1 }, ship, { retros: 0 });
    match = theirs(match, degrees);
    assert.ok(
      Math.hypot(mine.vx - match.vx, mine.vy - match.vy) < 1e-9,
      `tick ${i}: ${JSON.stringify(mine)} vs ${JSON.stringify(match)}`,
    );
  }
});

/**
 * The base model carries no friction of its own.
 *
 * Zero is the point, so this pins zero rather than a band -- and pins the one
 * number that is not zero against the original's own `decel(0.995)`.
 */
test("the base model carries no friction of its own", () => {
  assert.equal(IDLE_DRAG, 0, "coasting must cost nothing");
  assert.equal(LATERAL_DRAG, 0, "a burn adds to the course rather than scrubbing it");
  assert.equal(REVERSE_DRAG, 0, "retros are what oppose momentum, not the vacuum");
  assert.ok(
    Math.abs(RETRO_IDLE_DRAG_PER_LEVEL - 0.005) < 1e-9,
    "one retro mark is the original's decel(0.995) at the shared 15ms tick",
  );
  assert.ok(STOP_SPEED > 0 && STOP_SPEED < 0.05, "the park threshold must stay below a slow ship's acceleration");
});

test("the hull faces travel, aim overrides it, and the last heading is kept", () => {
  const moving = intentFromKeys(keys({ up: true }));

  assert.equal(facingFor(moving, null, 0), -90, "face the way you are travelling");
  assert.equal(facingFor(moving, 45, 0), 45, "aiming wins over travel");
  assert.equal(facingFor(NO_INTENT, null, 137), 137, "keep the last heading when drifting");
  assert.equal(facingFor(NO_INTENT, 20, 137), 20, "aim still wins while drifting");
});

test("keysFrom reads both key sets, and either one is enough", () => {
  assert.deepEqual(keysFrom({ KeyW: true, ArrowRight: true }), {
    up: true, down: false, left: false, right: true,
  });
  assert.deepEqual(keysFrom({}), { up: false, down: false, left: false, right: false });
  // A held key from each set on the same axis is still just that one axis.
  assert.deepEqual(keysFrom({ KeyA: true, ArrowLeft: true }), {
    up: false, down: false, left: true, right: false,
  });
});

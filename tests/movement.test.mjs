/**
 * Movement intent: the one model both keyboard and touch feed.
 *
 * Directions are screen-space degrees — 0 right, 90 down, -90 up — because the
 * canvas Y axis grows downward.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS } from "../app/game-data.ts";
import {
  NO_INTENT,
  applyIntent,
  facingFor,
  intentFromKeys,
  intentFromStick,
  keysFrom,
  resolveIntent,
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

test("touch steering keeps its original immediate response and acceleration", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const movingRight = { vx: 3, vy: 0 };
  const touchUp = applyIntent(movingRight, intentFromStick(-90), ship);

  assert.ok(Math.abs(touchUp.vx) < 1e-9, "touch direction should take effect immediately");
  assert.ok(Math.abs(touchUp.vy + 3.5) < 1e-9,
    "touch speed must remain current speed plus the unchanged ship acceleration");

  const firstTouchTick = applyIntent(still, intentFromStick(37), ship);
  assert.ok(Math.abs(speedOf(firstTouchTick) - ship.acceleration) < 1e-9,
    "touch sensitivity must retain the original first-tick acceleration");
});

test("changing direction bends momentum instead of snapping to a grid axis", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const movingRight = { vx: 3, vy: 0 };
  const turningUp = applyIntent(
    movingRight,
    intentFromKeys(keys({ up: true })),
    ship,
    { inertial: true }
  );

  assert.ok(turningUp.vx > 0, "existing rightward momentum should survive the first upward thrust tick");
  assert.ok(turningUp.vy < 0, "upward thrust should begin curving the flight path");
  assert.ok(Math.abs(turningUp.vx) > Math.abs(turningUp.vy), "the ship should arc instead of making an instant 90-degree turn");
  assert.ok(speedOf(turningUp) <= ship.maxSpeed, "curved flight must still respect top speed");
});

test("releasing the keys coasts, and retros bleed the drift off", () => {
  const ship = { acceleration: 0.5, maxSpeed: 4 };
  const moving = { vx: 3, vy: 0 };

  const coasting = applyIntent(moving, NO_INTENT, ship);
  assert.deepEqual(coasting, moving, "without retros the ship keeps its momentum");

  const braking = applyIntent(moving, NO_INTENT, ship, { retros: true });
  assert.ok(braking.vx < moving.vx && braking.vx > 0, "retros slow the ship without stopping it dead");
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

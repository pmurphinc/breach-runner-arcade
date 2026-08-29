import test from "node:test";
import assert from "node:assert/strict";
import { hasEnemyAttackAuthority, hostileShotVelocity, nearestPilot } from "../app/coop-enemy-targeting.js";

const host = (overrides = {}) => ({ id: "host", x: 100, y: 100, living: true, connected: true, ...overrides });
const guest = (overrides = {}) => ({ id: "guest", x: 700, y: 500, living: true, connected: true, ...overrides });

test("authoritative co-op targeting sees both synchronized pilot transforms", () => {
  assert.equal(nearestPilot({ x: 680, y: 500 }, [host(), guest()]).id, "guest");
  assert.equal(nearestPilot({ x: 120, y: 100 }, [host(), guest()]).id, "host");
});

test("host wins an exact-distance tie deterministically", () => {
  assert.equal(nearestPilot({ x: 400, y: 300 }, [host(), guest()]).id, "host");
});

test("dead, disconnected, and invalid teammate transforms are ignored", () => {
  for (const invalid of [
    guest({ living: false }),
    guest({ connected: false }),
    guest({ x: Number.NaN }),
  ]) assert.equal(nearestPilot({ x: 700, y: 500 }, [host(), invalid]).id, "host");
});

test("solo PvE retains its only living local pilot target", () => {
  assert.equal(nearestPilot({ x: 900, y: 900 }, [host()]).id, "host");
});

test("only a living teammate can remain as the target", () => {
  assert.equal(nearestPilot({ x: 100, y: 100 }, [host({ living: false }), guest()]).id, "guest");
});

test("hostile projectile direction physically points at the selected pilot", () => {
  const target = nearestPilot({ x: 650, y: 500 }, [host(), guest()]);
  const velocity = hostileShotVelocity({ x: 650, y: 500 }, target, 5);
  assert.deepEqual(velocity, { vx: 5, vy: 0 });
});

test("the guest cannot independently create a duplicate hostile attack", () => {
  assert.equal(hasEnemyAttackAuthority("coop", "host", "host"), true);
  assert.equal(hasEnemyAttackAuthority("coop", "guest", "host"), false);
  assert.equal(hasEnemyAttackAuthority("pve", undefined, undefined), true);
});

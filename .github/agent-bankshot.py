from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))

# ---------------------------------------------------------------- game data
replace_once(
    "app/game-data.ts",
    'export type PickupId = PowerId | "gun" | "thrust" | "retros" | "shield" | "clear" | "health";\n',
    'export type PickupId = PowerId | "gun" | "thrust" | "retros" | "shield" | "clear" | "health" | "ricochet";\n',
)
replace_once(
    "app/game-data.ts",
    '''  heatseeker: {\n''',
    '''  ricochet: {
    id: "ricochet", name: "BANKSHOT MATRIX", short: "BANKSHOT", abbr: "BM", color: "#73f6b0",
    category: "utility", sendable: false, threat: 1,
    summary: "Temporary pulse-cannon ricochet matrix collected on contact.",
    behavior: "Activates immediately for 10 seconds; normal cannon rounds can reflect from arena walls twice.",
    role: "Turns walls into firing angles without changing cannon damage or affecting enemy and special fire.",
  },
  heatseeker: {
''',
)

# ---------------------------------------------------------------- weapon art
replace_once(
    "app/weapon-art.ts",
    '''const GLYPHS: Record<PickupId, GlyphFn> = {\n''',
    '''const bankshotIcon: GlyphFn = (ctx, { r, detail }) => {
  const s = r / 14;
  // A hard zig-zag trajectory with two bright wall contacts reads as
  // "bank shot" even in the smallest inventory chip.
  ctx.beginPath();
  ctx.moveTo(-12 * s, 8 * s);
  ctx.lineTo(-3 * s, -8 * s);
  ctx.lineTo(5 * s, 8 * s);
  ctx.lineTo(12 * s, -5 * s);
  ctx.stroke();
  if (detail >= 0.35) {
    for (const [x, y] of [[-3, -8], [5, 8]] as const) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const GLYPHS: Record<PickupId, GlyphFn> = {
''',
)
replace_once(
    "app/weapon-art.ts",
    '''  health: healthIcon,\n};\n''',
    '''  health: healthIcon,
  ricochet: bankshotIcon,
};
''',
)

# ---------------------------------------------------------------- game imports/types/state
replace_once(
    "app/game.tsx",
    '''import { cannonPlaybackRate, hapticsAllow } from "./combat-feedback";\n''',
    '''import { cannonPlaybackRate, hapticsAllow } from "./combat-feedback";
import { RICOCHET_BOUNCES, RICOCHET_DURATION_SECONDS, reflectRicochet } from "./ricochet";
''',
)
replace_once(
    "app/game.tsx",
    '''  special?: boolean;\n  /** Steering authority in radians per tick. Absent means it flies straight. */\n''',
    '''  special?: boolean;
  /** Wall reflections remaining from Bankshot Matrix. Normal cannon only. */
  bouncesLeft?: number;
  /** Steering authority in radians per tick. Absent means it flies straight. */
''',
)
replace_once(
    "app/game.tsx",
    '''  specialCooldown: number;\n  emp: number;\n''',
    '''  specialCooldown: number;
  emp: number;
  /** Ticks remaining on the temporary Bankshot Matrix utility. */
  ricochetTicks: number;
''',
)
replace_once(
    "app/game.tsx",
    '''      specialCooldown: 0,\n      emp: 0,\n''',
    '''      specialCooldown: 0,
      emp: 0,
      ricochetTicks: 0,
''',
)
replace_once(
    "app/game.tsx",
    '''    const defensive: PickupId[] = ["gun", "thrust", "retros", "shield", "clear", "health"];\n''',
    '''    const defensive: PickupId[] = ["gun", "thrust", "retros", "shield", "clear", "health", "ricochet"];
''',
)

# ---------------------------------------------------------------- audio cue
replace_once(
    "app/game.tsx",
    '''      : cue === "cannon-hit"\n        ? { frequencies: [185, 122], duration: 0.075, gap: 0.012, type: "square" as OscillatorType }\n''',
    '''      : cue === "ricochet"
        ? { frequencies: [720, 980], duration: 0.09, gap: 0.018, type: "triangle" as OscillatorType }
      : cue === "cannon-hit"
        ? { frequencies: [185, 122], duration: 0.075, gap: 0.012, type: "square" as OscillatorType }
''',
)

# ---------------------------------------------------------------- tick/fire/bounce/collect
replace_once(
    "app/game.tsx",
    '''      player.emp = Math.max(0, player.emp - 1);\n''',
    '''      player.emp = Math.max(0, player.emp - 1);
      player.ricochetTicks = Math.max(0, player.ricochetTicks - 1);
''',
)
replace_once(
    "app/game.tsx",
    '''          game.bullets.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, damage: shot.damage, life: 110, enemy: false, color: shot.color });\n''',
    '''          game.bullets.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, damage: shot.damage, life: 110, enemy: false, color: shot.color, bouncesLeft: player.ricochetTicks > 0 ? RICOCHET_BOUNCES : 0 });
''',
)
replace_once(
    "app/game.tsx",
    '''        bullet.x += bullet.vx;\n        bullet.y += bullet.vy;\n        bullet.life -= 1;\n        if (bullet.enemy) {\n''',
    '''        bullet.x += bullet.vx;
        bullet.y += bullet.vy;
        bullet.life -= 1;
        if (!bullet.enemy && !bullet.special && (bullet.bouncesLeft ?? 0) > 0) {
          const reflected = reflectRicochet(
            bullet.x,
            bullet.y,
            bullet.vx,
            bullet.vy,
            game.worldWidth,
            game.worldHeight,
            bullet.bouncesLeft ?? 0,
          );
          if (reflected.bounced) {
            bullet.x = reflected.x;
            bullet.y = reflected.y;
            bullet.vx = reflected.vx;
            bullet.vy = reflected.vy;
            bullet.bouncesLeft = reflected.bouncesLeft;
            burst(game, bullet.x, bullet.y, "#73f6b0", 5, 3);
            playCue("ricochet", 0.065);
          }
        }
        if (bullet.enemy) {
''',
)
replace_once(
    "app/game.tsx",
    '''          else if (type === "health") player.health = Math.min(player.maxHealth, player.health + 30);\n          else if (game.stock.length < STOCK_LIMIT) game.stock.push(type);\n''',
    '''          else if (type === "health") player.health = Math.min(player.maxHealth, player.health + 30);
          else if (type === "ricochet") player.ricochetTicks = ticksForSeconds(RICOCHET_DURATION_SECONDS);
          else if (game.stock.length < STOCK_LIMIT) game.stock.push(type);
''',
)

# ---------------------------------------------------------------- visual language
replace_once(
    "app/game.tsx",
    '''          ctx.strokeStyle = bullet.color;\n          ctx.lineWidth = bullet.special ? 4.4 : 2.6;\n''',
    '''          const bankshot = !bullet.special && (bullet.bouncesLeft ?? 0) > 0;
          ctx.strokeStyle = bankshot ? "#73f6b0" : bullet.color;
          ctx.lineWidth = bullet.special ? 4.4 : bankshot ? 3.4 : 2.6;
''',
)
replace_once(
    "app/game.tsx",
    '''        const teammate = netRef.current?.state.teammate;\n''',
    '''        if (player.ricochetTicks > 0) {
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.strokeStyle = "#73f6b0";
          ctx.globalAlpha = 0.42;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 7]);
          ctx.beginPath();
          ctx.arc(0, 0, 36 + Math.sin(time * 0.014) * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = "#c8ffe5";
          ctx.font = "800 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`BANKSHOT ${(player.ricochetTicks * TICK_MS / 1000).toFixed(1)}s`, 0, player.emp > 0 ? 52 : 44);
          ctx.restore();
        }

        const teammate = netRef.current?.state.teammate;
''',
)

# ---------------------------------------------------------------- tests
Path("tests/ricochet.test.mjs").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = readFileSync(new URL("../app/game-data.ts", import.meta.url), "utf8");
const art = readFileSync(new URL("../app/weapon-art.ts", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const ricochet = readFileSync(new URL("../app/ricochet.ts", import.meta.url), "utf8");

test("Bankshot Matrix is a non-sendable utility pickup", () => {
  assert.match(data, /PickupId = PowerId[^;]+"ricochet"/);
  assert.doesNotMatch(data.match(/export type PowerId = ([^;]+)/)?.[1] ?? "", /ricochet/);
  const entry = data.slice(data.indexOf("ricochet: {"), data.indexOf("heatseeker: {"));
  assert.match(entry, /name: "BANKSHOT MATRIX"/);
  assert.match(entry, /sendable: false/);
  assert.match(art, /ricochet: bankshotIcon/);
});

test("ricochet is temporary and capped to two wall contacts", () => {
  assert.match(ricochet, /RICOCHET_DURATION_SECONDS = 10/);
  assert.match(ricochet, /RICOCHET_BOUNCES = 2/);
  assert.match(ricochet, /bouncesLeft: bouncesLeft - 1/);
  assert.match(ricochet, /vx: hitX \? -vx : vx/);
  assert.match(ricochet, /vy: hitY \? -vy : vy/);
});

test("only normal player cannon rounds receive and spend bounce charges", () => {
  assert.match(game, /bouncesLeft: player\.ricochetTicks > 0 \? RICOCHET_BOUNCES : 0/);
  assert.match(game, /!bullet\.enemy && !bullet\.special && \(bullet\.bouncesLeft \?\? 0\) > 0/);
  assert.match(game, /reflectRicochet\(/);
});

test("pickup activates a ten-second timer and already-fired rounds keep their own charges", () => {
  assert.match(game, /type === "ricochet"\) player\.ricochetTicks = ticksForSeconds\(RICOCHET_DURATION_SECONDS\)/);
  assert.match(game, /player\.ricochetTicks = Math\.max\(0, player\.ricochetTicks - 1\)/);
  assert.doesNotMatch(ricochet, /life/);
});

test("Bankshot has distinct active and bounce feedback", () => {
  assert.match(game, /BANKSHOT \$\{\(player\.ricochetTicks \* TICK_MS \/ 1000\)\.toFixed\(1\)\}s/);
  assert.match(game, /playCue\("ricochet"/);
  assert.match(game, /const bankshot = !bullet\.special/);
});
''')

# Temporary validation tooling never belongs in the feature diff.
Path(".github/workflows/agent-bankshot.yml").unlink(missing_ok=True)
Path(".github/agent-bankshot.py").unlink(missing_ok=True)

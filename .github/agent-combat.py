from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:90]!r}")
    p.write_text(text.replace(old, new, 1))

# ------------------------------------------------------------ settings
replace_once("app/view-settings.ts",
'''export type ZoomLevel = "wide" | "standard" | "close" | "closer";
''',
'''export type ZoomLevel = "wide" | "standard" | "close" | "closer";
export type CombatHaptics = "off" | "gun" | "hull" | "both";
''')
replace_once("app/view-settings.ts",
'''  sound: boolean;
  soundLevel: SoundLevel;
  thumbsticks: boolean;
''',
'''  sound: boolean;
  soundLevel: SoundLevel;
  /** Combat-only vibration. Control-press and victory haptics remain separate. */
  combatHaptics: CombatHaptics;
  cannonHitSound: boolean;
  thumbsticks: boolean;
''')
replace_once("app/view-settings.ts",
'''  sound: true,
  soundLevel: "medium",
  thumbsticks: true,
''',
'''  sound: true,
  soundLevel: "medium",
  combatHaptics: "both",
  cannonHitSound: true,
  thumbsticks: true,
''')
replace_once("app/view-settings.ts",
'''const isZoom = (value: unknown): value is ZoomLevel => value === "wide" || value === "standard" || value === "close" || value === "closer";
''',
'''const isZoom = (value: unknown): value is ZoomLevel => value === "wide" || value === "standard" || value === "close" || value === "closer";
const isCombatHaptics = (value: unknown): value is CombatHaptics => value === "off" || value === "gun" || value === "hull" || value === "both";
''')
replace_once("app/view-settings.ts",
'''    sound: typeof candidate.sound === "boolean" ? candidate.sound : true,
    soundLevel: isLevel(candidate.soundLevel) ? candidate.soundLevel : "medium",
    thumbsticks: typeof candidate.thumbsticks === "boolean" ? candidate.thumbsticks : true,
''',
'''    sound: typeof candidate.sound === "boolean" ? candidate.sound : true,
    soundLevel: isLevel(candidate.soundLevel) ? candidate.soundLevel : "medium",
    combatHaptics: isCombatHaptics(candidate.combatHaptics) ? candidate.combatHaptics : "both",
    cannonHitSound: typeof candidate.cannonHitSound === "boolean" ? candidate.cannonHitSound : true,
    thumbsticks: typeof candidate.thumbsticks === "boolean" ? candidate.thumbsticks : true,
''')

# ------------------------------------------------------------ menu
replace_once("app/main-menu.tsx",
'''import type { SoundLevel, TouchControlSize, ViewMode, ZoomLevel } from "./view-settings";
''',
'''import type { CombatHaptics, SoundLevel, TouchControlSize, ViewMode, ZoomLevel } from "./view-settings";
''')
replace_once("app/main-menu.tsx",
'''  soundLevel,
  onSoundLevel,
  cameraLock,
''',
'''  soundLevel,
  onSoundLevel,
  combatHaptics,
  onCombatHaptics,
  cannonHitSound,
  onCannonHitSound,
  cameraLock,
''')
replace_once("app/main-menu.tsx",
'''  soundLevel: SoundLevel;
  onSoundLevel: (next: SoundLevel) => void;
  cameraLock: boolean;
''',
'''  soundLevel: SoundLevel;
  onSoundLevel: (next: SoundLevel) => void;
  combatHaptics: CombatHaptics;
  onCombatHaptics: (next: CombatHaptics) => void;
  cannonHitSound: boolean;
  onCannonHitSound: (next: boolean) => void;
  cameraLock: boolean;
''')
replace_once("app/main-menu.tsx",
'''        <OptionRow
          label="Touch control size"
          value={touchSize}
          disabled={viewMode === "pc"}
          options={[
            { id: "small", label: "Small" },
            { id: "medium", label: "Medium" },
            { id: "large", label: "Large" },
          ]}
          onChange={onTouchSize}
        />
      </MenuSection>
''',
'''        <OptionRow
          label="Touch control size"
          value={touchSize}
          disabled={viewMode === "pc"}
          options={[
            { id: "small", label: "Small" },
            { id: "medium", label: "Medium" },
            { id: "large", label: "Large" },
          ]}
          onChange={onTouchSize}
        />
        <OptionRow
          label="Vibration"
          value={combatHaptics}
          options={[
            { id: "off", label: "Off" },
            { id: "gun", label: "Gun Feedback", hint: "Pulse when your cannon hits" },
            { id: "hull", label: "Hull Feedback", hint: "Pulse when hull takes damage" },
            { id: "both", label: "Both" },
          ]}
          onChange={onCombatHaptics}
        />
      </MenuSection>
''')
replace_once("app/main-menu.tsx",
'''          onChange={onSoundLevel}
        />
      </MenuSection>
''',
'''          onChange={onSoundLevel}
        />
        <Toggle
          label="Cannon Hit Sound"
          value={cannonHitSound}
          onChange={onCannonHitSound}
          disabled={!sound}
          hint="Short impact marker for normal pulse-cannon hits"
        />
      </MenuSection>
''')

# ------------------------------------------------------------ game imports/refs
replace_once("app/game.tsx",
'''  type SoundLevel,
  type ZoomLevel,
} from "./view-settings";
''',
'''  type CombatHaptics,
  type SoundLevel,
  type ZoomLevel,
} from "./view-settings";
''')
# Insert the pure feedback rules beside movement imports.
replace_once("app/game.tsx",
'''import {
  MOVEMENT_CODES,
''',
'''import { cannonPlaybackRate, hapticsAllow } from "./combat-feedback";
import {
  MOVEMENT_CODES,
''')
replace_once("app/game.tsx",
'''  const soundLevelRef = useRef<SoundLevel>("medium");
  const cameraRef = useRef(true);
''',
'''  const soundLevelRef = useRef<SoundLevel>("medium");
  const combatHapticsRef = useRef<CombatHaptics>("both");
  const cannonHitSoundRef = useRef(true);
  const cameraRef = useRef(true);
''')
replace_once("app/game.tsx",
'''  useEffect(() => { soundLevelRef.current = settings.soundLevel; }, [settings.soundLevel]);
  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
''',
'''  useEffect(() => { soundLevelRef.current = settings.soundLevel; }, [settings.soundLevel]);
  useEffect(() => { combatHapticsRef.current = settings.combatHaptics; }, [settings.combatHaptics]);
  useEffect(() => { cannonHitSoundRef.current = settings.cannonHitSound; }, [settings.cannonHitSound]);
  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
''')

# Playback rate keeps the same WAV identity across cannon marks.
replace_once("app/game.tsx",
'''  const play = useCallback((name: "fire" | "explosion" | "magic" | "thrust", volume = 0.22) => {
''',
'''  const play = useCallback((name: "fire" | "explosion" | "magic" | "thrust", volume = 0.22, playbackRate = 1) => {
''')
replace_once("app/game.tsx",
'''    clip.volume = cap(volume * SOUND_GAIN[soundLevelRef.current], 0, 1);
    try { clip.currentTime = 0; } catch { /* Safari throws before metadata loads. */ }
''',
'''    clip.volume = cap(volume * SOUND_GAIN[soundLevelRef.current], 0, 1);
    clip.playbackRate = cap(playbackRate, 0.5, 2);
    try { clip.currentTime = 0; } catch { /* Safari throws before metadata loads. */ }
''')
# Dedicated tiny cues before the generic hash fallback.
replace_once("app/game.tsx",
'''      : cue === "shield-pickup"
        ? { frequencies: [420, 680, 1020], duration: 0.46, gap: 0.07, type: "sine" as OscillatorType }
        : cue === "shield-down"
''',
'''      : cue === "cannon-hit"
        ? { frequencies: [185, 122], duration: 0.075, gap: 0.012, type: "square" as OscillatorType }
      : cue === "emp-hit"
        ? { frequencies: [920, 510, 260], duration: 0.34, gap: 0.035, type: "sawtooth" as OscillatorType }
      : cue === "shield-pickup"
        ? { frequencies: [420, 680, 1020], duration: 0.46, gap: 0.07, type: "sine" as OscillatorType }
        : cue === "shield-down"
''')

# ------------------------------------------------------------ canvas feedback
# Local helper inside the canvas effect so no hook dependencies are added.
replace_once("app/game.tsx",
'''    let hudDelay = 0;

    // Rendering geometry.
''',
'''    let hudDelay = 0;
    let lastGunFeedbackTick = -999;

    const vibrateCombat = (event: "gun" | "hull") => {
      if (reducedMotionRef.current || !hapticsAllow(combatHapticsRef.current, event)) return;
      if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
      navigator.vibrate(event === "gun" ? 9 : 24);
    };

    const cannonImpactFeedback = (game: Game, bullet: Bullet) => {
      if (bullet.enemy || bullet.special || game.cycles - lastGunFeedbackTick < 2) return;
      lastGunFeedbackTick = game.cycles;
      vibrateCombat("gun");
      if (cannonHitSoundRef.current) playCue("cannon-hit", 0.075);
    };

    // Rendering geometry.
''')
replace_once("app/game.tsx",
'''      player.health -= amount;
      if (game.mode !== "pve") {
''',
'''      if (amount > 0) vibrateCombat("hull");
      player.health -= amount;
      if (game.mode !== "pve") {
''')

# EMP mechanics stay 150 ticks; feedback is edge-triggered on first application.
replace_once("app/game.tsx",
'''        if ((enemy.blastRadius ?? 0) > 0 && (enemy.blastRadius ?? 0) >= d) player.emp = 150;
''',
'''        if ((enemy.blastRadius ?? 0) > 0 && (enemy.blastRadius ?? 0) >= d) {
          const newlyScrambled = player.emp <= 0;
          player.emp = 150;
          if (newlyScrambled) {
            game.notice = "SCRAMBLED // CONTROLS REVERSED";
            game.noticeLife = 150;
            playCue("emp-hit", 0.15);
          }
        }
''')

# Cannon pitch on normal trigger only.
replace_once("app/game.tsx",
'''        play("fire", 0.12);
''',
'''        play("fire", 0.12, cannonPlaybackRate(player.gun));
''')
# Confirmed normal-cannon impact on rift and hostile.
replace_once("app/game.tsx",
'''          burst(game, bullet.x, bullet.y, "#ff5ac8", 4, 2.5);
          if (game.portalCharge > game.portalThreshold) {
''',
'''          burst(game, bullet.x, bullet.y, "#ff5ac8", 4, 2.5);
          cannonImpactFeedback(game, bullet);
          if (game.portalCharge > game.portalThreshold) {
''')
replace_once("app/game.tsx",
'''            enemy.hp -= scrambledDamage(bullet.damage, (enemy.scrambled ?? 0) > 0);
            burst(game, bullet.x, bullet.y, POWER_COLORS[enemy.kind], 4, 2.5);
''',
'''            enemy.hp -= scrambledDamage(bullet.damage, (enemy.scrambled ?? 0) > 0);
            burst(game, bullet.x, bullet.y, POWER_COLORS[enemy.kind], 4, 2.5);
            cannonImpactFeedback(game, bullet);
''')

# Persistent EMP readout/electrical ring immediately after the player hull draw.
replace_once("app/game.tsx",
'''        ctx.restore();

        const teammate = netRef.current?.state.teammate;
''',
'''        ctx.restore();

        if (player.emp > 0) {
          ctx.save();
          ctx.translate(player.x, player.y);
          const pulse = 0.55 + Math.sin(time * 0.025) * 0.2;
          ctx.strokeStyle = "#7fb6ff";
          ctx.lineWidth = 2.4;
          ctx.globalAlpha = pulse;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, 31 + Math.sin(time * 0.018) * 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = "#dce8ff";
          ctx.font = "800 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`SCRAMBLED ${(player.emp * TICK_MS / 1000).toFixed(1)}s`, 0, -38);
          ctx.restore();
        }

        const teammate = netRef.current?.state.teammate;
''')

# Settings props supplied by game shell.
replace_once("app/game.tsx",
'''          soundLevel={settings.soundLevel}
          onSoundLevel={(next) => setSetting("soundLevel", next)}
          cameraLock={cameraLocked}
''',
'''          soundLevel={settings.soundLevel}
          onSoundLevel={(next) => setSetting("soundLevel", next)}
          combatHaptics={settings.combatHaptics}
          onCombatHaptics={(next) => setSetting("combatHaptics", next)}
          cannonHitSound={settings.cannonHitSound}
          onCannonHitSound={(next) => setSetting("cannonHitSound", next)}
          cameraLock={cameraLocked}
''')

# ------------------------------------------------------------ tests
Path("tests/combat-feedback.test.mjs").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const rules = readFileSync(new URL("../app/combat-feedback.ts", import.meta.url), "utf8");

test("combat vibration and hit-sound settings persist with safe defaults", () => {
  assert.match(settings, /combatHaptics: "both"/);
  assert.match(settings, /cannonHitSound: true/);
  assert.match(settings, /isCombatHaptics\(candidate\.combatHaptics\)/);
  assert.match(menu, /label="Vibration"/);
  assert.match(menu, /Gun Feedback/);
  assert.match(menu, /Hull Feedback/);
  assert.match(menu, /label="Cannon Hit Sound"/);
});

test("cannon mark pitch ladder keeps one fire sound identity", () => {
  for (const rate of ["1", "1.08", "1.17", "1.28", "1.4"]) assert.match(rules, new RegExp(rate.replace('.', '\\.')));
  assert.match(game, /play\("fire", 0\.12, cannonPlaybackRate\(player\.gun\)\)/);
});

test("normal cannon impacts drive hit feedback while specials are excluded", () => {
  assert.match(game, /bullet\.enemy \|\| bullet\.special/);
  assert.equal((game.match(/cannonImpactFeedback\(game, bullet\)/g) ?? []).length, 2);
  assert.match(game, /cannonHitSoundRef\.current/);
});

test("hull feedback is emitted only after unlimited-hull guard", () => {
  const start = game.indexOf("const applyHullDamage");
  const block = game.slice(start, start + 900);
  assert.ok(block.indexOf("unlimitedHull") < block.indexOf('vibrateCombat("hull")'));
});

test("EMP remains 150 ticks but gains edge-triggered audio and persistent status", () => {
  assert.match(game, /const newlyScrambled = player\.emp <= 0/);
  assert.match(game, /player\.emp = 150/);
  assert.match(game, /if \(newlyScrambled\)/);
  assert.match(game, /SCRAMBLED \/\/ CONTROLS REVERSED/);
  assert.match(game, /SCRAMBLED \$\{\(player\.emp \* TICK_MS \/ 1000\)\.toFixed\(1\)\}s/);
});
''')

Path(".github/workflows/agent-combat.yml").unlink(missing_ok=True)
Path(".github/agent-combat.py").unlink(missing_ok=True)

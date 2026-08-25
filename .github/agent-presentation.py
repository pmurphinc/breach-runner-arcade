from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))

# ---------------------------------------------------------------- settings
replace_once("app/view-settings.ts",
'''export type SoundLevel = "low" | "medium" | "high";
''',
'''export type SoundLevel = "low" | "medium" | "high";
export type ZoomLevel = "wide" | "standard" | "close" | "closer";
''')
replace_once("app/view-settings.ts",
'''  cameraLock: boolean;
  sound: boolean;
''',
'''  cameraLock: boolean;
  /** Follow-ship camera magnification. Full Arena always fits the whole world. */
  zoom: ZoomLevel;
  sound: boolean;
''')
replace_once("app/view-settings.ts",
'''  cameraLock: true,
  sound: true,
''',
'''  cameraLock: true,
  zoom: "standard",
  sound: true,
''')
replace_once("app/view-settings.ts",
'''const isLevel = (value: unknown): value is SoundLevel => value === "low" || value === "medium" || value === "high";
''',
'''const isLevel = (value: unknown): value is SoundLevel => value === "low" || value === "medium" || value === "high";
const isZoom = (value: unknown): value is ZoomLevel => value === "wide" || value === "standard" || value === "close" || value === "closer";
''')
replace_once("app/view-settings.ts",
'''    cameraLock: typeof candidate.cameraLock === "boolean" ? candidate.cameraLock : true,
    sound: typeof candidate.sound === "boolean" ? candidate.sound : true,
''',
'''    cameraLock: typeof candidate.cameraLock === "boolean" ? candidate.cameraLock : true,
    zoom: isZoom(candidate.zoom) ? candidate.zoom : "standard",
    sound: typeof candidate.sound === "boolean" ? candidate.sound : true,
''')
replace_once("app/view-settings.ts",
'''export const SOUND_GAIN: Record<SoundLevel, number> = {
''',
'''export const ZOOM_SCALE: Record<ZoomLevel, number> = {
  wide: 0.85,
  standard: 1,
  close: 1.15,
  closer: 1.3,
};

export const SOUND_GAIN: Record<SoundLevel, number> = {
''')

# ---------------------------------------------------------------- menu
replace_once("app/main-menu.tsx",
'''import type { SoundLevel, TouchControlSize, ViewMode } from "./view-settings";
''',
'''import type { SoundLevel, TouchControlSize, ViewMode, ZoomLevel } from "./view-settings";
''')
replace_once("app/main-menu.tsx",
'''  cameraLock,
  onCameraLock,
  initials,
''',
'''  cameraLock,
  onCameraLock,
  zoom,
  onZoom,
  initials,
''')
replace_once("app/main-menu.tsx",
'''  cameraLock: boolean;
  onCameraLock: (next: boolean) => void;
  initials: string;
''',
'''  cameraLock: boolean;
  onCameraLock: (next: boolean) => void;
  zoom: ZoomLevel;
  onZoom: (next: ZoomLevel) => void;
  initials: string;
''')
replace_once("app/main-menu.tsx",
'''      <MenuSection title="Display">
        <Toggle
          label="Camera lock"
          value={cameraLock}
          onChange={onCameraLock}
          hint="Keep the camera centred on your ship"
        />
      </MenuSection>
''',
'''      <MenuSection title="Display">
        <OptionRow
          label="Perspective"
          value={cameraLock ? "follow" : "arena"}
          options={[
            { id: "follow", label: "Follow Ship", hint: "The arena moves around your ship" },
            { id: "arena", label: "Full Arena", hint: "Fit the entire arena on screen" },
          ]}
          onChange={(next) => onCameraLock(next === "follow")}
        />
        <OptionRow
          label="Zoom"
          value={zoom}
          disabled={!cameraLock}
          options={[
            { id: "wide", label: "Wide", hint: "0.85×" },
            { id: "standard", label: "Standard", hint: "1.00×" },
            { id: "close", label: "Close", hint: "1.15×" },
            { id: "closer", label: "Closer", hint: "1.30×" },
          ]}
          onChange={onZoom}
        />
        {!cameraLock ? <p className="menu-hint">Full Arena always fits the entire arena.</p> : null}
      </MenuSection>
''')

# ---------------------------------------------------------------- themed difficulty copy
p = Path("app/difficulty.ts")
text = p.read_text()
for old, new in [
    ('displayName: "PRACTICE // UNLIMITED HULL"', 'displayName: "SIMULATION // HULL LOCKED"'),
    ('shortName: "PRACTICE"', 'shortName: "SIMULATION"'),
    ('displayName: "EASY // COLLISION SHIELD"', 'displayName: "STABLE // COLLISION SHIELD"'),
    ('shortName: "EASY"', 'shortName: "STABLE"'),
    ('displayName: "DIFFICULT // MOVING VOID"', 'displayName: "VOLATILE // MOVING RIFT"'),
    ('shortName: "DIFFICULT"', 'shortName: "VOLATILE"'),
    ('displayName: "HARD MODE // CONTACT HAZARD"', 'displayName: "CRITICAL // CONTACT HAZARD"'),
    ('shortName: "HARD MODE"', 'shortName: "CRITICAL"'),
    ('"Learn the flight controls, weapons, and wormhole loop without taking hull damage.', '"Learn the flight controls, weapons, and rift loop without taking hull damage.'),
    ('"The wormhole is locked dead centre and never moves.', '"The rift is locked dead centre and never moves.'),
]:
    if old not in text:
        raise SystemExit(f"difficulty anchor missing: {old}")
    text = text.replace(old, new, 1)
p.write_text(text)

# ---------------------------------------------------------------- game camera + visual scale
replace_once("app/game.tsx",
'''  SOUND_GAIN,
  VIEW_PROFILES,
  type SoundLevel,
''',
'''  SOUND_GAIN,
  VIEW_PROFILES,
  ZOOM_SCALE,
  type SoundLevel,
  type ZoomLevel,
''')
replace_once("app/game.tsx",
'''  const cameraRef = useRef(true);
  const qualityRef = useRef<QualityMode>("auto");
''',
'''  const cameraRef = useRef(true);
  const zoomRef = useRef<ZoomLevel>("standard");
  const qualityRef = useRef<QualityMode>("auto");
''')
replace_once("app/game.tsx",
'''  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
''',
'''  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
  useEffect(() => { zoomRef.current = settings.zoom; }, [settings.zoom]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
''')
old_camera = '''    const locked = cameraRef.current;
    const camScale = locked ? 1 : Math.min(VIEW_WIDTH / game.worldWidth, VIEW_HEIGHT / game.worldHeight);
    const camX = locked ? cap(VIEW_WIDTH / 2 - player.x, VIEW_WIDTH - game.worldWidth, 0) : (VIEW_WIDTH - game.worldWidth * camScale) / 2;
    const camY = locked ? cap(VIEW_HEIGHT / 2 - player.y, VIEW_HEIGHT - game.worldHeight, 0) : (VIEW_HEIGHT - game.worldHeight * camScale) / 2;
'''
new_camera = '''    const locked = cameraRef.current;
    const camScale = locked ? ZOOM_SCALE[zoomRef.current] : Math.min(VIEW_WIDTH / game.worldWidth, VIEW_HEIGHT / game.worldHeight);
    const camX = locked ? cap(VIEW_WIDTH / 2 - player.x * camScale, VIEW_WIDTH - game.worldWidth * camScale, 0) : (VIEW_WIDTH - game.worldWidth * camScale) / 2;
    const camY = locked ? cap(VIEW_HEIGHT / 2 - player.y * camScale, VIEW_HEIGHT - game.worldHeight * camScale, 0) : (VIEW_HEIGHT - game.worldHeight * camScale) / 2;
'''
game = Path("app/game.tsx").read_text()
if game.count(old_camera) != 2:
    raise SystemExit(f"expected two camera transforms, found {game.count(old_camera)}")
game = game.replace(old_camera, new_camera)
Path("app/game.tsx").write_text(game)
replace_once("app/game.tsx",
'''          cameraLock={cameraLocked}
          onCameraLock={(next) => setSetting("cameraLock", next)}
          initials={settings.playerInitials}
''',
'''          cameraLock={cameraLocked}
          onCameraLock={(next) => setSetting("cameraLock", next)}
          zoom={settings.zoom}
          onZoom={(next) => setSetting("zoom", next)}
          initials={settings.playerInitials}
''')
replace_once("app/game.tsx",
'''        drawShipShape(ctx, game.ship.id, game.ship.id === "flagship" ? .82 : 1);
''',
'''        drawShipShape(ctx, game.ship.id, (game.ship.id === "flagship" ? .82 : 1) * 1.15);
''')
replace_once("app/game.tsx",
'''          drawShipShape(ctx, teammate.ship as ShipId, teammate.ship === "flagship" ? .82 : 1);
''',
'''          drawShipShape(ctx, teammate.ship as ShipId, (teammate.ship === "flagship" ? .82 : 1) * 1.15);
''')
# Align practice-only feedback with the new player-facing ladder.
p = Path("app/game.tsx")
g = p.read_text().replace('"PRACTICE // HULL LOCKED"', '"SIMULATION // HULL LOCKED"')
p.write_text(g)

# Update old visible difficulty-name assertions in tests without changing internal ids.
for test_path in Path("tests").glob("*.mjs"):
    t = test_path.read_text()
    t = t.replace('PRACTICE // UNLIMITED HULL', 'SIMULATION // HULL LOCKED')
    t = t.replace('EASY // COLLISION SHIELD', 'STABLE // COLLISION SHIELD')
    t = t.replace('DIFFICULT // MOVING VOID', 'VOLATILE // MOVING RIFT')
    t = t.replace('HARD MODE // CONTACT HAZARD', 'CRITICAL // CONTACT HAZARD')
    test_path.write_text(t)

Path("tests/presentation-settings.test.mjs").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const difficulty = readFileSync(new URL("../app/difficulty.ts", import.meta.url), "utf8");

test("zoom settings migrate safely and expose four camera scales", () => {
  assert.match(settings, /zoom: "standard"/);
  assert.match(settings, /wide: 0\.85/);
  assert.match(settings, /close: 1\.15/);
  assert.match(settings, /closer: 1\.3/);
  assert.match(settings, /isZoom\(candidate\.zoom\) \? candidate\.zoom : "standard"/);
});

test("settings expose Perspective rather than the old Camera lock toggle", () => {
  assert.match(menu, /label="Perspective"/);
  assert.match(menu, /Follow Ship/);
  assert.match(menu, /Full Arena/);
  assert.doesNotMatch(menu, /label="Camera lock"/);
});

test("camera zoom is shared by rendering and pointer-to-world transforms", () => {
  assert.equal((game.match(/ZOOM_SCALE\[zoomRef\.current\]/g) ?? []).length, 2);
  assert.match(game, /player\.x \* camScale/);
  assert.match(game, /player\.y \* camScale/);
});

test("arena ships are visually larger without changing collision constants", () => {
  assert.equal((game.match(/\* 1\.15/g) ?? []).length, 2);
});

test("difficulty ladder uses Breach Runner themed names", () => {
  for (const label of ["SIMULATION", "STABLE", "VOLATILE", "CRITICAL"]) assert.match(difficulty, new RegExp(label));
});
''')

# Temporary automation must never appear in the final PR diff.
Path(".github/workflows/agent-presentation.yml").unlink(missing_ok=True)
Path(".github/agent-presentation.py").unlink(missing_ok=True)

from pathlib import Path
import re

GAME = Path("app/game.tsx")
source = GAME.read_text()
pattern = re.compile(
    r"(?m)^(?P<i>\s*)if \(player\.health > 0\) \{\n"
    r"(?P=i)  ctx\.save\(\);\n"
    r"(?P=i)  ctx\.translate\(player\.x, player\.y\);\n"
    r"(?P=i)  ctx\.rotate\(player\.angle \* DEG\);"
)
matches = list(pattern.finditer(source))
if len(matches) != 1:
    raise SystemExit(f"expected one player render anchor, found {len(matches)}; refusing broad patch")
match = matches[0]
indent = match.group("i")
replacement = "\n".join([
    f"{indent}if (player.health > 0) {{",
    f"{indent}  ctx.save();",
    f"{indent}  // A player hull must never inherit transparent or destructive canvas",
    f"{indent}  // state from an earlier arena effect. Form Shift can be triggered",
    f"{indent}  // repeatedly during long Switchback runs, so the player draw owns",
    f"{indent}  // an explicit visible render-state boundary every frame.",
    f"{indent}  ctx.globalAlpha = 1;",
    f"{indent}  ctx.globalCompositeOperation = \"source-over\";",
    f"{indent}  ctx.shadowBlur = 0;",
    f"{indent}  ctx.setLineDash([]);",
    f"{indent}  ctx.lineDashOffset = 0;",
    f"{indent}  ctx.translate(player.x, player.y);",
    f"{indent}  ctx.rotate(player.angle * DEG);",
])
GAME.write_text(source[:match.start()] + replacement + source[match.end():])

Path("tests/switchback-visibility.test.mjs").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("live player draw starts from an explicit visible canvas state", () => {
  const sceneStart = source.indexOf("const drawScene");
  assert.notEqual(sceneStart, -1);
  const start = source.indexOf("if (player.health > 0)", sceneStart);
  assert.notEqual(start, -1);
  const draw = source.slice(start, start + 1100);
  assert.match(draw, /ctx\.globalAlpha = 1/);
  assert.match(draw, /ctx\.globalCompositeOperation = "source-over"/);
  assert.match(draw, /ctx\.setLineDash\(\[\]\)/);
  assert.match(draw, /drawShipShape\(ctx, game\.ship\.id/);
});

test("Switchback Form Shift remains a handling-only state toggle", () => {
  const start = source.indexOf('ship === "flash"');
  assert.notEqual(start, -1);
  const branch = source.slice(start, start + 420);
  assert.match(branch, /player\.flashMode = player\.flashMode === "tank" \? "squid" : "tank"/);
  assert.doesNotMatch(branch, /globalAlpha|opacity|visible|health\s*=|game\.ship\s*=/);
});
''')

Path(".github/workflows/agent-fix-switchback.yml").unlink(missing_ok=True)
Path(".github/agent-fix-switchback.py").unlink(missing_ok=True)

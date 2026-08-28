import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const art = readFileSync(new URL("../app/weapon-art.ts", import.meta.url), "utf8");
const gameData = readFileSync(new URL("../app/game-data.ts", import.meta.url), "utf8");

function renderer(name, nextName) {
  const start = art.indexOf(`const ${name}: GlyphFn`);
  const end = art.indexOf(`const ${nextName}: GlyphFn`, start);
  assert.ok(start >= 0 && end > start, `${name} renderer exists`);
  return art.slice(start, end);
}

const geometryBlock = art.slice(
  art.indexOf("export const CANONICAL_GLYPH_GEOMETRY"),
  art.indexOf("} as const;", art.indexOf("export const CANONICAL_GLYPH_GEOMETRY")) + 11,
);

function canonicalValue(name) {
  const match = geometryBlock.match(new RegExp(`${name}:\\s*(\\d+)`));
  assert.ok(match, `${name} is declared`);
  return Number(match[1]);
}

test("Plasma Bloom keeps its canonical nine-lobe outer geometry at every detail level", () => {
  const inflator = renderer("inflator", "minelayer");
  assert.equal(canonicalValue("inflatorLobes"), 9);
  assert.match(inflator, /const lobes = CANONICAL_GLYPH_GEOMETRY\.inflatorLobes/);
  assert.doesNotMatch(inflator, /detail\s*[<>=!]+[^;\n]*\?[^;\n]*(?:lobes|steps)/);
  assert.match(inflator, /const steps = lobes \* 6/);
});

test("Plasma Bloom detail still controls only its secondary core and inner ring", () => {
  const inflator = renderer("inflator", "minelayer");
  assert.match(inflator, /core\(ctx, r \* 0\.62,[\s\S]*detail\)/);
  assert.match(inflator, /if \(detail >= 0\.35\) \{[\s\S]*ctx\.arc\(0, 0, r \* 0\.42/);
});

test("other audited glyphs keep canonical identifying geometry across detail levels", () => {
  const cases = [
    ["mines", "ufo", "mineSpikes", 10],
    ["ghost", "artillery", "ghostHemWaves", 5],
    ["zapIcon", "healthIcon", "clearBurstPoints", 10],
  ];
  for (const [name, next, property, expected] of cases) {
    const code = renderer(name, next);
    assert.equal(canonicalValue(property), expected);
    assert.match(code, new RegExp(`CANONICAL_GLYPH_GEOMETRY\\.${property}`));
    assert.doesNotMatch(code, new RegExp(`detail\\s*[<>=!]+[^;\\n]*\\?[^;\\n]*${property}`));
  }
  const scarab = renderer("scarab", "nuke");
  assert.match(scarab, /ctx\.moveTo\(14 \* s, -2 \* s\)[\s\S]*ctx\.lineTo\(20 \* s, -5\.5 \* s\)/);
  assert.doesNotMatch(scarab, /detail/);
  assert.match(renderer("mines", "ufo"), /if \(detail >= 0\.35\)[\s\S]*ctx\.arc/);
});

test("existing weapon IDs and glyph mappings remain unchanged", () => {
  const ids = gameData.match(/export type PowerId = ([^;]+);/)?.[1].match(/"[^"]+"/g)?.map((id) => id.slice(1, -1));
  assert.ok(ids?.length, "PowerId IDs are readable");
  const glyphBlock = art.slice(art.indexOf("const GLYPHS:"), art.indexOf("};", art.indexOf("const GLYPHS:")) + 2);
  for (const id of ids) assert.match(glyphBlock, new RegExp(`(?:^|[\\s,])${id}(?:[\\s,:]|$)`), `${id} retains a glyph mapping`);
  for (const utility of ["gun", "thrust", "retros", "shield", "clear", "health", "ricochet"]) {
    assert.match(glyphBlock, new RegExp(`${utility}:`), `${utility} retains a glyph mapping`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyText } from "../app/clipboard.js";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("private lobby code is an accessible copy action with temporary feedback", () => {
  assert.match(game, /aria-label=\{`Copy private match code \$\{status\.code\}`\}/);
  assert.match(game, /onClick=\{\(\) => void copyPrivateCode\(status\.code\)\}/);
  assert.match(game, /codeCopied \? "CODE COPIED" : "TAP TO COPY"/);
  assert.match(game, /setTimeout\(\(\) => setCodeCopied\(false\), 1800\)/);
});

test("successful clipboard writes report success", async () => {
  let copied = "";
  assert.equal(await copyText("AB7K", { writeText: async (text) => { copied = text; } }), true);
  assert.equal(copied, "AB7K");
});

test("missing or failed clipboard access is contained", async () => {
  assert.equal(await copyText("AB7K", undefined), false);
  assert.equal(await copyText("AB7K", { writeText: async () => { throw new Error("denied"); } }), false);
});

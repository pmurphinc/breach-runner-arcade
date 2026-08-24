import fs from "node:fs";

function edit(pathname, replacements) {
  let source = fs.readFileSync(pathname, "utf8");
  for (const [from, to] of replacements) {
    if (!source.includes(from)) {
      throw new Error(`${pathname} no longer contains expected text: ${from}`);
    }
    source = source.split(from).join(to);
  }
  fs.writeFileSync(pathname, source);
}

edit("app/layout.tsx", [
  ["https://wormhole-arcade.pmurphinc.chatgpt.site", "https://breachrunner.murphtournaments.com"],
]);

edit("README.md", [
  ["`https://wormhole.murphtournaments.com`", "`https://breachrunner.murphtournaments.com`"],
  [
    "The existing hostname and repository name are retained for development compatibility and are not the commercial product identity.",
    "The canonical web deployment now uses the Breach Runner subdomain. Internal compatibility ids remain unchanged where renaming them would risk saves, networking, or score data."
  ],
  [
    "The current development domain remains allowed by the multiplayer origin policy. Installed Android and Steam client origins will be addressed during the later packaging/networking phase.",
    "The canonical Breach Runner web domain is allowed by the multiplayer origin policy; the former Wormhole subdomain remains a temporary backend-only migration alias during the DNS cutover. Installed Android and Steam client origins will be addressed during the later packaging/networking phase."
  ],
]);

edit("server/pvp.mjs", [
  [
    'const PRODUCTION_ORIGIN = "https://wormhole.murphtournaments.com";',
    'const PRODUCTION_ORIGIN = "https://breachrunner.murphtournaments.com";\nconst LEGACY_PRODUCTION_ORIGIN = "https://wormhole.murphtournaments.com";'
  ],
  [
    "  const origins = new Set([PRODUCTION_ORIGIN]);",
    "  // Keep the former custom domain as a temporary migration alias while DNS propagates.\n  const origins = new Set([PRODUCTION_ORIGIN, LEGACY_PRODUCTION_ORIGIN]);"
  ],
]);

edit("tests/pvp-server.test.mjs", [
  [
    '  assert.equal(isOriginAllowed("https://wormhole.murphtournaments.com", origins, prod), true);',
    '  assert.equal(isOriginAllowed("https://breachrunner.murphtournaments.com", origins, prod), true);\n  assert.equal(isOriginAllowed("https://wormhole.murphtournaments.com", origins, prod), true,\n    "legacy custom domain stays accepted during the cutover");'
  ],
]);

edit("tests/pvp-socket.test.mjs", [
  [
    'const client = connect(harness.url, { origin: "https://wormhole.murphtournaments.com" });',
    'const client = connect(harness.url, { origin: "https://breachrunner.murphtournaments.com" });'
  ],
]);

edit("COMMERCIALIZATION.md", [
  [
    "The current web hostname, repository name, and internal **Project Rift** development label also remain unchanged during Phase 1. Store packaging and final domains belong to later release phases.",
    "The repository and Railway project have now been renamed **Breach Runner Arcade**, and the canonical web hostname is `breachrunner.murphtournaments.com`. The internal **Project Rift** development label and compatibility ids remain available where they protect saves, networking, or score data."
  ],
]);

console.log("Applied Breach Runner production-domain cutover.");

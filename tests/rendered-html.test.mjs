import assert from "node:assert/strict";
import test from "node:test";

const title = /<title>Breach Runner<\/title>/i;
const description = /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["']Weaponize the rift\.["'])[^>]*>/i;
const ogTitle = /<meta(?=[^>]*\bproperty=["']og:title["'])(?=[^>]*\bcontent=["']Breach Runner["'])[^>]*>/i;
const ogTagline = /<meta(?=[^>]*\bproperty=["']og:description["'])(?=[^>]*\bcontent=["']Weaponize the rift\.["'])[^>]*>/i;
const favicon = /<link(?=[^>]*\brel=["']icon["'])(?=[^>]*\bhref=["'][^"']*\/favicon\.ico["'])[^>]*>/i;
const productionUrl = "https://breachrunner.murphtournaments.com";

test("renders Breach Runner commercial metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );

  const html = await response.text();
  assert.match(html, title);
  assert.match(html, description);
  assert.match(html, ogTitle);
  assert.match(html, ogTagline);
  for (const metadata of [
    ["property", "og:url", productionUrl],
    ["property", "og:type", "website"],
    ["property", "og:image", `${productionUrl}/og.png`],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", "Breach Runner — Weaponize the Rift"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", "Breach Runner"],
    ["name", "twitter:description", "Weaponize the rift."],
    ["name", "twitter:image", `${productionUrl}/og.png`],
  ]) {
    const [attribute, key, value] = metadata;
    assert.match(
      html,
      new RegExp(`<meta(?=[^>]*\\b${attribute}=["']${key}["'])(?=[^>]*\\bcontent=["']${value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}["'])[^>]*>`, "i"),
    );
  }
  assert.match(html, new RegExp(`<link(?=[^>]*\\brel=["']canonical["'])(?=[^>]*\\bhref=["']${productionUrl}/["'])[^>]*>`, "i"));
  assert.match(html, favicon);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /wormhole-arcade\.pmurphinc\.chatgpt\.site/i);
});

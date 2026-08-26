import assert from "node:assert/strict";
import test from "node:test";

const title = /<title>Breach Runner<\/title>/i;
const description = /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["'][^"']*volatile rift[^"']*["'])[^>]*>/i;
const ogTitle = /<meta(?=[^>]*\bproperty=["']og:title["'])(?=[^>]*\bcontent=["']Breach Runner["'])[^>]*>/i;
const ogTagline = /<meta(?=[^>]*\bproperty=["']og:description["'])(?=[^>]*\bcontent=["']Weaponize the rift\.["'])[^>]*>/i;
const favicon = /<link(?=[^>]*\brel=["']icon["'])(?=[^>]*\bhref=["'][^"']*\/favicon\.ico["'])[^>]*>/i;

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
  assert.match(html, favicon);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /og\.png/i);
});

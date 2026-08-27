import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_URL,
  SOCIAL_IMAGE_CACHE_BUSTER,
  SOCIAL_IMAGE_URL,
  UNVERSIONED_SOCIAL_IMAGE,
  escapeRegExp,
} from "./social-metadata.mjs";

const title = /<title>Breach Runner<\/title>/i;
const description = /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["']Weaponize the rift\.["'])[^>]*>/i;
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
  for (const metadata of [
    ["property", "og:url", PRODUCTION_URL],
    ["property", "og:type", "website"],
    ["property", "og:image", SOCIAL_IMAGE_URL],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", "Breach Runner — Weaponize the Rift"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", "Breach Runner"],
    ["name", "twitter:description", "Weaponize the rift."],
    ["name", "twitter:image", SOCIAL_IMAGE_URL],
  ]) {
    const [attribute, key, value] = metadata;
    assert.match(
      html,
      new RegExp(`<meta(?=[^>]*\\b${attribute}=["']${key}["'])(?=[^>]*\\bcontent=["']${escapeRegExp(value)}["'])[^>]*>`, "i"),
    );
  }
  assert.match(html, new RegExp(`<link(?=[^>]*\\brel=["']canonical["'])(?=[^>]*\\bhref=["']${escapeRegExp(`${PRODUCTION_URL}/`)}["'])[^>]*>`, "i"));
  assert.match(html, favicon);

  // Every rendered social-image URL keeps the cache-busting suffix: a revert to
  // the bare /og.png would leave crawlers serving their stale cached preview.
  assert.match(html, new RegExp(escapeRegExp(SOCIAL_IMAGE_CACHE_BUSTER)));
  assert.doesNotMatch(html, UNVERSIONED_SOCIAL_IMAGE);

  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /wormhole/i);
  assert.doesNotMatch(html, /chatgpt\.site/i);
});

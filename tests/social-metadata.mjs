// Canonical social-preview expectations, shared by the metadata tests.
//
// The social image URL is deliberately versioned. Crawlers (Facebook, X,
// Slack, iMessage) cache a preview per image URL, so the `?v=` suffix is
// what actually forces them to re-fetch after the artwork is re-cut. It is
// cache busting, not an accident: do not drop the suffix to make an
// assertion pass. When the preview art is replaced, bump the version in
// app/layout.tsx and here together.
export const PRODUCTION_URL = "https://breachrunner.murphtournaments.com";
export const SOCIAL_IMAGE_CACHE_BUSTER = "?v=breach-runner-1";
export const SOCIAL_IMAGE_PATH = `/og.png${SOCIAL_IMAGE_CACHE_BUSTER}`;
export const SOCIAL_IMAGE_URL = `${PRODUCTION_URL}${SOCIAL_IMAGE_PATH}`;

// Any `/og.png` reference that is not immediately followed by the cache
// buster, i.e. a reversion to the stale unversioned path.
export const UNVERSIONED_SOCIAL_IMAGE = /\/og\.png(?!\?v=)/;

export const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

# Commercialization Plan

## Phase 1 — Original commercial identity

Goal: establish **Breach Runner** as the commercial game identity while separating the product from legacy Wormhole/Redux presentation without destabilizing gameplay, saves, matchmaking, or score data. The internal development project remains **Project Rift**.

### Completed in this branch

- Selected **Breach Runner** as the commercial game title and **Weaponize the rift.** as the tagline.
- Removed the public metadata language describing the product as a Centerfleet recreation.
- Centralized the commercial title, tagline, and description in `app/product.ts`.
- Replaced the player-facing eight-ship fleet names and ability names with an original identity while preserving internal compatibility ids.
- Replaced the player-facing pickup/weapon catalog with original names and copy while preserving internal compatibility ids.
- Replaced all four undocumented WAV files with newly generated original audio.
- Added `ASSET_PROVENANCE.md` so commercial-use evidence is recorded going forward.
- Kept gameplay balance values unchanged during the identity pass so IP cleanup and balance tuning remain reviewable as separate concerns.

### Intentionally retained for compatibility

Internal implementation ids such as `tank`, `wing`, `squid`, `rabbit`, `turtle`, `flash`, `hunter`, `flagship`, `heatseeker`, `scarab`, and similar values may remain in code, saved settings, tests, and multiplayer payloads. They are not intended as player-facing branding. Renaming those ids would create migration risk without materially improving the commercial presentation.

The current web hostname, repository name, and internal **Project Rift** development label also remain unchanged during Phase 1. Store packaging and final domains belong to later release phases.

### Remaining before a commercial store submission

- Replace remaining visible `WORMHOLE ARCADE` branding in the live game UI with **BREACH RUNNER** and the final brand mark.
- Review all remaining player-facing combat/death labels for legacy terminology and convert them to the new weapon names where needed.
- Review/redesign all eight ship silhouettes so the commercial fleet has a deliberately original visual language.
- Replace or independently clear `public/og.png` and the favicon before using them in store or advertising material.
- Perform an independent balance pass and document the design rationale rather than describing any values as preserved from a legacy client.
- Create final logo, icon, key art, screenshots, and trailer assets from cleared material only.
- Perform a final third-party dependency/license review and generate release notices.
- Perform a final trademark/store-name check immediately before paid store registration and artwork production.

## Phase 2 and later

Packaging for Google Play and Steam is intentionally deferred until the game and menus are polished. The planned later phases are shared store client, installed-client networking, Android packaging, Steam desktop packaging, controller support, store compliance, store assets, release testing, and launch.

# Asset Provenance

This file tracks the origin and commercial-use status of assets shipped with the game. It exists so future Android, Steam, web, trailer, and store-art releases can be reviewed without relying on memory.

## Phase 1 commercial cleanup — 2026-08-24

### Audio

The four file-based gameplay effects below were replaced during the commercial IP cleanup because the provenance of the previous WAV files was not documented.

| Path | Status | Provenance |
| --- | --- | --- |
| `public/sounds/fire.wav` | Cleared | Newly generated original waveform created specifically for this project during Phase 1. No source recording or legacy game sample used. |
| `public/sounds/explosion.wav` | Cleared | Newly generated original waveform created specifically for this project during Phase 1. No source recording or legacy game sample used. |
| `public/sounds/magic.wav` | Cleared | Newly generated original waveform created specifically for this project during Phase 1. No source recording or legacy game sample used. |
| `public/sounds/thrust.wav` | Cleared | Newly generated original waveform created specifically for this project during Phase 1. No source recording or legacy game sample used. |

The newer shield, power-up, rift-collapse, and victory-riser cues are synthesized at runtime with the Web Audio API from code in this repository and do not depend on external audio files.

### Gameplay art

Ships, weapons, projectiles, rift effects, particles, HUD elements, and most gameplay visuals are rendered procedurally by application code. No external sprite sheet is required for those systems.

The current ship silhouettes are polygon definitions stored in `app/weapon-art.ts`, and the weapon/pickup silhouettes are likewise repository code. Phase 1 treats them as code-owned prototype artwork, not imported commercial art. They should still receive a deliberate art-direction review before store screenshots, trailers, or final commercial launch artwork are produced.

Phase 1 changes the player-facing fleet and weapon identity while retaining existing internal compatibility keys. Internal keys such as `tank`, `wing`, `heatseeker`, or `scarab` are implementation identifiers and are not intended as product branding.

### Brand and marketing art

| Path | Status | Provenance / restriction |
| --- | --- | --- |
| `public/branding/breach_runner_logo.png` | Cleared for current project use | AI-generated original Breach Runner wordmark created specifically for this project at the owner's direction on 2026-08-25. No source image or existing franchise reference was used. |
| `public/branding/breach_runner_logo.webp` | Cleared for current project use | Web-optimized derivative of the cleared Breach Runner wordmark above. |
| `public/branding/breach_runner_favicon.png` | Cleared for current project use | AI-generated original rift-and-spacecraft brand mark created specifically for this project at the owner's direction on 2026-08-25. No source image or existing franchise reference was used. |
| `public/favicon.ico` | Cleared for current project use | Multi-size browser-icon derivative of the cleared favicon master above. |
| `public/favicon.png` | Cleared for current project use | 64px browser-icon derivative of the cleared favicon master above. |
| `public/apple-touch-icon.png` | Cleared for current project use | 180px touch-icon derivative of the cleared favicon master above. |
| `public/og.png` | Dormant / not cleared | Predates the commercial cleanup. Phase 1 removes it from active Open Graph and Twitter metadata. Do not reuse it for stores, trailers, advertisements, or other commercial launch material. |

New commercial key art, store icons, screenshots, capsule art, and trailer assets should be created from cleared material before store submission.

## Rules for new assets

For every new non-code asset added for release, record:

1. file path;
2. creator/source;
3. date added;
4. license or ownership basis;
5. whether commercial redistribution and promotional use are permitted;
6. any attribution requirement.

Do not add an asset to a commercial build if its source or license cannot be documented.

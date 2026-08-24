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

The newer shield, power-up, portal-collapse, and victory-riser cues are synthesized at runtime with the Web Audio API from code in this repository and do not depend on external audio files.

### Gameplay art

Ships, weapons, projectiles, portal effects, particles, HUD elements, and most gameplay visuals are rendered procedurally by application code. No external sprite sheet is required for those systems.

Phase 1 changes the player-facing fleet and weapon identity while retaining existing internal compatibility keys. Internal keys such as `tank`, `wing`, `heatseeker`, or `scarab` are implementation identifiers and are not intended as product branding.

### Marketing art

`public/og.png` predates the commercial cleanup and must not be reused for Google Play, Steam, trailers, advertisements, or other commercial launch material until its provenance and visual content have been reviewed. New commercial key art should be created before store submission.

`public/favicon.svg` should likewise be reviewed or replaced when the final commercial title and visual identity are selected.

## Rules for new assets

For every new non-code asset added for release, record:

1. file path;
2. creator/source;
3. date added;
4. license or ownership basis;
5. whether commercial redistribution and promotional use are permitted;
6. any attribution requirement.

Do not add an asset to a commercial build if its source or license cannot be documented.

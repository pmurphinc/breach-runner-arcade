# Wormhole Arcade

A modern browser recreation of the classic **Wormhole** arcade game, built from gameplay references and the original downloadable client.

## Play

The current playable build is available at:

https://wormhole-arcade.pmurphinc.chatgpt.site

## Controls

| Action | Keyboard |
| --- | --- |
| Turn | Arrow keys or `A` / `D` |
| Thrust | Up arrow or `W` |
| Fire | Space |
| Use power-up | `F` |
| Special weapon | `R` |
| Pause | `P` |

Touch controls use point-to-fly steering: press the thumbstick to thrust, aim it in any direction to set the ship's heading, and release to coast. Fullscreen play, high-density canvas rendering, safe-area support, and dedicated layouts for phone and foldable displays are included. Installable PWA mode is planned.

## Run locally

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm ci
npm run dev
```

Then open the local URL printed by the development server.

## Useful commands

```bash
npm run dev
npm run lint
npm test
npm run build
```

## Project direction

- Refine desktop combat, progression, ships, weapons, and power-ups
- Refine device-specific touch control placement from player feedback
- Add install-to-home-screen support
- Integrate the game into Murph Tournaments as a native `/wormhole` route
- Preserve the standalone build so it can also be deployed independently

## Technology

- React 19
- Next.js-compatible routing through Vinext
- TypeScript
- HTML Canvas
- Cloudflare-compatible deployment

## Attribution

This is a fan-made preservation and modernization project inspired by the original Centerfleet/Centerscore **Wormhole**. Original game names, sounds, and other legacy materials remain the property of their respective owners.

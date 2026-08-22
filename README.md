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
| Pulse cannon | Space |
| Fire collected power-up | `E` |
| Ship special | `Q` |
| Pause | `P` |

Touch controls use a twin-stick layout: the left stick moves the ship while the right stick independently aims and fires the pulse cannon. The **PUP** button is the touch equivalent of `E`, and **SPEC** is the touch equivalent of `Q`. Fullscreen play, high-density canvas rendering, safe-area support, and dedicated layouts for desktop, ultrawide, tablet, phone, and foldable displays are included. Installable PWA mode is planned.

## Loop

1. Shoot the rival wormhole with the pulse cannon. Damage fills its charge ring.
2. At 150 damage the wormhole generates a power-up.
3. Fly over the power-up to collect it into the bin (five slots, last in first out).
4. Aim at the wormhole and press `E` (touch: **PUP**) to send an attack power-up back through it.

## Weapons

Every power-up has its own canvas silhouette, projectile, and spawn animation, and each one is identifiable without colour. Hover or focus an inventory slot on desktop — or tap it on a touch screen — to open its information card, or open the **Weapon Codex** from the top bar to read about all of them before you fly.

## Rendering quality

The top bar cycles between **Auto**, **High**, and **Performance**. Auto starts from device pixel ratio, touch capability, and viewport size, then adapts to measured frame cost, capping canvas resolution and particle counts on lower-powered tablets and phones.

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

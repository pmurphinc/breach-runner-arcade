# Launch Deck responsive architecture

## Root cause

The old Launch Deck did not have one height owner. The screen reserved a
system-control lane, the panel bounded itself with `max-height`, the shared
content row was a scrollport, Home then disabled that scrollport with
`overflow: hidden`, and the stage forced `height: 100%`. Meanwhile the mission
panel retained intrinsic minimums and several height-breakpoint overrides.
When header, branding, mission, and utility heights exceeded the content row,
the footer still received its intrinsic height and the mission's bottom was
painted outside an overflow-clipped row. Removing the scrollbar therefore
turned overlap into invisible content; it did not make the composition fit.

## Ownership model

Home now has a single safe-area-adjusted `100dvh` owner. Its panel is a grid of
`header / minmax(0, 1fr) / utility`. The middle row is not a scroll container.
Inside it, the stage allocates `minmax(0, 1fr) / auto` to decorative branding
and the content-sized mission console. This guarantees that the mission,
including Play, participates in the same calculation as the utility footer.

The density variables are `--launch-edge`, `--launch-section-gap`,
`--launch-panel-padding`, `--launch-control-height`, `--launch-logo-size`,
`--launch-heading-size`, `--launch-body-size`, and `--launch-header-height`.
They use both dynamic viewport axes and container width, continuously yielding
decorative space before interactive target size.

When the panel is shorter than the intrinsic stacked composition, a block-size
container query uses available width: branding becomes one shallow row and the
mission console gives Play its own column spanning the briefing. This is a
content constraint, not a device-resolution patch. Text and controls remain in
the DOM and no description is hidden or line-clamped.

## Regression strategy

`scripts/menu-responsive-fuzz.mjs` drives a real Chromium browser through a
representative grid and a continuous diagonal resize sweep. It checks document
and Launch Deck overflow, viewport and ancestor clipping, pointer hit testing,
and pairwise exclusive-region intersections. A failed geometry check writes a
dimension-named PNG under `test-results/menu-responsive/`.

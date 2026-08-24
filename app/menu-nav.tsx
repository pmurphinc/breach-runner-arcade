"use client";

import type { MenuRoute } from "./menu-routes";

/**
 * The secondary navigation block.
 *
 * A grid of equal-weight destinations that reflows on its own with
 * `auto-fit`/`minmax` — one column on a narrow phone, two or four when there
 * is room — without a single breakpoint. Kept apart from the Play panel so the
 * hierarchy stays obvious: one primary action, then these.
 */
export function MenuSectionNav({
  items,
  onSelect,
}: {
  items: readonly { route: MenuRoute; label: string; hint: string }[];
  onSelect: (route: MenuRoute) => void;
}) {
  return (
    <nav className="menu-nav" aria-label="Menu sections">
      {items.map((item) => (
        <button key={item.route} type="button" onClick={() => onSelect(item.route)}>
          <b>{item.label}</b>
          <small>{item.hint}</small>
        </button>
      ))}
    </nav>
  );
}

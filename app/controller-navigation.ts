/** Shared controller navigation for every visible menu/dialog surface. */
export const CONTROLLER_FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export type ControllerCancelContext = {
  codex: boolean;
  summary: boolean;
  route: string | null;
};

export function controllerCancelTarget({ codex, summary, route }: ControllerCancelContext) {
  if (codex) return "close-codex" as const;
  if (summary) return "hold-summary" as const;
  if (route === "pause" || route === "home") return "resume" as const;
  if (route) return "back" as const;
  return "none" as const;
}

export function visibleControllerControls(root: ParentNode = document): HTMLElement[] {
  const surfaces = root.querySelectorAll<HTMLElement>("[data-controller-surface]");
  const controls = new Set<HTMLElement>();
  surfaces.forEach((surface) => {
    if (surface.offsetParent === null) return;
    surface.querySelectorAll<HTMLElement>(CONTROLLER_FOCUSABLE).forEach((control) => {
      if (control.offsetParent !== null && control.tabIndex >= 0) controls.add(control);
    });
  });
  return [...controls];
}

/**
 * Vertical input moves through the surface. Horizontal input changes a
 * focused select, matching native menu semantics while keeping a way out.
 */
export function moveControllerFocus(controls: readonly HTMLElement[], horizontal: number, vertical: number) {
  const active = document.activeElement as HTMLElement | null;
  if (active instanceof HTMLSelectElement && horizontal) {
    const enabled = [...active.options].filter((option) => !option.disabled);
    const current = enabled.indexOf(active.selectedOptions[0]);
    const option = enabled[(Math.max(0, current) + Math.sign(horizontal) + enabled.length) % enabled.length];
    if (option) {
      active.value = option.value;
      active.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return active;
  }
  const direction = vertical || horizontal;
  if (!direction || controls.length === 0) return active;
  const current = controls.indexOf(active as HTMLElement);
  const index = current < 0
    ? direction > 0 ? 0 : controls.length - 1
    : (current + Math.sign(direction) + controls.length) % controls.length;
  const next = controls[index];
  next?.focus();
  return next;
}

/** Shared controller navigation for every visible menu/dialog surface. */
export const CONTROLLER_FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
export const CONTROLLER_FOCUS_ATTRIBUTE = "data-controller-focused";

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
      if (isControllerControlVisible(control)) controls.add(control);
    });
  });
  return [...controls];
}

/** Keep visibility/disabled filtering in the shared model, not in individual menus. */
export function isControllerControlVisible(control: HTMLElement) {
  return control.offsetParent !== null
    && control.tabIndex >= 0
    && !control.matches(":disabled, [aria-disabled=\"true\"], [hidden]")
    && !control.closest('[aria-hidden="true"], [inert]');
}

export function clearControllerFocus(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(`[${CONTROLLER_FOCUS_ATTRIBUTE}]`).forEach((control) => {
    control.removeAttribute(CONTROLLER_FOCUS_ATTRIBUTE);
  });
}

export function showControllerFocus(control: HTMLElement | null, root: ParentNode = document) {
  clearControllerFocus(root);
  control?.setAttribute(CONTROLLER_FOCUS_ATTRIBUTE, "true");
}

/**
 * Vertical input moves through the surface. Horizontal input changes a
 * focused select, matching native menu semantics while keeping a way out.
 */
export function moveControllerFocus(controls: readonly HTMLElement[], horizontal: number, vertical: number) {
  const active = document.activeElement as HTMLElement | null;
  // Settings tabs use the same horizontal navigation path as every menu. The
  // active panel is changed immediately so hidden panels never enter the
  // controller's visible-controls collection.
  const tabList = horizontal && active?.getAttribute("role") === "tab"
    ? active.closest<HTMLElement>('[role="tablist"]')
    : null;
  if (tabList) {
    const tabs = [...tabList.querySelectorAll<HTMLElement>('[role="tab"]')]
      .filter((tab) => tab.offsetParent !== null && !tab.matches(':disabled, [aria-disabled="true"], [hidden]'));
    const current = tabs.indexOf(active);
    const next = tabs[(Math.max(0, current) + Math.sign(horizontal) + tabs.length) % tabs.length];
    next?.focus();
    next?.click();
    showControllerFocus(next);
    return next;
  }
  if (active instanceof HTMLSelectElement && horizontal) {
    const enabled = [...active.options].filter((option) => !option.disabled);
    const current = enabled.indexOf(active.selectedOptions[0]);
    const option = enabled[(Math.max(0, current) + Math.sign(horizontal) + enabled.length) % enabled.length];
    if (option) {
      active.value = option.value;
      active.dispatchEvent(new Event("change", { bubbles: true }));
    }
    showControllerFocus(active);
    return active;
  }
  // Roving radio groups (mode and difficulty rows) expose one tab stop, but
  // left/right still needs to traverse every logical choice in the row. Do
  // not click here: controller activation is reserved for Confirm, just like
  // mouse/touch activation remains reserved for an intentional press.
  const radioGroup = horizontal && active?.getAttribute("role") === "radio"
    ? active.closest<HTMLElement>('[role="radiogroup"]')
    : null;
  if (radioGroup) {
    const radios = [...radioGroup.querySelectorAll<HTMLElement>('[role="radio"]')]
      .filter((radio) => radio.offsetParent !== null && !radio.matches(':disabled, [aria-disabled="true"], [hidden]'));
    const current = radios.indexOf(active);
    const next = radios[(Math.max(0, current) + Math.sign(horizontal) + radios.length) % radios.length];
    next?.focus();
    showControllerFocus(next);
    return next;
  }
  const direction = vertical || horizontal;
  if (!direction || controls.length === 0) return active;
  const current = controls.indexOf(active as HTMLElement);
  const index = current < 0
    ? direction > 0 ? 0 : controls.length - 1
    : (current + Math.sign(direction) + controls.length) % controls.length;
  const next = controls[index];
  next?.focus();
  showControllerFocus(next ?? null);
  return next;
}

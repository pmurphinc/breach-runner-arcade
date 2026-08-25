export type ViewMode = "touch" | "pc" | "hybrid";
export type TouchControlSize = "small" | "medium" | "large";
/** How loud the effects bus plays. Music is not implemented, so it is absent. */
export type SoundLevel = "low" | "medium" | "high";
export type ZoomLevel = "wide" | "standard" | "close" | "closer";
export type CombatHaptics = "off" | "gun" | "hull" | "both";

export type DeviceSettings = {
  version: 1;
  /**
   * The player's explicit override, or null for "work it out".
   *
   * Null used to mean "block the whole game behind a Choose Your View screen
   * before anything renders". It now means the game infers the view from the
   * device's actual pointer capabilities, which is a thing the browser can
   * answer accurately and the player should never have to. The override stays
   * available in Settings for the cases inference gets wrong — a tablet with a
   * keyboard case, a touchscreen laptop.
   */
  viewMode: ViewMode | null;
  cameraLock: boolean;
  /** Follow-ship camera magnification. Full Arena always fits the whole world. */
  zoom: ZoomLevel;
  sound: boolean;
  soundLevel: SoundLevel;
  /** Combat-only vibration. Control-press and victory haptics remain separate. */
  combatHaptics: CombatHaptics;
  cannonHitSound: boolean;
  thumbsticks: boolean;
  touchControlSize: TouchControlSize;
  /** Duplicate PUP, SPEC, and Pause around the movement stick for either-hand access. */
  mirrorTouchActions: boolean;
  /** Three-character arcade identity remembered on this device. */
  playerInitials: string;
};

export const SETTINGS_KEY = "wormhole-arcade:settings:v1";
export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: DeviceSettings = {
  version: SETTINGS_VERSION,
  viewMode: null,
  cameraLock: true,
  zoom: "standard",
  sound: true,
  soundLevel: "medium",
  combatHaptics: "both",
  cannonHitSound: true,
  thumbsticks: true,
  touchControlSize: "medium",
  mirrorTouchActions: false,
  playerInitials: "",
};

export const VIEW_PROFILES = {
  touch: { mouseKeyboardPrimary: false, touch: true, thumbsticks: true, compactPowerups: true, fullInventory: false, verticalRails: true, pcHud: false, canvasQueue: false },
  pc: { mouseKeyboardPrimary: true, touch: false, thumbsticks: false, compactPowerups: false, fullInventory: true, verticalRails: false, pcHud: true, canvasQueue: true },
  hybrid: { mouseKeyboardPrimary: true, touch: true, thumbsticks: true, compactPowerups: true, fullInventory: false, verticalRails: true, pcHud: false, canvasQueue: false },
} as const satisfies Record<ViewMode, Record<string, boolean>>;

const isViewMode = (value: unknown): value is ViewMode => value === "touch" || value === "pc" || value === "hybrid";
const isSize = (value: unknown): value is TouchControlSize => value === "small" || value === "medium" || value === "large";
const isLevel = (value: unknown): value is SoundLevel => value === "low" || value === "medium" || value === "high";
const isZoom = (value: unknown): value is ZoomLevel => value === "wide" || value === "standard" || value === "close" || value === "closer";
const isCombatHaptics = (value: unknown): value is CombatHaptics => value === "off" || value === "gun" || value === "hull" || value === "both";
const normalizePlayerInitials = (value: unknown) => {
  if (typeof value !== "string") return "";
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  return normalized.length === 3 ? normalized : "";
};

export function migrateSettings(value: unknown): DeviceSettings {
  if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
  const candidate = value as Partial<DeviceSettings>;
  return {
    version: SETTINGS_VERSION,
    viewMode: isViewMode(candidate.viewMode) ? candidate.viewMode : null,
    cameraLock: typeof candidate.cameraLock === "boolean" ? candidate.cameraLock : true,
    zoom: isZoom(candidate.zoom) ? candidate.zoom : "standard",
    sound: typeof candidate.sound === "boolean" ? candidate.sound : true,
    soundLevel: isLevel(candidate.soundLevel) ? candidate.soundLevel : "medium",
    combatHaptics: isCombatHaptics(candidate.combatHaptics) ? candidate.combatHaptics : "both",
    cannonHitSound: typeof candidate.cannonHitSound === "boolean" ? candidate.cannonHitSound : true,
    thumbsticks: typeof candidate.thumbsticks === "boolean" ? candidate.thumbsticks : true,
    touchControlSize: isSize(candidate.touchControlSize) ? candidate.touchControlSize : "medium",
    mirrorTouchActions: typeof candidate.mirrorTouchActions === "boolean" ? candidate.mirrorTouchActions : false,
    playerInitials: normalizePlayerInitials(candidate.playerInitials),
  };
}

let cached: DeviceSettings | null = null;
const listeners = new Set<() => void>();

function read(): DeviceSettings {
  if (cached) return cached;
  try { cached = migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null")); }
  catch { cached = DEFAULT_SETTINGS; }
  return cached;
}

export const settingsStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot: read,
  getServerSnapshot: () => DEFAULT_SETTINGS,
  update(patch: Partial<Omit<DeviceSettings, "version">>) {
    cached = { ...read(), ...patch, version: SETTINGS_VERSION };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cached)); } catch { /* storage may be unavailable */ }
    listeners.forEach((listener) => listener());
  },
};

/** Relative gain applied to every effect, so the level means something real. */
export const ZOOM_SCALE: Record<ZoomLevel, number> = {
  wide: 0.85,
  standard: 1,
  close: 1.15,
  closer: 1.3,
};

export const SOUND_GAIN: Record<SoundLevel, number> = {
  low: 0.45,
  medium: 1,
  high: 1.6,
};

/**
 * What the device can actually do, as reported by the browser.
 *
 * Deliberately capability-based rather than device-based: no user-agent
 * sniffing, no model lists. A device either has a coarse pointer or it does
 * not, and that is the only question that changes how the game should be
 * driven.
 */
export type InputCapability = { touch: boolean; mouse: boolean };

export function readInputCapability(): InputCapability {
  if (typeof window === "undefined") return { touch: false, mouse: true };
  const query = (value: string) => {
    try {
      return window.matchMedia(value).matches;
    } catch {
      return false;
    }
  };
  const touch =
    navigator.maxTouchPoints > 0 || query("(pointer: coarse)") || query("(any-pointer: coarse)");
  // `any-pointer: fine` catches a tablet with a trackpad case, which wants the
  // hybrid treatment rather than the touch one.
  const mouse = query("(pointer: fine)") || query("(any-pointer: fine)");
  return { touch, mouse: mouse || !touch };
}

/** Both kinds of pointer means both kinds of control stay live. */
export function inferViewMode(capability: InputCapability): ViewMode {
  if (capability.touch && capability.mouse) return "hybrid";
  return capability.touch ? "touch" : "pc";
}

/**
 * The view actually in force: the player's override when they set one, and
 * the inferred answer otherwise. Nothing blocks on this — there is always an
 * answer, so the game can render on the first frame.
 */
export function resolveViewMode(stored: ViewMode | null, capability: InputCapability): ViewMode {
  return stored ?? inferViewMode(capability);
}

/**
 * Input capability as a subscribable store.
 *
 * Reading this in an effect and calling setState would be a cascading render,
 * and would also miss the interesting case: pointer capability is not fixed
 * for the life of a page. Plugging a mouse into a tablet, or detaching a
 * keyboard case, flips it. Subscribing means the layout follows.
 *
 * The snapshot is cached so repeated reads are referentially stable, which is
 * what `useSyncExternalStore` requires.
 */
const CAPABILITY_QUERIES = ["(pointer: coarse)", "(any-pointer: coarse)", "(pointer: fine)", "(any-pointer: fine)"];
const SERVER_CAPABILITY: InputCapability = { touch: false, mouse: true };

let capabilityCache: InputCapability | null = null;

export const capabilityStore = {
  subscribe(listener: () => void) {
    if (typeof window === "undefined") return () => {};
    const invalidate = () => {
      capabilityCache = null;
      listener();
    };
    const lists = CAPABILITY_QUERIES.map((query) => window.matchMedia(query));
    lists.forEach((list) => list.addEventListener?.("change", invalidate));
    return () => lists.forEach((list) => list.removeEventListener?.("change", invalidate));
  },
  getSnapshot(): InputCapability {
    if (!capabilityCache) capabilityCache = readInputCapability();
    return capabilityCache;
  },
  getServerSnapshot: (): InputCapability => SERVER_CAPABILITY,
};

export type ViewMode = "touch" | "pc" | "hybrid";
export type TouchControlSize = "small" | "medium" | "large";

export type DeviceSettings = {
  version: 1;
  viewMode: ViewMode | null;
  cameraLock: boolean;
  sound: boolean;
  thumbsticks: boolean;
  touchControlSize: TouchControlSize;
};

export const SETTINGS_KEY = "wormhole-arcade:settings:v1";
export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: DeviceSettings = {
  version: SETTINGS_VERSION,
  viewMode: null,
  cameraLock: true,
  sound: true,
  thumbsticks: true,
  touchControlSize: "medium",
};

export const VIEW_PROFILES = {
  touch: { mouseKeyboardPrimary: false, touch: true, thumbsticks: true, compactPowerups: true, fullInventory: false, verticalRails: true, pcHud: false, canvasQueue: false },
  pc: { mouseKeyboardPrimary: true, touch: false, thumbsticks: false, compactPowerups: false, fullInventory: true, verticalRails: false, pcHud: true, canvasQueue: true },
  hybrid: { mouseKeyboardPrimary: true, touch: true, thumbsticks: true, compactPowerups: true, fullInventory: false, verticalRails: true, pcHud: false, canvasQueue: false },
} as const satisfies Record<ViewMode, Record<string, boolean>>;

const isViewMode = (value: unknown): value is ViewMode => value === "touch" || value === "pc" || value === "hybrid";
const isSize = (value: unknown): value is TouchControlSize => value === "small" || value === "medium" || value === "large";

export function migrateSettings(value: unknown): DeviceSettings {
  if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
  const candidate = value as Partial<DeviceSettings>;
  return {
    version: SETTINGS_VERSION,
    viewMode: isViewMode(candidate.viewMode) ? candidate.viewMode : null,
    cameraLock: typeof candidate.cameraLock === "boolean" ? candidate.cameraLock : true,
    sound: typeof candidate.sound === "boolean" ? candidate.sound : true,
    thumbsticks: typeof candidate.thumbsticks === "boolean" ? candidate.thumbsticks : true,
    touchControlSize: isSize(candidate.touchControlSize) ? candidate.touchControlSize : "medium",
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

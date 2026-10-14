// The user's settings (manifest settingsSchema), with defaults and limits
// applied, so a hand-edited or missing value can't break anything.

export const DEFAULTS = Object.freeze({
  widgetDays: 30,
  notify: true,
  daysBefore: 3,
  addToCalendar: false,
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function readSettings(settings = {}) {
  return {
    widgetDays: clampInt(settings.widgetDays, 1, 365, DEFAULTS.widgetDays),
    notify: settings.notify === undefined ? DEFAULTS.notify : settings.notify !== false,
    daysBefore: clampInt(settings.daysBefore, 0, 30, DEFAULTS.daysBefore),
    addToCalendar: settings.addToCalendar === true,
  };
}

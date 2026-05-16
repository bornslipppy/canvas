/**
 * Deterministic hue from a frame id, so each frame gets a stable, distinct
 * color across reloads. Used to color comment pins and frame badges so it's
 * always clear which frame a comment belongs to.
 *
 * Goal: comments on different frames look obviously different at a glance.
 */
export function frameHue(frameId) {
  // Cheap stable hash (djb2-ish)
  let h = 5381
  for (let i = 0; i < frameId.length; i++) {
    h = ((h << 5) + h) ^ frameId.charCodeAt(i)
    h |= 0  // force 32-bit
  }
  // Map to 0..359; offset so we don't always start at red
  const hue = ((h % 360) + 360 + 47) % 360
  return hue
}

/** CSS color for a pin's fill. Saturated, dark enough to read white text on. */
export function framePinColor(frameId) {
  return `hsl(${frameHue(frameId)} 70% 45%)`
}

/** Softer color for the badge background. */
export function frameBadgeColor(frameId) {
  return `hsl(${frameHue(frameId)} 70% 92%)`
}

/** Strong color for the badge text. */
export function frameBadgeTextColor(frameId) {
  return `hsl(${frameHue(frameId)} 70% 30%)`
}

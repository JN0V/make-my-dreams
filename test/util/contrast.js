// test/util/contrast.js — WCAG 2.2 relative-luminance + contrast ratio.
// ~30 lines, no external dependency. Used by AC-2c unit test.
// References:
//   https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
//   https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio

/**
 * Parse a CSS color (3 or 6 hex digits) into {r, g, b} 0-255.
 * Throws on unknown formats — intentional: tests should only feed known colors.
 */
export function parseColor(css) {
  const v = css.trim().toLowerCase();
  if (v === 'white') return { r: 255, g: 255, b: 255 };
  if (v === 'black') return { r: 0, g: 0, b: 0 };
  const m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) throw new Error(`unsupported color: ${css}`);
  const hex = m[1];
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** sRGB component → linear (WCAG formula). */
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb) {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(fg, bg) {
  const L1 = relativeLuminance(parseColor(fg));
  const L2 = relativeLuminance(parseColor(bg));
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

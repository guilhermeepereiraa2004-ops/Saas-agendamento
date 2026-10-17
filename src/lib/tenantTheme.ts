type RgbColor = [number, number, number];

export function parseHexColor(value: string): RgbColor | null {
  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized;
  if (!/^[\da-f]{6}$/i.test(expanded)) return null;
  return [0, 2, 4].map(offset => parseInt(expanded.slice(offset, offset + 2), 16)) as RgbColor;
}

function luminance(rgb: RgbColor) {
  const [r, g, b] = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: RgbColor, second: RgbColor) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function getReadableAccentText(background: string, preferred: string) {
  const rgb = parseHexColor(background) || [17, 19, 24];
  const preferredRgb = parseHexColor(preferred);
  if (preferredRgb && contrastRatio(rgb, preferredRgb) >= 4.5) return preferred;
  return contrastRatio(rgb, [255, 255, 255]) >= contrastRatio(rgb, [17, 19, 24]) ? '#ffffff' : '#111318';
}

export function hexToRgbString(value: string) {
  return (parseHexColor(value) || [114, 87, 217]).join(', ');
}

/** Keep the chosen hue, with calmer saturation and readable light-surface accents. */
export function getTenantTheme(primary?: string, secondary?: string) {
  const source = parseHexColor(primary || '') || [114, 87, 217];
  const brand = `#${source.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  const midpoint = (Math.max(...source) + Math.min(...source)) / 2;
  const softened = source.map(channel => Math.round(channel * 0.82 + midpoint * 0.18)) as RgbColor;
  let accent = softened;
  // A little headroom also keeps accent text readable on softly tinted surfaces.
  for (let amount = 0; contrastRatio(accent, [255, 255, 255]) < 5.5 && amount <= 100; amount++) {
    accent = softened.map((channel, index) => Math.round(channel * (1 - amount / 100) + [26, 29, 34][index] * amount / 100)) as RgbColor;
  }
  const action = `#${accent.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  return { brand, action, onAction: getReadableAccentText(action, secondary || '#ffffff') };
}

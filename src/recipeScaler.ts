const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};

const FRIENDLY_FRACTIONS: Array<[number, string]> = [
  [0.125, '1/8'],
  [0.25, '1/4'],
  [1 / 3, '1/3'],
  [0.375, '3/8'],
  [0.5, '1/2'],
  [0.625, '5/8'],
  [2 / 3, '2/3'],
  [0.75, '3/4'],
  [0.875, '7/8'],
];

function normalizeUnicodeFractions(text: string): string {
  let out = text;
  for (const [uni, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    // Handle "1½" -> "1 1/2" as well as standalone "½" -> "1/2"
    out = out.replace(new RegExp(`(\\d)${uni}`, 'g'), `$1 ${ascii}`);
    out = out.replace(new RegExp(uni, 'g'), ascii);
  }
  return out;
}

function parseNumberToken(token: string): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Mixed fraction: "1 1/2"
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den !== 0) return whole + num / den;
  }

  // Simple fraction: "3/4"
  const frac = trimmed.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den !== 0) return num / den;
  }

  // Decimal or integer
  const val = Number(trimmed);
  return Number.isFinite(val) ? val : null;
}

export function formatKitchenQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const whole = Math.floor(value + 1e-6);
  const rem = value - whole;

  if (rem < 0.04) {
    return String(whole || 0);
  }
  if (rem > 0.96) {
    return String(whole + 1);
  }

  for (const [fracVal, fracStr] of FRIENDLY_FRACTIONS) {
    if (Math.abs(rem - fracVal) < 0.035) {
      return whole > 0 ? `${whole} ${fracStr}` : fracStr;
    }
  }

  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/**
 * Scales the leading quantity (single number, fraction, mixed number, or range like "2-3")
 * in an ingredient line by `multiplier`. Leaves lines without leading numbers unchanged.
 */
export function scaleIngredientLine(line: string, multiplier: number): string {
  if (!line.trim() || Math.abs(multiplier - 1) < 1e-4) return line;

  const normalized = normalizeUnicodeFractions(line);

  // Match optional leading bullet/dash, then a range "qty1 - qty2" or single "qty"
  const qtyPattern = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';
  const rangeRegex = new RegExp(`^(\\s*[-•*]?\\s*)${qtyPattern}(\\s*(?:-|–|to)\\s*)${qtyPattern}(.*)$`, 'i');
  const rangeMatch = normalized.match(rangeRegex);
  if (rangeMatch) {
    const [, prefix, q1Str, sep, q2Str, rest] = rangeMatch;
    const q1 = parseNumberToken(q1Str);
    const q2 = parseNumberToken(q2Str);
    if (q1 !== null && q2 !== null) {
      return `${prefix}${formatKitchenQuantity(q1 * multiplier)}${sep}${formatKitchenQuantity(q2 * multiplier)}${rest}`;
    }
  }

  const singleRegex = new RegExp(`^(\\s*[-•*]?\\s*)${qtyPattern}(\\b.*)$`);
  const singleMatch = normalized.match(singleRegex);
  if (singleMatch) {
    const [, prefix, qStr, rest] = singleMatch;
    const q = parseNumberToken(qStr);
    if (q !== null) {
      return `${prefix}${formatKitchenQuantity(q * multiplier)}${rest}`;
    }
  }

  return line;
}

export function scaleIngredients(ingredients: string[], multiplier: number): string[] {
  if (Math.abs(multiplier - 1) < 1e-4) return ingredients;
  return ingredients.map((line) => scaleIngredientLine(line, multiplier));
}

export function scaleServingsLabel(
  servings: string | undefined,
  multiplier: number
): string | undefined {
  if (!servings || !servings.trim() || Math.abs(multiplier - 1) < 1e-4) return servings;
  return servings.replace(/\d+(?:\.\d+)?/g, (numStr) => {
    const n = Number(numStr);
    if (!Number.isFinite(n)) return numStr;
    return formatKitchenQuantity(n * multiplier);
  });
}

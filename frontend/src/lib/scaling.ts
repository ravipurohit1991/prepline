/** Per-recipe serving scaling for the client.

 * The backend already scales step durations and shopping-list quantities
 * when a plan overrides ``recipe_servings``. These helpers are for the few
 * client-side places that need to preview or display the same scaling —
 * e.g. showing the projected step duration on the new-meal screen, or
 * formatting a scaled ingredient line in a tooltip.
 */

const FRACTION_VALUES: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const LEADING_NUM_RE = /^\s*(?<num>\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*(?<rest>.*)$/;

export function scaleDuration(
  baseMinutes: number,
  baseServings: number,
  targetServings: number,
): number {
  if (baseServings <= 0 || targetServings <= 0) return Math.max(1, baseMinutes);
  const scale = targetServings / baseServings;
  return Math.max(1, Math.round(baseMinutes * scale));
}

export function scaleFactor(baseServings: number, targetServings: number): number {
  if (baseServings <= 0 || targetServings <= 0) return 1;
  return targetServings / baseServings;
}

export function effectiveServings(
  recipeId: string,
  recipeServings: number,
  overrides: Record<string, number> | null | undefined,
): number {
  return overrides?.[recipeId] ?? recipeServings;
}

function formatScaledNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  // Trim trailing zeros from the decimal form.
  return String(rounded).replace(/\.?0+$/, '');
}

export function scaleIngredient(text: string, factor: number): string {
  if (factor === 1) return text;
  const match = LEADING_NUM_RE.exec(text.trim());
  if (match === null) return text;
  const raw = match.groups?.num ?? '';
  const rest = match.groups?.rest ?? '';
  const base = raw in FRACTION_VALUES ? FRACTION_VALUES[raw] : Number.parseFloat(raw);
  if (!Number.isFinite(base)) return text;
  const scaled = base * factor;
  if (Math.abs(scaled - base) < 1e-9) return text;
  return `${formatScaledNumber(scaled)} ${rest}`.trim();
}

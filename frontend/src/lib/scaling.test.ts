import { describe, expect, it } from 'vitest';
import { effectiveServings, scaleDuration, scaleFactor, scaleIngredient } from './scaling';

describe('scaleDuration', () => {
  it('scales a 10 minute step from 4 to 8 servings', () => {
    expect(scaleDuration(10, 4, 8)).toBe(20);
  });

  it('floors at 1 minute when scaling down to a fraction', () => {
    expect(scaleDuration(10, 10, 1)).toBe(1);
  });

  it('rounds to the nearest minute for odd ratios', () => {
    // 7/3 ≈ 2.33 → rounds to 2.
    expect(scaleDuration(3, 3, 7)).toBe(7);
  });

  it('returns the base when servings are zero or negative', () => {
    expect(scaleDuration(5, 0, 4)).toBe(5);
    expect(scaleDuration(5, 4, 0)).toBe(5);
  });
});

describe('scaleFactor', () => {
  it('computes the ratio between servings', () => {
    expect(scaleFactor(4, 8)).toBe(2);
    expect(scaleFactor(4, 2)).toBe(0.5);
  });
});

describe('effectiveServings', () => {
  it('returns the override when present', () => {
    expect(effectiveServings('r1', 4, { r1: 6 })).toBe(6);
  });

  it('returns the base servings when override is missing', () => {
    expect(effectiveServings('r1', 4, null)).toBe(4);
    expect(effectiveServings('r1', 4, {})).toBe(4);
  });
});

describe('scaleIngredient', () => {
  it('scales a leading integer quantity', () => {
    expect(scaleIngredient('80 g butter', 2)).toBe('160 g butter');
  });

  it('scales a decimal leading quantity', () => {
    expect(scaleIngredient('1.5 kg potatoes', 0.5)).toBe('0.75 kg potatoes');
  });

  it('scales a unicode fraction', () => {
    expect(scaleIngredient('½ tsp salt', 2)).toBe('1 tsp salt');
  });

  it('leaves lines without a leading number unchanged', () => {
    expect(scaleIngredient('salt to taste', 2)).toBe('salt to taste');
  });

  it('is a no-op when the factor is 1', () => {
    expect(scaleIngredient('80 g butter', 1)).toBe('80 g butter');
  });
});

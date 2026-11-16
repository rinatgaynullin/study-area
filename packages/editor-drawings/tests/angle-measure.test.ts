import { describe, expect, it } from 'vitest';
import { formatAngleMeasure, isAngleMeasureLabel } from '../src/builders/geometry-utils';

describe('подпись величины угла', () => {
  it('целые градусы пишет без дробной части', () => {
    expect(formatAngleMeasure(60)).toBe('60°');
    expect(formatAngleMeasure(59.96)).toBe('60°');
    expect(formatAngleMeasure(90.04)).toBe('90°');
  });

  it('дробные — с одним знаком через запятую', () => {
    expect(formatAngleMeasure(63.4349)).toBe('63,4°');
    expect(formatAngleMeasure(0.25)).toBe('0,3°');
  });

  it('узнаёт подпись-величину с пробелами и точкой', () => {
    expect(isAngleMeasureLabel('60°', 60.02)).toBe(true);
    expect(isAngleMeasureLabel(' 63.4 ° ', 63.43)).toBe(true);
    expect(isAngleMeasureLabel('63,4°', 63.43)).toBe(true);
  });

  it('чужую подпись величиной не считает', () => {
    expect(isAngleMeasureLabel('α', 60)).toBe(false);
    expect(isAngleMeasureLabel('45°', 60)).toBe(false);
    expect(isAngleMeasureLabel('60', 60)).toBe(false);
    expect(isAngleMeasureLabel(undefined, 60)).toBe(false);
    expect(isAngleMeasureLabel('', 60)).toBe(false);
  });
});

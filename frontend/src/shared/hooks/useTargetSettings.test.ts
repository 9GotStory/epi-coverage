/**
 * Issue #80 RED contracts — non-numeric target config values must not become NaN.
 *
 * `useTargetSettings.getTarget` wrapped every config lookup in a bare
 * `Number(...)`: a hand-edited `configs_system` value like "ร้อยละ 95" or an
 * empty string became NaN, rendering "เป้าหมาย: NaN%" and forcing
 * `coverage >= NaN` to false — a permanently red "ต่ำกว่าเป้าหมาย" badge.
 *
 * Seam under test: `resolveTargetValue()` (useTargetSettings.ts) — the pure
 * resolver the hook delegates to. A value that is not a finite number resolves
 * to undefined ("ยังไม่กำหนดเป้า"), exactly like a missing key.
 *
 * All fixtures are synthetic. No real health data or identifiers.
 */
import { describe, expect, it } from 'vitest';
import { resolveTargetValue } from './useTargetSettings';

describe('resolveTargetValue', () => {
  it('resolves numbers and numeric strings from configs_system', () => {
    expect(resolveTargetValue({ target_q4: 95 }, 'all', undefined, undefined, undefined)).toBe(95);
    expect(resolveTargetValue({ target_q4: '95' }, 'all', undefined, undefined, undefined)).toBe(95);
    expect(resolveTargetValue({ target_view2_q4: '90.5' }, 'all', 2, undefined, undefined)).toBe(90.5);
  });

  it('treats a non-numeric config value as no target — never NaN', () => {
    expect(resolveTargetValue({ target_q4: 'ร้อยละ 95' }, 'all', undefined, undefined, undefined)).toBeUndefined();
    expect(resolveTargetValue({ target_q4: '' }, 'all', undefined, undefined, undefined)).toBeUndefined();
    // null ไม่อยู่ในประเภท ConfigMap ปกติ แต่ resolver ต้องรับมือค่าผิดรูปจาก JSON ได้
    const nullValue = { target_q4: null } as unknown as Record<string, string>;
    expect(resolveTargetValue(nullValue, 'all', undefined, undefined, undefined)).toBeUndefined();
  });

  it('keeps the documented lookup precedence (vaccine → view → base; year-suffixed first)', () => {
    const config = {
      target_q4: 50,
      target_view2_q4: 60,
      target_mmr_q4: 70,
      target_q4_2569: 80,
    };
    expect(resolveTargetValue(config, 'all', 2, 'mmr', undefined)).toBe(70);
    expect(resolveTargetValue(config, 'all', 2, 'unknown-vaccine', undefined)).toBe(60);
    expect(resolveTargetValue(config, 'all', undefined, undefined, undefined)).toBe(50);
    expect(resolveTargetValue(config, 'all', undefined, undefined, 2569)).toBe(80);
  });

  it('maps quarter lookups and treats an explicitly configured 0 as a real target', () => {
    expect(resolveTargetValue({ target_q2: '40' }, 2, undefined, undefined, undefined)).toBe(40);
    expect(resolveTargetValue({ target_q4: 0 }, 'all', undefined, undefined, undefined)).toBe(0);
  });
});

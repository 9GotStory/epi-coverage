import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

// ประเภทของ Config Map
type ConfigMap = Record<string, number | string>;

/**
 * แปลงค่าจาก configs_system เป็นตัวเลขเป้าหมาย (Issue #80)
 * ค่าที่ไม่ใช่ตัวเลขจำกัด (เช่น "ร้อยละ 95") ช่องว่าง หรือ null → undefined
 * ("ยังไม่กำหนดเป้า") ไม่คืน NaN ที่ทำให้ UI แสดง "เป้าหมาย: NaN%" และ badge แดงเสมอ
 * (ค่าว่างไม่ใช่เป้าหมาย 0 — Number('') และ Number(null) เป็น 0 จึงต้องแยกก่อนแปลง)
 */
const toFiniteTarget = (value: unknown): number | undefined => {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * ตัวตัดสินเป้าหมายแบบ pure (Issue #80 แยกออกจาก hook เพื่อทดสอบได้)
 * ลำดับการค้นหา:
 * 1. เป้าหมายเฉพาะวัคซีนของปีนั้นๆ (target_mmr_q4_2568)
 * 2. เป้าหมายเฉพาะวัคซีนทั่วไป (target_mmr_q4)
 * 3. เป้าหมายเฉพาะมุมมองของปีนั้นๆ (target_view2_q4_2568)
 * 4. เป้าหมายเฉพาะมุมมองทั่วไป (target_view2_q4)
 * 5. เป้าหมายพื้นฐานของปีนั้นๆ (target_q4_2568)
 * 6. เป้าหมายพื้นฐานทั่วไป (target_q4)
 */
export function resolveTargetValue(
  config: ConfigMap,
  quarter: number | 'all',
  view?: 1 | 2,
  vaccineKey?: string,
  fiscalYear?: number,
): number | undefined {
  const q = quarter === 'all' ? 'q4' : `q${quarter}`;
  const yearSuffix = fiscalYear ? `_${fiscalYear}` : '';

  if (vaccineKey) {
    const specificYearKey = `target_${vaccineKey}_${q}${yearSuffix}`;
    const specificKey = `target_${vaccineKey}_${q}`;
    if (config[specificYearKey] !== undefined) return toFiniteTarget(config[specificYearKey]);
    if (config[specificKey] !== undefined) return toFiniteTarget(config[specificKey]);
  }

  if (view) {
    const viewYearKey = `target_view${view}_${q}${yearSuffix}`;
    const viewKey = `target_view${view}_${q}`;
    if (config[viewYearKey] !== undefined) return toFiniteTarget(config[viewYearKey]);
    if (config[viewKey] !== undefined) return toFiniteTarget(config[viewKey]);
  }

  const baseYearKey = `target_${q}${yearSuffix}`;
  const baseKey = `target_${q}`;
  if (config[baseYearKey] !== undefined) return toFiniteTarget(config[baseYearKey]);
  if (config[baseKey] !== undefined) return toFiniteTarget(config[baseKey]);

  // หากไม่มีกำหนดในระบบเลย จะไม่แสดงเส้นเป้าหมาย
  return undefined;
}

// ผลลัพธ์ที่ Hook ส่งกลับ
interface UseTargetSettingsResult {
  config: ConfigMap;
  isLoading: boolean;
  isError: boolean;
  getTarget: (quarter: number | 'all', view?: 1 | 2, vaccineKey?: string, fiscalYear?: number) => number | undefined;
}

// ลบ DEFAULT_CONFIG ออกเพื่อบังคับให้อ่านจากระบบเท่านั้น

export function useTargetSettings(): UseTargetSettingsResult {
  const { data: configData, isLoading, isError } = useQuery<ConfigMap>({
    queryKey: ['targetConfig'],
    queryFn: async () => {
      const res = await fetchApi('getTargetConfig');
      const data: ConfigMap = res?.data || res || {};
      return data;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 2,
  });

  const config = configData || {};

  const getTarget = useCallback(
    (quarter: number | 'all', view?: 1 | 2, vaccineKey?: string, fiscalYear?: number): number | undefined =>
      resolveTargetValue(configData || {}, quarter, view, vaccineKey, fiscalYear),
    [configData]
  );

  return { config, isLoading, isError, getTarget };
}

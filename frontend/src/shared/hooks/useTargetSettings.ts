import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

// ประเภทของ Config Map
type ConfigMap = Record<string, number | string>;

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
    (quarter: number | 'all', view?: 1 | 2, vaccineKey?: string, fiscalYear?: number): number | undefined => {
      const config = configData || {};
      const q = quarter === 'all' ? 'q4' : `q${quarter}`;
      const yearSuffix = fiscalYear ? `_${fiscalYear}` : '';

      // ลำดับการค้นหา: 
      // 1. เป้าหมายเฉพาะวัคซีนของปีนั้นๆ (target_mmr_q4_2568)
      // 2. เป้าหมายเฉพาะวัคซีนทั่วไป (target_mmr_q4)
      if (vaccineKey) {
        const specificYearKey = `target_${vaccineKey}_${q}${yearSuffix}`;
        const specificKey = `target_${vaccineKey}_${q}`;
        if (config[specificYearKey] !== undefined) return Number(config[specificYearKey]);
        if (config[specificKey] !== undefined) return Number(config[specificKey]);
      }

      // 3. เป้าหมายเฉพาะมุมมองของปีนั้นๆ (target_view2_q4_2568)
      // 4. เป้าหมายเฉพาะมุมมองทั่วไป (target_view2_q4)
      if (view) {
        const viewYearKey = `target_view${view}_${q}${yearSuffix}`;
        const viewKey = `target_view${view}_${q}`;
        if (config[viewYearKey] !== undefined) return Number(config[viewYearKey]);
        if (config[viewKey] !== undefined) return Number(config[viewKey]);
      }

      // 5. เป้าหมายพื้นฐานของปีนั้นๆ (target_q4_2568)
      // 6. เป้าหมายพื้นฐานทั่วไป (target_q4)
      const baseYearKey = `target_${q}${yearSuffix}`;
      const baseKey = `target_${q}`;
      
      if (config[baseYearKey] !== undefined) return Number(config[baseYearKey]);
      if (config[baseKey] !== undefined) return Number(config[baseKey]);

      // หากไม่มีกำหนดในระบบเลย จะไม่แสดงเส้นเป้าหมาย
      return undefined;
    },
    [configData]
  );

  return { config, isLoading, isError, getTarget };
}

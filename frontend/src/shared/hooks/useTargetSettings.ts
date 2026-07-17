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
  getTarget: (quarter: number | 'all', view?: 1 | 2, vaccineKey?: string) => number;
}

const DEFAULT_CONFIG: ConfigMap = {
  target_q1: 50,
  target_q2: 70,
  target_q3: 80,
  target_q4: 90,
  target_mmr_q1: 95,
  target_mmr_q2: 95,
  target_mmr_q3: 95,
  target_mmr_q4: 95,
};

export function useTargetSettings(): UseTargetSettingsResult {
  const { data: configData, isLoading, isError } = useQuery<ConfigMap>({
    queryKey: ['targetConfig'],
    queryFn: async () => {
      const res = await fetchApi('getTargetConfig');
      const data: ConfigMap = res?.data || res || {};
      return Object.keys(data).length > 0 ? data : DEFAULT_CONFIG;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 2,
  });

  const config = configData || DEFAULT_CONFIG;

  // ✅ useCallback ให้ getTarget มี stable reference ไม่สร้างใหม่ทุก render
  const getTarget = useCallback(
    (quarter: number | 'all', view?: 1 | 2, vaccineKey?: string): number => {
      const q = quarter === 'all' ? 'q4' : `q${quarter}`;
      const DEFAULT_TARGET = 90;

      // ลำดับ 1: เป้าหมายเฉพาะวัคซีน + ไตรมาส (เช่น target_mmr_q4 = 95)
      if (vaccineKey) {
        const specificKey = `target_${vaccineKey}_${q}`;
        if (config[specificKey] !== undefined) return Number(config[specificKey]);
      }

      // ลำดับ 2: เป้าหมายเฉพาะมุมมอง + ไตรมาส (เช่น target_view2_q4)
      if (view) {
        const viewKey = `target_view${view}_${q}`;
        if (config[viewKey] !== undefined) return Number(config[viewKey]);
      }

      // ลำดับ 3: เป้าหมายพื้นฐานของไตรมาส (เช่น target_q4 = 90)
      const baseKey = `target_${q}`;
      if (config[baseKey] !== undefined) return Number(config[baseKey]);

      // ลำดับ 4: Default fallback
      return DEFAULT_TARGET;
    },
    [config],
  );

  return { config, isLoading, isError, getTarget };
}

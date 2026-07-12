import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../lib/api';

// ประเภทของ Config Map
type ConfigMap = Record<string, number | string>;

// ผลลัพธ์ที่ Hook ส่งกลับ
interface UseTargetSettingsResult {
  config: ConfigMap;
  isLoading: boolean;
  /**
   * คำนวณค่าเป้าหมายโดยใช้ระบบ Fallback
   * ลำดับความสำคัญ: วัคซีนเฉพาะ > มุมมองเฉพาะ > ไตรมาสพื้นฐาน > ค่า Default
   *
   * @param quarter    - ไตรมาสที่เลือก (1-4)
   * @param view       - มุมมองที่ใช้ (1 หรือ 2) — optional
   * @param vaccineKey - ชนิดวัคซีน เช่น 'mmr', 'bcg' — optional
   * @returns ค่าเป้าหมายเป็น number (%)
   */
  getTarget: (quarter: number, view?: 1 | 2, vaccineKey?: string) => number;
}

// ──────────────────────────────────────────────────────
// Module-level Promise cache (Best Practice จาก React Docs)
// ref: https://react.dev/reference/react/use#usage
// ──────────────────────────────────────────────────────
let configPromise: Promise<ConfigMap> | null = null;
let cachedConfig: ConfigMap | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 นาที

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

function fetchConfigFromApi(): Promise<ConfigMap> {
  // Reuse Promise ที่กำลังโหลดอยู่ (ป้องกัน duplicate request)
  if (configPromise) return configPromise;

  configPromise = fetchApi('getTargetConfig')
    .then((res) => {
      const data: ConfigMap = res?.data || res || {};
      const merged = Object.keys(data).length > 0 ? data : DEFAULT_CONFIG;
      cachedConfig = merged;
      cacheTimestamp = Date.now();
      return merged;
    })
    .catch((err) => {
      console.warn('[useTargetSettings] ดึง config ไม่ได้ ใช้ค่า default:', err);
      cachedConfig = DEFAULT_CONFIG;
      cacheTimestamp = Date.now();
      return DEFAULT_CONFIG;
    })
    .finally(() => {
      // Reset promise หลัง resolve/reject เพื่อให้ refresh ในอนาคตได้
      configPromise = null;
    });

  return configPromise;
}

export function useTargetSettings(): UseTargetSettingsResult {
  const [config, setConfig] = useState<ConfigMap>(cachedConfig || DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState<boolean>(!cachedConfig);

  useEffect(() => {
    const now = Date.now();
    // ใช้ cache ถ้ายังไม่หมดอายุ — ไม่ต้องเรียก API ซ้ำ
    if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
      setConfig(cachedConfig);
      setIsLoading(false);
      return;
    }

    // ✅ ignore flag ตาม React Docs เพื่อป้องกัน setState หลัง unmount
    // ref: https://react.dev/learn/synchronizing-with-effects#fetching-data
    let ignore = false;

    setIsLoading(true);
    fetchConfigFromApi()
      .then((data) => {
        if (!ignore) {
          setConfig(data);
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  // ✅ useCallback ให้ getTarget มี stable reference ไม่สร้างใหม่ทุก render
  const getTarget = useCallback(
    (quarter: number, view?: 1 | 2, vaccineKey?: string): number => {
      const q = `q${quarter}`;
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

  return { config, isLoading, getTarget };
}

import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { summarizeHdcEpi1 } from '../utils/hdcAnnualReference';

/**
 * Lazy, read-only HDC reference. The public GAS action resolves the existing
 * aggregate-only opendata_cache (with a possible upstream fallback).
 * The model always rechecks report/year/district even on proxy fallback.
 */
export function useHdcEpi1AnnualReference(fiscalYear: number, enabled: boolean) {
  const query = useQuery({
    queryKey: ['hdcEpi1AnnualReference', fiscalYear],
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetchApi('getOpenData', {
        payload: { tableName: 's_epi1', year: String(fiscalYear) },
      });
      const envelope: unknown = response?.data;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new Error('รูปแบบข้อมูลตอบกลับ HDC ไม่ถูกต้อง');
      }
      const source = envelope as Record<string, unknown>;
      if (source.statusCode !== 200 || !Array.isArray(source.data)) {
        throw new Error('ยังไม่สามารถดึงข้อมูล HDC OpenData สำหรับปีที่เลือกได้');
      }
      return summarizeHdcEpi1(source.data, fiscalYear);
    },
  });
  return {
    reference: query.data ?? null,
    isLoading: query.isLoading && enabled,
    error: query.error ? query.error.message : null,
  };
}

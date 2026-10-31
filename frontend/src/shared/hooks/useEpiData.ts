import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import type { EpiRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface UseEpiDataResult {
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
  refetch: () => Promise<any>;
}

export function useEpiData(targetTable: 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year' = 'Epi_1_Year', fiscalYear?: number): UseEpiDataResult {
  const { user } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['epiData', user?.hoscode, targetTable, fiscalYear],
    queryFn: async () => {
      const response = await fetchApi('getEpiData', { hoscode: user?.hoscode, targetTable, fiscalYear });
      if (response.success === false) {
        throw new Error(response.error || 'Failed to fetch EPI data');
      }

      const records = Array.isArray(response) ? response : (response.data || []);

      // Double check active filter just in case — fail closed เหมือน backend (Issue #80):
      // เฉพาะ TRUE ชัด ๆ เท่านั้นที่ active
      const activeRecords = records.filter((r: any) => String(r.is_active).toUpperCase() === 'TRUE');

      // As-of date ของข้อมูล — ใช้ endpoint สำหรับผู้ใช้ทุกสถานะ (Issue #80)
      // ก่อนหน้านี้เรียก getAuditLogs ซึ่งเป็น admin action ทำให้ role user ได้ 403
      // เสมอและ as-of date ไม่แสดงเลย
      let calculatedAsOfDate = null;
      try {
        const asOfResponse = await fetchApi('getLatestImportTime');
        calculatedAsOfDate = asOfResponse?.data?.timestamp || null;
      } catch (e) {
        console.warn('Could not fetch last upload date', e);
      }

      return {
        records: activeRecords,
        asOfDate: calculatedAsOfDate
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000 // Cache for 5 minutes
  });

  return {
    data: data?.records || [],
    isLoading,
    error: error ? error.message : null,
    asOfDate: data?.asOfDate || null,
    refetch
  };
}

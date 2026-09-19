import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

/** Per-target-table fiscal years that have a usable annual summary (Issue #22). */
export type DashboardSummaryYears = Record<string, number[]>;

/**
 * Comparison-usable fiscal years, derived from actual annual summary data
 * (Issue #22). This is NOT a generic available-years source —
 * useAvailableYears() stays unrelated to Comparison.
 */
export function useDashboardSummaryYears() {
  const { data, isLoading, error } = useQuery<DashboardSummaryYears>({
    queryKey: ['dashboardSummaryYears'],
    queryFn: async () => {
      const res = await fetchApi('getDashboardSummaryYears', {});
      if (res?.data && res.data.success && res.data.tables) {
        return res.data.tables as DashboardSummaryYears;
      }
      throw new Error(res?.data?.error || 'ไม่สามารถดึงปีงบประมาณที่มีข้อมูลสรุปได้');
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    tables: data || {},
    isLoading,
    error: error ? error.message : null,
  };
}

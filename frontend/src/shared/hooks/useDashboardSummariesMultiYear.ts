import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface MultiYearSummary {
  id: string;
  targetTable: string;
  fiscalYear: number;
  summaryData: any;
  updated_at: string;
}

export const useDashboardSummariesMultiYear = (fiscalYears: number[]) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboardSummariesMultiYear', fiscalYears],
    queryFn: async () => {
      if (!fiscalYears || fiscalYears.length === 0) {
        return [];
      }
      const res = await fetchApi('getDashboardSummariesMultiYear', { fiscalYears });
      if (res && res.data && res.data.summaries) {
        return res.data.summaries as MultiYearSummary[];
      }
      throw new Error('ไม่สามารถดึงข้อมูลสรุปได้');
    },
    enabled: fiscalYears && fiscalYears.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  
  return { 
    data: data || [], 
    isLoading, 
    error: error ? error.message : null 
  };
};

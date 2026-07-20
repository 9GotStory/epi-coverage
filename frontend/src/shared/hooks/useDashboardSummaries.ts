import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface DashboardSummaryData {
  id: string;
  targetTable: 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year';
  fiscalYear: number;
  summaryData: any; // The JSON of the pre-calculated summary
  updated_at: string;
}

export function useDashboardSummaries(fiscalYear: number) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboardSummaries', fiscalYear],
    queryFn: async () => {
      const response = await fetchApi('getDashboardSummaries', { fiscalYear });
      if (response.data && response.data.success) {
        return response.data.summaries as DashboardSummaryData[];
      }
      throw new Error(response.data?.error || 'Failed to fetch summaries');
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return { 
    data: data || [], 
    isLoading, 
    error: error ? error.message : null 
  };
}

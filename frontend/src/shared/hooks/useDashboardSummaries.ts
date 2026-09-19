import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import type { DashboardSummaryRow } from '../types/dashboardSummary';

export function useDashboardSummaries(fiscalYear: number, quarter: number | 'all' = 'all') {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboardSummaries', fiscalYear, quarter],
    queryFn: async () => {
      const response = await fetchApi('getDashboardSummaries', { fiscalYear, quarter });
      if (response.data && response.data.success) {
        // Backend resolves canonical annual precedence (_all > legacy) — the rows
        // here are already one-per-(table, fiscalYear) for annual reads (Issue #22).
        return response.data.summaries as DashboardSummaryRow[];
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

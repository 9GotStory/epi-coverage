import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';

export interface DashboardSummaryData {
  id: string;
  targetTable: 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year';
  fiscalYear: number;
  summaryData: any; // The JSON of the pre-calculated summary
  updated_at: string;
}

export function useDashboardSummaries(fiscalYear: number) {
  const [data, setData] = useState<DashboardSummaryData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchSummaries() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchApi('getDashboardSummaries', { fiscalYear });
        if (response.data && response.data.success) {
          if (isMounted) setData(response.data.summaries || []);
        } else {
          if (isMounted) setError(response.data?.error || 'Failed to fetch summaries');
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'An error occurred');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchSummaries();

    return () => {
      isMounted = false;
    };
  }, [fiscalYear]);

  return { data, isLoading, error };
}

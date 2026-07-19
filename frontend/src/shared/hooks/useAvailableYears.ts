import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';
import { getCurrentFiscalYear } from '../utils/dateUtils';

export function useAvailableYears() {
  const currentYear = getCurrentFiscalYear();
  const [years, setYears] = useState<number[]>([currentYear]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadYears() {
      try {
        setIsLoading(true);
        const res = await fetchApi('getAvailableYears', {});
        if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
          // ensure current year and adjacent years are included for planning
          const fetchedYears = new Set<number>(res.data);
          fetchedYears.add(currentYear - 1);
          fetchedYears.add(currentYear);
          fetchedYears.add(currentYear + 1);
          
          // Sort descending
          const sorted = Array.from(fetchedYears).sort((a: number, b: number) => b - a);
          setYears(sorted);
        } else {
          setYears([currentYear]);
        }
      } catch (err: any) {
        console.error('Failed to fetch available years', err);
        setError(err.message || 'Error fetching available years');
        setYears([currentYear]);
      } finally {
        setIsLoading(false);
      }
    }

    loadYears();
  }, [currentYear]);

  return { years, isLoading, error };
}

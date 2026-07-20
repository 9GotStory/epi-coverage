import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { getCurrentFiscalYear } from '../utils/dateUtils';

export function useAvailableYears() {
  const currentYear = getCurrentFiscalYear();

  const { data: years, isLoading, error } = useQuery({
    queryKey: ['availableYears'],
    queryFn: async () => {
      const res = await fetchApi('getAvailableYears', {});
      
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        // ensure current year and adjacent years are included for planning
        const fetchedYears = new Set<number>(res.data);
        fetchedYears.add(currentYear - 1);
        fetchedYears.add(currentYear);
        fetchedYears.add(currentYear + 1);
        
        // Sort descending
        return Array.from(fetchedYears).sort((a: number, b: number) => b - a);
      }
      return [currentYear];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return { 
    years: years ?? [currentYear], 
    isLoading, 
    error: error ? error.message : null 
  };
}

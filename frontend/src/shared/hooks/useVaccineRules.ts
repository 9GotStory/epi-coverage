import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';

export const useVaccineRules = (fiscalYear: number, ageGroup: string) => {
  const queryClient = useQueryClient();
  const queryKey = ['vaccineRules', fiscalYear, ageGroup];

  const { data: rules, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetchApi('getVaccineRules', { fiscalYear, ageGroup });
      if (res && res.data) {
        return res.data as VaccineRule[];
      }
      throw new Error('Failed to load rules or no rules returned');
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return { 
    rules: rules || [], 
    isLoading, 
    error: error ? error.message : null 
  };
};

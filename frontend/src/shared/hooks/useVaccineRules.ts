import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';

export const useVaccineRules = (fiscalYear: number, ageGroup: string) => {
  const [rules, setRules] = useState<VaccineRule[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchRules = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Cache mechanism
        const cacheKey = `vaccine_rules_${fiscalYear}_${ageGroup}`;
        const cachedStr = sessionStorage.getItem(cacheKey);
        
        if (cachedStr) {
          const cachedRules = JSON.parse(cachedStr) as VaccineRule[];
          if (isMounted) {
            setRules(cachedRules);
            setIsLoading(false);
          }
          // Optionally re-fetch in background to keep fresh, but for now we trust cache for session duration
          return;
        }

        const res = await fetchApi('getVaccineRules', { fiscalYear, ageGroup });
        if (res && res.data) {
          if (isMounted) {
            setRules(res.data);
            sessionStorage.setItem(cacheKey, JSON.stringify(res.data));
          }
        } else {
          if (isMounted) setError('Failed to load rules or no rules returned');
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Error fetching vaccine rules');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchRules();

    return () => {
      isMounted = false;
    };
  }, [fiscalYear, ageGroup]);

  return { rules, isLoading, error, setRules };
};

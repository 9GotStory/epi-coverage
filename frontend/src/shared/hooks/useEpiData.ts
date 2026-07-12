import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../lib/api';
import type { EpiRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface UseEpiDataResult {
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
  refetch: () => Promise<void>;
}

export function useEpiData(targetTable: 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year' = 'Epi_1_Year'): UseEpiDataResult {
  const { user } = useAuth();
  const [data, setData] = useState<EpiRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function loadData() {
      if (!user) return;
      
      setIsLoading(true);
      setError(null);
      try {
        // API call to 'getEpiData'
        const response = await fetchApi('getEpiData', { hoscode: user.hoscode, targetTable });
        if (ignore) return;

        if (response.success === false) {
          throw new Error(response.error || 'Failed to fetch EPI data');
        }
        
        // Expected response is an array of EpiRecord
        const records = Array.isArray(response) ? response : (response.data || []);
        
        // Double check active filter just in case
        const activeRecords = records.filter((r: any) => String(r.is_active).toUpperCase() !== 'FALSE');
        setData(activeRecords);

        // Fetch last upload date from audit logs
        try {
          const logsResponse = await fetchApi('getAuditLogs');
          if (ignore) return;
          const logs = Array.isArray(logsResponse) ? logsResponse : (logsResponse.data || []);
          const lastUpload = logs.find((l: any) => l.action === 'cleanup_epi_data');
          if (lastUpload && lastUpload.timestamp) {
            setAsOfDate(lastUpload.timestamp);
          }
        } catch (e) {
          console.warn('Could not fetch last upload date', e);
        }
      } catch (err: any) {
        if (!ignore) {
          console.error('Error fetching EPI data:', err);
          setError(err.message || 'An unexpected error occurred');
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      ignore = true;
    };
  }, [user, targetTable, refreshCount]);

  const refetch = useCallback(async () => {
    setRefreshCount(c => c + 1);
  }, []);

  return { data, isLoading, error, asOfDate, refetch };
}

import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';

export interface MultiYearSummary {
  id: string;
  targetTable: string;
  fiscalYear: number;
  summaryData: any;
  updated_at: string;
}

export const useDashboardSummariesMultiYear = (fiscalYears: number[]) => {
  const [data, setData] = useState<MultiYearSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    const fetchSummaries = async () => {
      if (!fiscalYears || fiscalYears.length === 0) {
        if (isMounted) {
          setData([]);
          setIsLoading(false);
        }
        return;
      }
      
      try {
        setIsLoading(true);
        setError(null);
        
        const res = await fetchApi('getDashboardSummariesMultiYear', { fiscalYears });
        
        if (res && res.data && res.data.summaries) {
          if (isMounted) setData(res.data.summaries);
        } else {
          if (isMounted) setError('ไม่สามารถดึงข้อมูลสรุปได้');
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'เกิดข้อผิดพลาด');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    
    fetchSummaries();
    
    return () => {
      isMounted = false;
    };
  }, [JSON.stringify(fiscalYears)]);
  
  return { data, isLoading, error };
};

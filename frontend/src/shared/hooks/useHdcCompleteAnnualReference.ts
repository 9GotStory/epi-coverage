import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { getHdcCompleteReport, summarizeHdcCompleteAnnual } from '../utils/hdcCompleteAnnualReference';

/** Read-only HDC aggregate, loaded only when user opens the View 2 reference. */
export function useHdcCompleteAnnualReference(
  fiscalYear: number, ageGroup: string, enabled: boolean,
) {
  const supported = getHdcCompleteReport(ageGroup) !== null;
  const query = useQuery({
    queryKey: ['hdcCompleteAnnualReference',ageGroup,fiscalYear],
    enabled: enabled && supported,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetchApi('getOpenData',{
        payload:{tableName:'s_epi_complete',year:String(fiscalYear)},
      });
      const envelope:unknown = response?.data;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new Error('ข้อมูลตอบกลับ HDC ไม่ถูกต้อง');
      }
      const result = envelope as Record<string,unknown>;
      if (result.statusCode !== 200 || !Array.isArray(result.data)) {
        throw new Error('ไม่สามารถดึงรายงาน HDC Fully Immunized');
      }
      return summarizeHdcCompleteAnnual(result.data,fiscalYear,ageGroup);
    },
  });
  return {
    reference: query.data ?? null,
    isLoading: enabled && supported && query.isLoading,
    error: query.error ? query.error.message : null,
  };
}

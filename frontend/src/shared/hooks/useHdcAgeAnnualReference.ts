import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { getHdcAgeReport, summarizeHdcAgeAnnual } from '../utils/hdcAnnualReference';

/** Optional on-demand aggregate HDC report, restricted to the selected year and age. */
export function useHdcAgeAnnualReference(fiscalYear:number,ageGroup:string,enabled:boolean){
  const config=getHdcAgeReport(ageGroup);
  const query=useQuery({
    queryKey:['hdcAgeAnnualReference',ageGroup,fiscalYear],
    enabled:enabled && config!==null,
    retry:false,
    staleTime:5*60*1000,
    queryFn:async()=>{
      if(!config)throw new Error('ไม่รองรับรายงานสำหรับกลุ่มอายุนี้');
      const response=await fetchApi('getOpenData',{
        payload:{tableName:config.table,year:String(fiscalYear)},
      });
      const envelope:unknown=response?.data;
      if(!envelope || typeof envelope!=='object' || Array.isArray(envelope)){
        throw new Error('ข้อมูลตอบกลับ HDC ไม่ถูกต้อง');
      }
      const source=envelope as Record<string,unknown>;
      if(source.statusCode!==200 || !Array.isArray(source.data)){
        throw new Error('ไม่สามารถดึงผล HDC OpenData สำหรับปีที่เลือก');
      }
      // Cache and upstream fallback are both independently checked for area/year/report.
      return summarizeHdcAgeAnnual(source.data,fiscalYear,ageGroup);
    }
  });
  return {
    reference:query.data??null,
    isLoading:enabled && query.isLoading && config!==null,
    error:query.error?query.error.message:null,
  };
}

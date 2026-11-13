import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { HDC_FULLY_IMMUNIZED_TABLE, summarizeHdcFullyImmunized } from '../utils/hdcAnnualReference';

/**
 * On-demand HDC Fully Immunized figure for one Age Group and year. A failed
 * request and rows that fail validation are reported apart (Issue #186).
 */
export function useHdcFullyImmunizedReference(fiscalYear:number,ageGroup:string,enabled:boolean){
  // One s_epi_complete read per year serves all four Age Groups.
  const query=useQuery({
    queryKey:['hdcFullyImmunized',fiscalYear],
    enabled,
    retry:false,
    staleTime:5*60*1000,
    queryFn:async()=>{
      const response=await fetchApi('getOpenData',{
        payload:{tableName:HDC_FULLY_IMMUNIZED_TABLE,year:String(fiscalYear)},
      });
      const envelope:unknown=response?.data;
      if(!envelope || typeof envelope!=='object' || Array.isArray(envelope)){
        throw new Error('ข้อมูลตอบกลับ HDC ไม่ถูกต้อง');
      }
      const source=envelope as Record<string,unknown>;
      if(source.statusCode!==200 || !Array.isArray(source.data)){
        throw new Error('ไม่สามารถดึงผล HDC OpenData สำหรับปีที่เลือก');
      }
      return source.data as unknown[];
    }
  });
  const summary=useMemo(()=>{
    if(!query.data)return {reference:null,invalidReason:null};
    try{
      return {reference:summarizeHdcFullyImmunized(query.data,fiscalYear,ageGroup),invalidReason:null};
    }catch(e){
      return {reference:null,invalidReason:e instanceof Error?e.message:String(e)};
    }
  },[query.data,fiscalYear,ageGroup]);
  return {
    ...summary,
    isLoading:enabled && query.isLoading,
    requestError:query.error?query.error.message:null,
  };
}

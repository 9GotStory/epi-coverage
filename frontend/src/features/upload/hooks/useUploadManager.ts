import { useState, useCallback } from 'react';
import { read, utils } from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { fetchApi } from '../../../shared/lib/api';
import { calcGroupSummary } from '../../../shared/utils/dashboardLogic';
import { evaluateView1, evaluateView2 } from '../../../shared/utils/vaccine/vaccine-1yr';
import { evaluateView1_2Yr, evaluateView2_2Yr } from '../../../shared/utils/vaccine/vaccine-2yr';
import { evaluateView1_3Yr, evaluateView2_3Yr } from '../../../shared/utils/vaccine/vaccine-3yr';
import { evaluateView1_5Yr, evaluateView2_5Yr } from '../../../shared/utils/vaccine/vaccine-5yr';
import { cleanData } from '../utils/uploadHelpers';
const CHUNK_SIZE = 500;

export type TargetTable = 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year';
export type UploadStatus = 'idle' | 'parsing' | 'uploading' | 'cleaning' | 'generating_summary' | 'success' | 'error';

export function useUploadManager() {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [fiscalYear, setFiscalYear] = useState<string>(
    String(new Date().getFullYear() + 543 + (new Date().getMonth() >= 9 ? 1 : 0))
  );
  const [targetTable, setTargetTable] = useState<TargetTable>('Epi_1_Year');
  
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [results, setResults] = useState<{inserted: number, updated: number, deactivated: number}>({inserted: 0, updated: 0, deactivated: 0});
  const [isSyncing, setIsSyncing] = useState(false);

  const handleDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const selected = acceptedFiles[0];
    setFile(selected);
    setStatus('parsing');
    setErrorMsg('');

    try {
      const ab = await selected.arrayBuffer();
      const wb = read(ab, { type: 'array', cellDates: true });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      
      const data = utils.sheet_to_json(ws);
      
      if (data.length === 0) {
        throw new Error('ไฟล์ว่างเปล่า (ไม่พบข้อมูลในชีตแรก)');
      }
      
      // Smart File Validation
      const firstRow = data[0] as any;
      const columns = Object.keys(firstRow).map(k => k.toLowerCase());
      
      if (!columns.includes('hoscode') && !columns.includes('hospcode') && !columns.includes('hosp')) {
        throw new Error('ไม่พบคอลัมน์ "hoscode" ในไฟล์นี้ โปรดตรวจสอบรูปแบบไฟล์');
      }
      if (!columns.includes('cid')) {
        throw new Error('ไม่พบคอลัมน์ "cid" (เลขบัตรประชาชน) ในไฟล์นี้');
      }
      if (!columns.some(col => col.includes('_date') || col === 'bcg' || col.includes('hbv'))) {
         throw new Error('ไฟล์นี้ไม่ใช่ไฟล์รายงานความครอบคลุมวัคซีน (ไม่พบคอลัมน์วันที่รับบริการ)');
      }

      const cleaned = cleanData(data);
      
      setTotalRows(cleaned.length);
      setPreviewData(cleaned.slice(0, 10)); // Show 10 rows
      setStatus('idle');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setFile(null); // Reset file if validation fails
      setErrorMsg(err.message || 'ไม่สามารถอ่านไฟล์ Excel ได้ โปรดตรวจสอบรูปแบบไฟล์');
    }
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setStatus('uploading');
    setProgress(0);
    setErrorMsg('');
    setResults({inserted: 0, updated: 0, deactivated: 0});

    try {
      const ab = await file.arrayBuffer();
      const wb = read(ab, { type: 'array', cellDates: true });
      const data = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const allRows = cleanData(data);
      
      const batchId = uuidv4();
      const touchedHoscodes = Array.from(new Set(allRows.map(r => r.hoscode).filter(Boolean))) as string[];
      
      let inserted = 0;
      let updated = 0;

      // Chunking
      for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
        const chunk = allRows.slice(i, i + CHUNK_SIZE);
        
        const res = await fetchApi('upsertEpiData', { chunk, batchId, fiscalYear, targetTable });
        const payload = res.data;
        
        if (payload.error) throw new Error(payload.error);
        inserted += payload.inserted || 0;
        updated += payload.updated || 0;
        
        const currentProgress = Math.floor(((i + chunk.length) / allRows.length) * 80); // 80% for upload phase
        setProgress(currentProgress);
      }

      // Cleanup Phase
      setStatus('cleaning');
      const cleanupRes = await fetchApi('cleanupEpiData', { batchId, touchedHoscodes, fiscalYear, targetTable });
      const cleanupPayload = cleanupRes.data;
      if (cleanupPayload.error) throw new Error(cleanupPayload.error);
      
      // Generate and Save Dashboard Summary
      setStatus('generating_summary');
      setProgress(90);
      
      const fullDataRes = await fetchApi('getEpiData', { targetTable, fiscalYear: Number(fiscalYear), hoscode: '00588' });
      const fullData = fullDataRes.data.data || fullDataRes.data || [];
      
      let evalV1, evalV2;
      switch (targetTable) {
        case 'Epi_1_Year': evalV1 = evaluateView1; evalV2 = evaluateView2; break;
        case 'Epi_2_Year': evalV1 = evaluateView1_2Yr; evalV2 = evaluateView2_2Yr; break;
        case 'Epi_3_Year': evalV1 = evaluateView1_3Yr; evalV2 = evaluateView2_3Yr; break;
        case 'Epi_5_Year': evalV1 = evaluateView1_5Yr; evalV2 = evaluateView2_5Yr; break;
        default: throw new Error("Unknown target table for summary calculation.");
      }
      
      const summary = calcGroupSummary(fullData, evalV1, evalV2, Number(fiscalYear));
      await fetchApi('saveDashboardSummary', { targetTable, fiscalYear, summaryData: JSON.stringify(summary) });

      setProgress(100);
      setResults({ inserted, updated, deactivated: cleanupPayload.deactivated || 0 });
      setStatus('success');
      
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดระหว่างการนำเข้าข้อมูล');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewData([]);
    setTotalRows(0);
    setStatus('idle');
    setProgress(0);
    setErrorMsg('');
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    try {
      const tables: TargetTable[] = ['Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year'];
      for (const t of tables) {
        const fullDataRes = await fetchApi('getEpiData', { targetTable: t, fiscalYear: Number(fiscalYear), hoscode: '00588' });
        const fullData = fullDataRes.data.data || fullDataRes.data || [];
        
        let evalV1, evalV2;
        switch (t) {
          case 'Epi_1_Year': evalV1 = evaluateView1; evalV2 = evaluateView2; break;
          case 'Epi_2_Year': evalV1 = evaluateView1_2Yr; evalV2 = evaluateView2_2Yr; break;
          case 'Epi_3_Year': evalV1 = evaluateView1_3Yr; evalV2 = evaluateView2_3Yr; break;
          case 'Epi_5_Year': evalV1 = evaluateView1_5Yr; evalV2 = evaluateView2_5Yr; break;
          default: continue;
        }
        
        const summary = calcGroupSummary(fullData, evalV1, evalV2, Number(fiscalYear));
        await fetchApi('saveDashboardSummary', { targetTable: t, fiscalYear: Number(fiscalYear), summaryData: JSON.stringify(summary) });
      }
      toast.success('ประมวลผล Dashboard สำหรับทุกกลุ่มอายุเรียบร้อยแล้ว!');
    } catch (error: any) {
      console.error(error);
      toast.error('เกิดข้อผิดพลาดในการประมวลผล: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSyncing(false);
    }
  };

  return {
    file,
    previewData,
    totalRows,
    fiscalYear,
    setFiscalYear,
    targetTable,
    setTargetTable,
    isUploading,
    progress,
    status,
    errorMsg,
    results,
    isSyncing,
    handleDrop,
    handleUpload,
    handleReset,
    handleSyncAll,
  };
}

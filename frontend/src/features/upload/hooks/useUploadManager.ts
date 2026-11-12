import type { EpiAge } from '../../../shared/types/hdc';
import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseHdcFile } from '../utils/parseHdcFile';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { fetchApi } from '../../../shared/lib/api';
import { calcGroupSummary } from '../../../shared/utils/dashboardLogic';

import { evaluateDynamicV1, evaluateDynamicV2, markSourceAware } from '../../../shared/utils/vaccine/ruleEngine';
import type { VaccineRule } from '../../../shared/utils/vaccine/ruleEngine';
import { getAgeGroupFromTable, getAgeFromTable } from '../utils/uploadHelpers';
import { getBirthDateRangeForQuarter } from '../../../shared/utils/dateUtils';
import type { EpiRecord } from '../../../shared/types';
const CHUNK_SIZE = 500;
async function saveSummary(payload: Record<string, unknown>) {
  const response = await fetchApi('saveDashboardSummary', payload);
  if (response.data?.error || response.data?.success === false) throw new Error(response.data.error || 'บันทึกสรุปไม่สำเร็จ');
}

export type TargetTable = 'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year';

export const TABLE_LABEL: Record<TargetTable, string> = {
  Epi_1_Year: 'เด็ก 1 ปี', Epi_2_Year: 'เด็ก 2 ปี', Epi_3_Year: 'เด็ก 3 ปี', Epi_5_Year: 'เด็ก 5 ปี',
};

/** The four Age Group tables Summary Regeneration processes. */
export const SUMMARY_REGENERATION_TABLES: readonly TargetTable[] = ['Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year'];

/**
 * Issue #134: writes the Dashboard Summaries (`_all` + Q1–Q4) of one table and Fiscal Year from its
 * Active Records, for both Summary Regeneration and the post-import step. A table with no Active Records
 * gets no summary at all and its existing rows are left untouched (CONTEXT.md §44). An empty cohort or
 * quarter inside a table with records is still a real 0. Returns false when the table was skipped.
 */
async function writeTableSummaries(targetTable: TargetTable, fiscalYear: string): Promise<boolean> {
  const fullDataRes = await fetchApi('getEpiData', { targetTable, fiscalYear: Number(fiscalYear), hoscode: '00588' });
  const fullData = fullDataRes.data; // getEpiData คืน array ตรงๆ (ถ้าไม่มี sheet คืน [])
  if (!Array.isArray(fullData)) throw new Error('รูปแบบข้อมูล EPI ไม่ถูกต้อง (ต้องเป็น array)');
  if (fullData.length === 0) return false;

  // ดึง Rules จาก Database สำหรับปีงบประมาณและกลุ่มอายุนี้
  const ageGroup = getAgeGroupFromTable(targetTable);
  const rulesRes = await fetchApi('getVaccineRules', { fiscalYear, ageGroup });
  const rules: VaccineRule[] = rulesRes.data;
  if (!Array.isArray(rules)) throw new Error('รูปแบบข้อมูล vaccine rules ไม่ถูกต้อง (ต้องเป็น array)');

  // View 1 ใช้ rules จากฐานข้อมูล (view_type=1) ร่วมกับหน้ารายบุคคล; View 2 ใช้ view_type=2
  const dbRules = markSourceAware(rules);
  const evalV1 = (r: EpiRecord) => evaluateDynamicV1(r, dbRules);
  const evalV2 = (r: EpiRecord) => evaluateDynamicV2(r, dbRules);

  const targetAge = getAgeFromTable(targetTable);
  const rangeAll = getBirthDateRangeForQuarter(Number(fiscalYear), 'all', targetAge);
  const cohortAll = fullData.filter((record: EpiRecord) => new Date(record.birth) >= rangeAll.start && new Date(record.birth) <= rangeAll.end);
  const summaryAll = calcGroupSummary(cohortAll, evalV1, evalV2, Number(fiscalYear), dbRules);
  await saveSummary({ targetTable, fiscalYear: Number(fiscalYear), quarter: 'all', summaryData: JSON.stringify(summaryAll) });

  for (const q of [1, 2, 3, 4] as const) {
    const { start, end } = getBirthDateRangeForQuarter(Number(fiscalYear), q, targetAge);
    const quarterData = fullData.filter((record: any) => {
      if (!record.birth) return false;
      const bDate = new Date(record.birth);
      return bDate >= start && bDate <= end;
    });
    const summaryQ = calcGroupSummary(quarterData, evalV1, evalV2, Number(fiscalYear), dbRules);
    await saveSummary({ targetTable, fiscalYear: Number(fiscalYear), quarter: q, summaryData: JSON.stringify(summaryQ) });
  }
  return true;
}
export type UploadStatus = 'idle' | 'parsing' | 'preflighting' | 'confirming' | 'uploading' | 'cleaning' | 'generating_summary' | 'success' | 'error';

/**
 * Issue #136: each risk condition has its own typed number. `existingChildren` is the #111 zero-match / shrink
 * number; `outsideCohort` counts file rows born outside the selected Cohort Birth Range (CONTEXT.md §46).
 */
export type RiskConfirmation = 'existingChildren' | 'outsideCohort';
export type TypedConfirmations = Partial<Record<RiskConfirmation, string>>;

/** Issue #111: server-side preview of an import — counts and facility codes only, never identities. */
export interface ImportPreflight {
  batchId: string;
  targetTable: TargetTable;
  fiscalYear: string;
  mode: 'merge' | 'sync';
  matched: number;
  newRows: number;
  wouldDeactivate: number;
  activeBefore: number;
  outsideCohort: number;
  byHoscode: Array<{ hoscode: string; activeBefore: number; matched: number; newRows: number; wouldDeactivate: number; outsideCohort: number }>;
  risk: { zeroMatchHoscodes: string[]; shrinkOverThreshold: boolean; outsideCohort: boolean };
  /** The selected Age Group and Fiscal Year's Cohort Birth Range, CE `yyyy-MM-dd`, inclusive. */
  cohortBirthRange: { start: string; end: string };
  /** The one Fiscal Year (same Age Group) every out-of-range birth matches; null when none or several. */
  outsideCohortFiscalYear: string | null;
  /** The numbers the admin must type, one per fired condition, before the server accepts any write; null when the import is safe. */
  requiredConfirmations: Partial<Record<RiskConfirmation, number>> | null;
  /** The sync shrink ratio the server applied (single source: backend EPI_SYNC_SHRINK_THRESHOLD). */
  shrinkThreshold: number;
}

/** Record Identity (CONTEXT.md §3): the only fields sent to preflight. */
const RECORD_IDENTITY_FIELDS = ['hoscode', 'pid', 'cid', 'sex', 'birth', 'check_vhid'] as const;
const recordIdentityOf = (row: Record<string, unknown>) =>
  Object.fromEntries(RECORD_IDENTITY_FIELDS.filter(field => row[field] !== undefined).map(field => [field, row[field]]));

export function useUploadManager() {
  const queryClient = useQueryClient();
  const [importMode, setImportMode] = useState<'merge' | 'sync'>('merge');
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  // Issue #136: no default — a preselected current year caused a wrong-year import; the admin must choose.
  const [fiscalYear, setFiscalYear] = useState<string>('');
  const [targetTable, setTargetTable] = useState<TargetTable>('Epi_1_Year');
  
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [results, setResults] = useState<{inserted: number, updated: number, deactivated: number}>({inserted: 0, updated: 0, deactivated: 0});
  const [isSyncing, setIsSyncing] = useState(false);
  /** Issue #134: the last import wrote no Dashboard Summary because its table has no Active Records left. */
  const [summarySkipped, setSummarySkipped] = useState(false);
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  // The parsed rows and the scope they were preflighted for; the import uses exactly these.
  const pendingRef = useRef<{ batchId: string; rows: any[]; fiscalYear: string; targetTable: TargetTable; importMode: 'merge' | 'sync' } | null>(null);

  const handleDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || isUploading) return;
    setPreviewData([]);
    setSourceColumns([]);
    setTotalRows(0);
    const selected = acceptedFiles[0];
    setFile(selected);
    setStatus('parsing');
    setErrorMsg('');

    try {
      const { rows: cleaned, columns } = await parseHdcFile(selected, getAgeFromTable(targetTable) as EpiAge);
      setSourceColumns(columns);
      setTotalRows(cleaned.length);
      setPreviewData(cleaned.slice(0, 10)); // Show 10 rows
      setStatus('idle');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setFile(null); // Reset file if validation fails
      setErrorMsg(err.message || 'ไม่สามารถอ่านไฟล์ Excel ได้ โปรดตรวจสอบรูปแบบไฟล์');
    }
  }, [targetTable, isUploading]);

  /** Phase 1 (Issue #111): read-only server preflight. Nothing is written until confirmUpload(). */
  const handleUpload = useCallback(async () => {
    if (!file || !fiscalYear || isUploading || status === 'parsing' || status === 'confirming') return;
    setIsUploading(true);
    setStatus('preflighting');
    setErrorMsg('');

    try {
      const { rows } = await parseHdcFile(file, getAgeFromTable(targetTable) as EpiAge);
      const batchId = uuidv4();
      const keyChunks = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) keyChunks.push(rows.slice(i, i + CHUNK_SIZE).map(recordIdentityOf));
      const res = await fetchApi('preflightEpiImport', { keyChunks, batchId, fiscalYear, targetTable, mode: importMode });
      const payload = res.data;
      if (!payload || payload.error || payload.success === false) throw new Error(payload?.error || 'ตรวจสอบไฟล์ก่อนนำเข้าไม่สำเร็จ');
      pendingRef.current = { batchId, rows, fiscalYear, targetTable, importMode };
      setPreflight(payload as ImportPreflight);
      setStatus('confirming');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'ตรวจสอบไฟล์ก่อนนำเข้าไม่สำเร็จ');
    } finally {
      setIsUploading(false);
    }
  }, [file, fiscalYear, targetTable, importMode, isUploading, status]);

  const cancelPreflight = useCallback(() => {
    pendingRef.current = null;
    setPreflight(null);
    setErrorMsg('');
    setStatus('idle');
  }, []);

  /** Phase 2: typed confirmation (server-checked, one number per fired condition) when required, then the import itself. */
  const confirmUpload = useCallback(async (typedNumbers?: TypedConfirmations) => {
    const pending = pendingRef.current;
    if (!pending || !preflight || isUploading) return;
    setIsUploading(true);
    setErrorMsg('');
    if (preflight.requiredConfirmations != null) {
      try {
        const res = await fetchApi('confirmEpiImport', { batchId: pending.batchId, typedNumbers });
        if (res.data?.error || res.data?.success === false) throw new Error(res.data?.error || 'ยืนยันไม่สำเร็จ');
      } catch (err: any) {
        console.error(err);
        setErrorMsg(err.message === 'Typed number does not match.'
          ? 'ตัวเลขยืนยันไม่ตรงกับจำนวนที่ระบบคำนวณ กรุณาตรวจสอบแล้วพิมพ์ใหม่'
          : `ยืนยันไม่สำเร็จ: ${err.message || 'เกิดข้อผิดพลาด'}`);
        setIsUploading(false);
        return;
      }
    }
    setStatus('uploading');
    setProgress(0);
    setResults({inserted: 0, updated: 0, deactivated: 0});
    setSummarySkipped(false);
    const { batchId, rows: allRows, fiscalYear, targetTable, importMode } = pending;

    try {
      const touchedHoscodes = Array.from(new Set(allRows.map(r => r.hoscode).filter(Boolean))) as string[];
      
      let inserted = 0;
      let updated = 0;

      // Chunking
      for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
        const chunk = allRows.slice(i, i + CHUNK_SIZE);
        
        const res = await fetchApi('upsertEpiData', { chunk, batchId, fiscalYear, targetTable, options: { mode: importMode, chunkIndex: i / CHUNK_SIZE, totalChunks: Math.ceil(allRows.length / CHUNK_SIZE) } });
        const payload = res.data;
        
        if (payload.error) throw new Error(payload.error);
        inserted += payload.inserted || 0;
        updated += payload.updated || 0;
        setResults({ inserted, updated, deactivated: 0 });
        
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
      // Issue #134: a Full-File Sync that deactivated every record leaves no Active Records, so no summary.
      setSummarySkipped(!(await writeTableSummaries(targetTable, fiscalYear)));

      setProgress(100);
      setResults({ inserted, updated, deactivated: cleanupPayload.deactivated || 0 });
      setStatus('success');
      
      // Invalidate relevant queries to force dashboard and rules refresh
      queryClient.invalidateQueries({ queryKey: ['dashboardSummaries'] });
      // Issue #22: Comparison reads must refresh too (separate query family), plus
      // the summary-derived usable comparison years.
      queryClient.invalidateQueries({ queryKey: ['dashboardSummariesMultiYear'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummaryYears'] });
      queryClient.invalidateQueries({ queryKey: ['vaccineRules'] });
      queryClient.invalidateQueries({ queryKey: ['epiData'] });
      
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดระหว่างการนำเข้าข้อมูล');
    } finally {
      queryClient.invalidateQueries({ queryKey: ['epiData'] });
      pendingRef.current = null;
      setPreflight(null);
      setIsUploading(false);
    }
  }, [preflight, queryClient, isUploading]);

  const handleReset = useCallback(() => {
    pendingRef.current = null;
    setPreflight(null);
    setFile(null);
    setPreviewData([]);
    setSourceColumns([]);
    setTotalRows(0);
    setStatus('idle');
    setProgress(0);
    setErrorMsg('');
    setSummarySkipped(false);
  }, []);

  const handleSyncAll = useCallback(async () => {
    if (!fiscalYear) return; // Issue #136: never regenerate a year the admin did not choose
    setIsSyncing(true);
    // Issue #134: refresh unless the run certainly wrote nothing; a failure part-way may follow saved tables.
    let wroteNothing = false;
    try {
      const skippedLabels: string[] = [];
      for (const table of SUMMARY_REGENERATION_TABLES) {
        if (!(await writeTableSummaries(table, fiscalYear))) skippedLabels.push(TABLE_LABEL[table]);
      }
      if (skippedLabels.length === SUMMARY_REGENERATION_TABLES.length) {
        wroteNothing = true;
        toast.error(`ไม่มีข้อมูลปีงบประมาณ ${fiscalYear} ในทุกกลุ่มอายุ — ไม่ได้บันทึกสรุป`);
      } else if (skippedLabels.length > 0) {
        const regeneratedCount = SUMMARY_REGENERATION_TABLES.length - skippedLabels.length;
        toast.warning(`ประมวลผลปีงบประมาณ ${fiscalYear} แล้ว ${regeneratedCount} กลุ่มอายุ · ข้าม${skippedLabels.join(', ')} (ไม่มีข้อมูลปีนี้)`);
      } else {
        toast.success('ประมวลผล Dashboard สำหรับทุกกลุ่มอายุเรียบร้อยแล้ว!');
      }
    } catch (error: any) {
      console.error(error);
      toast.error('เกิดข้อผิดพลาดในการประมวลผล: ' + (error.message || 'Unknown error'));
    } finally {
      if (!wroteNothing) {
        // Invalidate relevant queries to force dashboard and rules refresh
        queryClient.invalidateQueries({ queryKey: ['dashboardSummaries'] });
        // Issue #22: Comparison reads must refresh too (separate query family), plus
        // the summary-derived usable comparison years.
        queryClient.invalidateQueries({ queryKey: ['dashboardSummariesMultiYear'] });
        queryClient.invalidateQueries({ queryKey: ['dashboardSummaryYears'] });
        queryClient.invalidateQueries({ queryKey: ['vaccineRules'] });
        queryClient.invalidateQueries({ queryKey: ['epiData'] });
      }
      setIsSyncing(false);
    }
  }, [fiscalYear, queryClient]);

  return {
    importMode, setImportMode, sourceColumns,
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
    summarySkipped,
    isSyncing,
    handleDrop,
    handleUpload,
    preflight,
    confirmUpload,
    cancelPreflight,
    handleReset,
    handleSyncAll,
  };
}

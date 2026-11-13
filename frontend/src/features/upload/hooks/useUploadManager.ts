import type { EpiAge } from '../../../shared/types/hdc';
import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseHdcFile } from '../utils/parseHdcFile';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { fetchApi, LostResponseError, LOST_RESPONSE_MESSAGE } from '../../../shared/lib/api';
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
export type UploadStatus = 'idle' | 'parsing' | 'preflighting' | 'confirming' | 'uploading' | 'generating_summary' | 'success' | 'error';

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
  risk: { zeroMatchHoscodes: string[]; shrinkOverThreshold: boolean; outsideCohortBirthRange: boolean };
  /** The selected Age Group and Fiscal Year's Cohort Birth Range, CE `yyyy-MM-dd`, inclusive. */
  cohortBirthRange: { start: string; end: string };
  /** The one Fiscal Year (same Age Group) every out-of-range birth matches; null when none or several. */
  outsideCohortFiscalYear: string | null;
  /** The numbers the admin must type, one per fired condition, before the server accepts any write; null when the import is safe. */
  requiredConfirmations: Partial<Record<RiskConfirmation, number>> | null;
  /** The sync shrink ratio the server applied (single source: backend EPI_SYNC_SHRINK_THRESHOLD). */
  shrinkThreshold: number;
}

/** Issue #139/#140: why the server refused Import Undo (ADR-0009, ADR-0010); `stale` and `unfinished_mismatch` come only from the undo call itself. */
export type UndoRefusalReason = 'no_batch' | 'in_progress' | 'already_undone' | 'not_recorded' | 'updated_existing' | 'newer_import' | 'stale' | 'unfinished_mismatch';
type UndoCallOnlyReason = 'stale' | 'unfinished_mismatch';

const REIMPORT_RECOVERY = 'วิธีแก้: นำเข้าไฟล์ที่ถูกต้องอีกครั้งแบบ "ซิงค์ไฟล์เต็ม"';
/** Thai wording of each refusal, with the recovery where one exists (CONTEXT.md §47). */
export const UNDO_REFUSAL_TEXT: Record<UndoRefusalReason, { reason: string; recovery?: string }> = {
  no_batch: { reason: 'ยังไม่มีการนำเข้าของกลุ่มอายุและปีงบประมาณนี้ จึงไม่มีการนำเข้าให้ย้อน' },
  in_progress: { reason: 'การนำเข้าล่าสุดยังอัปโหลดไม่เสร็จ จึงยังย้อนไม่ได้', recovery: 'รอให้การนำเข้าเสร็จแล้วลองใหม่ หรือนำเข้าไฟล์ที่ถูกต้องอีกครั้งแบบ "ซิงค์ไฟล์เต็ม"' },
  already_undone: { reason: 'การนำเข้าล่าสุดถูกย้อนไปแล้ว ระบบย้อนได้เพียงขั้นเดียว', recovery: REIMPORT_RECOVERY },
  not_recorded: { reason: 'การนำเข้าล่าสุดทำก่อนมีระบบย้อนการนำเข้า ระบบจึงไม่ทราบแน่ชัดว่าแถวใดถูกเปลี่ยน', recovery: REIMPORT_RECOVERY },
  updated_existing: { reason: 'การนำเข้าล่าสุดอัปเดตข้อมูลเด็กที่มีอยู่แล้ว ระบบคืนค่าวัคซีนที่ถูกเขียนทับไม่ได้', recovery: REIMPORT_RECOVERY },
  newer_import: { reason: 'มีการนำเข้าที่ใหม่กว่าเขียนข้อมูลของกลุ่มอายุและปีงบประมาณนี้แล้ว', recovery: REIMPORT_RECOVERY },
  stale: { reason: 'ตัวอย่างล้าสมัยเพราะข้อมูลเปลี่ยนไปหลังแสดงผล โปรดตรวจตัวเลขใหม่แล้วยืนยันอีกครั้ง' },
  unfinished_mismatch: { reason: 'ข้อมูลไม่ตรงกับการย้อนที่ยังไม่เสร็จแล้ว ระบบจึงย้อนต่อให้เสร็จไม่ได้ โปรดติดต่อผู้ดูแลระบบ' },
};

/** Issue #140: an Import is refused while an Import Undo of the same table and Fiscal Year is unfinished (ADR-0010). */
function importRefusalText(payload: { reason?: string; error?: string } | undefined, table: TargetTable, year: string, fallback: string) {
  if (payload?.reason === 'unfinished_undo') {
    return `การย้อนการนำเข้าของ ${TABLE_LABEL[table]} · ปีงบประมาณ ${year} ยังไม่เสร็จ จึงยังนำเข้าไม่ได้ โปรดกด "ย้อนต่อให้เสร็จ" ในส่วน "ย้อนการนำเข้าล่าสุด" ก่อน`;
  }
  return payload?.error || fallback;
}

interface UndoScope { targetTable: TargetTable; fiscalYear: string }
/** Issue #139: the server-computed preview of Import Undo for the latest written Batch — counts and facility codes only. */
export type ImportUndoPreview = UndoScope & (
  | { eligible: true; unfinished?: false; batchId: string; mode: 'merge' | 'sync'; importedAt: string | null; importedBy: string | null;
      wouldDeactivate: number; wouldReactivate: number; activeAfter: number; summariesWillBeRemoved: boolean;
      byHoscode: Array<{ hoscode: string; wouldDeactivate: number; wouldReactivate: number }> }
  // Issue #140: an Unfinished Import Undo; the counts are its plan, so there is no per-facility breakdown.
  | { eligible: true; unfinished: true; batchId: string; mode: 'merge' | 'sync'; importedAt: string | null; importedBy: string | null;
      startedBy: string | null; startedAt: string; wouldDeactivate: number; wouldReactivate: number; activeAfter: number; summariesWillBeRemoved: boolean }
  | { eligible: false; reason: Exclude<UndoRefusalReason, UndoCallOnlyReason>; batchId?: string; mode?: 'merge' | 'sync'; importedAt?: string | null; importedBy?: string | null }
);
export interface ImportUndoResult extends UndoScope { deactivated: number; reactivated: number; summariesRemoved: boolean; summaryFailed: boolean }

const NOT_FINALIZED_TEXT = 'ระบบยังไม่ปิดการนำเข้าชุดนี้ กรุณานำเข้าไฟล์ใหม่อีกครั้ง';

/**
 * Issue #156: after a Lost Response (CONTEXT.md §50) on a chunk, the Import Undo preview's latest written receipt
 * tells whether the server finalized this Batch. Only `batchId` and `importedAt` are read; nothing is resent.
 */
async function isBatchFinalized(batchId: string, targetTable: TargetTable, fiscalYear: string): Promise<boolean> {
  try {
    const res = await fetchApi('previewEpiImportUndo', { targetTable, fiscalYear });
    const payload = res.data;
    if (!payload || payload.error || payload.success === false) throw new Error(payload?.error || 'เกิดข้อผิดพลาด');
    return payload.batchId === batchId && !!payload.importedAt;
  } catch (err) {
    console.error(err);
    throw new Error(`${LOST_RESPONSE_MESSAGE} — ดูส่วน "ย้อนการนำเข้าล่าสุด" ก่อนนำเข้าไฟล์อีกครั้ง`);
  }
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
  /** Issue #156: the last import succeeded, but a Lost Response means its counts never arrived. */
  const [countsNotReceived, setCountsNotReceived] = useState(false);
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  // The parsed rows and the scope they were preflighted for; the import uses exactly these.
  const pendingRef = useRef<{ batchId: string; rows: any[]; fiscalYear: string; targetTable: TargetTable; importMode: 'merge' | 'sync' } | null>(null);

  // Issue #139: Import Undo has its own scope, with no default table or year (consistent with #136).
  const [undoTable, setUndoTableState] = useState<TargetTable | ''>('');
  const [undoFiscalYear, setUndoFiscalYearState] = useState('');
  const [undoPreview, setUndoPreview] = useState<ImportUndoPreview | null>(null);
  const [undoResult, setUndoResult] = useState<ImportUndoResult | null>(null);
  const [undoError, setUndoError] = useState('');
  const [isUndoing, setIsUndoing] = useState(false);
  const undoRequestRef = useRef(0); // only the latest preview request may land

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
      if (!payload || payload.error || payload.success === false) throw new Error(importRefusalText(payload, targetTable, fiscalYear, 'ตรวจสอบไฟล์ก่อนนำเข้าไม่สำเร็จ'));
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
    setCountsNotReceived(false);
    const { batchId, rows: allRows, fiscalYear, targetTable, importMode } = pending;

    try {
      let inserted = 0;
      let updated = 0;
      let finalized = false;
      let deactivated = 0;
      let countsLost = false;

      // Chunking
      for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
        const chunk = allRows.slice(i, i + CHUNK_SIZE);

        let res;
        try {
          res = await fetchApi('upsertEpiData', { chunk, batchId, fiscalYear, targetTable, options: { mode: importMode, chunkIndex: i / CHUNK_SIZE, totalChunks: Math.ceil(allRows.length / CHUNK_SIZE) } });
        } catch (err) {
          if (!(err instanceof LostResponseError)) throw err;
          // Issue #156: stop sending chunks and check this Batch instead; a chunk is never resent automatically.
          finalized = await isBatchFinalized(batchId, targetTable, fiscalYear);
          countsLost = true;
          break;
        }
        const payload = res.data;
        
        if (payload.error) throw new Error(importRefusalText(payload, targetTable, fiscalYear, payload.error));
        inserted += payload.inserted || 0;
        updated += payload.updated || 0;
        finalized = payload.finalized === true;
        deactivated = payload.deactivated || 0;
        setResults({ inserted, updated, deactivated: 0 });
        
        const currentProgress = Math.floor(((i + chunk.length) / allRows.length) * 80); // 80% for upload phase
        setProgress(currentProgress);
      }

      // Issue #144 (ADR-0011): the server finalizes the batch with its last chunk; there is no separate cleanup request.
      if (!finalized) throw new Error(NOT_FINALIZED_TEXT);

      // Generate and Save Dashboard Summary
      setStatus('generating_summary');
      setProgress(90);
      // Issue #134: a Full-File Sync that deactivated every record leaves no Active Records, so no summary.
      setSummarySkipped(!(await writeTableSummaries(targetTable, fiscalYear)));

      setProgress(100);
      setResults({ inserted, updated, deactivated });
      setCountsNotReceived(countsLost);
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
    setCountsNotReceived(false);
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

  const loadUndoPreview = useCallback(async (table: TargetTable | '', year: string) => {
    const request = ++undoRequestRef.current;
    setUndoPreview(null);
    if (!table || !year) return;
    try {
      const res = await fetchApi('previewEpiImportUndo', { targetTable: table, fiscalYear: year });
      const payload = res.data;
      if (!payload || payload.error || payload.success === false) throw new Error(payload?.error || 'เกิดข้อผิดพลาด');
      if (request === undoRequestRef.current) setUndoPreview(payload as ImportUndoPreview);
    } catch (err: any) {
      console.error(err);
      if (request === undoRequestRef.current) setUndoError(`ตรวจสอบการนำเข้าล่าสุดไม่สำเร็จ: ${err.message || 'เกิดข้อผิดพลาด'}`);
    }
  }, []);

  /** Choosing a table or year starts a fresh preview once both are chosen. */
  const selectUndoScope = useCallback((table: TargetTable | '', year: string) => {
    setUndoTableState(table);
    setUndoFiscalYearState(year);
    setUndoResult(null);
    setUndoError('');
    void loadUndoPreview(table, year);
  }, [loadUndoPreview]);
  const setUndoTable = useCallback((table: TargetTable | '') => selectUndoScope(table, undoFiscalYear), [selectUndoScope, undoFiscalYear]);
  const setUndoFiscalYear = useCallback((year: string) => selectUndoScope(undoTable, year), [selectUndoScope, undoTable]);

  const cancelUndo = useCallback(() => selectUndoScope(undoTable, ''), [selectUndoScope, undoTable]);

  /** One confirm click: the server re-checks everything against the previewed counts, then the summaries follow. */
  const confirmUndo = useCallback(async () => {
    const preview = undoPreview;
    if (!preview?.eligible || isUndoing) return;
    setIsUndoing(true);
    setUndoError('');
    try {
      const res = await fetchApi('undoEpiImport', { batchId: preview.batchId,
        expected: { wouldDeactivate: preview.wouldDeactivate, wouldReactivate: preview.wouldReactivate } });
      const payload = res.data;
      if (payload?.success !== true) {
        const refusal = UNDO_REFUSAL_TEXT[payload?.reason as UndoRefusalReason];
        setUndoError(refusal ? refusal.reason : `ย้อนการนำเข้าไม่สำเร็จ: ${payload?.error || 'เกิดข้อผิดพลาด'}`);
        await loadUndoPreview(preview.targetTable, preview.fiscalYear); // show what the server sees now
        return;
      }
      let summaryFailed = false;
      // The server deletes the summaries itself when no Active Records remain (CONTEXT.md §44); otherwise rewrite them.
      if (!payload.summariesRemoved) {
        try {
          await writeTableSummaries(preview.targetTable, preview.fiscalYear);
        } catch (err) {
          console.error(err);
          summaryFailed = true;
          toast.error('ย้อนการนำเข้าแล้ว แต่สร้างสรุป Dashboard ไม่สำเร็จ โปรดกด "ประมวลผล Dashboard ใหม่"');
        }
      }
      setUndoResult({ targetTable: preview.targetTable, fiscalYear: preview.fiscalYear, deactivated: payload.deactivated,
        reactivated: payload.reactivated, summariesRemoved: payload.summariesRemoved, summaryFailed });
      setUndoPreview(null);
      queryClient.invalidateQueries({ queryKey: ['dashboardSummaries'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummariesMultiYear'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummaryYears'] });
      queryClient.invalidateQueries({ queryKey: ['epiData'] });
    } catch (err: any) {
      console.error(err);
      setUndoError(`ย้อนการนำเข้าไม่สำเร็จ: ${err.message || 'เกิดข้อผิดพลาด'}`);
      await loadUndoPreview(preview.targetTable, preview.fiscalYear); // Issue #140: the undo may now be unfinished
    } finally {
      setIsUndoing(false);
    }
  }, [undoPreview, isUndoing, loadUndoPreview, queryClient]);

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
    countsNotReceived,
    isSyncing,
    handleDrop,
    handleUpload,
    preflight,
    confirmUpload,
    cancelPreflight,
    handleReset,
    handleSyncAll,
    undoTable,
    setUndoTable,
    undoFiscalYear,
    setUndoFiscalYear,
    undoPreview,
    undoResult,
    undoError,
    isUndoing,
    confirmUndo,
    cancelUndo,
  };
}

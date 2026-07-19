import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { read, utils } from 'xlsx';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '../../../shared/components/ui/button';
import { Progress } from '../../../shared/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '../../../shared/components/ui/alert';
import { SubNav } from '../../../widgets/layout/SubNav';
import { fetchApi } from '../../../shared/lib/api';
import { v4 as uuidv4 } from 'uuid';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '../../../shared/components/ui/confirm-modal';
import { calcGroupSummary } from '../../../shared/utils/dashboardLogic';
import { evaluateView1, evaluateView2 } from '../../vaccine-1yr/utils/vaccineLogic';
import { evaluateView1_2Yr, evaluateView2_2Yr } from '../../vaccine-2yr/utils/vaccineLogic';
import { evaluateView1_3Yr, evaluateView2_3Yr } from '../../vaccine-3yr/utils/vaccineLogic';
import { evaluateView1_5Yr, evaluateView2_5Yr } from '../../vaccine-5yr/utils/vaccineLogic5Yr';

const CHUNK_SIZE = 500;

export function UploadDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [fiscalYear, setFiscalYear] = useState<string>(
    String(new Date().getFullYear() + 543 + (new Date().getMonth() >= 9 ? 1 : 0))
  );
  const [targetTable, setTargetTable] = useState<'Epi_1_Year' | 'Epi_2_Year' | 'Epi_3_Year' | 'Epi_5_Year'>('Epi_1_Year');
  
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'cleaning' | 'generating_summary' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [results, setResults] = useState<{inserted: number, updated: number, deactivated: number}>({inserted: 0, updated: 0, deactivated: 0});

  // Date parser helper
  const parseDate = (val: any) => {
    if (!val) return null;
    if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}$/)) return val;
    
    // Attempt to parse Excel date serial number or JS Date
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch {
      // Ignore parse error
    }
    
    // If it's a serial number from Excel
    if (typeof val === 'number') {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
    return String(val); // Fallback
  };

  const cleanData = (data: any[]) => {
    return data.map(row => {
      const cleanRow: any = {};
      Object.keys(row).forEach(key => {
        let val = row[key];
        if (val === '<NA>' || val === 'NA' || val === '' || val === undefined) {
          val = null;
        }
        
        // Force string and pad for specific columns
        if (val !== null && ['hoscode', 'pid', 'cid', 'check_vhid'].includes(key.toLowerCase())) {
          val = String(val).trim();
          
          // Best Practice: Preserve leading zeros in case Excel parsed them as pure numbers
          if (key.toLowerCase() === 'hoscode' || key.toLowerCase() === 'hosp') {
            val = val.padStart(5, '0');
          } else if (key.toLowerCase() === 'cid') {
            val = val.padStart(13, '0');
          }
        }
        
        // Parse dates
        if (val !== null && (key.toLowerCase().includes('date') || key.toLowerCase() === 'birth')) {
          val = parseDate(val);
        }
        
        cleanRow[key.toLowerCase()] = val;
      });
      return cleanRow;
    });
  };

  const getAgeString = (birthDateString: string) => {
    if (!birthDateString) return '';
    const birth = new Date(birthDateString);
    if (isNaN(birth.getTime())) return '';
    const now = new Date();
    
    let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
    if (now.getDate() < birth.getDate()) {
      months--;
    }
    
    if (months < 0) return '0 เดือน';
    
    const y = Math.floor(months / 12);
    const m = months % 12;
    
    if (y > 0 && m > 0) return `${y} ปี ${m} เดือน`;
    if (y > 0) return `${y} ปี`;
    return `${m} เดือน`;
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
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
         // This assumes EPI files will have columns ending in _date or specific vaccine names
         // If HDC 1 year has 'bcg_date', this passes.
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    maxFiles: 1
  });

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setStatus('uploading');
    setProgress(0);
    setErrorMsg('');
    setResults({inserted: 0, updated: 0, deactivated: 0});

    try {
      // Re-parse the whole file (or we could store it in state if memory allows, but re-parsing is safer for large files)
      const ab = await file.arrayBuffer();
      const wb = read(ab, { type: 'array', cellDates: true });
      const data = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const allRows = cleanData(data);
      
      const batchId = uuidv4();
      const touchedHoscodes = Array.from(new Set(allRows.map(r => r.hoscode).filter(Boolean)));
      
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
      
      // ── Generate and Save Dashboard Summary ──
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

  const [isSyncing, setIsSyncing] = useState(false);
  const handleSyncAll = async () => {
    setIsSyncing(true);
    try {
      const tables = ['Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year'];
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

  return (
    <>
      <SubNav title="นำเข้าข้อมูลวัคซีน (EPI)" />
      
      <div className="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-8 space-y-6">
        <div className="max-w-2xl">
          <p className="text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">
            อัปโหลดไฟล์ Excel (.xlsx, .xls) ที่ส่งออกจากระบบ HDC เพื่อปรับปรุงฐานข้อมูลความครอบคลุมการได้รับวัคซีน
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-slate-900">1. ระบุปีงบประมาณ (บังคับ)</h3>
            <p className="text-sm text-slate-500 mt-1">
              โปรดเลือกปีงบประมาณของไฟล์ Excel นี้ก่อนทำการอัปโหลด 
              (ระบบจะจำกัดขอบเขตการอัปเดตให้อยู่แค่ในโควตาปีนี้เท่านั้น)
            </p>
          </div>
          <div className="w-full sm:w-64">
            <select 
              className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm font-medium disabled:opacity-50 disabled:bg-slate-50 disabled:cursor-not-allowed"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              disabled={!!file || status === 'success' || isUploading}
            >
              {Array.from({ length: 5 }, (_, i) => {
                const y = (new Date().getFullYear() + 543) - 2 + i;
                return (
                  <option key={y} value={y.toString()}>
                    ปีงบประมาณ {y}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-slate-900">2. เลือกกลุ่มเป้าหมาย (ช่วงอายุ)</h3>
            <p className="text-sm text-slate-500 mt-1">
              ระบบจะนำข้อมูลเข้าสู่ฐานข้อมูลแยกตามช่วงอายุที่คุณเลือก
            </p>
          </div>
          <div className="w-full sm:w-[450px] flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setTargetTable('Epi_1_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-sm font-medium rounded-md transition-all ${
                targetTable === 'Epi_1_Year' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 1 ปี
            </button>
            <button
              onClick={() => setTargetTable('Epi_2_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-sm font-medium rounded-md transition-all ${
                targetTable === 'Epi_2_Year' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 2 ปี
            </button>
            <button
              onClick={() => setTargetTable('Epi_3_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-sm font-medium rounded-md transition-all ${
                targetTable === 'Epi_3_Year' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 3 ปี
            </button>
            <button
              onClick={() => setTargetTable('Epi_5_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-sm font-medium rounded-md transition-all ${
                targetTable === 'Epi_5_Year' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 5 ปี
            </button>
          </div>
        </div>

      {status === 'error' && (
        <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {status === 'success' && (
        <Alert className="bg-emerald-50 text-emerald-800 border-emerald-200 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
          <AlertTitle className="text-emerald-900 font-bold text-base">นำเข้าข้อมูลสำเร็จ</AlertTitle>
          <AlertDescription className="text-emerald-800/90 mt-2">
            ประมวลผลข้อมูลสำเร็จจำนวน <strong className="font-semibold">{results.inserted + results.updated}</strong> รายการ
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <div className="bg-white/60 p-3 rounded-lg border border-emerald-100/50 flex flex-col">
                <span className="text-xs text-emerald-600 font-medium uppercase tracking-wider">เพิ่มข้อมูลใหม่</span>
                <span className="text-2xl font-bold text-emerald-700">{results.inserted.toLocaleString()}</span>
              </div>
              <div className="bg-white/60 p-3 rounded-lg border border-emerald-100/50 flex flex-col">
                <span className="text-xs text-emerald-600 font-medium uppercase tracking-wider">อัปเดตข้อมูลเดิม</span>
                <span className="text-2xl font-bold text-emerald-700">{results.updated.toLocaleString()}</span>
              </div>
              <div className="bg-white/60 p-3 rounded-lg border border-emerald-100/50 flex flex-col">
                <span className="text-xs text-emerald-600 font-medium uppercase tracking-wider">ลบ/ซ่อนข้อมูลเก่า</span>
                <span className="text-2xl font-bold text-emerald-700">{results.deactivated.toLocaleString()}</span>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {(!file || status === 'success') && (
        <div className="space-y-2">
          <h3 className="text-base font-medium text-slate-900 ml-1">3. อัปโหลดไฟล์ Excel</h3>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 ease-in-out
              ${isDragActive 
                ? 'border-blue-400 bg-blue-50/80 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)] scale-[1.01]' 
                : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
          >
          <input {...getInputProps()} />
          <UploadCloud className={`mx-auto h-14 w-14 mb-4 transition-colors duration-300 ${isDragActive ? 'text-blue-500 animate-bounce' : 'text-slate-300'}`} />
          <h3 className="text-lg font-semibold text-slate-900 mb-1 tracking-tight">
            ลากไฟล์ Excel มาวางที่นี่
          </h3>
          <p className="text-sm text-slate-500">
            หรือคลิกเพื่อเลือกไฟล์ (รองรับเฉพาะ .xlsx หรือ .xls)
          </p>
          </div>
        </div>
      )}

      {file && status !== 'success' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-primary/10 rounded-lg">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-slate-900">{file.name}</h3>
                <p className="text-sm text-slate-500">
                  {totalRows.toLocaleString()} rows • {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            {!isUploading && (
              <ConfirmModal
                title="ยกเลิกการนำเข้าข้อมูล"
                description="คุณต้องการยกเลิกการนำเข้าข้อมูลและรีเซ็ตค่าทั้งหมดใช่หรือไม่?"
                onConfirm={handleReset}
                confirmText="ยืนยัน"
                cancelText="ปิด"
              >
                <Button variant="outline" className="font-medium">
                  ยกเลิก
                </Button>
              </ConfirmModal>
            )}
          </div>

          <div className="p-6 space-y-6">
            {isUploading ? (
              <div className="space-y-4">
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-slate-600">
                    {status === 'cleaning' ? 'กำลังจัดระเบียบและตรวจสอบข้อมูลเก่า...' : 
                     status === 'generating_summary' ? 'กำลังประมวลผลข้อมูลภาพรวม Dashboard...' : 'กำลังนำเข้าข้อมูล...'}
                  </span>
                  <span className="text-primary font-bold">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2.5 bg-slate-100 transition-all duration-300" />
              </div>
            ) : (
              <div className="animate-in fade-in duration-500">
                <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  ตัวอย่างข้อมูล <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs font-medium">10 แถวแรก</span>
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50/80 text-slate-600 font-medium border-b border-slate-200 backdrop-blur-sm">
                      <tr>
                        <th className="px-4 py-3 whitespace-nowrap">รหัสสถานบริการ</th>
                        <th className="px-4 py-3 whitespace-nowrap">PID</th>
                        <th className="px-4 py-3 whitespace-nowrap">เลขบัตรประชาชน</th>
                        <th className="px-4 py-3 whitespace-nowrap">ชื่อ-สกุล</th>
                        <th className="px-4 py-3 whitespace-nowrap">เพศ</th>
                        <th className="px-4 py-3 whitespace-nowrap">วันเกิด</th>
                        <th className="px-4 py-3 whitespace-nowrap">ผลประเมิน</th>
                        <th className="px-4 py-3 whitespace-nowrap">บ้านเลขที่</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {previewData.map((row, i) => (
                        <tr key={i} className="hover:bg-blue-50/40 transition-colors duration-150">
                          <td className="px-4 py-3 font-mono text-xs">{row.hoscode || row.hospcode || row.hosp}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.pid}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.cid}</td>
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-800">{row.name} {row.lname}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {String(row.sex) === '1' ? 'ชาย' : String(row.sex) === '2' ? 'หญิง' : row.sex}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                            {row.birth} <span className="text-slate-400 text-xs ml-1 font-medium">({getAgeString(row.birth)})</span>
                          </td>
                          <td className="px-4 py-3">
                            {row.result ? (
                              <span className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-bold tracking-wide ${
                                row.result.includes('ไม่ผ่าน') ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              }`}>
                                {row.result}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.check_vhid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="mt-6 flex justify-end">
                  <ConfirmModal
                    title="ยืนยันการนำเข้าข้อมูล"
                    description={`คุณกำลังจะนำเข้าข้อมูลจำนวน ${totalRows.toLocaleString()} รายการ ข้อมูลเก่าในปีงบประมาณเดียวกันจะถูกอัปเดต ต้องการดำเนินการต่อหรือไม่?`}
                    onConfirm={handleUpload}
                    confirmText="เริ่มนำเข้า"
                  >
                    <Button size="lg" className="w-full sm:w-auto shadow-sm" disabled={!fiscalYear}>
                      <UploadCloud className="mr-2 h-5 w-5" />
                      เริ่มนำเข้า {totalRows.toLocaleString()} รายการ
                    </Button>
                  </ConfirmModal>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mt-8">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2 mb-2">
            <RefreshCw className="w-5 h-5 text-slate-400" />
            เครื่องมือขั้นสูง: ประมวลผล Dashboard ใหม่ (Sync Summaries)
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            ใช้ปุ่มนี้เพื่อคำนวณและสร้าง Cache สำหรับหน้า Dashboard ใหม่ทั้งหมด (ทั้ง 4 กลุ่มอายุ) สำหรับปีงบประมาณ {fiscalYear} 
            โดยดึงข้อมูลล่าสุดจากฐานข้อมูล (ใช้ในกรณีที่ข้อมูลหน้า Dashboard ไม่ตรงกับฐานข้อมูล)
          </p>
          <ConfirmModal
            title="ยืนยันการประมวลผลใหม่"
            description="การประมวลผลใหม่อาจใช้เวลาสักครู่ ระบบจะสร้าง Cache ขึ้นมาใหม่เพื่อแสดงผลในหน้า Dashboard ต้องการดำเนินการต่อหรือไม่?"
            onConfirm={handleSyncAll}
            confirmText="ประมวลผล"
          >
            <Button 
              variant="outline" 
              disabled={isSyncing || isUploading}
              className="font-medium"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  กำลังประมวลผล...
                </>
              ) : (
                'ประมวลผล Dashboard ใหม่ทั้งหมด'
              )}
            </Button>
          </ConfirmModal>
        </div>
      </div>
    </>
  );
}

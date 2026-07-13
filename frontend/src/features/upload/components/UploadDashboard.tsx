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
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'cleaning' | 'success' | 'error'>('idle');
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
    } catch(e) {}
    
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
      const cleaned = cleanData(data);
      
      setTotalRows(cleaned.length);
      setPreviewData(cleaned.slice(0, 10)); // Show 10 rows
      setStatus('idle');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg('Failed to parse Excel file. Please check the file format.');
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
      
      setProgress(100);
      setResults({ inserted, updated, deactivated: cleanupPayload.deactivated || 0 });
      setStatus('success');
      
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'An error occurred during upload.');
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

  return (
    <>
      <SubNav title="Upload EPI Data" />
      
      <div className="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-8 space-y-6">
        <div className="max-w-2xl">
          <p className="text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">
            Upload Excel file (.xlsx) from HDC to update the vaccine coverage database.
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
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {status === 'success' && (
        <Alert className="bg-emerald-50 text-emerald-800 border-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle className="text-emerald-800">Upload Complete</AlertTitle>
          <AlertDescription>
            Successfully processed {results.inserted + results.updated} records.
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Inserted: {results.inserted} new records</li>
              <li>Updated: {results.updated} existing records</li>
              <li>Deactivated: {results.deactivated} records (Soft Deleted)</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {(!file || status === 'success') && (
        <div className="space-y-2">
          <h3 className="text-base font-medium text-slate-900 ml-1">3. อัปโหลดไฟล์ Excel</h3>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'}`}
          >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-1">
            Drag & drop Excel file here
          </h3>
          <p className="text-sm text-slate-500">
            or click to select file (only .xlsx or .xls)
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
              <Button variant="outline" onClick={handleReset}>
                Cancel
              </Button>
            )}
          </div>

          <div className="p-6 space-y-6">
            {isUploading ? (
              <div className="space-y-4">
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-slate-600">
                    {status === 'cleaning' ? 'Cleaning up old records...' : 'Uploading data...'}
                  </span>
                  <span className="text-primary">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            ) : (
              <div>
                <h4 className="text-sm font-medium text-slate-900 mb-3">Data Preview (First 10 rows)</h4>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-600 font-medium">
                      <tr>
                        <th className="px-4 py-3">hoscode</th>
                        <th className="px-4 py-3">pid</th>
                        <th className="px-4 py-3">cid</th>
                        <th className="px-4 py-3">name</th>
                        <th className="px-4 py-3">sex</th>
                        <th className="px-4 py-3">birth</th>
                        <th className="px-4 py-3">result</th>
                        <th className="px-4 py-3">check_vhid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {previewData.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-xs">{row.hoscode}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.pid}</td>
                          <td className="px-4 py-3 font-mono text-xs">{row.cid}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{row.name} {row.lname}</td>
                          <td className="px-4 py-3">
                            {String(row.sex) === '1' ? 'ชาย' : String(row.sex) === '2' ? 'หญิง' : row.sex}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.birth} <span className="text-slate-400 text-xs ml-1">({getAgeString(row.birth)})</span>
                          </td>
                          <td className="px-4 py-3">
                            {row.result ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                row.result.includes('ไม่ผ่าน') ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
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
                  <Button onClick={handleUpload} size="lg" className="w-full sm:w-auto" disabled={!fiscalYear}>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Upload {totalRows.toLocaleString()} Records
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </>
  );
}

import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../../../shared/components/ui/button';
import { Progress } from '../../../shared/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '../../../shared/components/ui/alert';
import { SubNav } from '../../../widgets/layout/SubNav';
import { ConfirmModal } from '../../../shared/components/ui/confirm-modal';
import { getAgeString } from '../utils/uploadHelpers';
import { useUploadManager } from '../hooks/useUploadManager';

export function UploadDashboard() {
  const {
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
    isSyncing,
    handleDrop,
    handleUpload,
    handleReset,
    handleSyncAll,
  } = useUploadManager();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/json': ['.json']
    },
    disabled: isUploading || status === 'parsing',
    maxFiles: 1
  });

  return (
    <>
      <SubNav title="นำเข้าข้อมูลวัคซีน (EPI)" />
      
      <div className="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-8 space-y-8">
        <div className="max-w-3xl">
          <p className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f] mb-2">
            นำเข้าข้อมูลวัคซีน (EPI)
          </p>
          <p className="text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">
            อัปโหลดไฟล์ Excel / JSON (.xlsx, .xls, .json) ที่ส่งออกจากระบบ HDC เพื่อปรับปรุงฐานข้อมูลความครอบคลุมการได้รับวัคซีน
          </p>
        </div>

        <div className="bg-white p-8 rounded-[24px] border border-[#e0e0e0] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.374px] text-[#1d1d1f]">1. ระบุปีงบประมาณ (บังคับ)</h3>
            <p className="text-[14px] font-normal tracking-[-0.224px] text-[#7a7a7a] mt-1">
              โปรดเลือกปีงบประมาณของไฟล์นี้ก่อนทำการอัปโหลด
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

        <div className="bg-white p-8 rounded-[24px] border border-[#e0e0e0] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.374px] text-[#1d1d1f]">2. เลือกกลุ่มเป้าหมาย (ช่วงอายุ)</h3>
            <p className="text-[14px] font-normal tracking-[-0.224px] text-[#7a7a7a] mt-1">
              ระบบจะนำข้อมูลเข้าสู่ฐานข้อมูลแยกตามช่วงอายุที่คุณเลือก
            </p>
          </div>
          <div className="w-full sm:w-[450px] flex bg-[#f5f5f7] p-1 rounded-xl">
            <button
              onClick={() => setTargetTable('Epi_1_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all ${
                targetTable === 'Epi_1_Year' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#1d1d1f]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 1 ปี
            </button>
            <button
              onClick={() => setTargetTable('Epi_2_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all ${
                targetTable === 'Epi_2_Year' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#1d1d1f]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 2 ปี
            </button>
            <button
              onClick={() => setTargetTable('Epi_3_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all ${
                targetTable === 'Epi_3_Year' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#1d1d1f]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 3 ปี
            </button>
            <button
              onClick={() => setTargetTable('Epi_5_Year')}
              disabled={!!file || status === 'success' || isUploading}
              className={`flex-1 py-2 px-2 text-[14px] font-medium tracking-[-0.224px] rounded-lg transition-all ${
                targetTable === 'Epi_5_Year' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] text-[#1d1d1f]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              เด็ก 5 ปี
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="import-mode" className="font-semibold">วิธีปรับปรุงข้อมูล</label>
          <select id="import-mode" value={importMode} disabled={isUploading || status === 'success'} onChange={event => setImportMode(event.target.value as 'merge' | 'sync')} className="block w-full border rounded-md p-3">
            <option value="merge">เติม / อัปเดตข้อมูล — คงรายชื่อที่ไม่ได้ส่งมา</option>
            <option value="sync">ซิงค์ไฟล์เต็ม — ปิดสถานะรายชื่อที่หายจากไฟล์ในหน่วยบริการและปีนี้</option>
          </select>
          <p className="text-sm text-muted-foreground">คอลัมน์ที่ไฟล์ไม่มีจะคงค่าเดิม ส่วนเซลล์ว่างในคอลัมน์ที่ส่งมาจะล้างค่านั้น</p>
          {importMode === 'sync' && <p role="status">ใช้ไฟล์รายชื่อครบทุกคนของหน่วยบริการที่อยู่ในไฟล์เท่านั้น</p>}
          {sourceColumns.length > 0 && <details className="text-sm"><summary>ตรวจคอลัมน์ก่อนนำเข้า</summary><p className="break-words">{sourceColumns.join(', ')}</p></details>}
          {sourceColumns.length > 0 && <p role="status">พบ {sourceColumns.length} คอลัมน์ · {['addr', 'check_typearea'].filter(field => !sourceColumns.includes(field)).map(field => `ไม่มี ${field}`).join(' · ')}</p>}
        </div>

      {status === 'error' && (
        <Alert variant="destructive" className="bg-[#fff0f0] border-0 rounded-[16px] animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="h-5 w-5 text-[#ff3b30] mt-0.5" />
          <AlertTitle className="text-[#ff3b30] font-semibold text-[17px] tracking-[-0.374px]">เกิดข้อผิดพลาด</AlertTitle>
          <AlertDescription className="text-[#ff3b30]/90 text-[14px] font-normal tracking-[-0.224px] mt-1">{errorMsg}</AlertDescription>
        </Alert>
      )}

      {status === 'success' && (
        <Alert className="bg-[#f0f9f0] border-0 rounded-[24px] animate-in fade-in slide-in-from-top-2 duration-300">
          <CheckCircle2 className="h-5 w-5 text-[#34c759] mt-0.5" />
          <AlertTitle className="text-[#1d1d1f] font-semibold text-[17px] tracking-[-0.374px]">นำเข้าข้อมูลสำเร็จ</AlertTitle>
          <AlertDescription className="text-[#7a7a7a] text-[14px] mt-2">
            ประมวลผลข้อมูลสำเร็จจำนวน <strong className="text-[#1d1d1f] font-semibold">{results.inserted + results.updated}</strong> รายการ
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div className="bg-white p-4 rounded-[16px] border border-[#e0e0e0] flex flex-col">
                <span className="text-[12px] text-[#7a7a7a] font-medium uppercase tracking-[0.231px]">เพิ่มข้อมูลใหม่</span>
                <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1">{results.inserted.toLocaleString()}</span>
              </div>
              <div className="bg-white p-4 rounded-[16px] border border-[#e0e0e0] flex flex-col">
                <span className="text-[12px] text-[#7a7a7a] font-medium uppercase tracking-[0.231px]">อัปเดตข้อมูลเดิม</span>
                <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1">{results.updated.toLocaleString()}</span>
              </div>
              <div className="bg-white p-4 rounded-[16px] border border-[#e0e0e0] flex flex-col">
                <span className="text-[12px] text-[#7a7a7a] font-medium uppercase tracking-[0.231px]">ปิดสถานะจากการซิงค์</span>
                <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1">{results.deactivated.toLocaleString()}</span>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {(!file || status === 'success') && (
        <div className="space-y-3">
          <h3 className="text-[17px] font-semibold tracking-[-0.374px] text-[#1d1d1f] ml-2">3. อัปโหลดไฟล์ HDC</h3>
          <div
            {...getRootProps()}
            className={`border border-[#e0e0e0] rounded-[32px] p-16 text-center cursor-pointer transition-all duration-300 ease-in-out
              ${isDragActive 
                ? 'bg-[#f0f8ff] border-[#0066cc] scale-[1.02]' 
                : 'bg-[#fafafc] hover:bg-white hover:shadow-[0_4px_24px_rgba(0,0,0,0.04)] hover:scale-[1.01]'}`}
          >
          <input {...getInputProps()} />
          <UploadCloud className={`mx-auto h-16 w-16 mb-6 transition-colors duration-300 ${isDragActive ? 'text-[#0066cc] animate-bounce' : 'text-[#cccccc]'}`} />
          <h3 className="text-[21px] font-semibold text-[#1d1d1f] mb-2 tracking-[0.231px]">
            ลากไฟล์ Excel หรือ JSON มาวางที่นี่
          </h3>
          <p className="text-[17px] font-normal text-[#7a7a7a] tracking-[-0.374px]">
            หรือคลิกเพื่อเลือกไฟล์ (รองรับ .xlsx, .xls และ .json)
          </p>
          </div>
        </div>
      )}

      {file && status !== 'success' && (
        <div className="bg-white rounded-[24px] border border-[#e0e0e0] overflow-hidden">
          <div className="p-8 border-b border-[#f0f0f0] flex items-center justify-between bg-[#fafafc]">
            <div className="flex items-center space-x-5">
              <div className="p-4 bg-white border border-[#e0e0e0] rounded-[16px] shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                <FileSpreadsheet className="h-8 w-8 text-[#0066cc]" />
              </div>
              <div>
                <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.374px]">{file.name}</h3>
                <p className="text-[14px] font-normal text-[#7a7a7a] tracking-[-0.224px] mt-1">
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
                <Button variant="outline" className="font-medium text-[14px] rounded-full px-6 border-[#e0e0e0]">
                  ยกเลิก
                </Button>
              </ConfirmModal>
            )}
          </div>

          <div className="p-8 space-y-8">
            {isUploading ? (
              <div className="space-y-4 max-w-3xl mx-auto">
                <div className="flex justify-between text-[14px] font-medium tracking-[-0.224px]">
                  <span className="text-[#7a7a7a]">
                    {status === 'cleaning' ? 'กำลังจัดระเบียบและตรวจสอบข้อมูลเก่า...' : 
                     status === 'generating_summary' ? 'กำลังประมวลผลข้อมูลภาพรวม Dashboard...' : 'กำลังนำเข้าข้อมูล...'}
                  </span>
                  <span className="text-[#0066cc] font-semibold">{progress}%</span>
                </div>
                <Progress value={progress} className="h-3 bg-[#f5f5f7] transition-all duration-300" />
              </div>
            ) : (
              <div className="animate-in fade-in duration-500">
                <h4 className="text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-3 tracking-[-0.374px]">
                  ตัวอย่างข้อมูล <span className="px-3 py-1 bg-[#f5f5f7] text-[#7a7a7a] rounded-full text-[12px] font-medium">10 แถวแรก</span>
                </h4>
                <div className="overflow-x-auto rounded-[16px] border border-[#e0e0e0]">
                  <table className="w-full text-[14px] text-left">
                    <thead className="bg-[#fafafc] text-[#7a7a7a] font-medium border-b border-[#e0e0e0]">
                      <tr>
                        <th className="px-4 py-3 whitespace-nowrap">รหัสสถานบริการ</th>
                        <th className="px-4 py-3 whitespace-nowrap">PID</th>
                        <th className="px-4 py-3 whitespace-nowrap">เลขบัตรประชาชน</th>
                        <th className="px-4 py-3 whitespace-nowrap">ชื่อ-สกุล</th>
                        <th className="px-4 py-3 whitespace-nowrap">เพศ</th>
                        <th className="px-4 py-3 whitespace-nowrap">วันเกิด</th>
                        <th className="px-4 py-3 whitespace-nowrap">ผลประเมิน</th>
                        <th className="px-4 py-3 whitespace-nowrap">ที่อยู่</th>
                        <th className="px-4 py-3 whitespace-nowrap">ประเภทพื้นที่</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f0f0] bg-white">
                      {previewData.map((row, i) => (
                        <tr key={i} className="hover:bg-[#f5f5f7] transition-colors duration-150">
                          <td className="px-4 py-3 font-mono text-[12px] text-[#1d1d1f]">{row.hoscode || row.hospcode || row.hosp}</td>
                          <td className="px-4 py-3 font-mono text-[12px] text-[#7a7a7a]">{row.pid}</td>
                          <td className="px-4 py-3 font-mono text-[12px] text-[#1d1d1f]">{row.cid}</td>
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-[#1d1d1f]">{row.name} {row.lname}</td>
                          <td className="px-4 py-3 text-[#7a7a7a] text-[12px]">
                            {String(row.sex) === '1' ? 'ชาย' : String(row.sex) === '2' ? 'หญิง' : row.sex}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-[#7a7a7a] text-[12px]">
                            {row.birth} <span className="text-[#cccccc] text-[11px] ml-1 font-medium">({getAgeString(row.birth)})</span>
                          </td>
                          <td className="px-4 py-3">
                            {row.result ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium tracking-[0.231px] ${
                                row.result.includes('ไม่ผ่าน') ? 'bg-[#fff0f0] text-[#ff3b30]' : 'bg-[#f0f9f0] text-[#34c759]'
                              }`}>
                                {row.result}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3 text-[12px] text-[#7a7a7a] max-w-[200px] truncate">
                            {row.addr || '—'}
                          </td>
                          <td className="px-4 py-3">{row.check_typearea || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="mt-6 flex justify-end">
                  <ConfirmModal
                    title="ยืนยันการนำเข้าข้อมูล"
                    description={`คุณกำลังจะนำเข้าข้อมูลจำนวน ${totalRows.toLocaleString()} รายการ ${importMode === 'sync' ? 'ไฟล์นี้ต้องมีรายชื่อครบทุกคนของหน่วยบริการที่ส่งมา รายชื่อที่หายไปจะถูกปิดสถานะในปีนี้' : 'อัปเดตเฉพาะรายชื่อที่ส่งมาและคงรายชื่ออื่นไว้'} คอลัมน์ที่ส่งค่าว่างจะล้างค่าเดิม ต้องการดำเนินการต่อหรือไม่?`}
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

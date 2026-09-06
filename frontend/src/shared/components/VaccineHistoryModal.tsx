import React, { useMemo, useState } from 'react';
import type { EpiRecord } from '../types';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Button } from './ui/button';
import { formatDateStr } from '../utils/dateUtils';
import { hasDose, getDataErrors, getAgeInMonths, ruleHasDataError } from '../utils/vaccine/ruleEngine';
import { Bot, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface VaccineHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: EpiRecord | null;
  rules: VaccineRule[];
}

export function VaccineHistoryModal({
  isOpen,
  onClose,
  record,
  rules,
}: VaccineHistoryModalProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [localAiAnalysis, setLocalAiAnalysis] = useState<string | null>(null);
  const [localAiAnalyzedAt, setLocalAiAnalyzedAt] = useState<string | null>(null);

  const [prevRecord, setPrevRecord] = useState<EpiRecord | null>(null);

  // Better: Adjust the state while rendering (React Best Practice: "You Might Not Need an Effect")
  if (record?.cid !== prevRecord?.cid) {
    setPrevRecord(record);
    setLocalAiAnalysis(null);
    setLocalAiAnalyzedAt(null);
  }

  const rows = useMemo(() => {
    if (!record) return [];
    return rules.map((rule) => {
      let passed = false;
      const fields = rule.required_fields || [];
      const altFields = rule.branch_alt_fields || [];
      const allowOnBirth = rule.target_age_months === 0;

      if (rule.logic_type === 'ALL') {
        passed = fields.every((field: string) => hasDose(record, field as keyof EpiRecord, allowOnBirth));
      } else if (rule.logic_type === 'ANY') {
        passed = fields.some((field: string) => hasDose(record, field as keyof EpiRecord, allowOnBirth));
      } else if (rule.logic_type === 'BRANCH') {
        const path1Passed = fields.every((field: string) => hasDose(record, field as keyof EpiRecord, allowOnBirth));
        const path2Passed = altFields.length > 0 ? altFields.every((field: string) => hasDose(record, field as keyof EpiRecord, allowOnBirth)) : false;
        passed = path1Passed || path2Passed;
      }

      // 1. DATA ERROR OVERRIDE: If ruleHasDataError finds a duplicate date, etc., it fails.
      const dataErr = ruleHasDataError(record, rule, rules);
      if (dataErr) passed = false;

      // 2. RAW DATA DISPLAY: The user explicitly requested to see raw database columns
      // Show every field that this rule checks (both path 1 and path 2)
      const allRuleFields = [...fields, ...altFields];
      const dateStringWithFields = allRuleFields.map((f: string) => {
        const val = record[f as keyof EpiRecord];
        // We'll show the raw YYYY-MM-DD or whatever is in the DB
        const rawDate = val ? String(val).split('T')[0] : '-';
        return `${f}: ${rawDate}`;
      }).join(' | ');

      // 3. CLEAN NAME DISPLAY: Strip "ขาด" from rule.display_name if present
      let cleanName = rule.display_name;
      if (cleanName.startsWith('ขาด ')) {
        cleanName = cleanName.substring(4);
      } else if (cleanName.startsWith('ขาด')) {
        cleanName = cleanName.substring(3);
      }
      
      // Append data error reason to the name if there is one
      const finalName = dataErr ? `${cleanName} (${dataErr})` : cleanName;

      return {
        name: finalName,
        passed,
        dateString: dateStringWithFields,
      };
    });
  }, [record, rules]);

  if (!record) return null;

  const dataErrors = getDataErrors(record, rules);
  
  // A record is fully immunized only if all local rules pass, no data errors exist,
  // AND the HDC result (if any) does not explicitly say "ไม่ผ่าน"
  const isHdcFailed = record.result?.includes('ไม่ผ่าน');
  const isLocallyPassed = rows.every(r => r.passed);
  
  // Only show AI button if they passed locally (no missing doses), but HDC failed or there are data errors
  const showAiButton = isLocallyPassed && (isHdcFailed || dataErrors.length > 0);
  const isFullyImmunized = isLocallyPassed && dataErrors.length === 0 && !isHdcFailed;
  
  const currentAiAnalysis = localAiAnalysis || record.ai_analysis;
  const shouldShowAiSection = showAiButton || !!currentAiAnalysis;

  const handleAnalyze = async () => {
    if (!record) return;
    setIsAnalyzing(true);
    try {
      const missingVaccines = rows.filter(r => !r.passed).map(r => r.name);
      
      let datesContext = rules.map(rule => {
        const fields = rule.required_fields || [];
        const altFields = rule.branch_alt_fields || [];
        
        const getVals = (fList: string[]) => fList.map(f => {
           const v = record[f as keyof EpiRecord];
           return `${f}=${v ? formatDateStr(String(v)) : '-'}`;
        }).join(', ');

        if (rule.logic_type === 'BRANCH' && altFields.length > 0) {
           return `- ${rule.display_name}: [${getVals(fields)}] OR [${getVals(altFields)}]`;
        }
        return `- ${rule.display_name}: ${getVals(fields)}`;
      }).join('\n');

      const ageGroup = rules[0]?.age_group;
      const ageText = ageGroup === '1yr' ? '1 ปี' :
                      ageGroup === '2yr' ? '2 ปี' :
                      ageGroup === '3yr' ? '3 ปี' : '5 ปี';

      const prompt = `คุณคือผู้เชี่ยวชาญด้านงานข้อมูลระบาดวิทยา (EPI) และระบบ HDC ของกระทรวงสาธารณสุขไทย หน้าที่ของคุณคือวิเคราะห์สาเหตุที่ข้อมูลการรับวัคซีนของเด็กรายนี้ "ไม่ผ่านเกณฑ์การประเมินความครอบคลุมวัคซีน (Fully Immunized)" หรือพบความผิดปกติของข้อมูล

[ข้อมูลทั่วไป]
- วันเกิดเด็ก: ${formatDateStr(String(record.birth))} (อายุปัจจุบัน ${getAgeInMonths(record.birth)} เดือน)
- กลุ่มอายุเป้าหมายที่ประเมิน: ${ageText}
- เพศ: ${record.sex === '1' ? 'ชาย' : 'หญิง'}
- สถานะจากระบบ: ${record.result || 'ไม่ระบุ / พบความผิดปกติ'}

[ข้อผิดพลาดที่ระบบตรวจพบเบื้องต้น]
- วันที่ผิดปกติ (Data Errors/Duplicates): ${dataErrors.length > 0 ? dataErrors.join(', ') : 'ไม่พบ'}
- วัคซีนที่ขาดหายไปจากเกณฑ์ (Missing Doses): ${missingVaccines.length > 0 ? missingVaccines.join(', ') : 'ไม่พบ'}

[ประวัติการรับวัคซีนของเด็ก (เฉพาะรายการที่ใช้ประเมินเกณฑ์ ${ageText})]
${datesContext}

[คำแนะนำสำหรับการวิเคราะห์ (คิดทีละขั้นตอน)]
1. ตรวจสอบระยะห่าง (Interval): วัคซีนแต่ละเข็มห่างกันตามเกณฑ์มาตรฐานหรือไม่ วันที่ฉีดต้องไม่เกิดก่อนวันเกิด
2. กฎเฉพาะของ HDC: ตรวจสอบจุดบอดที่พบบ่อย เช่น ลืมคีย์ OPV ตอน 6 เดือน, การใช้รหัสวัคซีน JE/LAJE ผิดประเภท, หรือ Rota ที่ฉีดต่างชนิดกัน
3. ชี้เป้าสาเหตุ: อธิบายสั้นๆ ว่าทำไมระบบถึงตีตกข้อมูลนี้

[รูปแบบการตอบ (Formatting)]
- เขียนอธิบายเป็นข้อๆ (Bullet points) กระชับ ตรงประเด็น
- เสนอแนะวิธีตรวจสอบและแก้ไขในโปรแกรม HOSxP/JHCIS อย่างชัดเจน
- ไม่ต้องเกริ่นนำหรือลงท้ายยาวๆ ตอบเข้าประเด็นได้เลย`;

      let targetTable = 'Epi_1_Year';
      if (ageGroup === '2yr') targetTable = 'Epi_2_Year';
      else if (ageGroup === '3yr') targetTable = 'Epi_3_Year';
      else if (ageGroup === '5yr') targetTable = 'Epi_5_Year';

      const response = await fetchApi('analyzeVaccineData', {
        prompt,
        recordKey: {
          hoscode: record.hoscode,
          hosname: record.hosname,
          pid: record.pid,
          cid: record.cid,
          name: record.name,
          lname: record.lname,
          sex: record.sex,
          birth: record.birth,
          check_vhid: record.check_vhid
        },
        targetTable
      });

      if (response && response.data && response.data.success) {
        setLocalAiAnalysis(response.data.aiAnalysis);
        setLocalAiAnalyzedAt(response.data.aiAnalyzedAt || new Date().toISOString());
      } else {
        throw new Error(response?.data?.error || 'Unknown error from server');
      }
    } catch (err: any) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการวิเคราะห์ AI: " + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`${shouldShowAiSection ? 'max-w-6xl sm:max-w-6xl' : 'max-w-4xl sm:max-w-4xl'} w-[95vw] h-[90vh] flex flex-col p-6 transition-all duration-300`}>
        <DialogHeader className="shrink-0 border-b border-slate-100 pb-4">
          <DialogTitle className="text-2xl font-bold text-slate-800">
            ประวัติการรับวัคซีน
          </DialogTitle>
          <div className="text-sm text-slate-600 mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <p className="flex items-center gap-2"><span className="font-semibold text-slate-800 bg-slate-100 px-2 py-1 rounded-md">ชื่อ-สกุล</span> {record.name} {record.lname}</p>
            <p className="flex items-center gap-2"><span className="font-semibold text-slate-800 bg-slate-100 px-2 py-1 rounded-md">CID</span> {record.cid}</p>
            <p className="flex items-center gap-2"><span className="font-semibold text-slate-800 bg-slate-100 px-2 py-1 rounded-md">วันเกิด</span> {formatDateStr(String(record.birth))}</p>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto lg:overflow-hidden mt-6 pb-6 lg:pb-0 custom-scrollbar -mx-2 px-2 lg:mx-0 lg:px-0">
          <div className={`flex flex-col lg:grid ${shouldShowAiSection ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-6 lg:h-full min-h-max lg:min-h-0`}>
            
            {/* Column 1: Table (HDC Data) */}
            <div className="flex flex-col h-[50vh] lg:h-full border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white shrink-0">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-semibold text-slate-700 flex justify-between items-center shrink-0">
                <span>ข้อมูลจากฐานข้อมูล HDC</span>
                <span className="text-xs font-normal text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
                  {rows.length} รายการ
                </span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader className="sticky top-0 bg-white shadow-sm z-10">
                    <TableRow>
                      <TableHead className="font-semibold text-slate-700">รายการวัคซีน</TableHead>
                      <TableHead className="font-semibold text-slate-700">วันที่ได้รับ</TableHead>
                      <TableHead className="text-center font-semibold text-slate-700">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={i} className="hover:bg-slate-50/50 transition-colors">
                        <TableCell className="font-medium text-slate-700">{r.name}</TableCell>
                        <TableCell className="text-slate-600">{r.dateString}</TableCell>
                        <TableCell className="text-center">
                          {r.passed ? (
                            <div className="inline-flex items-center justify-center text-green-700 font-medium bg-green-100/50 px-2.5 py-1 rounded-full text-[11px] uppercase tracking-wider">
                              <CheckCircle2 className="w-3 h-3 mr-1.5" />
                              มีข้อมูล
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-center text-red-700 font-medium bg-red-100/50 px-2.5 py-1 rounded-full text-[11px] uppercase tracking-wider">
                              <XCircle className="w-3 h-3 mr-1.5" />
                              ขาดข้อมูล
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-slate-500 py-12">
                          ไม่มีเงื่อนไขวัคซีนสำหรับมุมมองนี้
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Column 2: AI Analysis */}
            {shouldShowAiSection && (
            <div className="flex flex-col h-[60vh] lg:h-full border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-slate-50/50 shrink-0">
              <div className="bg-white px-4 py-3 border-b border-slate-200 font-semibold text-slate-800 flex items-center gap-2 shrink-0">
                <Bot className="w-5 h-5 text-blue-600" />
                ผลการวิเคราะห์จาก AI (Gemini Flash Lite)
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 lg:p-6 bg-slate-50/30">
                {currentAiAnalysis ? (
                  <div className="text-[14.5px] text-slate-700 leading-relaxed font-[Inter,system-ui,sans-serif] tracking-[-0.01em]">
                    {/* Minimalist Apple-inspired Markdown Parser */}
                    {currentAiAnalysis.split('\n').map((line, idx) => {
                      const trimmed = line.trim();
                      if (!trimmed) return <div key={idx} className="h-3" />; // controlled spacing for empty lines
                      
                      if (trimmed.startsWith('###')) {
                        return <h5 key={idx} className="font-semibold text-slate-900 mt-6 mb-2 flex items-center text-[15px]">{trimmed.replace(/#/g, '').trim()}</h5>;
                      }
                      
                      if (trimmed.startsWith('>')) {
                        return <blockquote key={idx} className="border-l-2 border-blue-500 bg-blue-50/50 pl-3 py-2 my-3 text-slate-600 rounded-r-md text-[13px]">{trimmed.replace('>', '').trim()}</blockquote>;
                      }
                      
                      if (trimmed === '---') {
                        return <hr key={idx} className="border-slate-200 my-5" />;
                      }
                      
                      // Format inline **bold** text helper
                      const formatBold = (text: string) => {
                        return text.split(/(\*\*.*?\*\*)/g).map((part, pIdx) => {
                          if (part.startsWith('**') && part.endsWith('**')) {
                            return <strong key={pIdx} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
                          }
                          return part;
                        });
                      };

                      // Handle bullet points
                      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                        return (
                          <div key={idx} className="flex gap-2.5 my-1.5 ml-1">
                            <span className="text-slate-400 mt-[7px] shrink-0"><span className="block w-1.5 h-1.5 bg-slate-400 rounded-full"></span></span>
                            <span className="text-slate-600">{formatBold(trimmed.substring(2))}</span>
                          </div>
                        );
                      }

                      // Handle numbered lists "1. "
                      const numMatch = trimmed.match(/^(\d+\.)\s(.*)/);
                      if (numMatch) {
                        return (
                          <div key={idx} className="flex gap-2 my-2 ml-1">
                            <span className="font-medium text-slate-500 shrink-0 w-5">{numMatch[1]}</span>
                            <span className="text-slate-600">{formatBold(numMatch[2])}</span>
                          </div>
                        );
                      }
                      
                      // Normal paragraph
                      return (
                        <p key={idx} className="mb-1.5 text-slate-600">
                          {formatBold(trimmed)}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-in fade-in zoom-in duration-500">
                    {showAiButton ? (
                      <>
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-5 relative group">
                          <div className="absolute inset-0 bg-blue-200 rounded-2xl blur-xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
                          <Bot className="w-10 h-10 text-blue-600 relative z-10" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-800 mb-2 tracking-tight">ตรวจสอบหาข้อผิดพลาด</h3>
                        <p className="text-slate-500 text-[14px] mb-8 max-w-[280px] leading-relaxed">
                          ให้ AI ช่วยตรวจสอบวันที่รับวัคซีนและกฎเกณฑ์ต่างๆ เพื่อหาสาเหตุที่ทำให้ข้อมูลไม่ผ่านเกณฑ์ของ HDC
                        </p>
                        <Button 
                          onClick={handleAnalyze} 
                          disabled={isAnalyzing}
                          className="bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm w-full sm:w-auto px-6 rounded-full h-11 text-[14px] font-medium"
                        >
                          {isAnalyzing ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              กำลังประมวลผลข้อมูล...
                            </>
                          ) : (
                            <>
                              <Bot className="w-4 h-4 mr-2" />
                              เริ่มการวิเคราะห์ด้วย AI
                            </>
                          )}
                        </Button>
                      </>
                    ) : !isFullyImmunized ? (
                      <div className="text-amber-600 font-medium flex flex-col items-center p-8 bg-amber-50 rounded-2xl border border-amber-100">
                        <XCircle className="w-12 h-12 mb-4 text-amber-500" />
                        <span className="text-lg">ข้อมูลไม่ครบถ้วน</span>
                        <p className="text-amber-600/70 text-sm mt-1 max-w-[250px] text-center">
                          เด็กยังได้รับวัคซีนไม่ครบถ้วนตามเกณฑ์ กรุณาบันทึกประวัติการรับวัคซีนเพิ่มเติม โดยไม่ต้องใช้ AI วิเคราะห์
                        </p>
                      </div>
                    ) : (
                      <div className="text-emerald-600 font-medium flex flex-col items-center p-8 bg-emerald-50 rounded-2xl border border-emerald-100">
                        <CheckCircle2 className="w-12 h-12 mb-4 text-emerald-500" />
                        <span className="text-lg">ข้อมูลสมบูรณ์</span>
                        <p className="text-emerald-600/70 text-sm mt-1">เด็กคนนี้ได้รับวัคซีนครบถ้วนตามเกณฑ์แล้ว</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {currentAiAnalysis && (localAiAnalyzedAt || record.ai_analyzed_at) && (
                <div className="shrink-0 p-3 bg-slate-50 border-t border-slate-200/80">
                  <p className="text-xs text-slate-500 font-medium text-right flex justify-end items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                    วิเคราะห์ล่าสุดเมื่อ: {formatDateStr(String(localAiAnalyzedAt || record.ai_analyzed_at))}
                  </p>
                </div>
              )}
            </div>
            )}

          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

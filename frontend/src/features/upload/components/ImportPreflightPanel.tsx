import { useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '../../../shared/components/ui/button';
import { formatDateStr } from '../../../shared/utils/dateUtils';
import { TABLE_LABEL } from '../hooks/useUploadManager';
import type { ImportPreflight, RiskConfirmation, TypedConfirmations } from '../hooks/useUploadManager';

interface Props {
  preflight: ImportPreflight;
  isBusy: boolean;
  errorMsg: string;
  onConfirm: (typedNumbers?: TypedConfirmations) => void;
  onCancel: () => void;
}

/** The order the typed-number fields appear in, matching the order of the warnings. */
const CONFIRMATION_ORDER: RiskConfirmation[] = ['existingChildren', 'outsideCohort'];

/**
 * Issue #111: what the import will do, shown before any write; a risky import needs the exact number typed.
 * Issue #136: each fired risk condition has its own number, so one warning can never hide another.
 */
export function ImportPreflightPanel({ preflight, isBusy, errorMsg, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState<TypedConfirmations>({});
  const required = preflight.requiredConfirmations;
  const conditions = CONFIRMATION_ORDER.filter(name => required?.[name] != null);
  const isSync = preflight.mode === 'sync';
  const showOutsideCohort = preflight.outsideCohort > 0;
  const canConfirm = !isBusy && conditions.every(name => (typed[name] ?? '').trim() === String(required?.[name]));
  const confirmationLabel: Record<RiskConfirmation, string> = {
    existingChildren: isSync ? 'จำนวนเด็กเดิมที่จะถูกปิดสถานะ' : 'จำนวนรายชื่อในไฟล์ที่ไม่ตรงกับเด็กที่เปิดใช้งานอยู่',
    outsideCohort: 'จำนวนรายชื่อในไฟล์ที่เกิดนอกช่วงวันเกิด',
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <p className="text-[14px] font-medium text-[#7a7a7a] tracking-[-0.224px]">ตรวจสอบก่อนนำเข้า · {isSync ? 'ซิงค์ไฟล์เต็ม' : 'เติม / อัปเดตข้อมูล'}</p>
        <h3 className="text-[28px] font-semibold text-[#1d1d1f] tracking-[0.196px] mt-1">
          {TABLE_LABEL[preflight.targetTable]} · ปีงบประมาณ {preflight.fiscalYear}
        </h3>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${isSync ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="bg-[#fafafc] p-4 rounded-[16px] border border-[#e0e0e0] flex flex-col">
          <span className="text-[12px] text-[#7a7a7a] font-medium tracking-[0.231px]">จับคู่กับเด็กเดิม</span>
          <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1">{preflight.matched.toLocaleString()}</span>
        </div>
        <div className="bg-[#fafafc] p-4 rounded-[16px] border border-[#e0e0e0] flex flex-col">
          <span className="text-[12px] text-[#7a7a7a] font-medium tracking-[0.231px]">เพิ่มเป็นรายชื่อใหม่</span>
          <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1">{preflight.newRows.toLocaleString()}</span>
        </div>
        {isSync && (
          <div className="bg-[#fafafc] p-4 rounded-[16px] border border-[#e0e0e0] flex flex-col">
            <span className="text-[12px] text-[#7a7a7a] font-medium tracking-[0.231px]">จะปิดสถานะ (จาก {preflight.activeBefore.toLocaleString()} คนเดิม)</span>
            <span className="text-[28px] font-semibold text-[#1d1d1f] mt-1">{preflight.wouldDeactivate.toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-[16px] border border-[#e0e0e0]">
        <table className="w-full text-[14px] text-left">
          <thead className="bg-[#fafafc] text-[#7a7a7a] font-medium border-b border-[#e0e0e0]">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">หน่วยบริการ</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">เด็กเดิม</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">จับคู่ได้</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">ใหม่</th>
              {isSync && <th className="px-4 py-3 whitespace-nowrap text-right">จะปิดสถานะ</th>}
              {showOutsideCohort && <th className="px-4 py-3 whitespace-nowrap text-right">นอกช่วงวันเกิด</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0] bg-white">
            {preflight.byHoscode.map(row => {
              const zeroMatch = preflight.risk.zeroMatchHoscodes.includes(row.hoscode);
              const outsideCohort = row.outsideCohort > 0;
              return (
                <tr key={row.hoscode} className={zeroMatch || outsideCohort ? 'bg-[#fff0f0]' : undefined}>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#1d1d1f]">{row.hoscode}</td>
                  <td className="px-4 py-3 text-right">{row.activeBefore.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right ${zeroMatch ? 'text-[#ff3b30] font-semibold' : ''}`}>{row.matched.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{row.newRows.toLocaleString()}</td>
                  {isSync && <td className="px-4 py-3 text-right">{row.wouldDeactivate.toLocaleString()}</td>}
                  {showOutsideCohort && (
                    <td className={`px-4 py-3 text-right ${outsideCohort ? 'text-[#ff3b30] font-semibold' : ''}`}>{row.outsideCohort.toLocaleString()}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {required != null ? (
        <div className="bg-[#fff0f0] rounded-[16px] p-6 space-y-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-[#ff3b30] mt-0.5 shrink-0" />
            <div className="space-y-1 text-[14px] text-[#ff3b30] tracking-[-0.224px]">
              <p className="font-semibold text-[17px] tracking-[-0.374px]">ไฟล์นี้อาจไม่ถูกต้อง โปรดตรวจสอบก่อนนำเข้า</p>
              {preflight.risk.zeroMatchHoscodes.length > 0 && (
                <p>หน่วยบริการ {preflight.risk.zeroMatchHoscodes.join(', ')} มีเด็กเดิมอยู่ แต่ไม่มีรายชื่อในไฟล์ที่ตรงกับเด็กเดิมเลย</p>
              )}
              {preflight.risk.shrinkOverThreshold && (
                <p>จะปิดสถานะเด็กเดิม {preflight.wouldDeactivate.toLocaleString()} จาก {preflight.activeBefore.toLocaleString()} คน (เกิน {Math.round(preflight.shrinkThreshold * 100)}%)</p>
              )}
              {preflight.risk.outsideCohort && (
                <>
                  <p>
                    {preflight.outsideCohort.toLocaleString()} รายชื่อในไฟล์เกิดนอกช่วงวันเกิดของ{TABLE_LABEL[preflight.targetTable]} ปีงบประมาณ {preflight.fiscalYear}
                    {' '}({formatDateStr(preflight.cohortBirthRange.start)} – {formatDateStr(preflight.cohortBirthRange.end)})
                  </p>
                  {preflight.outsideCohortFiscalYear && (
                    <p className="font-semibold">วันเกิดตรงกับปีงบประมาณ {preflight.outsideCohortFiscalYear} โปรดตรวจสอบว่าเลือกปีงบประมาณถูกต้อง</p>
                  )}
                </>
              )}
            </div>
          </div>
          {conditions.map(name => (
            <div key={name} className="space-y-2">
              <label htmlFor={`preflight-typed-${name}`} className="block text-[14px] font-medium text-[#1d1d1f]">
                พิมพ์ตัวเลข {required[name]!.toLocaleString('en-US', { useGrouping: false })} ({confirmationLabel[name]}) เพื่อยืนยัน
              </label>
              <input
                id={`preflight-typed-${name}`}
                inputMode="numeric"
                autoComplete="off"
                value={typed[name] ?? ''}
                disabled={isBusy}
                onChange={event => setTyped(current => ({ ...current, [name]: event.target.value }))}
                className="w-full sm:w-64 h-10 px-3 rounded-md border border-[#e0e0e0] bg-white text-[14px] focus:outline-none focus:ring-2 focus:ring-[#ff3b30]/20"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 bg-[#f0f9f0] rounded-[16px] p-4 text-[14px] text-[#1d1d1f]">
          <ShieldCheck className="h-5 w-5 text-[#34c759] shrink-0" />
          <p>ไม่พบความผิดปกติ ตรวจตารางเป้าหมายและปีงบประมาณให้ถูกต้องแล้วกดยืนยัน</p>
        </div>
      )}

      {errorMsg && <p role="alert" className="text-[14px] text-[#ff3b30]">{errorMsg}</p>}

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
        <Button variant="outline" className="rounded-full px-6" disabled={isBusy} onClick={onCancel}>ยกเลิก</Button>
        <Button size="lg" disabled={!canConfirm}
          onClick={() => onConfirm(required == null ? undefined : Object.fromEntries(conditions.map(name => [name, (typed[name] ?? '').trim()])))}>
          ยืนยันนำเข้า
        </Button>
      </div>
    </div>
  );
}

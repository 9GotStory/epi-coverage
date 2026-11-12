import { AlertTriangle, Undo2 } from 'lucide-react';
import { Button } from '../../../shared/components/ui/button';
import { formatDateTimeStr } from '../../../shared/utils/dateUtils';
import { TABLE_LABEL, UNDO_REFUSAL_TEXT } from '../hooks/useUploadManager';
import type { ImportUndoPreview } from '../hooks/useUploadManager';

interface Props {
  preview: ImportUndoPreview;
  isBusy: boolean;
  errorMsg: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const MODE_LABEL = { merge: 'เติม / อัปเดตข้อมูล', sync: 'ซิงค์ไฟล์เต็ม' } as const;

const SUMMARIES_REMOVED_WARNING = (
  <div className="flex gap-3 bg-[#fff0f0] rounded-[16px] p-4 text-[14px] text-[#ff3b30]">
    <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
    <p>หลังย้อนจะไม่มีรายการที่เปิดใช้งานเหลือ ระบบจะลบสรุป Dashboard ของกลุ่มอายุและปีงบประมาณนี้ หน้า Dashboard จะแสดง "ไม่มีข้อมูลสรุป"</p>
  </div>
);

const factCards = (facts: Array<[string, string]>, columns: string) => (
  <dl className={`grid grid-cols-1 ${columns} gap-4 text-[14px]`}>
    {facts.map(([label, value]) => (
      <div key={label} className="bg-[#fafafc] p-4 rounded-[16px] border border-[#e0e0e0]">
        <dt className="text-[12px] text-[#7a7a7a] font-medium tracking-[0.231px]">{label}</dt>
        <dd className="text-[#1d1d1f] font-medium mt-1 break-all">{value}</dd>
      </div>
    ))}
  </dl>
);

/** Issue #139/#140: what Import Undo would change, computed by the server, whether it is unfinished, or why it is refused (ADR-0009, ADR-0010). */
export function ImportUndoPanel({ preview, isBusy, errorMsg, onConfirm, onCancel }: Props) {
  const heading = (
    <div>
      <p className="text-[14px] font-medium text-[#7a7a7a] tracking-[-0.224px]">ย้อนการนำเข้าล่าสุด</p>
      <h3 className="text-[28px] font-semibold text-[#1d1d1f] tracking-[0.196px] mt-1">
        {TABLE_LABEL[preview.targetTable]} · ปีงบประมาณ {preview.fiscalYear}
      </h3>
    </div>
  );
  const error = errorMsg && <p role="alert" className="text-[14px] text-[#ff3b30]">{errorMsg}</p>;
  const actions = (confirmLabel: string) => (
    <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
      <Button variant="outline" className="rounded-full px-6" disabled={isBusy} onClick={onCancel}>ยกเลิก</Button>
      <Button size="lg" disabled={isBusy} onClick={onConfirm}>
        <Undo2 className="mr-2 h-5 w-5" />
        {confirmLabel}
      </Button>
    </div>
  );

  if (!preview.eligible) {
    const refusal = UNDO_REFUSAL_TEXT[preview.reason];
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        {heading}
        {error}
        <div className="flex gap-3 bg-[#fafafc] rounded-[16px] border border-[#e0e0e0] p-4 text-[14px] text-[#1d1d1f]">
          <AlertTriangle className="h-5 w-5 text-[#7a7a7a] mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">ย้อนการนำเข้านี้ไม่ได้</p>
            <p>{refusal.reason}</p>
            {refusal.recovery && <p>{refusal.recovery}</p>}
          </div>
        </div>
      </div>
    );
  }

  // An admin tells a Batch apart by when, by whom and how it was imported; its id means nothing to them.
  const batch = factCards([
    ['นำเข้าเมื่อ', formatDateTimeStr(preview.importedAt)],
    ['นำเข้าโดย', preview.importedBy || '-'],
    ['วิธีนำเข้า', MODE_LABEL[preview.mode]],
  ], 'sm:grid-cols-3');

  if (preview.unfinished) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        {heading}
        <div className="flex gap-3 bg-[#fafafc] rounded-[16px] border border-[#e0e0e0] p-4 text-[14px] text-[#1d1d1f]">
          <AlertTriangle className="h-5 w-5 text-[#7a7a7a] mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">การย้อนที่ยังไม่เสร็จ</p>
            <p>การย้อนการนำเข้านี้เริ่มแล้วแต่ยังทำไม่ครบทุกขั้น ระหว่างนี้นำเข้าข้อมูลของกลุ่มอายุและปีงบประมาณนี้ไม่ได้ กด "ย้อนต่อให้เสร็จ" เพื่อทำขั้นที่เหลือตามแผนเดิม</p>
          </div>
        </div>
        {batch}
        {factCards([
          ['เริ่มย้อนเมื่อ', formatDateTimeStr(preview.startedAt)],
          ['เริ่มย้อนโดย', preview.startedBy || '-'],
          ['จะปิดสถานะ (รวม)', preview.wouldDeactivate.toLocaleString()],
          ['จะเปิดสถานะคืน (รวม)', preview.wouldReactivate.toLocaleString()],
        ], 'sm:grid-cols-2 lg:grid-cols-4')}
        {preview.summariesWillBeRemoved && SUMMARIES_REMOVED_WARNING}
        {error}
        {actions('ย้อนต่อให้เสร็จ')}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {heading}

      {batch}

      <div className="overflow-x-auto rounded-[16px] border border-[#e0e0e0]">
        <table className="w-full text-[14px] text-left">
          <thead className="bg-[#fafafc] text-[#7a7a7a] font-medium border-b border-[#e0e0e0]">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">หน่วยบริการ</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">จะปิดสถานะ (เพิ่มจากการนำเข้านี้)</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">จะเปิดสถานะคืน (ถูกปิดโดยการนำเข้านี้)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0] bg-white">
            {preview.byHoscode.map(row => (
              <tr key={row.hoscode}>
                <td className="px-4 py-3 font-mono text-[12px] text-[#1d1d1f]">{row.hoscode}</td>
                <td className="px-4 py-3 text-right">{row.wouldDeactivate.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{row.wouldReactivate.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-[#fafafc] font-semibold text-[#1d1d1f] border-t border-[#e0e0e0]">
            <tr>
              <td className="px-4 py-3">รวม</td>
              <td className="px-4 py-3 text-right">{preview.wouldDeactivate.toLocaleString()}</td>
              <td className="px-4 py-3 text-right">{preview.wouldReactivate.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[14px] text-[#7a7a7a]">
        หลังย้อนจะเหลือรายการที่เปิดใช้งาน {preview.activeAfter.toLocaleString()} รายการ แถวที่ปิดสถานะยังคงอยู่ในฐานข้อมูล ไม่ได้ถูกลบ
      </p>

      {preview.summariesWillBeRemoved && SUMMARIES_REMOVED_WARNING}

      {error}

      {actions('ยืนยันย้อนการนำเข้า')}
    </div>
  );
}

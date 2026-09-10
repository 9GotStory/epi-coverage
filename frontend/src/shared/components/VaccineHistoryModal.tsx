import type { EpiRecord } from '../types';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';
import { getAgeInMonths } from '../utils/vaccine/ruleEngine';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { getHdcVaccineRows, hdcValue, formatHdcDate, calendarDay } from '../utils/vaccine/hdcData';
import { formatDateStr } from '../utils/dateUtils';

interface VaccineHistoryModalProps {
  rules?: VaccineRule[];
  caption?: string;
  warnings?: string[];
  warningsStatus?: string;
  isOpen: boolean;
  onClose: () => void;
  record: EpiRecord | null;
}

const MISSING_COLUMN_TEXT = 'ไฟล์ไม่มีคอลัมน์ / ยังไม่มีข้อมูลต้นทาง';

/** tooltip ประกอบเซลล์วันที่: อายุ ณ วันฉีด สำหรับวันที่ปกติ หรือคำอธิบายความหมายของค่าพิเศษ */
function dateCellTooltip(record: EpiRecord, value: string): string | undefined {
  if (value === MISSING_COLUMN_TEXT) {
    return 'ไฟล์ HDC ที่นำเข้าไม่มีคอลัมน์นี้ใน header (schema รองรับ แต่ไฟล์ต้นทางไม่มี) — รายการนี้จะแสดง "ข้อมูลไม่พอประเมิน" และไม่นับเป็นขาดวัคซีน';
  }
  if (!value || value === '—') {
    return 'เซลล์ว่างในไฟล์ที่นำเข้า — คอลัมน์นี้มีอยู่ในไฟล์ แต่ไม่มีวันที่บันทึกสำหรับรายนี้';
  }
  const day = calendarDay(value);
  if (!day) return undefined;
  const months = getAgeInMonths(record.birth, new Date(`${day}T00:00:00`));
  if (months === 999 || Number.isNaN(months)) return undefined;
  return months === 0 ? 'ฉีดเมื่อแรกเกิด (0 เดือน)' : `ฉีดเมื่ออายุประมาณ ${months} เดือน`;
}

export function VaccineHistoryModal({ isOpen, onClose, record, warnings, warningsStatus, rules, caption }: VaccineHistoryModalProps) {
  if (!record) return null;
  const rows = getHdcVaccineRows(record, rules);
  const dateWarnings = warnings ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ประวัติการรับวัคซีน</DialogTitle>
          <DialogDescription>{caption ?? 'ข้อมูลจาก HDC ที่นำเข้า แสดงทุกเข็ม'}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-zinc-500">ชื่อ-สกุล</dt><dd>{record.name} {record.lname}</dd></div>
          <div><dt className="text-zinc-500">CID</dt><dd>{record.cid}</dd></div>
          <div><dt className="text-zinc-500">วันเกิด</dt><dd>{formatDateStr(record.birth)}</dd></div>
          <div><dt className="text-zinc-500">ผลจาก HDC</dt><dd className="whitespace-pre-wrap">{hdcValue(record.result)}</dd></div>
          <div><dt className="text-muted-foreground">ที่อยู่</dt><dd>{hdcValue(record.addr)}</dd></div>
          <div><dt className="text-muted-foreground">ประเภทพื้นที่</dt><dd>{hdcValue(record.check_typearea)}</dd></div>
          <div><dt className="text-muted-foreground">รหัสหมู่บ้าน</dt><dd>{hdcValue(record.check_vhid)}</dd></div>
        </dl>
        <p className="text-sm text-zinc-500">{rows.length} รายการ · — หมายถึงไม่มีค่าในข้อมูลที่โหลดมา · ชี้เมาส์ที่แต่ละเซลล์เพื่อดูรายละเอียดเพิ่มเติม</p>
        {warningsStatus && <p role="status" className="text-sm text-zinc-500">{warningsStatus}</p>}
        {dateWarnings.length > 0 && <div className="border rounded-lg p-3 text-sm space-y-2">
          <p className="font-semibold">ข้อสังเกตข้อมูลวันที่ — โปรดตรวจสอบต้นทาง</p>
          <p className="text-zinc-500">ข้อสังเกตนี้ไม่เปลี่ยนผลจาก HDC และยังไม่ยืนยันว่าเป็นการบันทึกผิด</p>
          <ul className="list-disc pl-5">{dateWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </div>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>รายการวัคซีน</TableHead>
              <TableHead>วันที่จาก HDC</TableHead>
              <TableHead>รหัสสถานบริการที่ฉีด</TableHead>
              <TableHead>รหัสหน่วยบันทึก (input_hosp)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.id}>
                <TableCell><div>{row.name}</div><div className="text-xs text-zinc-500" title="ชื่อคอลัมน์ในไฟล์ HDC ที่นำเข้า">{row.field}</div>{row.note && <div className="text-sm text-muted-foreground">{row.note}</div>}</TableCell>
                <TableCell className="whitespace-pre-wrap" title={dateCellTooltip(record, row.date)}>{formatHdcDate(row.date)}</TableCell>
                <TableCell title={row.facility === '—' ? 'ไม่มีค่ารหัสสถานบริการในไฟล์ที่นำเข้า' : undefined}>{row.facility}</TableCell>
                <TableCell title={row.inputFacility === '—' ? 'ไม่มีค่ารหัสหน่วยบันทึกในไฟล์ที่นำเข้า' : undefined}>{row.inputFacility}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8">ไม่พบคอลัมน์วัคซีนในข้อมูลที่โหลดมา</TableCell></TableRow>}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

import type { EpiAge } from '../types/hdc';
import type { EpiRecord } from '../types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { getHdcVaccineRows, hdcValue, formatHdcDate } from '../utils/vaccine/hdcData';
import { formatDateStr } from '../utils/dateUtils';

interface VaccineHistoryModalProps {
  age?: EpiAge;
  warnings?: string[];
  warningsStatus?: string;
  isOpen: boolean;
  onClose: () => void;
  record: EpiRecord | null;
}

export function VaccineHistoryModal({ isOpen, onClose, record, warnings, warningsStatus, age }: VaccineHistoryModalProps) {
  if (!record) return null;
  const rows = getHdcVaccineRows(record, age);
  const dateWarnings = warnings ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ประวัติการรับวัคซีน</DialogTitle>
          <DialogDescription>{age ? `รายการวัคซีนสำหรับกลุ่มอายุ ${age} ปี` : 'ข้อมูลจาก HDC ที่นำเข้า แสดงทุกเข็ม'}</DialogDescription>
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
        <p className="text-sm text-zinc-500">{rows.length} รายการ · — หมายถึงไม่มีค่าในข้อมูลที่โหลดมา</p>
        {warningsStatus && <p role="status" className="text-sm text-zinc-500">{warningsStatus}</p>}
        {dateWarnings.length > 0 && <div className="border rounded-lg p-3 text-sm space-y-2">
          <p className="font-semibold">ข้อสังเกตข้อมูลวันที่ — โปรดตรวจสอบต้นทาง</p>
          <p className="text-zinc-500">ข้อสังเกตนี้ไม่เปลี่ยนผลจาก HDC และยังไม่ยืนยันว่าเป็นการบันทึกผิด</p>
          <ul className="list-disc pl-5">{dateWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </div>}
        {rows.some(row => /^rv[23]/.test(row.field)) && <p className="text-sm text-zinc-500">ข้อมูล Rota แยกเป็นชุด 2 เข็ม (rv21, rv22) และชุด 3 เข็ม (rv31, rv32, rv33) ส่วน “Rota เข็ม 1” และ “Rota (ครบถ้วน)” เป็นชื่อเกณฑ์ตรวจเข็มแรกและตรวจครบชุด</p>}
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
                <TableCell><div>{row.name}</div><div className="text-xs text-zinc-500">{row.field}</div>{row.mappingNote && <div className="text-sm text-muted-foreground">ข้อมูลไม่พอประเมิน: {row.mappingNote}</div>}</TableCell>
                <TableCell className="whitespace-pre-wrap">{formatHdcDate(row.date)}</TableCell>
                <TableCell>{row.facility}</TableCell>
                <TableCell>{row.inputFacility}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8">ไม่พบคอลัมน์วัคซีนในข้อมูลที่โหลดมา</TableCell></TableRow>}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

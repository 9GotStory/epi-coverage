import React, { useMemo } from 'react';
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
import { hasDose } from '../utils/vaccine/ruleEngine';
import { Bot, CheckCircle2, XCircle } from 'lucide-react';

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
  const rows = useMemo(() => {
    if (!record) return [];
    return rules.map((rule) => {
      let passed = false;
      let dates: string[] = [];
      const fields = rule.required_fields || [];
      const altFields = rule.branch_alt_fields || [];

      if (rule.logic_type === 'ALL') {
        passed = fields.every((field: string) => hasDose(record, field as keyof EpiRecord, record.birth));
        dates = fields.map((f: string) => (record[f as keyof EpiRecord] ? formatDateStr(String(record[f as keyof EpiRecord])) : '-'));
      } else if (rule.logic_type === 'ANY') {
        passed = fields.some((field: string) => hasDose(record, field as keyof EpiRecord, record.birth));
        dates = fields.map((f: string) => (record[f as keyof EpiRecord] ? formatDateStr(String(record[f as keyof EpiRecord])) : '-'));
      } else if (rule.logic_type === 'BRANCH') {
        const path1Passed = fields.every((field: string) => hasDose(record, field as keyof EpiRecord, record.birth));
        const path2Passed =
          altFields.length > 0
            ? altFields.every((field: string) => hasDose(record, field as keyof EpiRecord, record.birth))
            : false;

        passed = path1Passed || path2Passed;

        // Show the path that was taken, or main if both failed
        if (path2Passed && !path1Passed) {
          dates = altFields.map((f: string) => (record[f as keyof EpiRecord] ? formatDateStr(String(record[f as keyof EpiRecord])) : '-'));
        } else {
          dates = fields.map((f: string) => (record[f as keyof EpiRecord] ? formatDateStr(String(record[f as keyof EpiRecord])) : '-'));
        }
      }

      return {
        name: rule.display_name,
        passed,
        dateString: dates.join(', '),
      };
    });
  }, [record, rules]);

  if (!record) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            ประวัติการรับวัคซีน
          </DialogTitle>
          <div className="text-sm text-slate-500 mt-2 space-y-1">
            <p><span className="font-semibold text-slate-700">ชื่อ-สกุล:</span> {record.name} {record.lname}</p>
            <p><span className="font-semibold text-slate-700">CID:</span> {record.cid}</p>
            <p><span className="font-semibold text-slate-700">วันเกิด:</span> {formatDateStr(String(record.birth))}</p>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 max-h-[50vh] mt-4 no-scrollbar">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รายการวัคซีน</TableHead>
                <TableHead>วันที่ได้รับ</TableHead>
                <TableHead className="text-center">สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.dateString}</TableCell>
                  <TableCell className="text-center">
                    {r.passed ? (
                      <div className="inline-flex items-center justify-center text-green-600 font-medium bg-green-50 px-2 py-1 rounded-md text-xs">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        มีข้อมูล
                      </div>
                    ) : (
                      <div className="inline-flex items-center justify-center text-red-600 font-medium bg-red-50 px-2 py-1 rounded-md text-xs">
                        <XCircle className="w-3 h-3 mr-1" />
                        ขาดข้อมูล
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-slate-500 py-8">
                    ไม่มีเงื่อนไขวัคซีนสำหรับมุมมองนี้
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* 
          // FUTURE FEATURE (IDEA 1): AI Analysis 
        */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
          <Button variant="outline" className="border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors">
            <Bot className="w-4 h-4 mr-2" />
            ให้ AI ช่วยวิเคราะห์ (Coming Soon)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

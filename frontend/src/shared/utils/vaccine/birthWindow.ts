import type { EpiRecord } from '../../types';
import { calendarDay } from './hdcData';

/**
 * Issue #121 (ADR-0008): Birth Window ของ Vaccine Rule — ช่วงวันเกิดที่ rule ใช้กับเด็ก
 * (CONTEXT.md §41) เริ่มรวม (born_on_or_after) สิ้นสุดไม่รวม (born_before) ด้านที่ว่าง = ไม่จำกัด
 * ค่าเป็นวันปฏิทิน ค.ศ. `yyyy-MM-dd` ตามสัญญาการอ่านของ backend
 */
export interface BirthWindow {
  born_on_or_after?: string;
  born_before?: string;
}

export type BirthWindowSide = 'born_on_or_after' | 'born_before';

/** Inapplicable Rule (CONTEXT.md §42) ของเด็กหนึ่งคน พร้อมด้านของช่วงที่ตัดเด็กออก */
export interface InapplicableRule {
  rule_id: string;
  display_name: string;
  side: BirthWindowSide;
  date: string;
}

export type RuleApplicability =
  | { kind: 'applies' }
  | { kind: 'inapplicable'; side: BirthWindowSide; date: string }
  | { kind: 'not_evaluable'; reason: string };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** วันปฏิทินจริงในรูป `yyyy-MM-dd` (ปฏิเสธ 2023-02-30 ฯลฯ) — เกณฑ์เดียวกับการตรวจฝั่ง backend */
export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const windowSide = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function hasBirthWindow(rule: BirthWindow): boolean {
  return windowSide(rule.born_on_or_after) !== '' || windowSide(rule.born_before) !== '';
}

/**
 * ตัดสินว่า rule ใช้กับเด็กรายนี้หรือไม่ — ตัดสินก่อนการตรวจคอลัมน์ วันที่ และ Target Age
 * - ไม่มี Birth Window → ใช้กับทุกคนเหมือนเดิม
 * - มีช่วงและวันเกิดอยู่ในช่วง → ใช้ (`born_on_or_after <= birth < born_before`)
 * - มีช่วงและวันเกิดอยู่นอกช่วง → Inapplicable Rule
 * - มีช่วงแต่ไม่มีวันเกิดที่ถูกต้อง (หรือช่วงในชีตไม่ใช่วันที่) → ประเมินไม่ได้ ไม่เดาว่าเป็นสูตรใด
 */
export function ruleApplicability(rule: BirthWindow, record: EpiRecord): RuleApplicability {
  if (!hasBirthWindow(rule)) return { kind: 'applies' };
  const start = windowSide(rule.born_on_or_after);
  const end = windowSide(rule.born_before);
  if ((start && !isIsoCalendarDate(start)) || (end && !isIsoCalendarDate(end))) {
    return { kind: 'not_evaluable', reason: 'ช่วงวันเกิดของเกณฑ์ไม่ถูกต้อง' };
  }
  const birth = calendarDay(record.birth);
  if (!birth) return { kind: 'not_evaluable', reason: 'ไม่มีวันเกิดที่ถูกต้อง' };
  if (start && birth < start) return { kind: 'inapplicable', side: 'born_on_or_after', date: start };
  if (end && birth >= end) return { kind: 'inapplicable', side: 'born_before', date: end };
  return { kind: 'applies' };
}

export function isInapplicableRule(rule: BirthWindow, record: EpiRecord): boolean {
  return ruleApplicability(rule, record).kind === 'inapplicable';
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** `2023-05-01` → `1 พ.ค. 2566` (พ.ศ.) — แปลงจากตัวเลขตรง ไม่ผ่าน Date จึงไม่เลื่อนตามเขตเวลา */
export function formatBirthWindowDate(iso: string): string {
  if (!isIsoCalendarDate(iso)) return iso;
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${THAI_MONTHS[month - 1]} ${year + 543}`;
}

/** ข้อความอธิบาย Inapplicable Rule เช่น "ไม่ใช้กับเด็กรายนี้ (เกิดก่อน 1 พ.ค. 2566)" */
export function inapplicableReason(rule: Pick<InapplicableRule, 'side' | 'date'>): string {
  const relation = rule.side === 'born_on_or_after' ? 'เกิดก่อน' : 'เกิดตั้งแต่';
  return `ไม่ใช้กับเด็กรายนี้ (${relation} ${formatBirthWindowDate(rule.date)})`;
}

/** ช่วงวันเกิดแบบอ่านง่ายสำหรับรายการเกณฑ์ เช่น "เกิดตั้งแต่ 1 พ.ค. 2566" — ไม่มีช่วงคืน '' */
export function describeBirthWindow(rule: BirthWindow): string {
  const start = windowSide(rule.born_on_or_after);
  const end = windowSide(rule.born_before);
  const parts = [
    start ? `เกิดตั้งแต่ ${formatBirthWindowDate(start)}` : '',
    end ? `เกิดก่อน ${formatBirthWindowDate(end)}` : '',
  ].filter(Boolean);
  return parts.join(' และ');
}

/** ช่อง พ.ศ. `วว/ดด/ปปปป` ↔ ค่าเก็บ ค.ศ. `yyyy-MM-dd` (ฟอร์มแก้ไขเกณฑ์) */
export function isoToBeInput(iso: string | undefined): string {
  const value = windowSide(iso);
  if (!isIsoCalendarDate(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  return `${day}/${month}/${year + 543}`;
}

/** คืน `yyyy-MM-dd` หรือ '' เมื่อว่าง หรือ null เมื่อไม่ใช่วันที่จริงในรูป วว/ดด/ปปปป (พ.ศ.) */
export function beInputToIso(input: string): string | null {
  const value = input.trim();
  if (value === '') return '';
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [day, month, beYear] = match.slice(1).map(Number);
  const iso = `${String(beYear - 543).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoCalendarDate(iso) ? iso : null;
}

import type { EpiRecord } from '../../types';
import type { VaccineDateChecks, VaccineDatePair } from '../../types/vaccineDateChecks';
import type { VaccineRule } from './ruleEngine';
import { buildFieldLabelMap } from './rulePresentation';
import { calendarDay, vaccineFieldLabel } from './hdcData';

/** คีย์วันที่สำหรับการประเมิน — timestamp ที่มี timezone แปลงตามเขตเวลาท้องถิ่น (กันวันเลื่อนหลัง 1 วัน) */
export function dateKey(value: unknown): string | null {
  return calendarDay(value);
}

// Compatibility defaults for unsaved legacy rules. Once saved, the explicit pairs are authoritative.
export function getRuleDateChecks(rule: VaccineRule, allRules: VaccineRule[]): VaccineDateChecks {
  if (rule.date_checks) return rule.date_checks;
  const own = new Set([...(rule.required_fields || []), ...(rule.branch_alt_fields || [])]);
  const fields = [...new Set(allRules.filter(r => r.is_active).flatMap(r => [...r.required_fields, ...(r.branch_alt_fields || [])]))];
  const pairs: VaccineDatePair[] = [];
  for (const field of fields) {
    const a = field.match(/^(hbv|dtp|hib|ipv|opv|mmr|pcv|je|j1|rv2|rv3)(\d+)_date$/);
    if (!a) continue;
    for (const other_field of fields) {
      const b = other_field.match(/^(hbv|dtp|hib|ipv|opv|mmr|pcv|je|j1|rv2|rv3)(\d+)_date$/);
      if (b && a[1] === b[1] && Number(a[2]) < Number(b[2]) && (own.has(field) || own.has(other_field))) pairs.push({ field, other_field });
    }
  }
  return { before_birth: true, allow_on_birth: rule.target_age_months === 0, same_day_pairs: pairs, ordered_pairs: pairs };
}

export function getRuleDateWarnings(record: EpiRecord, rule: VaccineRule, allRules: VaccineRule[]): string[] {
  if (!rule.is_active) return [];
  const config = getRuleDateChecks(rule, allRules);
  // ป้ายชื่อเข็มมาจาก vaccine_rules (display_name ของ rule ที่ใช้ field นั้น) โดย fallback ที่ vaccineFieldLabel
  const labels = buildFieldLabelMap(allRules);
  const name = (field: string) => labels.get(field) ?? vaccineFieldLabel(field);
  const warnings: string[] = [];
  const birth = dateKey(record.birth);
  const fields = [...new Set([...rule.required_fields, ...(rule.branch_alt_fields || [])])];
  for (const field of fields) {
    const day = dateKey(record[field as keyof EpiRecord]);
    if (day === '') warnings.push(`${name(field)}: รูปแบบวันที่ไม่ถูกต้อง`);
    else if (day && birth) {
      if (config.before_birth && day < birth) warnings.push(`${name(field)}: วันที่ฉีดก่อนวันเกิด`);
      if (!config.allow_on_birth && day === birth) warnings.push(`${name(field)}: วันที่ฉีดตรงวันเกิดตามเกณฑ์ที่ไม่อนุญาต`);
    }
  }
  for (const { field, other_field } of config.same_day_pairs) {
    const a = dateKey(record[field as keyof EpiRecord]);
    const b = dateKey(record[other_field as keyof EpiRecord]);
    if (a && b && a === b) warnings.push(`${name(field)} / ${name(other_field)}: วันที่ซ้ำซ้อนกับเข็มอื่น`);
  }
  for (const { field, other_field } of config.ordered_pairs) {
    const a = dateKey(record[field as keyof EpiRecord]);
    const b = dateKey(record[other_field as keyof EpiRecord]);
    if (a && b && a > b) warnings.push(`${name(other_field)}: วันที่ฉีดก่อน ${name(field)}`);
  }
  return [...new Set(warnings)];
}

export function getRecordDateWarnings(record: EpiRecord, rules: VaccineRule[]): string[] {
  return [...new Set(rules.flatMap(rule => getRuleDateWarnings(record, rule, rules)))];
}

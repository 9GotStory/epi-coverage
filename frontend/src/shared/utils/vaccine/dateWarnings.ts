import type { EpiRecord } from '../../types';
import type { VaccineDateChecks, VaccineDatePair } from '../../types/vaccineDateChecks';
import type { VaccineRule } from './ruleEngine';
import { buildFieldLabelMap } from './rulePresentation';
import { calendarDay, vaccineFieldLabel } from './hdcData';
import { ruleApplicability } from './birthWindow';

/** คีย์วันที่สำหรับการประเมิน — timestamp ที่มี timezone แปลงตามเขตเวลาท้องถิ่น (กันวันเลื่อนหลัง 1 วัน) */
export function dateKey(value: unknown): string | null {
  return calendarDay(value);
}

// Compatibility defaults for unsaved legacy rules. Once saved, the explicit pairs are authoritative.
export function getRuleDateChecks(rule: VaccineRule, allRules: VaccineRule[]): VaccineDateChecks {
  if (rule.date_checks) return rule.date_checks;
  const own = new Set([...(rule.required_fields || []), ...(rule.branch_alt_fields || [])]);
  const active = allRules.filter(r => r.is_active);
  const fields = [...new Set(active.flatMap(r => [...r.required_fields, ...(r.branch_alt_fields || [])]))];
  // Issue #100: dose order comes from the configured target age (earliest rule using the field),
  // never the column number — HOSxP stores the 4-month HBV dose in hbv4_date and the 6-month dose in hbv3_date.
  const ageOf = (field: string): number | undefined => {
    const ages = active
      .filter(r => typeof r.target_age_months === 'number' && [...r.required_fields, ...(r.branch_alt_fields || [])].includes(field))
      .map(r => r.target_age_months as number);
    return ages.length > 0 ? Math.min(...ages) : undefined;
  };
  const sameDay: VaccineDatePair[] = [];
  const ordered: VaccineDatePair[] = [];
  for (const field of fields) {
    const a = field.match(/^(hbv|dtp|hib|ipv|opv|mmr|pcv|je|j1|rv2|rv3)(\d+)_date$/);
    if (!a) continue;
    for (const other_field of fields) {
      const b = other_field.match(/^(hbv|dtp|hib|ipv|opv|mmr|pcv|je|j1|rv2|rv3)(\d+)_date$/);
      if (!b || a[1] !== b[1] || field === other_field || !(own.has(field) || own.has(other_field))) continue;
      // Same-day duplicates do not depend on order; the number only keeps one entry per pair.
      if (Number(a[2]) < Number(b[2])) sameDay.push({ field, other_field });
      // Unknown or equal ages infer no order, so no false "dose given before" warning.
      const ageA = ageOf(field);
      const ageB = ageOf(other_field);
      if (ageA !== undefined && ageB !== undefined && ageA < ageB) ordered.push({ field, other_field });
    }
  }
  return { before_birth: true, allow_on_birth: rule.target_age_months === 0, same_day_pairs: sameDay, ordered_pairs: ordered };
}

export function getRuleDateWarnings(record: EpiRecord, rule: VaccineRule, allRules: VaccineRule[]): string[] {
  // Issue #121: Inapplicable Rule ไม่ใช้กับเด็กรายนี้ จึงไม่มีข้อสังเกตวันที่ของตัวเอง
  if (!rule.is_active || ruleApplicability(rule, record).kind === 'inapplicable') return [];
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

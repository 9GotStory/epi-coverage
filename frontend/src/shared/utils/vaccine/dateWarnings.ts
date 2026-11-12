import type { EpiRecord } from '../../types';
import type { VaccineDateChecks, VaccineDatePair } from '../../types/vaccineDateChecks';
import type { VaccineRule } from './ruleEngine';
import { buildDoseLabeler } from './rulePresentation';
import { calendarDay, formatHdcDate } from './hdcData';
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

/** Issue #130: a date-check warning with the columns it concerns, their display dates and its message */
export interface DateWarning {
  type: 'before_birth' | 'on_birth' | 'same_day' | 'ordered' | 'invalid';
  /** ordered: [dose expected earlier, dose expected later] as configured in ordered_pairs */
  fields: string[];
  labels: string[];
  /** DD-MM-YYYY like the history table; an invalid value is kept raw */
  dates: string[];
  birth?: string;
  message: string;
}

// Same-Day Pairs are symmetric, so a pair configured either way (or on two rules) is one warning.
const warningKey = ({ type, fields }: DateWarning) => `${type}|${(type === 'same_day' ? [...fields].sort() : fields).join('|')}`;
const uniqueWarnings = (warnings: DateWarning[]): DateWarning[] =>
  warnings.filter((warning, index) => warnings.findIndex(other => warningKey(other) === warningKey(warning)) === index);

/**
 * labelRules: กฎที่ใช้ตั้งชื่อเข็ม — ปกติคือ allRules แต่ View 1 ตรวจเฉพาะกฎของกลุ่มอายุ
 * จึงส่งกฎทั้งหมดของปีและกลุ่มอายุมาเพื่อให้ชื่อเข็มตรงกับ View 2 และหน้า Rules Engine
 */
export function getRuleDateWarningDetails(record: EpiRecord, rule: VaccineRule, allRules: VaccineRule[], labelRules: VaccineRule[] = allRules): DateWarning[] {
  // Issue #121: Inapplicable Rule ไม่ใช้กับเด็กรายนี้ จึงไม่มีข้อสังเกตวันที่ของตัวเอง
  if (!rule.is_active || ruleApplicability(rule, record).kind === 'inapplicable') return [];
  const config = getRuleDateChecks(rule, allRules);
  // Issue #130: ป้ายชื่อเข็มเดียวกับหน้า Rules Engine (display_name ของ rule คอลัมน์เดียว หรือป้ายตามคอลัมน์)
  const name = buildDoseLabeler(labelRules);
  const rawValue = (field: string) => record[field as keyof EpiRecord];
  const warnings: DateWarning[] = [];
  const singleDoseWarning = (type: DateWarning['type'], field: string, message: (date: string) => string, birth?: string): DateWarning => {
    // An invalid value is shown as stored (String, since hdcValue cannot format an invalid Date).
    const date = type === 'invalid' ? String(rawValue(field)).trim() : formatHdcDate(rawValue(field));
    return { type, fields: [field], labels: [name(field)], dates: [date], ...(birth ? { birth } : {}), message: message(date) };
  };
  const birth = dateKey(record.birth);
  const birthDate = formatHdcDate(record.birth);
  const fields = [...new Set([...rule.required_fields, ...(rule.branch_alt_fields || [])])];
  for (const field of fields) {
    const day = dateKey(rawValue(field));
    if (day === '') warnings.push(singleDoseWarning('invalid', field, date => `${name(field)} รูปแบบวันที่ไม่ถูกต้อง ("${date}")`));
    else if (day && birth) {
      if (config.before_birth && day < birth) warnings.push(singleDoseWarning('before_birth', field, date => `${name(field)} ฉีดก่อนวันเกิด (${date}, เกิด ${birthDate})`, birthDate));
      if (!config.allow_on_birth && day === birth) warnings.push(singleDoseWarning('on_birth', field, date => `${name(field)} ฉีดตรงวันเกิด (${date}) ซึ่งเกณฑ์ไม่อนุญาต`));
    }
  }
  const pairWarning = (type: DateWarning['type'], first: string, second: string, message: (firstDate: string, secondDate: string) => string): DateWarning => {
    const dates = [formatHdcDate(rawValue(first)), formatHdcDate(rawValue(second))];
    return { type, fields: [first, second], labels: [name(first), name(second)], dates, message: message(dates[0], dates[1]) };
  };
  for (const { field, other_field } of config.same_day_pairs) {
    const a = dateKey(rawValue(field));
    const b = dateKey(rawValue(other_field));
    if (a && b && a === b) warnings.push(pairWarning('same_day', field, other_field, day => `${name(field)} และ ${name(other_field)} ฉีดวันเดียวกัน (${day})`));
  }
  for (const { field, other_field } of config.ordered_pairs) {
    const a = dateKey(rawValue(field));
    const b = dateKey(rawValue(other_field));
    // field ควรฉีดก่อน other_field แต่วันที่จริงกลับหลัง จึงขึ้นต้นด้วย other_field
    if (a && b && a > b) warnings.push(pairWarning('ordered', field, other_field, (fieldDate, otherDate) => `${name(other_field)} (${otherDate}) ฉีดก่อน ${name(field)} (${fieldDate})`));
  }
  return uniqueWarnings(warnings);
}

/** Issue #130: the short note on a history row the warning concerns */
export function dateWarningNote(warning: DateWarning, field: string): string {
  const other = warning.labels[warning.fields[0] === field ? 1 : 0];
  switch (warning.type) {
    case 'same_day': return `วันเดียวกับ ${other}`;
    // fields[0] is expected before fields[1]
    case 'ordered': return warning.fields[0] === field ? `ฉีดหลัง ${other}` : `ฉีดก่อน ${other}`;
    case 'before_birth': return 'ฉีดก่อนวันเกิด';
    case 'on_birth': return 'ฉีดตรงวันเกิด';
    case 'invalid': return 'รูปแบบวันที่ไม่ถูกต้อง';
  }
}

export function getRecordDateWarningDetails(record: EpiRecord, rules: VaccineRule[], labelRules: VaccineRule[] = rules): DateWarning[] {
  return uniqueWarnings(rules.flatMap(rule => getRuleDateWarningDetails(record, rule, rules, labelRules)));
}

export function getRuleDateWarnings(record: EpiRecord, rule: VaccineRule, allRules: VaccineRule[]): string[] {
  return getRuleDateWarningDetails(record, rule, allRules).map(warning => warning.message);
}

export function getRecordDateWarnings(record: EpiRecord, rules: VaccineRule[]): string[] {
  return getRecordDateWarningDetails(record, rules).map(warning => warning.message);
}

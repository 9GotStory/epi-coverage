import type { VaccineBreakdownEntry } from '../types/dashboardSummary';
import type { VaccineRule } from './vaccine/ruleEngine';

/**
 * Read-only reference from the exact HDC standard report used by the EPI1 OpenData
 * dataset. These are aggregate counts, NOT person-level HDC export values.
 * No cross-year label inference, no blind DTP3 ↔ DTP-HB3 substitution.
 */
export const HDC_EPI1_REPORT_ID = 'c88658f4d09acb8c76e6c06ffb58ebaf';
export const HDC_SONG_DISTRICT_PREFIX = '5406';
const MONTHS = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09'] as const;

// Explicitly reviewed against FY2569 vaccine_rules AND s_epi1 report keys.
// Further vaccine codes are intentionally not guessed from a display label.
const VERIFIED_METRICS = [
  { metric: 'bcg', hdcCode: '010', vaccineGroup: 'BCG', sourceField: 'bcg_date' },
  { metric: 'dtp1', hdcCode: '031', vaccineGroup: 'DTP', sourceField: 'dtp1_date' },
  { metric: 'dtp2', hdcCode: '032', vaccineGroup: 'DTP', sourceField: 'dtp2_date' },
] as const;

export type HdcEpi1Metric = (typeof VERIFIED_METRICS)[number]['metric'];

export interface HdcEpi1AnnualReference {
  reportId: typeof HDC_EPI1_REPORT_ID;
  fiscalYear: number;
  target: number;
  numerators: Record<HdcEpi1Metric, number>;
  dateCom: string;
  rowCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function count(row: Record<string, unknown>, field: string): number {
  const source = row[field];
  // Absent/invalid data is never treated as zero or an empty successful result.
  if (!(typeof source === 'number' || (typeof source === 'string' && /^\d+$/.test(source)))) {
    throw new Error('ข้อมูลจำนวนใน HDC ไม่ครบหรือไม่ถูกต้อง');
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('ข้อมูลจำนวนใน HDC ไม่ครบหรือไม่ถูกต้อง');
  }
  return value;
}

/**
 * Keep only the supported district, report, and year. This is required even
 * when the backend serves a province-wide proxy fallback instead of its cache.
 * Throw on ambiguous/partial snapshots instead of displaying an invented rate.
 */
export function summarizeHdcEpi1(rows: unknown[], fiscalYear: number): HdcEpi1AnnualReference | null {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2500) throw new Error('ปีงบประมาณไม่ถูกต้อง');
  const seen = new Set<string>();
  const numerators: Record<HdcEpi1Metric, number> = { bcg: 0, dtp1: 0, dtp2: 0 };
  let target = 0;
  let dateCom = '';
  let rowCount = 0;

  for (const value of rows) {
    const row = asRecord(value);
    if (!row || row.id !== HDC_EPI1_REPORT_ID ||
      String(row.b_year) !== String(fiscalYear) ||
      !String(row.areacode ?? '').startsWith(HDC_SONG_DISTRICT_PREFIX)) continue;

    const hospcode = row.hospcode;
    const areacode = row.areacode;
    const snapshot = row.date_com;
    if (typeof hospcode !== 'string' || !/^\d{5}$/.test(hospcode) ||
      typeof areacode !== 'string' || !/^\d{8}$/.test(areacode) ||
      typeof snapshot !== 'string' || !/^\d{14}$/.test(snapshot)) {
      throw new Error('ข้อมูลอ้างอิง HDC ไม่มีรหัสหน่วยบริการ/พื้นที่หรือรอบประมวลผลที่ตรวจสอบได้');
    }
    const locationKey = `${hospcode}|${areacode}`;
    if (seen.has(locationKey)) throw new Error('ข้อมูล HDC มีระเบียนพื้นที่/หน่วยบริการซ้ำ');
    seen.add(locationKey);
    if (dateCom && dateCom !== snapshot) throw new Error('ข้อมูล HDC มาจากหลายรอบประมวลผล');
    dateCom = snapshot;

    for (const month of MONTHS) {
      const monthTarget = count(row, `target${month}`);
      target += monthTarget;
      for (const metric of VERIFIED_METRICS) {
        const value = count(row, `${metric.metric}_${month}`);
        if (value > monthTarget) throw new Error('ตัวตั้ง HDC มากกว่าตัวหารของเดือนเดียวกัน');
        numerators[metric.metric] += value;
      }
    }
    rowCount += 1;
  }

  if (!rowCount) return null;
  if (target === 0) throw new Error('ข้อมูล HDC ไม่มีประชากรเป้าหมายสำหรับการคำนวณร้อยละ');
  return { reportId: HDC_EPI1_REPORT_ID, fiscalYear, target, numerators, dateCom, rowCount };
}

/**
 * A snapshot breakdown metric must match exactly ONE active rule from the
 * selected fiscal year, with a stable metric identity AND verified source code.
 * EPI's display_name is never itself sufficient for mapping into HDC OpenData.
 */
export function findHdcEpi1Metric(
  item: VaccineBreakdownEntry,
  rules: VaccineRule[],
  fiscalYear: number,
): HdcEpi1Metric | null {
  if (!item.metric_key || !Array.isArray(rules)) return null;
  const matches = rules.filter(rule =>
    rule.is_active && rule.view_type === 1 && rule.age_group === '1yr' &&
    Number(rule.fiscal_year) === fiscalYear &&
    (rule.metric_key || rule.rule_id) === item.metric_key &&
    rule.display_name === item.name);
  if (matches.length !== 1) return null;
  const rule = matches[0];
  const validated = VERIFIED_METRICS.find(mapping =>
    rule.hdc_code === mapping.hdcCode &&
    rule.vaccine_group === mapping.vaccineGroup &&
    rule.logic_type === 'ALL' &&
    rule.required_fields.length === 1 &&
    rule.required_fields[0] === mapping.sourceField &&
    !(rule.branch_alt_fields?.length) &&
    rule.is_required_for_v2 !== false);
  return validated?.metric ?? null;
}

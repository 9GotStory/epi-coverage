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
    rule.display_name === item.name);
  // A reused active display name is ambiguous even when one rule has the
  // snapshot key. Do not silently select one of several candidate rules.
  if (matches.length !== 1) return null;
  const rule = matches[0];
  if ((rule.metric_key || rule.rule_id) !== item.metric_key) return null;
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


/**
 * Crosswalk of HDC AGGREGATE COLUMN contracts by AGE REPORT, not a duplicate
 * source of vaccine display names. The visible vaccine list and identity come
 * exclusively from snapshot metric_key + current active vaccine_rules.
 *
 * Only pairs whose source meaning can be checked against the age-specific
 * HDC schema and EPI field/branch contract appear here. Deliberately absent:
 * DTP3 ↔ combined DTP-HB3; OPV3 pending local export mapping;
 * IPV2 ↔ ambiguous `ipv`/ `ipv1` naming.
 */
type HdcAgeGroup = '1yr' | '2yr' | '3yr' | '5yr';
interface HdcMetricRuleMapping {
  metric: string;
  code: string;
  vaccineGroup: string;
  fields: readonly string[];
  logic: 'ALL' | 'BRANCH';
  branch?: readonly string[];
}

interface HdcAgeReport {
  table: string;
  reportId: string;
  mappings: readonly HdcMetricRuleMapping[];
}

const pair = (
  metric: string, code: string, vaccineGroup: string, field: string,
): HdcMetricRuleMapping => ({metric,code,vaccineGroup,fields:[field],logic:'ALL'});

const branch = (
  metric: string,code:string,vaccineGroup:string,fields:readonly string[],alternative:readonly string[],
): HdcMetricRuleMapping=>({metric,code,vaccineGroup,fields,logic:'BRANCH',branch:alternative});

export const HDC_AGE_REPORTS: Record<HdcAgeGroup, HdcAgeReport> = {
  '1yr': {
    table: 's_epi1', reportId: HDC_EPI1_REPORT_ID,
    mappings: [
      pair('bcg','010','BCG','bcg_date'),
      pair('hbv','041','HBV','hbv1_date'),
      pair('hbv2','042','HBV','hbv2_date'),
      // HOSxP age-4mo/age-6mo physical column swap is verified in
      // docs/hdc-column-upgrade.md. These are DOSE labels, not field suffixes.
      pair('hbv3','043','HBV','hbv4_date'),
      pair('hbv4','044','HBV','hbv3_date'),
      pair('dtp1','031','DTP','dtp1_date'),
      pair('dtp2','032','DTP','dtp2_date'),
      pair('hib1','D21','Hib','hib1_date'),
      pair('hib2','D22','Hib','hib2_date'),
      pair('hib3','D23','Hib','hib3_date'),
      pair('ipv1','I11','IPV','ipv1_date'),
      pair('mmr','061','MMR','mmr1_date'),
      pair('pcv1','P11','PCV','pcv1_date'),
      pair('pcv2','P12','PCV','pcv2_date'),
      pair('pcv3','P13','PCV','pcv3_date'),
      branch('rota1','R11/R21','Rota',['rv21_date'],['rv31_date']),
      branch('rota','R12/R23','Rota',['rv21_date','rv22_date'],['rv31_date','rv32_date','rv33_date']),
    ],
  },
  '2yr': {
    table:'s_epi2',reportId:'71e49e4b61aafee17761601c506d5f85',
    mappings:[
      pair('mmr1','061','MMR','mmr1_date'),
      pair('mmr2','073','MMR','mmr2_date'),
      pair('dtp4','034','DTP','dtp4_date'),
      pair('opv4','084','OPV','opv4_date'),
      branch('je2','J11/051','JE',['j11_date'],['je1_date','je2_date']),
    ],
  },
  '3yr': {
    table:'s_epi3',reportId:'267ce09f2a704eb7783997e25d1f18ba',
    mappings:[
      branch('je3','J12/053','JE',['j12_date'],['je3_date']),
    ],
  },
  '5yr': {
    table:'s_epi5',reportId:'c47283d3c2c1e6528ddcf88c254f21b3',
    mappings:[
      pair('dtp5','035','DTP','dtp5_date'),
      pair('opv5','085','OPV','opv5_date'),
    ],
  },
};

export function getHdcAgeReport(ageGroup: string): HdcAgeReport | null {
  return ageGroup in HDC_AGE_REPORTS ? HDC_AGE_REPORTS[ageGroup as HdcAgeGroup] : null;
}

export interface HdcAgeAnnualReference {
  ageGroup: HdcAgeGroup;
  table: string;
  reportId: string;
  fiscalYear: number;
  target: number;
  numerators: Record<string, number>;
  dateCom: string;
  rowCount: number;
}

function checkCounts(row: Record<string,unknown>,field:string):number {
  const val=row[field];
  if (!(typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val)))) {
    throw new Error('จำนวนจาก HDC OpenData ไม่ครบหรือมีรูปแบบไม่ถูกต้อง');
  }
  const n=Number(val);
  if (!Number.isSafeInteger(n) || n<0) throw new Error('จำนวนจาก HDC OpenData ไม่ใช่จำนวนเต็มที่ถูกต้อง');
  return n;
}

/** Sum 12 monthly numerator/target pairs in the same official age report. */
export function summarizeHdcAgeAnnual(
  rows: unknown[], fiscalYear: number, ageGroup: string,
): HdcAgeAnnualReference | null {
  const config=getHdcAgeReport(ageGroup);
  if (!config || !Number.isInteger(fiscalYear) || fiscalYear<2500 || !Array.isArray(rows)) return null;
  const seen=new Set<string>();
  const numerators:Record<string,number>=Object.fromEntries(config.mappings.map(x=>[x.metric,0]));
  let total=0;
  let dateCom='';
  let rowCount=0;
  for(const input of rows){
    const row=asRecord(input);
    if(!row || row.id!==config.reportId || String(row.b_year)!==String(fiscalYear) ||
       !String(row.areacode??'').startsWith(HDC_SONG_DISTRICT_PREFIX)) continue;
    // Source date_com in s_epi2/3/5 is YYYYMMDDHHMM (12 digits);
    // s_epi1 uses YYYYMMDDHHMMSS (14 digits).
    if(typeof row.hospcode!=='string' || !/^\d{5}$/.test(row.hospcode) ||
       typeof row.areacode!=='string' || !/^\d{8}$/.test(row.areacode) ||
       typeof row.date_com!=='string' || !/^\d{12}(?:\d{2})?$/.test(row.date_com)){
      throw new Error('รหัสหน่วยบริการ พื้นที่ หรือรอบประมวลผล HDC ไม่ถูกต้อง');
    }
    const location=`${row.hospcode}|${row.areacode}`;
    if(seen.has(location)) throw new Error('แหล่ง HDC มีข้อมูลซ้ำของหน่วยบริการและพื้นที่');
    seen.add(location);
    if(dateCom && row.date_com!==dateCom) throw new Error('แหล่ง HDC มีข้อมูลคนละรอบประมวลผล');
    dateCom=row.date_com;
    for(const month of MONTHS){
      const denominator=checkCounts(row,`target${month}`);
      total+=denominator;
      if(!Number.isSafeInteger(total))throw new Error('จำนวนรวม HDC เกินขอบเขตที่รองรับ');
      for(const mapping of config.mappings){
        const metricValue=checkCounts(row,`${mapping.metric}_${month}`);
        if(metricValue>denominator)throw new Error('ตัวตั้ง HDC มากกว่าตัวหารในเดือนเดียวกัน');
        numerators[mapping.metric]+=metricValue;
        if(!Number.isSafeInteger(numerators[mapping.metric])) throw new Error('จำนวนรวม HDC เกินขอบเขตที่รองรับ');
      }
    }
    rowCount++;
  }
  if(!rowCount)return null;
  if(total===0)throw new Error('HDC ไม่มีประชากรเป้าหมายสำหรับรายงานนี้');
  return {ageGroup:ageGroup as HdcAgeGroup,table:config.table,reportId:config.reportId,
    fiscalYear,target:total,numerators,dateCom,rowCount};
}

function sameStrings(a:readonly string[]|undefined,b:readonly string[]|undefined):boolean {
  return JSON.stringify(a??[])===JSON.stringify(b??[]);
}

/**
 * Resolve an OpenData metric from EXACTLY one active rule matching the summary
 * identity. No matching by fuzzy name, no implicit new vaccines, no auto code
 * guessing. Missing/changed rules are explicit unsupported states in the UI.
 */
export function findHdcAgeMetric(
  item:VaccineBreakdownEntry,rules:VaccineRule[],fiscalYear:number,ageGroup:string,
):string|null{
  const report=getHdcAgeReport(ageGroup);
  if(!report || !item.metric_key || !Array.isArray(rules))return null;
  const matches=rules.filter(r=>r.is_active===true && r.view_type===1 &&
    r.age_group===ageGroup && Number(r.fiscal_year)===fiscalYear &&
    r.display_name===item.name);
  if(matches.length!==1)return null;
  const rule=matches[0];
  if((rule.metric_key||rule.rule_id)!==item.metric_key)return null;
  const metric=report.mappings.filter(m=>m.code===rule.hdc_code &&
    m.vaccineGroup===rule.vaccine_group &&
    m.logic===rule.logic_type &&
    sameStrings(m.fields,rule.required_fields) &&
    sameStrings(m.branch,rule.branch_alt_fields));
  return metric.length===1 ? metric[0].metric:null;
}

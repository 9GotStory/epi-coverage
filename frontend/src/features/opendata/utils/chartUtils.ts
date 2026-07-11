import type { SEpiCompleteRecord } from './types';

// Map of HDC month codes (Fiscal year months)
export const MONTHS_MAP: Record<string, string> = {
  '10': 'ต.ค.',
  '11': 'พ.ย.',
  '12': 'ธ.ค.',
  '01': 'ม.ค.',
  '02': 'ก.พ.',
  '03': 'มี.ค.',
  '04': 'เม.ย.',
  '05': 'พ.ค.',
  '06': 'มิ.ย.',
  '07': 'ก.ค.',
  '08': 'ส.ค.',
  '09': 'ก.ย.'
};

const MONTH_KEYS = Object.keys(MONTHS_MAP);

export function formatCompleteDataForChart(data: SEpiCompleteRecord[]) {
  // Since we query by amphur, we might get multiple rows (one for each hospcode)
  // We need to aggregate them to show a total chart, or show them by facility.
  // For the bar chart (monthly trend), we aggregate all facilities.
  
  // Filter for Song District (5406) since MOPH API returns all of Phrae or matches other districts
  const filteredData = data.filter(row => row.areacode && row.areacode.startsWith('5406'));
  
  const monthlyTotals: Record<string, { target: number; result: number }> = {};
  
  MONTH_KEYS.forEach(m => {
    monthlyTotals[m] = { target: 0, result: 0 };
  });

  filteredData.forEach(row => {
    MONTH_KEYS.forEach(m => {
      const t = parseInt(row[`target${m}`] || '0', 10);
      const r = parseInt(row[`result${m}`] || '0', 10);
      monthlyTotals[m].target += isNaN(t) ? 0 : t;
      monthlyTotals[m].result += isNaN(r) ? 0 : r;
    });
  });

  // Convert to array for Recharts
  return MONTH_KEYS.map(m => {
    const target = monthlyTotals[m].target;
    const result = monthlyTotals[m].result;
    const coverage = target > 0 ? (result / target) * 100 : 0;
    
    return {
      name: MONTHS_MAP[m],
      target,
      result,
      coverage: parseFloat(coverage.toFixed(2))
    };
  });
}

export function formatEpiDataForChart(data: any[], vaccineKey: string) {
  // vaccineKey = 'dtp1', 'bcg', 'dtp4', etc.
  // We aggregate for the whole amphur over the months
  
  // Filter for Song District (5406)
  const filteredData = data.filter(row => row.areacode && String(row.areacode).startsWith('5406'));
  
  const monthlyTotals: Record<string, { target: number; result: number }> = {};
  
  MONTH_KEYS.forEach(m => {
    monthlyTotals[m] = { target: 0, result: 0 };
  });

  filteredData.forEach(row => {
    MONTH_KEYS.forEach(m => {
      const t = parseInt(row[`target${m}`] as string || '0', 10);
      const r = parseInt(row[`${vaccineKey}_${m}`] as string || '0', 10);
      monthlyTotals[m].target += isNaN(t) ? 0 : t;
      monthlyTotals[m].result += isNaN(r) ? 0 : r;
    });
  });

  return MONTH_KEYS.map(m => {
    const target = monthlyTotals[m].target;
    const result = monthlyTotals[m].result;
    const coverage = target > 0 ? (result / target) * 100 : 0;
    
    return {
      name: MONTHS_MAP[m],
      target,
      result,
      coverage: parseFloat(coverage.toFixed(2))
    };
  });
}

export function formatEpiAllVaccines(data: any[], targetTable: string = 's_epi1') {
  // We want to calculate the YTD cumulative target and result for all key vaccines
  
  const filteredData = data.filter(row => row.areacode && String(row.areacode).startsWith('5406'));
  
  const vaccines = targetTable === 's_epi2' ? [
    { key: 'pcv4', label: 'PCV 1 ปี' },
    { key: 'je2', label: 'LAJE/JE 1 ปี' },
    { key: 'dtp4', label: 'DTP 1 ปี 6 เดือน' },
    { key: 'opv4', label: 'OPV 1 ปี 6 เดือน' },
    { key: 'mmr1', label: 'MMR1 (เก็บตก)' },
    { key: 'mmr2', label: 'MMR 1 ปี 6 เดือน' }
  ] : [
    { key: 'bcg', label: 'BCG แรกเกิด' },
    { key: 'hbv4', label: 'HBV 6 เดือน (ครบ 3 เข็ม)' },
    { key: 'dtp_hb3', label: 'DTP 6 เดือน (ครบ 3 เข็ม)' },
    { key: 'opv3', label: 'OPV 6 เดือน' },
    { key: 'ipv', label: 'IPV 4 เดือน (ครบ 2 เข็ม)' },
    { key: 'rota', label: 'Rota (ครบถ้วน)' },
    { key: 'mmr', label: 'MMR 9 เดือน' }
  ];
  
  const totals: Record<string, { target: number; result: number; label: string }> = {};
  
  vaccines.forEach(v => {
    totals[v.key] = { target: 0, result: 0, label: v.label };
  });

  filteredData.forEach(row => {
    MONTH_KEYS.forEach(m => {
      const t = parseInt(row[`target${m}`] as string || '0', 10);
      
      // If target is valid, we add to all vaccines
      if (!isNaN(t) && t > 0) {
        vaccines.forEach(v => {
          const r = parseInt(row[`${v.key}_${m}`] as string || '0', 10);
          totals[v.key].target += t;
          totals[v.key].result += isNaN(r) ? 0 : r;
        });
      }
    });
  });

  // Convert to array for Radar and Grid charts
  return vaccines.map(v => {
    const target = totals[v.key].target;
    const result = totals[v.key].result;
    const coverage = target > 0 ? (result / target) * 100 : 0;
    
    return {
      vaccine: v.key,
      label: v.label,
      target,
      result,
      coverage: parseFloat(coverage.toFixed(2)),
      goal: 90 // Constant goal for visual reference in Radar chart
    };
  });
}

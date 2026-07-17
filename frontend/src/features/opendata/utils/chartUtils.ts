
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


export function formatEpiDataForChart(data: any[], vaccineKey: string) {
  // data is already filtered by OpenDataDashboard (either 'all' or specific hospital)
  const monthlyTotals: Record<string, { target: number; result: number }> = {};
  
  MONTH_KEYS.forEach(m => {
    monthlyTotals[m] = { target: 0, result: 0 };
  });

  data.forEach(row => {
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
  // data is already filtered by OpenDataDashboard
  
  const vaccines = targetTable === 's_epi2' ? [
    { key: 'je2', label: 'LAJE/JE (1 เข็ม หรือ ครบ 2 เข็ม)' },
    { key: 'dtp4', label: 'DTP (เข็ม 4)' },
    { key: 'opv4', label: 'OPV (เข็ม 4)' },
    { key: 'mmr1', label: 'MMR (เก็บตกเข็ม 1)' },
    { key: 'mmr2', label: 'MMR (เข็ม 2)' }
  ] : targetTable === 's_epi3' ? [
    { key: 'je3', label: 'LAJE เข็ม 2 / JE เข็ม 3' }
  ] : targetTable === 's_epi5' ? [
    { key: 'dtp5', label: 'DTP (เข็ม 5)' },
    { key: 'opv5', label: 'OPV (เข็ม 5)' }
  ] : [
    { key: 'bcg', label: 'BCG (1 เข็ม)' },
    { key: 'hbv4', label: 'HBV (3 เข็ม)' },
    { key: 'dtp_hb3', label: 'DTP (3 เข็ม)' },
    { key: 'hib3', label: 'Hib (3 เข็ม)' },
    { key: 'opv3', label: 'OPV (1 เข็ม ตอน 6 ด.)' },
    { key: 'ipv', label: 'IPV (2 เข็ม)' },
    { key: 'rota', label: 'Rota (ครบตามเกณฑ์)' },
    { key: 'mmr', label: 'MMR (1 เข็ม)' }
  ];
  
  const totals: Record<string, { target: number; result: number; label: string }> = {};
  
  vaccines.forEach(v => {
    totals[v.key] = { target: 0, result: 0, label: v.label };
  });

  data.forEach(row => {
    MONTH_KEYS.forEach(m => {
      const t = parseInt(row[`target${m}`] as string || '0', 10);
      const validT = isNaN(t) ? 0 : t;
      
      vaccines.forEach(v => {
        const r = parseInt(row[`${v.key}_${m}`] as string || '0', 10);
        totals[v.key].target += validT;
        totals[v.key].result += isNaN(r) ? 0 : r;
      });
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

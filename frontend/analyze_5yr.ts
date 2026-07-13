import { evaluateView2_5Yr } from './src/features/vaccine-5yr/utils/vaccineLogic5Yr';

async function run() {
  const url = 'https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec?action=getData&sheetName=Epi_5_Year';
  console.log('Fetching data...');
  try {
    const res = await fetch(url);
    const json = await res.json();
    const data = json.data;
    console.log('Total records:', data.length);
    
    let fullyImmunizedCount = 0;
    const missingCounts: Record<string, number> = {};

    for (const r of data) {
      if (r.is_active === false) continue;
      
      const v2 = evaluateView2_5Yr(r as any);
      if (v2.isFullyImmunized) {
        fullyImmunizedCount++;
      } else {
        v2.missingVaccines.forEach((v: string) => {
          missingCounts[v] = (missingCounts[v] || 0) + 1;
        });
      }
    }

    console.log('Fully Immunized:', fullyImmunizedCount);
    const sorted = Object.entries(missingCounts).sort((a, b) => b[1] - a[1]);
    console.log('Missing breakdown:');
    sorted.forEach(([k, v]) => console.log(`${k}: ${v}`));
  } catch (err) {
    console.error(err);
  }
}

run();

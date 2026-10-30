import { evaluateView2_5Yr } from './src/features/vaccine-5yr/utils/vaccineLogic5Yr';

async function run() {
  // Issue #73: the old one-off deployment URL was removed — the deployment itself was
  // deleted (it served pre-hardening code). Pass the current endpoint via GAS_API_URL.
  const base = process.env.GAS_API_URL;
  if (!base) throw new Error('GAS_API_URL is required');
  const url = `${base}?action=getData&sheetName=Epi_5_Year`;
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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getBirthDateRangeForQuarter(fiscalYear, quarter, ageYears) {
  const evaluateYear = fiscalYear - 543;
  let evalStartStr, evalEndStr;

  if (quarter === 1) {
    evalStartStr = `${evaluateYear - 1}-10-01`;
    evalEndStr = `${evaluateYear - 1}-12-31`;
  } else if (quarter === 2) {
    evalStartStr = `${evaluateYear}-01-01`;
    evalEndStr = `${evaluateYear}-03-31`;
  } else if (quarter === 3) {
    evalStartStr = `${evaluateYear}-04-01`;
    evalEndStr = `${evaluateYear}-06-30`;
  } else {
    evalStartStr = `${evaluateYear}-07-01`;
    evalEndStr = `${evaluateYear}-09-30`;
  }

  const evalStart = new Date(evalStartStr);
  const evalEnd = new Date(evalEndStr);
  evalEnd.setHours(23, 59, 59, 999);

  const start = new Date(evalStart);
  start.setFullYear(start.getFullYear() - ageYears);

  const end = new Date(evalEnd);
  end.setFullYear(end.getFullYear() - ageYears);

  return { start, end };
}

async function run() {
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getEpiData', targetTable: 'Epi_1_Year', hoscode: '00588' }) 
  });
  
  const json = await res.json();
  const data = json.data;
  
  const { start, end } = getBirthDateRangeForQuarter(2569, 4, 1);
  
  const cohort = data.filter(r => {
    if (!r.birth) return false;
    const bDate = new Date(r.birth);
    return bDate >= start && bDate <= end;
  });
  
  let passedFromHdc = 0;
  cohort.forEach(r => {
    if (r.result && r.result.includes('ผ่าน') && !r.result.includes('ไม่ผ่าน')) {
      passedFromHdc++;
    }
  });
  
  console.log(`Quarter 4 Total active records: ${data.length}`);
  console.log(`Quarter 4 Cohort records: ${cohort.length}`);
  console.log(`Quarter 4 Passed: ${passedFromHdc}`);
  console.log(`Quarter 4 Coverage: ${(passedFromHdc / cohort.length * 100).toFixed(2)}%`);
  
  // Try all quarters
  for (let q = 1; q <= 4; q++) {
    const { start, end } = getBirthDateRangeForQuarter(2569, q, 1);
    const qCohort = data.filter(r => {
      if (!r.birth) return false;
      const bDate = new Date(r.birth);
      return bDate >= start && bDate <= end;
    });
    
    let p = 0;
    qCohort.forEach(r => {
      if (r.result && r.result.includes('ผ่าน') && !r.result.includes('ไม่ผ่าน')) p++;
    });
    console.log(`\nQuarter ${q} Cohort records: ${qCohort.length}, Passed: ${p}, Coverage: ${(p/qCohort.length*100).toFixed(2)}%`);
  }
}

run().catch(console.error);

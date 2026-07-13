import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  
  // Need to use an admin hoscode like '00588' or '04604' to get data
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getEpiData', targetTable: 'Epi_1_Year', hoscode: '00588' }) // 00588 gets all data based on Data.js
  });
  
  const json = await res.json();
  const data = json.data;
  
  if (!Array.isArray(data) || data.length === 0) {
    console.log("No data returned");
    return;
  }
  
  console.log(`Total records: ${data.length}`);
  
  let passedFromHdc = 0;
  let failedFromHdc = 0;
  let noResult = 0;
  
  data.forEach(r => {
    if (r.is_active === false || r.is_active === 'FALSE' || r.is_active === 'false') return;
    
    if (r.result && typeof r.result === 'string') {
      if (r.result.includes('ผ่าน') && !r.result.includes('ไม่ผ่าน')) {
        passedFromHdc++;
      } else if (r.result.includes('ไม่ผ่าน')) {
        failedFromHdc++;
      } else {
        noResult++;
      }
    } else {
      noResult++;
    }
  });
  
  const totalActive = passedFromHdc + failedFromHdc + noResult;
  console.log(`Active records: ${totalActive}`);
  console.log(`Passed from HDC result: ${passedFromHdc}`);
  console.log(`Failed from HDC result: ${failedFromHdc}`);
  console.log(`No result or empty: ${noResult}`);
  console.log(`HDC Coverage based ONLY on 'result' column: ${(passedFromHdc / totalActive * 100).toFixed(2)}%`);
}

run().catch(console.error);

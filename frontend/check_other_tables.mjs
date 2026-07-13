import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  
  const tables = ['Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year'];
  for (const table of tables) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getEpiData', targetTable: table, hoscode: '00588' }) 
    });
    const json = await res.json();
    const data = json.data || [];
    
    let pass = 0;
    data.forEach(r => {
      if (r.result && r.result.includes('ผ่าน') && !r.result.includes('ไม่ผ่าน')) pass++;
    });
    
    console.log(`${table} - Total records: ${data.length}, Passed: ${pass}, Coverage: ${(pass/data.length*100).toFixed(2)}%`);
  }
}

run().catch(console.error);

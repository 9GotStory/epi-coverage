import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getEpiData', targetTable: 'Epi_1_Year', hoscode: '00588' }) 
  });
  
  const json = await res.json();
  const data = json.data;
  
  const byYear = {};
  data.forEach(r => {
    const y = r.fiscal_year || 'Empty/Null';
    byYear[y] = (byYear[y] || 0) + 1;
  });
  console.log("fiscal_year distribution:", byYear);
}

run().catch(console.error);

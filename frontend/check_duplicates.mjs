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
  
  const cidCounts = {};
  data.forEach(r => {
    const cid = r.cid;
    if (cid) {
      cidCounts[cid] = (cidCounts[cid] || 0) + 1;
    }
  });
  
  let duplicates = 0;
  for (const [cid, count] of Object.entries(cidCounts)) {
    if (count > 1) {
      console.log(`Duplicate CID: ${cid} appears ${count} times`);
      duplicates += (count - 1);
    }
  }
  
  console.log(`Total records: ${data.length}`);
  console.log(`Unique CIDs: ${Object.keys(cidCounts).length}`);
  console.log(`Number of duplicated records: ${duplicates}`);
}

run().catch(console.error);

async function run() {
  // ดึงข้อมูลผ่าน URL เดียวกับ frontend (ต้องส่ง hoscode ที่มีในระบบ)
  // ลองใช้ hoscode ที่น่าจะมีข้อมูล
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  
  // ลอง hoscode ต่างๆ
  const hoscodes = ["04604", "04624", "04625", "04626", "04600"];
  
  for (const hoscode of hoscodes) {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ action: "getEpiData", targetTable: "Epi_1_Year", hoscode })
    });
    const json = await res.json();
    if (json.data && json.data.length > 0) {
      console.log(`hoscode ${hoscode}: ${json.data.length} records`);
      // ตรวจ result values
      const first5 = json.data.slice(0, 5);
      first5.forEach((r, i) => {
        console.log(`  [${i}] result="${r.result}" birth="${r.birth}" hoscode="${r.hoscode}"`);
      });
      
      // สรุป result distribution
      const dist = {};
      let nullCount = 0;
      json.data.forEach(r => {
        if (!r.result || r.result.trim() === "") nullCount++;
        else dist[r.result] = (dist[r.result] || 0) + 1;
      });
      console.log("  result distribution:", JSON.stringify(dist));
      console.log("  null/empty result:", nullCount);
      break; // แค่หน่วยแรกที่มีข้อมูล
    }
  }
}
run().catch(console.error);

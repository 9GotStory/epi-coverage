async function run() {
  const url = 'https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec';
  
  // ดึงข้อมูล 1yr ของ hoscode ใด hoscode นึง ก่อน
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action: 'getEpiData', targetTable: 'Epi_1_Year', hoscode: '04604' })
  });
  const json = await res.json();
  const data = json.data;
  
  if (!Array.isArray(data) || data.length === 0) {
    console.log("no data:", json);
    return;
  }
  
  console.log("Total records:", data.length);
  
  // ดูค่า result ที่มีใน dataset
  const resultValues = {};
  let noResult = 0;
  data.forEach(r => {
    if (!r.result || r.result === '') {
      noResult++;
    } else {
      resultValues[r.result] = (resultValues[r.result] || 0) + 1;
    }
  });
  
  console.log("Result column unique values:", JSON.stringify(resultValues, null, 2));
  console.log("Records with no result:", noResult);
  
  // นับ pass ตาม result column
  let pass = 0, fail = 0, noResult2 = 0;
  data.forEach(r => {
    if (!r.result || r.result === '') { noResult2++; return; }
    if (r.result.includes('ผ่าน') && !r.result.includes('ไม่ผ่าน')) pass++;
    else fail++;
  });
  const total = data.filter(r => r.is_active !== false).length;
  console.log(`Pass: ${pass}, Fail: ${fail}, No result: ${noResult2}, Active total: ${total}`);
  console.log(`Coverage from result col: ${(pass/(pass+fail+noResult2)*100).toFixed(2)}%`);
}
run().catch(console.error);

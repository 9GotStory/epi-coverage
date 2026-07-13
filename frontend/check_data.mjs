async function run() {
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ action: "getEpiData", targetTable: "Epi_1_Year", hoscode: "all" })
  });
  const json = await res.json();
  const data = json.data;
  if (!Array.isArray(data) || data.length === 0) {
    console.log("no data:", JSON.stringify(json).slice(0, 200));
    return;
  }
  console.log("Total records:", data.length);
  
  // Group by fiscal_year
  const byYear = {};
  data.forEach(r => {
    const y = r.fiscal_year || "null";
    byYear[y] = (byYear[y] || 0) + 1;
  });
  console.log("By fiscal_year:", JSON.stringify(byYear, null, 2));
  
  // Check result values
  const resultCounts = {};
  let noResult = 0;
  data.forEach(r => {
    if (!r.result || r.result.trim() === "") { noResult++; return; }
    resultCounts[r.result] = (resultCounts[r.result] || 0) + 1;
  });
  console.log("\nResult values:", JSON.stringify(resultCounts, null, 2));
  console.log("No result:", noResult);
}
run().catch(console.error);

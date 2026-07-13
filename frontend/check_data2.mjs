async function run() {
  const url = "https://script.google.com/macros/s/AKfycbzRydywYZRLmHcS0Qs8p-1M7-5F3uWqUQWmTNtE-ofOf90DdprrwhM-i2n1Hm3YRKeupA/exec";
  // Try without hoscode filter - use admin hoscode or leave empty
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ action: "getEpiData", targetTable: "Epi_1_Year" })
  });
  const json = await res.json();
  console.log("Status:", json.status);
  console.log("Data length:", json.data?.length);
  if (json.data?.length > 0) {
    const sample = json.data[0];
    console.log("Sample keys:", Object.keys(sample));
    console.log("Sample result:", sample.result);
    console.log("Sample fiscal_year:", sample.fiscal_year);
    console.log("Sample hoscode:", sample.hoscode);
  }
}
run().catch(console.error);

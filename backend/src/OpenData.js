/**
 * Proxy สำหรับดึงข้อมูลจาก MOPH OpenData API เพื่อแก้ปัญหา CORS ฝั่ง Frontend
 * และเพิ่มระบบ Cache 6 ชั่วโมง ป้องกันการดึงข้อมูลซ้ำซ้อนจนโดนบล็อก
 * @param {object} payload - ตัวแปรที่ต้องการส่งไป เช่น { tableName: "s_epi1", year: "2567", province: "54", amp: "06" }
 */
function fetchOpenDataProxy(payload) {
  const url = "https://opendata.moph.go.th/api/report_data";
  
  // 1. สร้าง Cache Key จาก Payload (ใช้ v2 เพื่อล้าง Cache เดิมที่ติด Error)
  const cacheKey = "opendata_v2_" + payload.tableName + "_" + payload.year + "_" + payload.province + "_" + (payload.amp || "all");
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);
  
  // 2. ถ้ามีใน Cache ส่งกลับทันที
  if (cachedData) {
    return JSON.parse(cachedData);
  }
  
  // 3. ถ้าไม่มีใน Cache ให้ยิง API ไปขอกระทรวง
  try {
    // ตาม Spec HDC ต้องแนบ type: "json" ไปด้วยเสมอ
    const requestPayload = { ...payload, type: "json" };
    
    const options = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const content = response.getContentText();
    
    // ตรวจสอบว่าใช่ JSON หรือไม่ ถ้าใช่ให้แปลง
    let resultData;
    try {
      resultData = JSON.parse(content);
    } catch (e) {
      return { error: "Invalid JSON from OpenData", details: content };
    }
    
    // 4. เก็บลง Cache เฉพาะกรณีที่ดึงสำเร็จเท่านั้น (ป้องกันการจำ Error)
    if (!resultData.error && resultData.statusCode !== 404 && resultData.statusCode !== 400) {
      try {
        cache.put(cacheKey, JSON.stringify(resultData), 21600);
      } catch (e) {
        console.error("Failed to cache OpenData:", e); 
      }
    }
    
    return resultData;
  } catch (error) {
    console.error("OpenData Fetch Error: ", error);
    return { error: "Failed to fetch OpenData: " + error.toString() };
  }
}

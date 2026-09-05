/**
 * Proxy สำหรับดึงข้อมูลจาก MOPH OpenData API เพื่อแก้ปัญหา CORS ฝั่ง Frontend
 * และเพิ่มระบบ Cache 6 ชั่วโมง ป้องกันการดึงข้อมูลซ้ำซ้อนจนโดนบล็อก
 * @param {object} payload - ตัวแปรที่ต้องการส่งไป เช่น { tableName: "s_epi1", year: "2567", province: "54", amp: "06" }
 */
function fetchOpenDataProxy(payload) {
  const url = "https://opendata.moph.go.th/api/report_data";
  
  // 1. สร้าง Cache Key จาก Payload (ใช้ v2 เพื่อล้าง Cache เดิมที่ติด Error)
  const cacheKey = "opendata_v3_" + payload.tableName + "_" + payload.year + "_" + payload.province + "_" + (payload.amp || "all");
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);
  
  // 2. ถ้ามีใน Cache ส่งกลับทันที
  if (cachedData) {
    return JSON.parse(cachedData);
  }
  
  // 3. ถ้าไม่มีใน Cache ให้ยิง API ไปขอกระทรวง
  try {
    // ตาม Spec HDC ต้องแนบ type: "json" ไปด้วยเสมอ
    const requestPayload = { ...payload, type: "json", limit: 10000 };
    
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

/**
 * ฟังก์ชัน ETL (Data Lake): ดึงข้อมูลจาก HDC OpenData เก็บลง Google Sheet อัตโนมัติ
 * ทำงานผ่าน Time-driven trigger ทุกวัน
 */
function syncOpenData() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('opendata_cache');
  if (!sheet) {
    sheet = ss.insertSheet('opendata_cache');
    const headers = ['sync_id', 'table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json', 'updated_at'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  
  const targetTables = ['s_epi1', 's_epi2', 's_epi3', 's_epi5', 's_epi_complete'];
  
  // Best Practice 1: Sync multiple years (current and previous) or based on active years
  // Fallback if getAvailableYears doesn't exist
  let yearsToSync = [];
  try {
    yearsToSync = getAvailableYears(); // Set object
    yearsToSync = Array.from(yearsToSync).map(String);
  } catch (e) {
    const d = new Date();
    const currentYear = d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
    yearsToSync = [String(currentYear), String(currentYear - 1)];
  }
  
  const province = "54"; // แพร่
  const targetAreacodePrefix = "5406"; // อำเภอสอง
  
  const syncId = Utilities.getUuid();
  const updatedAt = new Date().toISOString();
  
  // Best Practice 2: Resilient ETL - Keep old data if fetch fails
  const oldDataRows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues() : [];
  let finalRows = [];
  let totalFetched = 0;
  
  for (const year of yearsToSync) {
    for (const tableName of targetTables) {
      let fetchSuccess = false;
      try {
        const url = "https://opendata.moph.go.th/api/report_data";
        const payload = {
          tableName: tableName,
          year: year,
          province: province,
          type: "json",
          limit: 10000 
        };
        
        const options = {
          method: "POST",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };
        
        const response = UrlFetchApp.fetch(url, options);
        const resultData = JSON.parse(response.getContentText());
        
        if (!resultData.error && Array.isArray(resultData.data)) {
          const filteredData = resultData.data.filter(row => row.areacode && String(row.areacode).startsWith(targetAreacodePrefix));
          
          for (const row of filteredData) {
            finalRows.push([
              syncId,
              tableName,
              year,
              row.hospcode || "",
              row.areacode || "",
              JSON.stringify(row),
              updatedAt
            ]);
          }
          fetchSuccess = true;
          totalFetched += filteredData.length;
        }
      } catch (e) {
        console.error(`Error syncing ${tableName} (${year}): ${e.toString()}`);
      }
      
      // If fetch failed, retain old data for this specific table and year
      if (!fetchSuccess && oldDataRows.length > 0) {
        const retainedRows = oldDataRows.filter(row => row[1] === tableName && String(row[2]) === String(year));
        finalRows = finalRows.concat(retainedRows);
        console.log(`Retained ${retainedRows.length} old rows for ${tableName} (${year}) due to fetch failure.`);
      }
    }
  }
  
  // 2. Load (Batch Write)
  if (finalRows.length > 0) {
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
    
    // Best Practice 3: setValues (Batch Write) is highly optimized
    sheet.getRange(2, 1, finalRows.length, finalRows[0].length).setValues(finalRows);
    SpreadsheetApp.flush(); 
    
    try {
      logAction('SYSTEM', 'Cron', 'sync_opendata', `Synced ${totalFetched} new rows (Total cache: ${finalRows.length})`);
    } catch(e) {}
    
    return { success: true, count: finalRows.length, newFetched: totalFetched, syncedAt: updatedAt };
  }
  
  return { success: false, error: "No data synced and no old data retained" };
}

/**
 * ดึงข้อมูลจาก Data Lake (Google Sheet) แทนการดึงสดๆ จาก API กระทรวง
 */
function getCachedOpenData(tableName, year, hospcode = 'all') {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('opendata_cache');
  if (!sheet || sheet.getLastRow() <= 1) {
    // Fallback: ถ้ายังไม่มี Cache เลย ให้ไปดึงผ่าน Proxy
    return fetchOpenDataProxy({ tableName, year, province: "54" });
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tableIdx = headers.indexOf('table_name');
  const yearIdx = headers.indexOf('fiscal_year');
  const hospIdx = headers.indexOf('hospcode');
  const jsonIdx = headers.indexOf('raw_json');
  
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[tableIdx] === tableName && String(row[yearIdx]) === String(year)) {
      if (hospcode === 'all' || String(row[hospIdx]) === String(hospcode)) {
        try {
          records.push(JSON.parse(row[jsonIdx]));
        } catch(e) {}
      }
    }
  }
  
  // จำลองโครงสร้าง Response ให้เหมือน MOPH API
  return { statusCode: 200, data: records, isFromCache: true };
}

/**
 * สร้าง Trigger ให้ syncOpenData ทำงานทุกวันตอนตี 2
 */
function setupOpenDataTrigger() {
  // ลบ Trigger เดิมก่อน (ป้องกันซ้ำ)
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'syncOpenData') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // สร้าง Trigger ใหม่ ตอนตี 2
  ScriptApp.newTrigger('syncOpenData')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
    
  return { success: true, message: "Trigger setup complete" };
}

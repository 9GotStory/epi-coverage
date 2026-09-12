/**
 * Issue #14: แหล่งค่าคงที่เชิงปฏิบัติการของ OpenData แห่งเดียว (ไม่ใช่ระบบ config แบบไดนามิก)
 * ข้อเท็จจริงระดับอำเภอ (จังหวัด/อำเภอ) เป็นค่าคงที่ฝั่งเซิร์ฟเวอร์ ห้ามรับจากผู้ใช้
 */
const OPENDATA_CONSTANTS = {
  DATASETS: ['s_epi1', 's_epi2', 's_epi3', 's_epi5', 's_epi_complete'],
  ENDPOINT: 'https://opendata.moph.go.th/api/report_data',
  PROVINCE: '54',           // แพร่
  AREACODE_PREFIX: '5406',  // อำเภอสอง
  LIMIT: 10000,
  CACHE_TTL_SECONDS: 21600, // 6 ชั่วโมง
};

/**
 * Issue #14: นโยบายปีงบประมาณที่รองรับ อนุมานจากแหล่งเดียวคือ getAvailableYears() ฝั่งเซิร์ฟเวอร์
 * ปรับเป็น string ทุกค่า; ถ้าแหล่งหลักประเมินไม่ได้ ให้ fail closed (ไม่มีปีที่พิสูจน์ได้ว่ารองรับ)
 * ห้ามสร้าง allowlist ปีแบบสแตติกชุดที่สอง
 */
function supportedOpenDataYears() {
  try {
    const years = getAvailableYears();
    return (Array.isArray(years) ? years : Array.from(years || [])).map(String);
  } catch (e) {
    console.error('supportedOpenDataYears failed, failing closed:', e);
    return [];
  }
}

/**
 * Issue #14: ตัวจัดประเภทการตอบกลับอัปสตรีมแบบใช้ร่วมกัน — ไม่โยน SyntaxError ดิบออกมาเลย
 * ลำดับการพิจารณา: (A) non-2xx → http_error โดยไม่อ่าน body; (B) 2xx แล้ว parse ไม่ได้ →
 * non_json (HTML/ข้อความ) หรือ malformed_json (คล้าย JSON แต่พัง); (C) JSON ที่ parse ได้ →
 * json_error (มี error ตามสัญญาอัปสตรีม) / success (data เป็น array, รวมแถวว่าง) / invalid_contract
 * การวินิจฉัยเป็น metadata แบบมีขอบเขตเท่านั้น — ห้ามเก็บ body ดิบของอัปสตรีม
 */
function classifyOpenDataResponse(response) {
  const status = response.getResponseCode();
  const contentType = String((response.getHeaders && response.getHeaders()['Content-Type']) || '');
  const diagnostic = `opendata_upstream status=${status} content-type=${contentType || 'unknown'}`.slice(0, 200);
  if (status < 200 || status >= 300) {
    return { category: 'http_error', diagnostic };
  }
  const content = response.getContentText();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const trimmed = String(content || '').trim();
    const category = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'malformed_json' : 'non_json';
    return { category, diagnostic };
  }
  if (parsed && typeof parsed === 'object' && parsed.error != null) {
    return { category: 'json_error', error: String(parsed.error).slice(0, 200), diagnostic };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
    return { category: 'success', data: parsed.data, response: parsed, diagnostic };
  }
  return { category: 'invalid_contract', diagnostic };
}

/**
 * Issue #14: ตรวจคำขอสาธารณะ getOpenData ก่อนแตะ cache/fallback/upstream —
 * ปฏิเสธแบบ deterministic ทั้ง payload ผิดรูป / dataset ไม่รองรับ / ปีผิดรูปแบบ / ปีไม่รองรับ
 */
function validateOpenDataRequest(payload) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Invalid getOpenData payload.' };
  }
  if (!OPENDATA_CONSTANTS.DATASETS.includes(payload.tableName)) {
    return { valid: false, error: 'Unsupported OpenData dataset: ' + String(payload.tableName).slice(0, 50) };
  }
  const year = String(payload.year == null ? '' : payload.year);
  if (!/^\d{4}$/.test(year)) {
    return { valid: false, error: 'Malformed fiscal year: ' + year.slice(0, 10) };
  }
  if (!supportedOpenDataYears().includes(year)) {
    return { valid: false, error: 'Unsupported fiscal year: ' + year };
  }
  return { valid: true, year };
}

/**
 * Proxy สำหรับดึงข้อมูลจาก MOPH OpenData API เพื่อแก้ปัญหา CORS ฝั่ง Frontend
 * และเพิ่มระบบ Cache 6 ชั่วโมง ป้องกันการดึงข้อมูลซ้ำซ้อนจนโดนบล็อก (เก็บเฉพาะผลสำเร็จ)
 * การจัดประเภทการตอบกลับทั้งหมดผ่าน classifyOpenDataResponse แห่งเดียว
 * @param {object} payload - เช่น { tableName: "s_epi1", year: "2567", province: "54" }
 */
function fetchOpenDataProxy(payload) {
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
    const requestPayload = { ...payload, type: "json", limit: OPENDATA_CONSTANTS.LIMIT };

    const options = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(OPENDATA_CONSTANTS.ENDPOINT, options);
    const result = classifyOpenDataResponse(response);
    if (result.category !== 'success') {
      // ความล้มเหลวที่จัดประเภทแล้ว: ส่งกลับซอง error แบบปลอดภัย ไม่แคช ไม่โยน SyntaxError ดิบ
      console.error('OpenData upstream failure:', result.diagnostic);
      return { error: 'OpenData upstream ' + result.category + (result.error ? ': ' + result.error : ''), diagnostic: result.diagnostic };
    }

    // 4. เก็บลง Cache เฉพาะกรณีที่ดึงสำเร็จ และ body ไม่ได้ประกาศ statusCode 400/404
    //    (สัญญาเดิมก่อน Issue #14: ส่งกลับให้คำขอปัจจุบัน แต่ห้ามจำ error ลง cache)
    const bodyStatus = result.response && result.response.statusCode;
    if (bodyStatus !== 400 && bodyStatus !== 404) {
      try {
        cache.put(cacheKey, JSON.stringify(result.response), OPENDATA_CONSTANTS.CACHE_TTL_SECONDS);
      } catch (e) {
        console.error("Failed to cache OpenData:", e);
      }
    }

    return result.response;
  } catch (error) {
    console.error("OpenData Fetch Error: ", error);
    return { error: "Failed to fetch OpenData: " + String(error).slice(0, 200) };
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
  
  const targetTables = OPENDATA_CONSTANTS.DATASETS;
  
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
  
  const province = OPENDATA_CONSTANTS.PROVINCE; // แพร่
  const targetAreacodePrefix = OPENDATA_CONSTANTS.AREACODE_PREFIX; // อำเภอสอง
  
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
        const url = OPENDATA_CONSTANTS.ENDPOINT;
        const payload = {
          tableName: tableName,
          year: year,
          province: province,
          type: "json",
          limit: OPENDATA_CONSTANTS.LIMIT
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
    return fetchOpenDataProxy({ tableName, year, province: OPENDATA_CONSTANTS.PROVINCE });
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

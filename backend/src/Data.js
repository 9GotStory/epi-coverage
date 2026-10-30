/**
 * ดึงรายชื่อหน่วยบริการทั้งหมด
 */
function getFacilities() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('facilities');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const facilities = [];
  for (let i = 1; i < data.length; i++) {
    facilities.push(arrayToObj(headers, data[i]));
  }
  return facilities;
}

/**
 * เพิ่มหรือแก้ไขข้อมูลหน่วยบริการ (รพ.สต.)
 */
function upsertFacility(hoscode, hosname, isActive, adminEmail) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('facilities');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const hoscodeCol = headers.indexOf('hoscode');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][hoscodeCol] === hoscode) {
      const existingName = data[i][headers.indexOf('hosname')];
      
      // Update
      const finalName = hosname || existingName;
      const finalIsActive = isActive !== undefined ? isActive : data[i][headers.indexOf('is_active')];
      
      const updateRange = sheet.getRange(i + 1, headers.indexOf('hosname') + 1, 1, 2);
      // Issue #77: escape formula triggers (=, +, -, @) in admin-supplied facility names.
      updateRange.setValues([[sanitizeSheetText(finalName), finalIsActive]]);
      
      const statusText = isActive !== undefined ? ` (Active: ${isActive})` : '';
      
      logAction('SYSTEM', adminEmail || 'Admin', 'update_facility', `Updated facility ${hoscode} - ${finalName}${statusText}`);
      return { success: true, message: "Facility updated" };
    }
  }
  
  // Insert new
  const nextRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(nextRow, 1, 1, headers.length);
  
  const newRow = headers.map(header => {
    if (header === 'hoscode') return "'" + hoscode;
    if (header === 'hosname') return sanitizeSheetText(hosname);
    if (header === 'is_active') return isActive !== undefined ? isActive : true;
    return "";
  });
  
  range.setNumberFormat("@");
  range.setValues([newRow]);
  
  logAction('SYSTEM', adminEmail || 'Admin', 'add_facility', `Added facility ${hoscode} - ${hosname}`);
  return { success: true, message: "Facility created" };
}

/**
 * ดึงข้อมูลวัคซีนเด็ก 1 ปี (filter ตาม hoscode และ is_active)
 * @param {string} hoscode - รหัสสถานบริการ ('00588' = สสอ. เห็นทุก รหัส)
 * @param {string} targetTable - ชื่อตาราง Base (e.g. 'Epi_1_Year')
 * @param {string|number|null} fiscalYear - ปีงบประมาณ (e.g. 2568) ถ้ามีจะใช้ Sheet แบบแยกปี
 */
/**
 * ช่องวันที่ในชีตอาจเป็น Date จริง (ข้อมูลเดิมหรือกรอกด้วยมือ) — ถ้าส่งออกดิบ ๆ
 * JSON.stringify จะได้ UTC timestamp แบบ "2024-10-30T17:00:00.000Z" ทำให้หน้าเว็บ
 * แสดงวันเลื่อนหลัง 1 วัน (เที่ยงคืน 31 ต.ค. ไทย = 17:00 ของวันก่อนตาม UTC)
 * จึงแปลงเป็น "วันปฏิทิน" yyyy-MM-dd ตามเขตเวลาของสเปรดชีตก่อนส่งออกทุกครั้ง
 * @param {string} timeZone — หาไว้ครั้งเดียวนอก loop (เป็น GAS API call ห้ามเรียกต่อ record)
 */
function normalizeEpiDateFields_(obj, timeZone) {
  for (const key of Object.keys(obj)) {
    if (key !== 'birth' && !/_date$/.test(key)) continue;
    const value = obj[key];
    if (value instanceof Date) {
      obj[key] = Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) obj[key] = Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd');
    }
  }
  return obj;
}

function getEpiData(hoscode, targetTable = 'Epi_1_Year', fiscalYear = null) {
  const ss = getSpreadsheet();
  // ใช้ตาราง Base ตรงๆ (เช่น Epi_1_Year) ตามที่ตกลงกันไว้ ไม่แยก Sheet ตามปี
  const sheetName = targetTable;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    // ถ้าไม่มี Sheet สำหรับปีนั้น → return เปล่า ไม่ Fallback ไปใช้ Sheet เก่า
    // (เพราะ Sheet เก่าอาจเป็นปีอื่น การ Fallback จะทำให้ข้อมูลปนเปื้อนกัน)
    console.warn(`Sheet not found: ${sheetName}`);
    return [];
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const records = [];
  const timeZone = getSpreadsheet().getSpreadsheetTimeZone();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = normalizeEpiDateFields_(arrayToObj(headers, row), timeZone);
    
    // 1. สสอ. (00588) เห็นข้อมูลทั้งหมด | รพ.สต. อื่นเห็นเฉพาะของตนเอง
    // 2. เฉพาะบรรทัดที่ Active
    // 3. กรองตามปีงบประมาณ (fiscalYear) ถ้ามีการระบุ
    const isHoscodeMatch = hoscode === '00588' || obj.hoscode === hoscode;
    const isActiveMatch = String(obj.is_active).toUpperCase() !== 'FALSE';
    const isFiscalYearMatch = !fiscalYear || String(obj.fiscal_year) === String(fiscalYear);

    if (isHoscodeMatch && isActiveMatch && isFiscalYearMatch) {
      records.push(obj);
    }
  }
  return records;
}

/**
 * Normalize one birth value to its calendar day (yyyy-MM-dd) for composite-key comparison.
 * Sheet Date cells carry the calendar date in the SPREADSHEET timezone (เที่ยงคืนตามเวลาไทย),
 * while composite keys from the client are plain yyyy-MM-dd strings (UTC midnight when parsed) —
 * comparing raw instants therefore skews by the UTC offset and never matches (Issue #75).
 * Both sides normalize to the spreadsheet-timezone calendar day, the same convention as
 * normalizeEpiDateFields_ และ epiImportKey
 */
function aiBirthDay_(value, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) return Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd');
  }
  return text.slice(0, 10);
}

/** Locate the AI target by the exact composite key (hoscode + pid/cid + sex + birth + check_vhid); 1-based sheet row, or -1 when absent. */
function findAiTargetRow(data, headers, recordKey, timeZone) {
  const iHoscode = headers.indexOf('hoscode');
  const iPid = headers.indexOf('pid');
  const iCid = headers.indexOf('cid');
  const iSex = headers.indexOf('sex');
  const iBirth = headers.indexOf('birth');
  const iCheckVhid = headers.indexOf('check_vhid');
  if (iHoscode === -1 || iPid === -1 || iCid === -1 || iSex === -1 || iBirth === -1 || iCheckVhid === -1) return -1;
  const targetBirth = aiBirthDay_(recordKey.birth, timeZone);
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (
      String(row[iHoscode]) === String(recordKey.hoscode) &&
      String(row[iPid]) === String(recordKey.pid) &&
      String(row[iCid]) === String(recordKey.cid) &&
      String(row[iSex]) === String(recordKey.sex) &&
      aiBirthDay_(row[iBirth], timeZone) === targetBirth &&
      String(row[iCheckVhid] || '') === String(recordKey.check_vhid || '')
    ) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * บันทึกผลการวิเคราะห์จาก AI (Gemini) ลงฐานข้อมูล
 * อนุญาตเฉพาะขอบเขตหน่วยบริการของบัญชีที่ยืนยันตัวแล้ว (auth) — ไม่ใช้ identity จาก client
 */
function saveAiAnalysis(recordKey, targetTable, aiAnalysis, auth) {
  if (!auth || (!isDistrictScope(auth) && String(recordKey.hoscode) !== String(auth.hoscode))) {
    return { success: false, error: 'Forbidden: AI analysis is limited to your facility.' };
  }
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(targetTable);

  if (!sheet) {
    return { success: false, error: `Sheet not found: ${targetTable}` };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const aiAnalysisCol = headers.indexOf('ai_analysis');
  const aiAnalyzedAtCol = headers.indexOf('ai_analyzed_at');
  const hasKeyColumns = ['hoscode', 'pid', 'cid', 'sex', 'birth', 'check_vhid'].every(field => headers.includes(field));
  if (!hasKeyColumns || aiAnalysisCol === -1 || aiAnalyzedAtCol === -1) {
    return { success: false, error: "Missing required columns in database schema for AI Analysis (Composite Key)." };
  }

  const targetRow = findAiTargetRow(data, headers, recordKey, ss.getSpreadsheetTimeZone());
  if (targetRow === -1) {
    return { success: false, error: "Record not found for Composite Key" };
  }

  const now = new Date();
  // Issue #77: escape formula triggers (=, +, -, @) in user/AI-supplied analysis free text.
  sheet.getRange(targetRow, aiAnalysisCol + 1, 1, 2).setValues([[sanitizeSheetText(aiAnalysis), now.toISOString()]]);
  logAction(auth.userId, auth.email, 'save_ai_analysis', `Saved AI analysis for CID ${recordKey.cid} in ${targetTable}`);
  return { success: true, message: "AI Analysis saved", aiAnalyzedAt: now.toISOString() };
}

/**
 * ส่งคำขอไปยัง Gemini API เพื่อวิเคราะห์ข้อมูล และบันทึกผลลัพธ์
 * ต้องพิสูจน์ว่า target มีจริงและอยู่ในขอบเขตที่อนุญาต ก่อนเรียกทรัพยากรภายนอกทุกครั้ง (fail-closed)
 */
function analyzeVaccineData(prompt, recordKey, targetTable, auth) {
  if (!auth) return { success: false, error: 'Forbidden: AI analysis is limited to your facility.' };
  if (!getEpiSchemas()[targetTable]) return { success: false, error: 'Unknown EPI table' };
  // Read-only resolution of the exact target record: recordKey.hoscode alone proves nothing.
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(targetTable);
  const data = sheet ? sheet.getDataRange().getValues() : [];
  const targetRow = findAiTargetRow(data, data[0] || [], recordKey, ss.getSpreadsheetTimeZone());
  if (targetRow === -1) return { success: false, error: 'Record not found for Composite Key' };
  const actualHoscode = String(data[targetRow - 1][data[0].indexOf('hoscode')]);
  if (!isDistrictScope(auth) && actualHoscode !== String(auth.hoscode)) {
    return { success: false, error: 'Forbidden: AI analysis is limited to your facility.' };
  }
  try {
    // 1. Get API Key from Script Properties (Security Best Practice)
    const scriptProperties = PropertiesService.getScriptProperties();
    const apiKey = scriptProperties.getProperty('GEMINI_API_KEY');
    
    if (!apiKey) {
      return { success: false, error: "ไม่พบ GEMINI_API_KEY ใน Script Properties (Project Settings)" };
    }
    
    // 2. Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 }
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) {
      return { success: false, error: `Gemini API Error: ${result.error.message}` };
    }
    
    if (result.candidates && result.candidates[0].content.parts[0].text) {
      const aiAnalysis = result.candidates[0].content.parts[0].text;
      
      // 3. Save to DB
      const saveResult = saveAiAnalysis(recordKey, targetTable, aiAnalysis, auth);
      
      return { 
        success: true, 
        aiAnalysis: aiAnalysis,
        aiAnalyzedAt: saveResult.success ? saveResult.aiAnalyzedAt : new Date().toISOString()
      };
    } else {
      return { success: false, error: "ไม่สามารถประมวลผลคำตอบจาก AI ได้" };
    }
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * ดึงประวัติการทำงาน (Audit Logs)
 */
function getAuditLogs() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('audit_logs');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0];
  const logs = [];
  for (let i = 1; i < data.length; i++) {
    logs.push(arrayToObj(headers, data[i]));
  }
  return logs.reverse(); // คืนค่าจากล่าสุดไปเก่าสุด
}

/**
 * ดึงค่า Config เป้าหมาย (Target) จาก Sheet 'configs_system'
 * โครงสร้าง: config_key | config_value | description
 */
function getTargetConfig() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('configs_system');
  if (!sheet) {
    return {};
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};
  
  const headers = data[0]; // ['config_key', 'config_value', 'description']
  const keyCol = headers.indexOf('config_key');
  const valueCol = headers.indexOf('config_value');
  
  if (keyCol === -1 || valueCol === -1) return {};

  const config = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][keyCol]).trim();
    const v = data[i][valueCol];
    if (k && v !== '') {
      config[k] = isNaN(Number(v)) ? String(v) : Number(v);
    }
  }
  return config;
}

/**
 * Utility: บันทึก Log การทำงาน
 */
function logAction(userId, email, action, details) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('audit_logs');
  const timestamp = new Date().toISOString();
  const logId = Utilities.getUuid();
  
  // Issue #77: escape formula triggers (=, +, -, @) — email/details can embed user-supplied
  // text (e.g. the self-declared signup email audited by the public createUser endpoint).
  sheet.appendRow([logId, userId, email, action, details, timestamp].map(sanitizeSheetText));
}

/**
 * ดึงรายการปีงบประมาณที่มีอยู่ในระบบทั้งหมด
 */
function getAvailableYears() {
  const ss = getSpreadsheet();
  const sheets = ss.getSheets();
  const years = new Set();
  
  // เพิ่มปีปัจจุบันไว้เป็นพื้นฐานเสมอ
  const d = new Date();
  const currentYear = d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
  years.add(currentYear);
  
  // หาปีจากชื่อ Sheet (เช่น Epi_1_Year_2568)
  for (const sheet of sheets) {
    const name = sheet.getName();
    const match = name.match(/_(\d{4})$/);
    if (match) {
      years.add(Number(match[1]));
    }
  }
  
  // หาปีจาก Dashboard Cache
  const cacheSheet = ss.getSheetByName('dashboard_cache');
  if (cacheSheet && cacheSheet.getLastRow() > 1) {
    const data = cacheSheet.getDataRange().getValues();
    const headers = data[0];
    const yearIdx = headers.indexOf('fiscal_year');
    if (yearIdx >= 0) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][yearIdx]) years.add(Number(data[i][yearIdx]));
      }
    }
  }

  // หาปีจาก Vaccine Rules
  const ruleSheet = ss.getSheetByName('vaccine_rules');
  if (ruleSheet && ruleSheet.getLastRow() > 1) {
    const data = ruleSheet.getDataRange().getValues();
    const headers = data[0];
    const yearIdx = headers.indexOf('fiscal_year');
    if (yearIdx >= 0) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][yearIdx]) years.add(Number(data[i][yearIdx]));
      }
    }
  }
  
  return Array.from(years).sort((a, b) => a - b);
}

/** District scope: admins and the สสอ. account (00588) operate across all facilities. */
function isDistrictScope(auth) {
  return ['admin', 'superadmin'].includes(auth.role) || auth.hoscode === '00588';
}

/** Facility access is derived from the authenticated account. */
function getAuthorizedEpiData(auth, requestedHoscode, targetTable, fiscalYear) {
  if (!getEpiSchemas()[targetTable]) throw new Error('Unknown EPI table');
  const district = isDistrictScope(auth);
  if (!district && !auth.hoscode) throw new Error('No facility assigned');
  const scope = district ? (requestedHoscode || '00588') : auth.hoscode;
  return getEpiData(scope, targetTable, fiscalYear);
}

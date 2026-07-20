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
      if (hosname) sheet.getRange(i + 1, headers.indexOf('hosname') + 1).setValue(hosname);
      if (isActive !== undefined) sheet.getRange(i + 1, headers.indexOf('is_active') + 1).setValue(isActive);
      
      const finalName = hosname || existingName;
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
    if (header === 'hosname') return hosname;
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
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = arrayToObj(headers, row);
    
    // 1. สสอ. (00588) เห็นข้อมูลทั้งหมด | รพ.สต. อื่นเห็นเฉพาะของตนเอง
    // 2. เฉพาะบรรทัดที่ Active
    // 3. กรองตามปีงบประมาณ (fiscalYear) ถ้ามีการระบุ
    const isHoscodeMatch = hoscode === '00588' || obj.hoscode === hoscode;
    const isActiveMatch = String(obj.is_active).toUpperCase() !== 'FALSE';
    const isFiscalYearMatch = !fiscalYear || !obj.fiscal_year || String(obj.fiscal_year) === String(fiscalYear);

    if (isHoscodeMatch && isActiveMatch && isFiscalYearMatch) {
      records.push(obj);
    }
  }
  return records;
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
 * ดึงค่า Config เป้าหมาย (Target) จาก Sheet 'config'
 * โครงสร้าง: key | value | description
 */
function getTargetConfig() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('config');
  if (!sheet) {
    // ถ้ายังไม่มี Sheet ให้ return ค่าเริ่มต้น
    return {
      target_q1: 50,
      target_q2: 70,
      target_q3: 80,
      target_q4: 90,
      target_mmr_q1: 95,
      target_mmr_q2: 95,
      target_mmr_q3: 95,
      target_mmr_q4: 95
    };
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  const headers = data[0]; // ['key', 'value', 'description']
  const keyCol = headers.indexOf('key');
  const valueCol = headers.indexOf('value');
  if (keyCol === -1 || valueCol === -1) return {};

  const config = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][keyCol]).trim();
    const v = data[i][valueCol];
    if (k) config[k] = isNaN(Number(v)) ? String(v) : Number(v);
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
  
  sheet.appendRow([logId, userId, email, action, details, timestamp]);
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

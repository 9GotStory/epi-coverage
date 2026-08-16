/**
 * ──────────────────────────────────────────────────────────
 * getEpiSchemas — Schema ของตาราง EPI ทุกกลุ่มอายุ
 * ──────────────────────────────────────────────────────────
 */
function getEpiSchemas() {
  return {
    'Epi_1_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'mmr1_date',
      'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at'
    ],
    'Epi_2_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'dtp4_hospcode', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date', 'opv4_hospcode',
      'mmr1_date', 'mmr2_date', 'mmr2_hospcode', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'je1_date', 'je2_date', 'j11_date', 'j11_hospcode',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at'
    ],
    'Epi_3_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'dtp4_hospcode', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date', 'opv4_hospcode',
      'mmr1_date', 'mmr2_date', 'mmr2_hospcode', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'je1_date', 'je2_date', 'je3_date', 'j11_date', 'j11_hospcode', 'j12_date', 'j12_hospcode',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at'
    ],
    'Epi_5_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'dtp4_hospcode', 'dtp5_date', 'dtp5_hospcode', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date', 'opv4_hospcode', 'opv5_date', 'opv5_hospcode',
      'mmr1_date', 'mmr2_date', 'mmr2_hospcode', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'pcv4_date', 'je1_date', 'je2_date', 'je3_date', 'j11_date', 'j11_hospcode', 'j12_date', 'j12_hospcode',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at'
    ]
  };
}

/**
 * ──────────────────────────────────────────────────────────
 * setupSheetWithHeaders — Helper สำหรับสร้าง/ตั้งค่า Sheet
 * ──────────────────────────────────────────────────────────
 */
function setupSheetWithHeaders(ss, sheetName, columns) {
  let sheet = ss.getSheetByName(sheetName);
  let isNew = false;
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    isNew = true;
  }
  
  if (isNew || sheet.getLastRow() === 0) {
    // ป้องกัน Out of Bounds กรณี Sheet ตั้งต้นมีคอลัมน์น้อยกว่าที่ Schema ต้องการ
    if (sheet.getMaxColumns() < columns.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    }
    
    // ตั้งค่า Header (แถวที่ 1)
    const headerRange = sheet.getRange(1, 1, 1, columns.length);
    headerRange.setValues([columns]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f3f3f3');

    // ป้องกันเลข 0 หาย สำหรับคอลัมน์สำคัญ (hosc, hosp, cid, hdc_code)
    const numRows = sheet.getMaxRows() - 1;
    if (numRows > 0) {
      columns.forEach((col, index) => {
        if (col.includes('hosc') || col.includes('hosp') || col === 'cid' || col.includes('hdc_code') || col === 'config_value') {
          sheet.getRange(2, index + 1, numRows, 1).setNumberFormat('@');
        }
      });
    }
  }
  return sheet;
}

/**
 * ฟังก์ชันสำหรับเพิ่มคอลัมน์ที่ตกหล่นให้กับ Sheet เดิม (ทั้ง Static และ EPI)
 * เพื่อป้องกันข้อมูลเดิมพัง (Non-Destructive Sync)
 */
function syncAllSchemasToExistingSheets(ss, allSchemas) {
  const sheets = ss.getSheets();
  let updatedSheets = [];
  const epiSchemaKeys = Object.keys(getEpiSchemas());
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    let expectedColumns = null;

    if (allSchemas[sheetName]) {
      // Static sheets (e.g. Users, facilities) หรือ EPI Sheets ที่ตรงตัว
      expectedColumns = allSchemas[sheetName];
    } else {
      // รองรับ EPI sheets ที่อาจมีชื่อเก่าที่มีปีงบประมาณต่อท้าย (เผื่อไว้)
      for (const b of epiSchemaKeys) {
        if (sheetName.startsWith(b)) {
          expectedColumns = allSchemas[b];
          break;
        }
      }
    }
    
    if (expectedColumns) {
      const lastCol = sheet.getLastColumn();
      // ถ้า sheet ว่างเปล่า ให้ currentHeaders เป็น array ว่าง
      const currentHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      const missingColumns = expectedColumns.filter(col => !currentHeaders.includes(col));
      
      if (missingColumns.length > 0) {
        const startCol = lastCol > 0 ? lastCol + 1 : 1;
        const totalReqCols = startCol + missingColumns.length - 1;
        
        // ป้องกัน Out of Bounds
        if (sheet.getMaxColumns() < totalReqCols) {
          sheet.insertColumnsAfter(sheet.getMaxColumns(), totalReqCols - sheet.getMaxColumns());
        }

        const headerRange = sheet.getRange(1, startCol, 1, missingColumns.length);
        headerRange.setValues([missingColumns]);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#f3f3f3');
        
        // บังคับ Plain Text ให้คอลัมน์ใหม่ที่ระบุ
        const numRows = sheet.getMaxRows() - 1;
        if (numRows > 0) {
          missingColumns.forEach((col, index) => {
            if (col.includes('hosc') || col.includes('hosp') || col === 'cid' || col.includes('hdc_code') || col === 'config_value') {
              sheet.getRange(2, startCol + index, numRows, 1).setNumberFormat('@');
            }
          });
        }
        
        updatedSheets.push(sheetName);
      }
    }
  });
  
  return { success: true, message: "ซิงค์ Schema ให้กับ Sheet ที่มีอยู่แล้วเรียบร้อย", updatedSheets };
}

/**
 * ──────────────────────────────────────────────────────────
 * setupDatabase — สร้าง/อัปเดต Schema ของทุก Static Sheet ในระบบ
 * รวมถึง EPI Data Sheets พื้นฐาน (Epi_1_Year, Epi_2_Year, ...)
 * ──────────────────────────────────────────────────────────
 */
function setupDatabase() {
  const ss = getSpreadsheet();

  // Static schemas
  const staticSchemas = {
    'Users': ['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'],
    'facilities': ['hoscode', 'hosname', 'is_active'],
    'audit_logs': ['log_id', 'user_id', 'email', 'action', 'details', 'timestamp'],
    'configs_system': ['config_key', 'config_value', 'description'],
    'sessions': ['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at'],
    'vaccine_rules': [
      'rule_id', 'fiscal_year', 'age_group', 'view_type',
      'vaccine_group', 'display_name', 'hdc_code',
      'required_fields', 'logic_type', 'branch_alt_fields',
      'is_required_for_v2', 'is_active', 'target_age_months', 'note', 'updated_at', 'updated_by'
    ]
  };

  const epiSchemas = getEpiSchemas();
  const allSchemas = { ...staticSchemas, ...epiSchemas };

  for (const [sheetName, columns] of Object.entries(staticSchemas)) {
    const sheet = setupSheetWithHeaders(ss, sheetName, columns);

    // ไม่มีการ Seed ค่าเป้าหมายจำลอง (Hardcode) อีกต่อไป
    // ให้ Admin เป็นผู้กำหนดผ่าน Sheet เท่านั้น เพื่อความยืดหยุ่นตามปีงบประมาณ
    if (sheetName === 'configs_system' && sheet.getLastRow() <= 1) {
      // ปล่อยให้ Sheet ว่างเปล่า (มีแค่ Header) 
    }
  }

  // EPI Schemas
  for (const [sheetName, columns] of Object.entries(epiSchemas)) {
    setupSheetWithHeaders(ss, sheetName, columns);
  }

  // ลบชีตตั้งต้น (Sheet1) ถ้ามีและไม่ได้ใช้งาน
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  // อัปเกรด/เพิ่มคอลัมน์ที่ขาดหายไปให้กับชีตข้อมูลทั้งหมดแบบปลอดภัย (Non-Destructive)
  const schemaSyncResult = syncAllSchemasToExistingSheets(ss, allSchemas);

  return { 
    message: 'Database setup completed successfully. All static and EPI schemas have been initialized.',
    schema_sync: schemaSyncResult
  };
}

/**
 * ──────────────────────────────────────────────────────────
 * migrateVaccineRulesTargetAge — ฟังก์ชันสำหรับอัปเดต target_age_months ในฐานข้อมูล
 * สำหรับกฎที่มีอยู่แล้วแต่ยังไม่มี target_age_months โดยอ้างอิงจาก TARGET_AGE_MONTHS_MAP เดิม
 * (ใช้ Run ครั้งเดียวเพื่อเยียวยาฐานข้อมูล หลังจากนำ Hardcode ใน Frontend ออกไปแล้ว)
 * ──────────────────────────────────────────────────────────
 */
function migrateVaccineRulesTargetAge() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('vaccine_rules');
  if (!sheet) {
    return { success: false, error: 'Sheet vaccine_rules not found' };
  }

  // ใช้แผนที่กลางแหล่งเดียวจาก VaccineRules.js (TARGET_AGE_MONTHS_BY_FIELD)
  // ไม่เก็บ map ซ้ำในไฟล์นี้อีกต่อไป — แก้ที่เดียว ใช้ได้ทั้ง seed / migration / ปุ่ม Auto ในหน้า Rules Engine
  const TARGET_AGE_MONTHS_MAP = TARGET_AGE_MONTHS_BY_FIELD;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const reqFieldsIdx = headers.indexOf('required_fields');
  const altFieldsIdx = headers.indexOf('branch_alt_fields');
  const targetAgeIdx = headers.indexOf('target_age_months');

  if (reqFieldsIdx === -1 || targetAgeIdx === -1) {
    return { success: false, error: 'Required columns not found in vaccine_rules' };
  }

  // เตรียม 2D Array สำหรับ targetAge Column (เริ่มจากแถวที่ 2 เป็นต้นไป)
  // ให้มีความสูงเท่ากับ data.length - 1 (ไม่รวม Header)
  const targetAgeUpdates = [];
  let updatedCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const currentTargetAge = row[targetAgeIdx];

    // ถ้าไม่มีอายุเป้าหมาย
    if (currentTargetAge === '' || currentTargetAge === null || currentTargetAge === undefined) {
      let fieldsToCheck = [];

      try {
        if (row[reqFieldsIdx]) {
          const parsedReq = JSON.parse(row[reqFieldsIdx]);
          if (Array.isArray(parsedReq)) fieldsToCheck = fieldsToCheck.concat(parsedReq);
        }
        if (altFieldsIdx !== -1 && row[altFieldsIdx]) {
          const parsedAlt = JSON.parse(row[altFieldsIdx]);
          if (Array.isArray(parsedAlt)) fieldsToCheck = fieldsToCheck.concat(parsedAlt);
        }
      } catch (e) {
        targetAgeUpdates.push([currentTargetAge]); // รักษาสภาพเดิม
        continue;
      }

      let maxAge = 0;
      let foundMatch = false;

      for (const field of fieldsToCheck) {
        if (TARGET_AGE_MONTHS_MAP[field] !== undefined) {
          if (TARGET_AGE_MONTHS_MAP[field] > maxAge) {
            maxAge = TARGET_AGE_MONTHS_MAP[field];
          }
          foundMatch = true;
        }
      }

      if (foundMatch) {
        targetAgeUpdates.push([maxAge]);
        updatedCount++;
      } else {
        targetAgeUpdates.push([currentTargetAge]); // รักษาสภาพเดิม
      }
    } else {
      targetAgeUpdates.push([currentTargetAge]); // รักษาสภาพเดิม
    }
  }

  // อัปเดตข้อมูลแบบ Batch (setValues ทีเดียวรวด)
  if (targetAgeUpdates.length > 0) {
    // column index เริ่มจาก 1 ดังนั้น targetAgeIdx + 1
    // row เริ่มจาก 2 (ข้าม header)
    sheet.getRange(2, targetAgeIdx + 1, targetAgeUpdates.length, 1).setValues(targetAgeUpdates);
  }

  return { success: true, message: `Migrated target_age_months for ${updatedCount} rules.` };
}

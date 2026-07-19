/**
 * ──────────────────────────────────────────────────────────
 * getEpiSchemas — Schema ของตาราง EPI ทุกกลุ่มอายุ
 * แยกออกมาจาก setupDatabase() เพื่อให้ reuse ได้กับ
 * setupEpiSheetForYear() และ setupDatabase()
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
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'Epi_2_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date',
      'mmr1_date', 'mmr2_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'je1_date', 'je2_date', 'j11_date',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'Epi_3_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date',
      'mmr1_date', 'mmr2_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'je1_date', 'je2_date', 'je3_date', 'j11_date', 'j12_date',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'Epi_5_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'dtp5_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date', 'opv5_date',
      'mmr1_date', 'mmr2_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'pcv4_date', 'je1_date', 'je2_date', 'je3_date', 'j11_date', 'j12_date',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ]
  };
}

/**
 * ──────────────────────────────────────────────────────────
 * setupSheetWithHeaders — Helper สำหรับสร้าง/ตั้งค่า Sheet
 * ──────────────────────────────────────────────────────────
 */
function setupSheetWithHeaders(ss, sheetName, columns, applyTextFormat) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  // ตั้งค่า Header (แถวที่ 1)
  const headerRange = sheet.getRange(1, 1, 1, columns.length);
  headerRange.setValues([columns]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f3f3');

  // ป้องกันเลข 0 หาย สำหรับชีตที่มี hoscode
  if (applyTextFormat) {
    sheet.getRange(2, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat('@');
  }
  return sheet;
}

/**
 * ──────────────────────────────────────────────────────────
 * setupEpiSheetForYear — สร้าง Sheet EPI แยกตามปีงบประมาณ
 * เช่น Epi_1_Year_2568, Epi_2_Year_2568, ...
 * ถ้า Sheet มีอยู่แล้ว → Skip (ไม่ทับข้อมูลเดิม)
 * ──────────────────────────────────────────────────────────
 */
function setupEpiSheetForYear(fiscalYear) {
  if (!fiscalYear) {
    return { success: false, error: 'fiscalYear is required' };
  }
  const ss = getSpreadsheet();
  const epiSchemas = getEpiSchemas();
  const created = [];
  const skipped = [];

  for (const [baseTable, columns] of Object.entries(epiSchemas)) {
    const sheetName = `${baseTable}_${fiscalYear}`;
    if (ss.getSheetByName(sheetName)) {
      skipped.push(sheetName);
      continue;
    }
    setupSheetWithHeaders(ss, sheetName, columns, true);
    created.push(sheetName);
  }

  return {
    success: true,
    fiscalYear,
    created,
    skipped,
    message: `Setup complete for fiscal year ${fiscalYear}. Created: ${created.length}, Skipped (already exists): ${skipped.length}`
  };
}

/**
 * ──────────────────────────────────────────────────────────
 * migrateSheetNames — Rename Sheet เดิม (ไม่มี Year) → เพิ่ม Year ต่อท้าย
 * ใช้สำหรับ Migration ข้อมูลที่มีอยู่แล้ว (One-time operation)
 * ⚠️ ทำ Backup Google Sheet ก่อนรันทุกครั้ง!
 * ──────────────────────────────────────────────────────────
 */
function migrateSheetNames(fromFiscalYear) {
  if (!fromFiscalYear) {
    return { success: false, error: 'fromFiscalYear is required' };
  }
  const ss = getSpreadsheet();
  const baseTables = ['Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year'];
  const results = [];

  for (const baseName of baseTables) {
    const newName = `${baseName}_${fromFiscalYear}`;

    // ตรวจสอบว่าชื่อใหม่ซ้ำกับ Sheet ที่มีอยู่แล้ว
    if (ss.getSheetByName(newName)) {
      results.push({ sheet: baseName, status: 'error', reason: `Target name "${newName}" already exists` });
      continue;
    }

    const sheet = ss.getSheetByName(baseName);
    if (!sheet) {
      results.push({ sheet: baseName, status: 'skip', reason: 'Source sheet not found' });
      continue;
    }

    sheet.setName(newName);
    results.push({ sheet: baseName, status: 'renamed', to: newName });
  }

  return { success: true, fromFiscalYear, results };
}

/**
 * ──────────────────────────────────────────────────────────
 * setupDatabase — สร้าง/อัปเดต Schema ของทุก Static Sheet ในระบบ
 * (Users, facilities, audit_logs, configs_system, sessions, config, vaccine_rules)
 * ⚠️ EPI Data Sheets ไม่ถูกสร้างที่นี่อีกต่อไป
 *    ให้ใช้ setupEpiSheetForYear(fiscalYear) แทน
 * ──────────────────────────────────────────────────────────
 */
function setupDatabase() {
  const ss = getSpreadsheet();

  // Static schemas (ไม่แยกตามปีงบประมาณ)
  const staticSchemas = {
    'Users': ['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'],
    'facilities': ['hoscode', 'hosname', 'is_active'],
    'audit_logs': ['log_id', 'user_id', 'email', 'action', 'details', 'timestamp'],
    'configs_system': ['config_key', 'config_value', 'description'],
    'sessions': ['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at'],
    'config': ['key', 'value', 'description'],
    'vaccine_rules': [
      'rule_id', 'fiscal_year', 'age_group', 'view_type',
      'vaccine_group', 'display_name', 'hdc_code',
      'required_fields', 'logic_type', 'branch_alt_fields',
      'is_required_for_v2', 'is_active', 'note', 'updated_at', 'updated_by'
    ]
  };

  const textFormatSheets = ['Users', 'facilities'];

  for (const [sheetName, columns] of Object.entries(staticSchemas)) {
    const sheet = setupSheetWithHeaders(ss, sheetName, columns, textFormatSheets.includes(sheetName));

    // Seed default config values ถ้าเพิ่งสร้างใหม่
    if (sheetName === 'config' && sheet.getLastRow() <= 1) {
      const defaultConfigs = [
        ['target_q1', 50, 'เป้าหมายพื้นฐาน ไตรมาส 1'],
        ['target_q2', 70, 'เป้าหมายพื้นฐาน ไตรมาส 2'],
        ['target_q3', 80, 'เป้าหมายพื้นฐาน ไตรมาส 3'],
        ['target_q4', 90, 'เป้าหมายพื้นฐาน ไตรมาส 4'],
        ['target_mmr_q1', 95, 'MMR ไตรมาส 1 (Override)'],
        ['target_mmr_q2', 95, 'MMR ไตรมาส 2 (Override)'],
        ['target_mmr_q3', 95, 'MMR ไตรมาส 3 (Override)'],
        ['target_mmr_q4', 95, 'MMR ไตรมาส 4 (Override)'],
        ['target_view2_q4', 90, 'Fully Immunized ไตรมาส 4 (มุมมองที่ 2)']
      ];
      sheet.getRange(2, 1, defaultConfigs.length, 3).setValues(defaultConfigs);
    }
  }

  // ลบชีตตั้งต้น (Sheet1) ถ้ามีและไม่ได้ใช้งาน
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  return { message: 'Database static sheets setup completed successfully. Use setupEpiSheetForYear(fiscalYear) to create EPI data sheets.' };
}

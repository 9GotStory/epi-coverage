/**
 * ──────────────────────────────────────────────────────────
 * VaccineRules.js — Dynamic Vaccine Rule Engine (GAS Backend)
 * จัดการเกณฑ์การประเมินวัคซีนแบบ Config-Driven
 * แทนที่ Hardcoded Logic ใน vaccine-*.ts ฝั่ง Frontend
 * ──────────────────────────────────────────────────────────
 */

const VACCINE_RULES_SHEET = 'vaccine_rules';

// Validate relationships before any sheet mutation.
function validateDateChecks_(checks, rule, knownFields) {
  if (checks === undefined) return;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks) ||
      typeof checks.before_birth !== 'boolean' || typeof checks.allow_on_birth !== 'boolean') throw new Error('Invalid date_checks settings');
  const own = [...(rule.required_fields || []), ...(rule.branch_alt_fields || [])];
  for (const key of ['same_day_pairs', 'ordered_pairs']) {
    if (!Array.isArray(checks[key]) || checks[key].length > 500) throw new Error('Invalid date pair list');
    const seen = new Set();
    for (const pair of checks[key]) {
      if (!pair || typeof pair.field !== 'string' || typeof pair.other_field !== 'string' ||
          pair.field === pair.other_field || !knownFields.has(pair.field) || !knownFields.has(pair.other_field) ||
          (!own.includes(pair.field) && !own.includes(pair.other_field))) throw new Error('Invalid vaccine date pair');
      const id = key === 'same_day_pairs' ? [pair.field, pair.other_field].sort().join('|') : pair.field + '|' + pair.other_field;
      if (seen.has(id)) throw new Error('Duplicate vaccine date pair');
      seen.add(id);
    }
  }
}
function ensureDateChecksColumn_(sheet) {
  const headers = sheet.getDataRange().getValues()[0];
  if (!headers.includes('date_checks')) sheet.getRange(1, headers.length + 1, 1, 1).setValues([['date_checks']]);
}
function parseDateChecks_(value) {
  if (value === '' || value === undefined || value === null) return undefined;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * ──────────────────────────────────────────────────────────
 * TARGET_AGE_MONTHS_BY_FIELD — แหล่งเดียว (Single Source of Truth)
 * ของ "ค่าเริ่มต้นอายุเป้าหมาย (เดือน)" ราย field ของวัคซีน
 *
 * ใช้โดย: seedVaccineRules, migrateVaccineRulesTargetAge (Setup.js),
 * และ suggestRuleTargetAges (ปุ่ม "อัปเดตอายุเป้าหมาย (Auto)" ในหน้า Rules Engine)
 *
 * หมายเหตุ: นี่คือ "ค่าเริ่มต้น" เท่านั้น — Admin แก้ค่าจริงของแต่ละ rule ได้
 * ผ่านช่อง "อายุเป้าหมาย (เดือน)" ในหน้าจัดการเกณฑ์ (คอลัมน์ target_age_months)
 * ใช้ var เพื่อให้ปลอดภัยต่อการอ้างอิงข้ามไฟล์ใน Google Apps Script
 * ──────────────────────────────────────────────────────────
 */
var TARGET_AGE_MONTHS_BY_FIELD = {
  // แรกเกิด (0 เดือน)
  bcg_date: 0, hbv1_date: 0,
  // 2 เดือน
  // หมายเหตุ OPV: ปฏิทิน 2569 ให้ IPV ที่ 2, 4 เดือน และ OPV เพียงเข็มเดียวที่ 6 เดือน
  // opv1/opv2 เหมาะกับรุ่นเก่า (หยอด 2/4/6 เดือน) — รอยืนยันรหัส HDC ของโดส 6 เดือนรุ่นใหม่ (081 หรือ 083)
  // ก่อนปรับ rules ของปีงบประมาณที่เด็กเกิดตามปฏิทินใหม่ (ตัดสินใจ ส.ค. 2569: รอตรวจสอบกับ HDC/สสอ.)
  hbv2_date: 2, dtp1_date: 2, opv1_date: 2, ipv1_date: 2, hib1_date: 2,
  rv21_date: 2, rv31_date: 2, pcv1_date: 2,
  // 4 เดือน
  hbv3_date: 4, dtp2_date: 4, opv2_date: 4, ipv2_date: 4, hib2_date: 4,
  rv22_date: 4, rv32_date: 4, pcv2_date: 4,
  // 6 เดือน
  hbv4_date: 6, dtp3_date: 6, opv3_date: 6, hib3_date: 6,
  rv33_date: 6, pcv3_date: 6,
  // 9 เดือน (ขอบล่างของช่วงแนะนำ 9-12 เดือน — สอดคล้องกับ MMR1)
  mmr1_date: 9, j11_date: 9,
  // 12-13 เดือน
  je1_date: 12, je2_date: 13,
  // 1 ปีครึ่ง (18 เดือน)
  dtp4_date: 18, opv4_date: 18, mmr2_date: 18,
  // 2 ปีครึ่ง (30 เดือน)
  je3_date: 30, j12_date: 30,
  // 4 ปี (48 เดือน)
  dtp5_date: 48, opv5_date: 48,
};

/**
 * คำนวณอายุเป้าหมายของ rule จาก field ทั้งหมด (ใช้ค่าสูงสุด)
 * @returns {number|null} null ถ้าไม่รู้จัก field ใดเลย
 */
function computeTargetAgeMonths(rule) {
  const fields = [...(rule.required_fields || []), ...(rule.branch_alt_fields || [])];
  let max = null;
  for (const f of fields) {
    if (TARGET_AGE_MONTHS_BY_FIELD[f] !== undefined) {
      max = max === null ? TARGET_AGE_MONTHS_BY_FIELD[f] : Math.max(max, TARGET_AGE_MONTHS_BY_FIELD[f]);
    }
  }
  return max;
}

/**
 * คำนวณ "ค่าเริ่มต้นอายุเป้าหมาย" ของ rules ที่ส่งมา (ใช้โดยปุ่ม Auto ในหน้า Rules Engine)
 * เพื่อไม่ให้ frontend ต้องฮาร์ดโค้ด map ไว้เอง — แหล่งเดียวคือ TARGET_AGE_MONTHS_BY_FIELD
 * @param {object[]} rules - rule objects ที่มี rule_id + required_fields (+ branch_alt_fields)
 * @returns {{suggestions: {rule_id: string, target_age_months: number|null}[]}}
 */
function suggestRuleTargetAges(rules) {
  if (!rules || !Array.isArray(rules)) {
    return { suggestions: [] };
  }
  const suggestions = rules.map(rule => ({
    rule_id: rule.rule_id,
    target_age_months: computeTargetAgeMonths(rule)
  }));
  return { suggestions };
}

/**
 * ดึง Vaccine Rules สำหรับปีงบประมาณและกลุ่มอายุที่ระบุ
 * @param {string|number} fiscalYear - ปีงบประมาณ เช่น 2568
 * @param {string} ageGroup - กลุ่มอายุ ('1yr', '2yr', '3yr', '5yr')
 * @returns {object[]} Array ของ Rules ที่ active
 */
function getVaccineRules(fiscalYear, ageGroup) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(VACCINE_RULES_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  return data.slice(1)
    .map(row => arrayToObj(headers, row))
    .filter(r =>
      String(r.fiscal_year) === String(fiscalYear) &&
      r.age_group === ageGroup &&
      (r.is_active === true || r.is_active === 'TRUE' || r.is_active === 'true')
    )
    .map(r => {
      // Parse JSON fields
      let requiredFields = [];
      let branchAltFields = [];
      try { requiredFields = JSON.parse(r.required_fields || '[]'); } catch (e) { /* ignore */ }
      try { branchAltFields = JSON.parse(r.branch_alt_fields || '[]'); } catch (e) { /* ignore */ }
      return {
        ...r,
        fiscal_year: Number(r.fiscal_year),
        view_type: Number(r.view_type),
        date_checks: parseDateChecks_(r.date_checks),
        required_fields: requiredFields,
        branch_alt_fields: branchAltFields,
        is_active: true,
        is_required_for_v2: r.is_required_for_v2 === true || r.is_required_for_v2 === 'TRUE' || r.is_required_for_v2 === 'true'
      };
    });
}

/**
 * บันทึก Vaccine Rule (Insert หรือ Update)
 * @param {object} rule - Rule object ที่ต้องการบันทึก
 * @param {string} adminEmail - Email ของ Admin ที่แก้ไข
 */
function saveVaccineRule(rule, adminEmail) {
  if (!rule || !rule.rule_id) {
    return { success: false, error: 'rule and rule_id are required' };
  }

  const validLogicTypes = ['ALL', 'ANY', 'BRANCH'];
  if (!validLogicTypes.includes(rule.logic_type)) {
    return { success: false, error: `logic_type must be one of: ${validLogicTypes.join(', ')}` };
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(VACCINE_RULES_SHEET);
  if (!sheet) return { success: false, error: 'vaccine_rules sheet not found. Run setup first.' };

  try {
    const incoming = [rule];
    const known = new Set(Object.keys(TARGET_AGE_MONTHS_BY_FIELD));
    const peers = getVaccineRules(rule.fiscal_year, rule.age_group);
    [...incoming, ...peers].forEach(r => [...(r.required_fields || []), ...(r.branch_alt_fields || [])].forEach(f => {
      if (typeof f === 'string' && /^[a-z][a-z0-9_]*_date$/.test(f)) known.add(f);
    }));
    incoming.forEach(r => validateDateChecks_(r.date_checks, r, known));
  } catch (error) { return { success: false, error: error.message }; }
  ensureDateChecksColumn_(sheet);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('rule_id');

  // Serialize JSON fields
  const requiredFieldsJson = JSON.stringify(Array.isArray(rule.required_fields) ? rule.required_fields : []);
  const branchAltFieldsJson = JSON.stringify(Array.isArray(rule.branch_alt_fields) ? rule.branch_alt_fields : []);

  const now = new Date();

  // ค้นหา Row ที่มีอยู่แล้ว
  let existingRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === rule.rule_id) {
      existingRowIndex = i + 1; // 1-indexed
      break;
    }
  }

  // ป้องกันเลข 0 นำหน้าหาย สำหรับ hdc_code
  const hdcCodeColIndex = headers.indexOf('hdc_code');
  if (hdcCodeColIndex !== -1) {
    const targetRow = existingRowIndex !== -1 ? existingRowIndex : sheet.getLastRow() + 1;
    sheet.getRange(targetRow, hdcCodeColIndex + 1).setNumberFormat('@');
  }

  const rowData = headers.map(header => {
    switch (header) {
      case 'rule_id': return rule.rule_id;
      case 'fiscal_year': return rule.fiscal_year;
      case 'age_group': return rule.age_group;
      case 'view_type': return rule.view_type;
      case 'vaccine_group': return rule.vaccine_group || '';
      case 'display_name': return rule.display_name || '';
      case 'hdc_code': return rule.hdc_code || '';
      case 'required_fields': return requiredFieldsJson;
      case 'logic_type': return rule.logic_type;
      case 'branch_alt_fields': return branchAltFieldsJson;
      case 'is_required_for_v2': return rule.is_required_for_v2 !== false;
      case 'is_active': return rule.is_active !== false;
      case 'target_age_months': return rule.target_age_months !== undefined ? rule.target_age_months : '';
      case 'date_checks': return rule.date_checks === undefined ? (existingRowIndex > 0 ? data[existingRowIndex - 1][headers.indexOf('date_checks')] || '' : '') : JSON.stringify(rule.date_checks);
      case 'note': return rule.note || '';
      case 'updated_at': return now;
      case 'updated_by': return adminEmail || '';
      default: return '';
    }
  });

  if (existingRowIndex > 0) {
    sheet.getRange(existingRowIndex, 1, 1, headers.length).setValues([rowData]);
  } else {
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, headers.length).setValues([rowData]);
  }

  logAction('SYSTEM', adminEmail, 'save_vaccine_rule',
    `Saved rule ${rule.rule_id} for fiscal_year=${rule.fiscal_year}, age_group=${rule.age_group}`);

  return { success: true, rule_id: rule.rule_id, action: existingRowIndex > 0 ? 'updated' : 'inserted' };
}

/**
 * บันทึก Vaccine Rules ทั้งหมดสำหรับกลุ่มอายุและปีงบประมาณนั้นๆ
 * โดยใช้วิธีลบของเดิมแล้ว Insert ใหม่ เพื่อความรวดเร็วและป้องกัน Rule ขยะ
 */
function batchSaveRules(fiscalYear, ageGroup, rules, adminEmail) {
  if (!fiscalYear || !ageGroup || !rules || !Array.isArray(rules)) {
    return { success: false, error: 'fiscalYear, ageGroup, and rules array are required' };
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(VACCINE_RULES_SHEET);
  if (!sheet) return { success: false, error: 'vaccine_rules sheet not found.' };

  try {
    const incoming = rules;
    const known = new Set(Object.keys(TARGET_AGE_MONTHS_BY_FIELD));
    const peers = getVaccineRules(incoming[0]?.fiscal_year || fiscalYear, incoming[0]?.age_group || ageGroup);
    [...incoming, ...peers].forEach(r => [...(r.required_fields || []), ...(r.branch_alt_fields || [])].forEach(f => {
      if (typeof f === 'string' && /^[a-z][a-z0-9_]*_date$/.test(f)) known.add(f);
    }));
    incoming.forEach(r => validateDateChecks_(r.date_checks, r, known));
  } catch (error) { return { success: false, error: error.message }; }
  ensureDateChecksColumn_(sheet);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // 1. แยก row ที่ไม่เกี่ยวข้องเก็บไว้ (ปีอื่น หรือกลุ่มอายุอื่น)
  const keptRows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = arrayToObj(headers, row);
    // ถ้าไม่ใช่เป้าหมาย ให้เก็บไว้
    if (String(obj.fiscal_year) !== String(fiscalYear) || obj.age_group !== ageGroup) {
      keptRows.push(row);
    }
  }

  // 2. แปลง new rules ให้เป็นรูปแบบ row
  const now = new Date();
  const newRows = rules.map(rule => {
    return headers.map(header => {
      switch (header) {
        case 'rule_id': return rule.rule_id;
        case 'fiscal_year': return fiscalYear;
        case 'age_group': return ageGroup;
        case 'view_type': return rule.view_type;
        case 'vaccine_group': return rule.vaccine_group || '';
        case 'display_name': return rule.display_name || '';
        case 'hdc_code': return rule.hdc_code || '';
        case 'required_fields': return JSON.stringify(rule.required_fields || []);
        case 'logic_type': return rule.logic_type;
        case 'branch_alt_fields': return JSON.stringify(rule.branch_alt_fields || []);
        case 'is_required_for_v2': return rule.is_required_for_v2 !== false;
        case 'is_active': return rule.is_active !== false;
        case 'target_age_months': return rule.target_age_months !== undefined ? rule.target_age_months : '';
        case 'date_checks': return rule.date_checks === undefined ? (data.slice(1).find(row => row[headers.indexOf('rule_id')] === rule.rule_id)?.[headers.indexOf('date_checks')] || '') : JSON.stringify(rule.date_checks);
      case 'note': return rule.note || '';
        case 'updated_at': return now;
        case 'updated_by': return adminEmail || '';
        default: return '';
      }
    });
  });

  // 3. Clear Sheet แล้วเขียนข้อมูลที่เก็บไว้ + ข้อมูลใหม่
  // เพื่อหลีกเลี่ยง error "Cannot clear the last row", clear แบบเหลือ header
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  
  const finalRows = [...keptRows, ...newRows];
  if (finalRows.length > 0) {
    const hdcCodeColIndex = headers.indexOf('hdc_code');
    if (hdcCodeColIndex !== -1) {
      sheet.getRange(2, hdcCodeColIndex + 1, finalRows.length, 1).setNumberFormat('@');
    }
    sheet.getRange(2, 1, finalRows.length, headers.length).setValues(finalRows);
  }

  logAction('SYSTEM', adminEmail, 'batch_save_rules',
    `Batch saved ${newRows.length} rules for fiscal_year=${fiscalYear}, age_group=${ageGroup}`);

  return { success: true, saved_count: newRows.length };
}

/**
 * คัดลอก Rules จากปีหนึ่งไปอีกปี (Clone)
 * @param {string|number} fromYear - ปีต้นทาง
 * @param {string|number} toYear - ปีปลายทาง
 * @param {string} adminEmail - Email ของ Admin
 */
function cloneRulesFromYear(fromYear, toYear, adminEmail) {
  if (!fromYear || !toYear) {
    return { success: false, error: 'fromYear and toYear are required' };
  }
  if (String(fromYear) === String(toYear)) {
    return { success: false, error: 'fromYear and toYear must be different' };
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(VACCINE_RULES_SHEET);
  if (!sheet) return { success: false, error: 'vaccine_rules sheet not found.' };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // ตรวจสอบว่าปีปลายทางมี Rules อยู่แล้วหรือไม่
  const existingInTarget = data.slice(1).filter(row => {
    const obj = arrayToObj(headers, row);
    return String(obj.fiscal_year) === String(toYear);
  });
  if (existingInTarget.length > 0) {
    return {
      success: false,
      error: `Target year ${toYear} already has ${existingInTarget.length} rules. Delete them first before cloning.`
    };
  }

  // ดึง Rules ของปีต้นทาง
  const sourceRules = data.slice(1).filter(row => {
    const obj = arrayToObj(headers, row);
    return String(obj.fiscal_year) === String(fromYear);
  });

  if (sourceRules.length === 0) {
    return { success: false, error: `No rules found for year ${fromYear}` };
  }

  // สร้าง Row ใหม่สำหรับปีปลายทาง
  const now = new Date();
  const newRows = sourceRules.map(row => {
    const obj = arrayToObj(headers, row);
    return headers.map(header => {
      if (header === 'rule_id') return Utilities.getUuid();
      if (header === 'fiscal_year') return toYear;
      if (header === 'updated_at') return now;
      if (header === 'updated_by') return adminEmail || '';
      return obj[header] !== undefined ? obj[header] : '';
    });
  });

  // Batch insert
  const startRow = sheet.getLastRow() + 1;
  const hdcCodeColIndex = headers.indexOf('hdc_code');
  if (hdcCodeColIndex !== -1) {
    sheet.getRange(startRow, hdcCodeColIndex + 1, newRows.length, 1).setNumberFormat('@');
  }
  sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);

  logAction('SYSTEM', adminEmail, 'clone_vaccine_rules',
    `Cloned ${newRows.length} rules from year ${fromYear} to ${toYear}`);

  return { success: true, cloned: newRows.length, fromYear, toYear };
}

/**
 * Seed Vaccine Rules เริ่มต้น จาก Hardcoded Logic ที่มีอยู่
 * ใช้สำหรับตั้งค่าครั้งแรก หรือเมื่อต้องการ Reset กลับไปเป็นค่า Default
 * @param {string|number} fiscalYear - ปีงบประมาณที่ต้องการ Seed
 * @param {string} adminEmail
 */
function seedVaccineRules(fiscalYear, adminEmail, force = false) {
  if (!fiscalYear) {
    return { success: false, error: 'fiscalYear is required' };
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(VACCINE_RULES_SHEET);
  if (!sheet) return { success: false, error: 'vaccine_rules sheet not found. Run setup first.' };

  // ตรวจสอบว่ามี Rules ของปีนั้นอยู่แล้วหรือไม่
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const existing = data.slice(1).filter(row => {
    const obj = arrayToObj(headers, row);
    return String(obj.fiscal_year) === String(fiscalYear);
  });
  
  if (existing.length > 0) {
    if (force) {
      const rowsToDelete = [];
      data.forEach((row, idx) => {
        if (idx === 0) return;
        const obj = arrayToObj(headers, row);
        if (String(obj.fiscal_year) === String(fiscalYear)) {
          rowsToDelete.push(idx + 1);
        }
      });
      // Delete from bottom to top to avoid index shifting
      for (let i = rowsToDelete.length - 1; i >= 0; i--) {
        sheet.deleteRow(rowsToDelete[i]);
      }
    } else {
      return { success: false, error: `Year ${fiscalYear} already has ${existing.length} rules. Use cloneVaccineRules or delete existing rules first.` };
    }
  }

  // ──────────────────────────────────────────────────────────
  // Default Rules — แปลงมาจาก vaccine-*.ts Hardcoded Logic
  // ──────────────────────────────────────────────────────────
  const rules = [
    // ── 1yr — View 1 (รายเข็ม) ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'BCG', display_name: 'ขาด BCG (010)', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'ขาด HBV เข็ม 1 (041)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'ขาด HBV เข็ม 2 (042)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'ขาด HBV เข็ม 3 (043)', hdc_code: '043', required_fields: ['hbv3_date'], logic_type: 'ALL', is_required_for_v2: false },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'ขาด HBV เข็ม 4 (043)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'DTP', display_name: 'ขาด DTP เข็ม 1 (031)', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'DTP', display_name: 'ขาด DTP เข็ม 2 (032)', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'DTP', display_name: 'ขาด DTP เข็ม 3 (033)', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Hib', display_name: 'ขาด Hib เข็ม 1 (D21)', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Hib', display_name: 'ขาด Hib เข็ม 2 (D22)', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Hib', display_name: 'ขาด Hib เข็ม 3 (D23)', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1 (I11)', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2 (I12)', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'OPV', display_name: 'ขาด OPV เข็ม 1 (081)', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'OPV', display_name: 'ขาด OPV เข็ม 2 (082)', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'OPV', display_name: 'ขาด OPV เข็ม 3 (083)', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'MMR', display_name: 'ขาด MMR เข็ม 1 (061)', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Rota', display_name: 'ขาด Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Rota', display_name: 'ขาด Rota (ครบถ้วน)', hdc_code: '', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true },

    // ── 1yr — View 2 (Fully Immunized) ──
    { age_group: '1yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม (010)', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (041)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2 (042)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (6 ด.) (043)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1 (031)', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2 (032)', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3 (033)', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1 (D21)', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2 (D22)', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3 (D23)', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1 (I11)', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2 (I12)', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true },

    { age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1 (081)', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2 (082)', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3 (083)', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1 (061)', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็มสุดท้าย (ครบ)', hdc_code: '', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true },

    // ── 2yr — View 1 ──
    { age_group: '2yr', view_type: 1, vaccine_group: 'JE/LAJE', display_name: 'ขาด LAJE เข็ม 1 (J11) / JE เข็ม 2 (052)', hdc_code: 'J11/052', required_fields: ['j11_date'], branch_alt_fields: ['je1_date', 'je2_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '2yr', view_type: 1, vaccine_group: 'DTP', display_name: 'ขาด DTP เข็ม 4 (034)', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 1, vaccine_group: 'OPV', display_name: 'ขาด OPV เข็ม 4 (084)', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 1, vaccine_group: 'MMR', display_name: 'ขาด MMR เข็ม 1 (061)', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 1, vaccine_group: 'MMR', display_name: 'ขาด MMR เข็ม 2 (073)', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true },

    // ── 2yr — View 2 ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (6 ด.)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true },

    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3 (083)', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 4 (084)', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็มสุดท้าย (ครบ)', hdc_code: '', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'JE/LAJE', display_name: 'LAJE เข็ม 1 หรือ JE เข็ม 1', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '2yr', view_type: 2, vaccine_group: 'JE/LAJE', display_name: 'JE เข็ม 2 (เฉพาะกรณีรับ JE)', hdc_code: '052', required_fields: ['j11_date'], branch_alt_fields: ['je2_date'], logic_type: 'BRANCH', is_required_for_v2: true },

    // ── 3yr — View 1 ──
    { age_group: '3yr', view_type: 1, vaccine_group: 'JE/LAJE', display_name: 'ขาด LAJE เข็ม 2 / JE เข็ม 3', hdc_code: 'J12/053', required_fields: ['j12_date'], branch_alt_fields: ['je3_date'], logic_type: 'BRANCH', is_required_for_v2: true },

    // ── 3yr — View 2: report template ข้อ 6 (Fully Immunized) ──
    // ครบทั้ง 9 กลุ่ม: BCG1, HBV3, DTP4, Hib3, IPV2, OPV2, MMR2, Rota, LAJE2/JE3
    // OPV ใช้ opv3_date + opv4_date (6 และ 18 เดือน); ไม่บังคับ opv1_date/opv2_date
    // ใช้ result ของ HDC เป็นผลอ้างอิง; template ยังไม่ระบุเงื่อนไขวันที่ซ้ำ/ระยะห่าง
    { age_group: '3yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (6 ด.)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, note: 'Template กำหนด HBV แรกเกิด + 2 เดือน + 6 เดือน; คง mapping hbv1_date, hbv2_date, hbv4_date ของระบบเดิมไว้ก่อน รอยืนยัน mapping เข็ม 6 เดือนจากรายงาน HDC' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, note: 'Report template ข้อ 6: IPV 2 ครั้ง ต้องมี IPV1 และ IPV2; ไม่ใช้ IPV2 แทน IPV1' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, note: 'Report template ข้อ 6: IPV 2 ครั้ง ต้องมี IPV1 และ IPV2; ไม่ใช้ OPV4 แทน IPV2' },

    { age_group: '3yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV 6 เดือน (083)', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, note: 'Report template ข้อ 6: OPV 2 ครั้ง ใช้ opv3_date และ opv4_date ตามกำหนดการ 6 และ 18 เดือน; ไม่บังคับ OPV1–2 ในมุมมองที่ 2 อายุ 3 ปี' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV 18 เดือน (084)', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true, note: 'Report template ข้อ 6: OPV 2 ครั้ง ใช้ opv3_date และ opv4_date ตามกำหนดการ 6 และ 18 เดือน; ไม่บังคับ OPV1–2 ในมุมมองที่ 2 อายุ 3 ปี' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็มสุดท้าย (ครบ)', hdc_code: '', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, note: 'ครบชุด 2 เข็ม หรือครบชุด 3 เข็ม; template ที่ได้รับยังไม่แจกแจงวันที่ซ้ำ ระยะห่าง หรือสูตรผสม จึงไม่เพิ่มเงื่อนไขเหล่านี้ใน seed' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'JE/LAJE', display_name: 'LAJE เข็ม 1 หรือ JE เข็ม 1', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '3yr', view_type: 2, vaccine_group: 'JE/LAJE', display_name: 'LAJE เข็ม 2 หรือ JE เข็ม 2-3 (ครบ)', hdc_code: 'J12/052-053', required_fields: ['j11_date', 'j12_date'], branch_alt_fields: ['je1_date', 'je2_date', 'je3_date'], logic_type: 'BRANCH', is_required_for_v2: true },

    // ── 5yr — View 1 ──
    { age_group: '5yr', view_type: 1, vaccine_group: 'DTP', display_name: 'ขาด DTP เข็ม 5 (035)', hdc_code: '035', required_fields: ['dtp5_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 1, vaccine_group: 'OPV', display_name: 'ขาด OPV เข็ม 5 (085)', hdc_code: '085', required_fields: ['opv5_date'], logic_type: 'ALL', is_required_for_v2: true },

    // ── 5yr — View 2 ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (6 ด.)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 5 (4 ปี)', hdc_code: '035', required_fields: ['dtp5_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV (4 เดือน)', hdc_code: 'I11', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true },

    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3 (083)', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 4 (084)', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 5 (085)', hdc_code: '085', required_fields: ['opv5_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true },
    // Rota สำหรับเด็ก 5 ปี: HDC บังคับเป็นผ่านเกณฑ์
    { age_group: '5yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วน)', hdc_code: '', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'JE/LAJE', display_name: 'LAJE เข็ม 1 หรือ JE เข็ม 1', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date'], logic_type: 'BRANCH', is_required_for_v2: true },
    { age_group: '5yr', view_type: 2, vaccine_group: 'JE/LAJE', display_name: 'LAJE เข็ม 2 หรือ JE เข็ม 2-3 (ครบ)', hdc_code: 'J12/052-053', required_fields: ['j11_date', 'j12_date'], branch_alt_fields: ['je1_date', 'je2_date', 'je3_date'], logic_type: 'BRANCH', is_required_for_v2: true }
  ];

  const now = new Date();
  const rows = rules.map(r => {
    const targetAge = computeTargetAgeMonths(r);
    return headers.map(header => {
      switch (header) {
        case 'rule_id': return Utilities.getUuid();
        case 'fiscal_year': return fiscalYear;
        case 'age_group': return r.age_group;
        case 'view_type': return r.view_type;
        case 'vaccine_group': return r.vaccine_group || '';
        case 'display_name': return r.display_name || '';
        case 'hdc_code': return r.hdc_code || '';
        case 'required_fields': return JSON.stringify(r.required_fields || []);
        case 'logic_type': return r.logic_type;
        case 'branch_alt_fields': return JSON.stringify(r.branch_alt_fields || []);
        case 'is_required_for_v2': return r.is_required_for_v2 !== false;
        case 'is_active': return true;
        case 'target_age_months': return targetAge !== null ? targetAge : '';
        case 'note': return r.note || '';
        case 'updated_at': return now;
        case 'updated_by': return adminEmail || 'system';
        default: return '';
      }
    });
  });

  const startRow = sheet.getLastRow() + 1;
  
  // ป้องกันเลข 0 นำหน้าหาย สำหรับ hdc_code
  const hdcCodeColIndex = headers.indexOf('hdc_code');
  if (hdcCodeColIndex !== -1) {
    sheet.getRange(startRow, hdcCodeColIndex + 1, rows.length, 1).setNumberFormat('@');
  }
  
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);

  logAction('SYSTEM', adminEmail || 'system', 'seed_vaccine_rules',
    `Seeded ${rows.length} vaccine rules for fiscal_year=${fiscalYear}`);

  return { success: true, seeded: rows.length, fiscalYear };
}

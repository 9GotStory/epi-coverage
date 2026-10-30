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
 * Issue #26 (Decision E — forward-only vaccine identity): a metric_key is
 * ESTABLISHED only when stored as a non-empty string. Absent/null/undefined/
 * empty means no established key; the effective runtime key is the rule_id.
 */
function establishedMetricKey_(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Resolve the metric_key to persist for an incoming rule against its stored state.
 * Returns { error } when the caller attempts an unauthorized lineage change. */
function resolveMetricKeyForSave_(rule, storedKey) {
  const supplied = establishedMetricKey_(rule.metric_key);
  const established = establishedMetricKey_(storedKey);
  if (established) {
    // Ordinary edits must preserve an established lineage; reassignment fails closed.
    if (supplied && supplied !== established) {
      return { error: 'metric_key is established for this rule and cannot be reassigned' };
    }
    return { key: established };
  }
  // No established lineage yet: a genuinely new/legacy rule starts from its own rule_id.
  // A caller may not graft another lineage onto it by supplying a different key.
  if (supplied && supplied !== rule.rule_id) {
    return { error: 'metric_key cannot be set to another lineage on a rule without an established key' };
  }
  return { key: rule.rule_id };
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
  // หมายเหตุ HBV: โครงสร้าง HOSxP สลับชื่อคอลัมน์ — hbv4_date เก็บเข็มที่ 4 เดือน (โดส 3)
  // และ hbv3_date เก็บเข็มที่ 6 เดือน (โดส 4) — ยืนยันโดยเจ้าของข้อมูล (10 ก.ย. 2569)
  hbv4_date: 4, dtp2_date: 4, opv2_date: 4, ipv2_date: 4, hib2_date: 4,
  rv22_date: 4, rv32_date: 4, pcv2_date: 4,
  // 6 เดือน
  hbv3_date: 6, dtp3_date: 6, opv3_date: 6, hib3_date: 6,
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

// รูปแบบฟิลด์ตามชุดวัคซีน เช่น hbv1_date, rv31_date, j12_date
var FIELD_SERIES_RE_ = /^(hbv|dtp|hib|ipv|opv|mmr|pcv|je|j1|rv2|rv3)(\d+)_date$/;

/**
 * สร้าง date_checks เป็น "ค่าจริง" ตอน seed — ทุกค่ามีที่มาจากแหล่งเดียว (TARGET_AGE_MONTHS_BY_FIELD):
 * - before_birth: เปิดตรวจวันที่ก่อนวันเกิดทุกเข็ม
 * - allow_on_birth: อนุญาตเฉพาะวัคซีนแรกเกิด (อายุเป้าหมาย 0 เดือน)
 * - same_day_pairs / ordered_pairs: คู่เข็มในชุดเดียวกัน เรียงตาม "อายุเป้าหมาย" (ไม่ใช่เลขเข็ม
 *   เพื่อให้ถูกต้องแม้ชื่อคอลัมน์กับลำดับโดสไม่ตรงกัน) และต้องมีอย่างน้อยหนึ่งเข็มอยู่ใน rule นี้
 * Admin แก้ค่าเหล่านี้ผ่านหน้า Rules Engine ได้ภายหลัง
 * @param {object} rule - rule ที่กำลังจะ seed
 * @param {object[]} peerRules - rules ทั้งหมดของกลุ่มอายุเดียวกัน (ใช้รวบรวมฟิลด์คู่เทียบ)
 */
function buildSeedDateChecks_(rule, peerRules) {
  const own = [...(rule.required_fields || []), ...(rule.branch_alt_fields || [])];
  const fields = [];
  for (const r of peerRules) {
    for (const f of [...(r.required_fields || []), ...(r.branch_alt_fields || [])]) {
      if (f && !fields.includes(f)) fields.push(f);
    }
  }
  const sameDay = [];
  const ordered = [];
  for (const a of fields) {
    const ma = FIELD_SERIES_RE_.exec(a);
    if (!ma) continue;
    const ageA = TARGET_AGE_MONTHS_BY_FIELD[a];
    if (ageA === undefined) continue;
    for (const b of fields) {
      if (a === b) continue;
      const mb = FIELD_SERIES_RE_.exec(b);
      if (!mb || mb[1] !== ma[1]) continue;
      const ageB = TARGET_AGE_MONTHS_BY_FIELD[b];
      if (ageB === undefined || ageA >= ageB) continue;
      if (!own.includes(a) && !own.includes(b)) continue;
      sameDay.push({ field: a, other_field: b });
      ordered.push({ field: a, other_field: b });
    }
  }
  return {
    before_birth: true,
    allow_on_birth: computeTargetAgeMonths(rule) === 0,
    same_day_pairs: sameDay,
    ordered_pairs: ordered,
  };
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
 * แนะนำ date_checks (คู่เข็ม same_day/ordered ฯลฯ) ของ rules ที่ส่งมา
 * ใช้ตอนสร้าง/แก้ไข rule ในหน้า Rules Engine — ตรรกะเดียวกับตอน seed
 * (แหล่งที่มาเดียว: TARGET_AGE_MONTHS_BY_FIELD ผ่าน buildSeedDateChecks_)
 * ส่ง rule ที่สนใจมาพร้อม peers ของกลุ่มอายุเดียวกันเพื่อให้จับคู่เข็มข้าม rule ได้ครบ
 * @param {object[]} rules - rule objects (rule แรกคือ rule ที่กำลังแก้ หรือส่งทั้งชุดเพื่ออัปเดตหลาย rule)
 * @returns {{suggestions: {rule_id: string, date_checks: object}[]}}
 */
function suggestRuleDateChecks(rules) {
  if (!rules || !Array.isArray(rules)) {
    return { suggestions: [] };
  }
  const suggestions = rules.map(rule => ({
    rule_id: rule.rule_id,
    date_checks: buildSeedDateChecks_(rule, rules.filter(r => r.age_group === rule.age_group))
  }));
  return { suggestions };
}

/**
 * ดึง Vaccine Rules สำหรับปีงบประมาณและกลุ่มอายุที่ระบุ (รวมกฎที่ is_active = false)
 * ให้ฝั่งผู้ใช้กรอง is_active เอง — หน้า Rules Engine ต้องเห็นกฎที่ปิดอยู่เพื่อเปิดคืนได้
 * และ Batch Save จะได้ไม่ลบกฎที่ปิดอยู่ทิ้งโดยไม่ตั้งใจ
 * @param {string|number} fiscalYear - ปีงบประมาณ เช่น 2568
 * @param {string} ageGroup - กลุ่มอายุ ('1yr', '2yr', '3yr', '5yr')
 * @returns {object[]} Array ของ Rules ทั้งหมดของปีและกลุ่มอายุนั้น
 */
/**
 * Issue #76: bounded script lock around every vaccine_rules mutation — ทั้งชุด
 * อ่าน-ตัดสิน-เขียนเกิดภายใต้ lock เดียวและปล่อยเสมอใน finally ก่อนหน้านี้
 * batchSaveRules/seed/clone ทำ read-modify-write ทั้งชีตโดยไม่มี lock ทำให้
 * การบันทึกพร้อมกันเขียนทับกันเงียบ ๆ
 */
const RULES_WRITE_LOCK_TIMEOUT_MS = 60000;

function withRulesLock_(work) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(RULES_WRITE_LOCK_TIMEOUT_MS);
  } catch (e) {
    return { success: false, status: 'rules_busy', error: 'vaccine_rules lock busy; no changes were made.' };
  }
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Issue #76: cell parity สำหรับ read-back verification — เซลล์สตริงต้องอ่านกลับเป็น
 * สตริงเดิมทุกประการ, Date เทียบตาม instant, Number ยอมรับเพิ่มรูปข้อความทศนิยมตรงตัว
 * (เซลล์ที่ถูก format เป็นข้อความ) นอกนั้นเทียบเคร้งครัด เจตนาเดียวกับ openDataCellParity
 * (OpenData.js) โดยไม่ผูก graph การโหลดของสองไฟล์เข้าด้วยกัน
 */
function ruleCellParity_(intended, observed) {
  if (typeof intended === 'string') return observed === intended;
  if (intended instanceof Date) return observed instanceof Date && observed.getTime() === intended.getTime();
  if (typeof intended === 'number' && Number.isFinite(intended)) {
    return observed === intended || observed === String(intended);
  }
  return observed === intended;
}

/**
 * Issue #76: commit บริเวณข้อมูลทั้งหมดด้วย setValues สี่เหลี่ยมเดียวแบบเติม padding —
 * ไม่มี clear-before-write — แล้วตรวจ read-back ด้วย commit states ที่ซื่อสัตย์
 * (ตามวินัยเดียวกับ sync OpenData ที่ harden ไว้แล้ว) padding เติมหางเดิมที่ยาวกว่า
 * ให้ว่างในการเขียนครั้งเดียวกัน จึงไม่ต้อง clearContent หรือ deleteRow อีก
 * คืน { verified: true } หรือ { verified: false, commitState: 'commit_uncertain' | 'commit_failure' }
 */
function commitRulesRectangle_(sheet, headers, rows, previousDataRowCount) {
  const width = headers.length;
  const height = Math.max(previousDataRowCount, rows.length);
  const matrix = rows.slice();
  while (matrix.length < height) matrix.push(Array(width).fill(''));
  let writeAttempted = false;
  try {
    const hdcCodeColIndex = headers.indexOf('hdc_code');
    if (hdcCodeColIndex !== -1) {
      sheet.getRange(2, hdcCodeColIndex + 1, height, 1).setNumberFormat('@');
    }
    const target = sheet.getRange(2, 1, height, width);
    writeAttempted = true; // throw หลังจุดนี้คือความไม่ชัดเจน (batch อาจถูก apply ไปแล้ว)
    target.setValues(matrix);
    SpreadsheetApp.flush();
    const readBack = target.getValues();
    const verified = readBack.length === height && readBack.every((row, i) =>
      row.length === width && row.every((cell, j) => ruleCellParity_(matrix[i][j], cell)));
    return verified ? { verified: true } : { verified: false, commitState: 'commit_uncertain' };
  } catch (e) {
    // writeAttempted เป็นตัวกำกับความจริงเท่านั้น: format-throw = ค่ายังไม่ถูกเขียน (commit_failure);
    // setValues/flush/read-back throw = เขียนแล้วหรือไม่ก็ไม่รู้ (commit_uncertain) — ห้ามอ้างว่าสำเร็จ
    return { verified: false, commitState: writeAttempted ? 'commit_uncertain' : 'commit_failure' };
  }
}

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
      r.age_group === ageGroup
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
        // Issue #26 (Decision E): expose the EFFECTIVE forward identity — the stored
        // key when established, otherwise this rule's own rule_id. Runtime identity
        // only; it never claims equivalence with another fiscal year.
        metric_key: establishedMetricKey_(r.metric_key) || r.rule_id,
        is_active: r.is_active === true || r.is_active === 'TRUE' || r.is_active === 'true',
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

  // Issue #76: อ่าน-ตัดสิน-เขียนทั้งลำดับเกิดภายใต้ lock เดียว (release เสมอใน finally)
  return withRulesLock_(() => {
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

    // Issue #26 (Decision E): resolve the forward identity BEFORE any sheet mutation —
    // an unauthorized lineage change fails closed leaving the row fully untouched.
    const metricKeyCol = headers.indexOf('metric_key');
    const storedKey = existingRowIndex > 0 && metricKeyCol !== -1
      ? data[existingRowIndex - 1][metricKeyCol]
      : undefined;
    const metricKeyResolution = resolveMetricKeyForSave_(rule, storedKey);
    if (metricKeyResolution.error) {
      return { success: false, error: metricKeyResolution.error };
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
        case 'metric_key': return metricKeyResolution.key;
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
  });
}

/**
 * บันทึก Vaccine Rules ทั้งหมดสำหรับกลุ่มอายุและปีงบประมาณนั้นๆ
 * โดยใช้วิธีลบของเดิมแล้ว Insert ใหม่ เพื่อความรวดเร็วและป้องกัน Rule ขยะ
 */
function batchSaveRules(fiscalYear, ageGroup, rules, adminEmail) {
  if (!fiscalYear || !ageGroup || !rules || !Array.isArray(rules)) {
    return { success: false, error: 'fiscalYear, ageGroup, and rules array are required' };
  }

  // Issue #76: ทั้ง lifecycle (อ่าน keptRows, ตัดสิน metric_key, commit) เกิดภายใต้ lock
  // เดียว — กันการบันทึกพร้อมกันอ่านสแนปช็อตเก่าแล้วเขียนทับกันเงียบ ๆ
  return withRulesLock_(() => {
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

    // Issue #26 (Decision E): resolve every incoming rule's forward identity against its
    // STORED key BEFORE any sheet mutation. Established keys survive older-client omission
    // and replacement; attempted lineage reassignment fails the whole batch with the
    // (FY, ageGroup) ruleset untouched.
    const idColIndex = headers.indexOf('rule_id');
    const metricKeyColIndex = headers.indexOf('metric_key');
    const storedKeyByRuleId = new Map();
    for (let i = 1; i < data.length; i++) {
      if (String(arrayToObj(headers, data[i]).fiscal_year) === String(fiscalYear) && arrayToObj(headers, data[i]).age_group === ageGroup) {
        storedKeyByRuleId.set(data[i][idColIndex], metricKeyColIndex !== -1 ? data[i][metricKeyColIndex] : undefined);
      }
    }
    const resolvedMetricKeys = new Map();
    for (const rule of rules) {
      const resolution = resolveMetricKeyForSave_(rule, storedKeyByRuleId.get(rule.rule_id));
      if (resolution.error) {
        return { success: false, error: `rule ${rule.rule_id}: ${resolution.error}` };
      }
      resolvedMetricKeys.set(rule.rule_id, resolution.key);
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
          case 'metric_key': return resolvedMetricKeys.get(rule.rule_id);
          case 'note': return rule.note || '';
          case 'updated_at': return now;
          case 'updated_by': return adminEmail || '';
          default: return '';
        }
      });
    });

    // 3. Issue #76: single padded rectangular replacement — ไม่มี clear-before-write อีกต่อไป
    //    (ช่องว่าง clear→setValues เดิมทำให้พังชั่วขณะแล้วกฎหายทุกปีทั้งชีต) stale tail
    //    ถูกเติมให้ว่างในการเขียนครั้งเดียวกัน และ read-back ถูกตรวจก่อนอ้างความสำเร็จ
    const commit = commitRulesRectangle_(sheet, headers, [...keptRows, ...newRows], data.length - 1);
    if (!commit.verified) {
      logAction('SYSTEM', adminEmail, 'batch_save_rules',
        `Commit ${commit.commitState} for fiscal_year=${fiscalYear}, age_group=${ageGroup} — no success claimed`);
      return {
        success: false, status: commit.commitState,
        error: commit.commitState === 'commit_failure'
          ? 'vaccine_rules commit failed before any value write.'
          : 'vaccine_rules commit could not be verified; the sheet may be partially applied — inspect before retrying.'
      };
    }

    logAction('SYSTEM', adminEmail, 'batch_save_rules',
      `Batch saved ${newRows.length} rules for fiscal_year=${fiscalYear}, age_group=${ageGroup}`);

    return { success: true, saved_count: newRows.length };
  });
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

  // Issue #76: read-check-insert ทั้งลำดับอยู่ใต้ lock เดียว
  return withRulesLock_(() => cloneRulesFromYearLocked_(fromYear, toYear, adminEmail));
}

function cloneRulesFromYearLocked_(fromYear, toYear, adminEmail) {

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
    // Issue #26 (Decision E): the clone is a NEW rule instance but preserves the source
    // lineage — the stored key when established, otherwise the SOURCE rule_id (an empty
    // stored key must never propagate as an empty lineage).
    const sourceMetricKey = establishedMetricKey_(obj.metric_key) || obj.rule_id;
    return headers.map(header => {
      if (header === 'rule_id') return Utilities.getUuid();
      if (header === 'metric_key') return sourceMetricKey;
      if (header === 'fiscal_year') return toYear;
      if (header === 'updated_at') return now;
      if (header === 'updated_by') return adminEmail || '';
      return obj[header] !== undefined ? obj[header] : '';
    });
  });

  // Issue #76: commit ทั้งบริเวณข้อมูล (แถวเดิม + แถว clone) ด้วยสี่เหลี่ยมเดียวแบบตรวจ
  // read-back — แทนการ append ท้ายชีตแบบเดิมที่พังกลางทางแล้วปีปลายทางติดค้างบางส่วน
  const commit = commitRulesRectangle_(sheet, headers, [...data.slice(1), ...newRows], data.length - 1);
  if (!commit.verified) {
    logAction('SYSTEM', adminEmail, 'clone_vaccine_rules',
      `Commit ${commit.commitState} for ${fromYear} → ${toYear} — no success claimed`);
    return {
      success: false, status: commit.commitState,
      error: commit.commitState === 'commit_failure'
        ? 'vaccine_rules clone commit failed before any value write.'
        : 'vaccine_rules clone commit could not be verified; the sheet may be partially applied — inspect before retrying.'
    };
  }

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

  // Issue #76: read-check-commit ทั้งลำดับอยู่ใต้ lock เดียว
  return withRulesLock_(() => seedVaccineRulesLocked_(fiscalYear, adminEmail, force));
}

function seedVaccineRulesLocked_(fiscalYear, adminEmail, force) {

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

  if (existing.length > 0 && !force) {
    return { success: false, error: `Year ${fiscalYear} already has ${existing.length} rules. Use cloneVaccineRules or delete existing rules first.` };
  }

  // Issue #76: force ไม่ลบทีละแถวอีกต่อไป — แถวของปีอื่นถูกเก็บไว้แล้วเขียนทับทั้งบริเวณ
  // ด้วยสี่เหลี่ยมเดียว จึงไม่มีหน้าต่าง delete→append ที่พังครึ่งทางแล้วปีนั้นหายบางส่วน
  const keptRows = data.slice(1).filter(row => {
    const obj = arrayToObj(headers, row);
    return String(obj.fiscal_year) !== String(fiscalYear);
  });

  // ──────────────────────────────────────────────────────────
  // Default Rules
  // ──────────────────────────────────────────────────────────
  const rules = [
    // ── 1yr — View 1 (วัคซีนรายชนิด/รายเข็ม) ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'BCG', display_name: 'BCG', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    
    // ── HBV (เรียงตามอายุ แต่สลับฟิลด์ตามโครงสร้าง HOSxP) ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (0 เดือน)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2 (2 เดือน)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (4 เดือน)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'HBV', display_name: 'HBV เข็ม 4 (6 เดือน)', hdc_code: '044', required_fields: ['hbv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── DTP ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── Hib ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── IPV ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    
    // ── OPV ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 2, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '1yr', view_type: 1, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 4, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '1yr', view_type: 1, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── MMR ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 9 },
    
    // ── PCV (นอกแผน) ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'PCV', display_name: 'PCV เข็ม 1', hdc_code: 'P11', required_fields: ['pcv1_date'], logic_type: 'ALL', is_required_for_v2: false, target_age_months: 2 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'PCV', display_name: 'PCV เข็ม 2', hdc_code: 'P12', required_fields: ['pcv2_date'], logic_type: 'ALL', is_required_for_v2: false, target_age_months: 4 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'PCV', display_name: 'PCV เข็ม 3', hdc_code: 'P13', required_fields: ['pcv3_date'], logic_type: 'ALL', is_required_for_v2: false, target_age_months: 6 },

// ── Rota (BRANCH: ได้ครบชุดชนิด 2 เข็ม หรือชุด 3 เข็ม ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '1yr', view_type: 1, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 1, vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วนตามเกณฑ์)', hdc_code: 'R12/R23', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 6 },

    // ── 1yr — View 2 (Fully Immunized) ──
    { age_group: '1yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    // ── HBV (เรียงตามอายุ แต่สลับฟิลด์ตามโครงสร้าง HOSxP) ──
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (0 เดือน)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2 (2 เดือน)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (4 เดือน)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 4 (6 เดือน)', hdc_code: '044', required_fields: ['hbv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 2, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 4, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 9 },
    
// ── Rota (BRANCH: ได้ครบชุดชนิด 2 เข็ม หรือชุด 3 เข็ม ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '1yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '1yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วนตามเกณฑ์)', hdc_code: 'R12/R23', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 6 },

    // ── 2yr — View 1 ──
    { age_group: '2yr', view_type: 1, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 9 },
    { age_group: '2yr', view_type: 1, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },

    // ── DTP & OPV (1 ปี 6 เดือน) ──
    { age_group: '2yr', view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    { age_group: '2yr', view_type: 1, vaccine_group: 'OPV', display_name: 'OPV เข็ม 4', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },

    // ── JE / LAJE (แยกรายเข็ม Single Responsibility) ──
    // ── JE / LAJE (BRANCH: ได้ LAJE หรือครบ JE series ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '2yr', view_type: 1, vaccine_group: 'JE', display_name: 'LAJE/JE 1 ปี', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date', 'je2_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 12 },
    
    // ── 2yr — View 2 ──
    // ── BCG ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },

    // ── HBV (เรียงตามอายุ แต่สลับฟิลด์ตามโครงสร้าง HOSxP) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (0 เดือน)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2 (2 เดือน)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (4 เดือน)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 4 (6 เดือน)', hdc_code: '044', required_fields: ['hbv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },

    // ── DTP (เช็ค 4 เข็ม: 2, 4, 6, 18 เดือน) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
    // ── Hib (เช็ค 3 เข็ม) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── IPV (เช็ค 2 เข็ม) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    
    // ── OPV (เช็ค 4 เข็ม) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 2, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 4, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 4', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
    // ── MMR (เช็ค 2 เข็ม: 9 เดือน, 18 เดือน) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 9 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
// ── Rota (BRANCH: ได้ครบชุดชนิด 2 เข็ม หรือชุด 3 เข็ม ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '2yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วนตามเกณฑ์)', hdc_code: 'R12/R23', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 6 },

    // ── JE / LAJE (แยกรายเข็ม Single Responsibility) ──
    // ── JE / LAJE (BRANCH: ได้ LAJE หรือครบ JE series ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '2yr', view_type: 2, vaccine_group: 'JE', display_name: 'LAJE/JE 1 ปี', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date', 'je2_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 12 },

    // ── 3yr — View 1 ──
    { age_group: '3yr', view_type: 1, vaccine_group: 'JE', display_name: 'LAJE เข็ม 2 / JE เข็ม 3', hdc_code: 'J12/053', required_fields: ['j12_date'], branch_alt_fields: ['je3_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 30 },

    // ── 3yr — View 2: report template ข้อ 6 (Fully Immunized) ──
    // ── BCG ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },

    // ── HBV (เรียงตามอายุ แต่สลับฟิลด์ตามโครงสร้าง HOSxP) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (0 เดือน)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2 (2 เดือน)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (4 เดือน)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 4 (6 เดือน)', hdc_code: '044', required_fields: ['hbv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },

    // ── DTP (เช็ค 4 เข็ม) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
    // ── Hib (เช็ค 3 เข็ม) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── IPV (เช็ค 2 เข็ม) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    
    // ── OPV (เช็ค 4 เข็ม) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 2, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 4, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '3yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 4', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
    // ── MMR (เช็ค 2 เข็ม) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 9 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
// ── Rota (BRANCH: ได้ครบชุดชนิด 2 เข็ม หรือชุด 3 เข็ม ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วนตามเกณฑ์)', hdc_code: 'R12/R23', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 6 },

    // ── JE / LAJE (แยกรายเข็ม Single Responsibility สำหรับเด็ก 3 ปี) ──
    // ── JE / LAJE (BRANCH: ได้ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '3yr', view_type: 2, vaccine_group: 'JE', display_name: 'LAJE/JE 1 ปี', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date', 'je2_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 12 },
    { age_group: '3yr', view_type: 2, vaccine_group: 'JE', display_name: 'LAJE เข็ม 2 / JE เข็ม 3', hdc_code: 'J12/053', required_fields: ['j12_date'], branch_alt_fields: ['je3_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 30 },

    // ── 5yr — View 1 ──
    { age_group: '5yr', view_type: 1, vaccine_group: 'DTP', display_name: 'DTP เข็ม 5', hdc_code: '035', required_fields: ['dtp5_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 48},
    { age_group: '5yr', view_type: 1, vaccine_group: 'OPV', display_name: 'OPV เข็ม 5', hdc_code: '085', required_fields: ['opv5_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 48 },

    // ── 5yr — View 2 ──
    // ── BCG ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG 1 เข็ม', hdc_code: '010', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },

    // ── HBV (เรียงตามอายุ แต่สลับฟิลด์ตามโครงสร้าง HOSxP) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 1 (0 เดือน)', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 0 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 2 (2 เดือน)', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 3 (4 เดือน)', hdc_code: '043', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV เข็ม 4 (6 เดือน)', hdc_code: '044', required_fields: ['hbv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },

    // ── DTP (เช็ค 5 เข็ม: 2, 4, 6, 18 เดือน, 4 ปี) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 4', hdc_code: '034', required_fields: ['dtp4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP เข็ม 5', hdc_code: '035', required_fields: ['dtp5_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 48 },
    
    // ── Hib (เช็ค 3 เข็ม) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib เข็ม 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    
    // ── IPV (เช็ค 2 เข็ม) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV เข็ม 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 4 },
    
    // ── OPV (เช็ค 5 เข็ม: 2, 4, 6, 18 เดือน, 4 ปี) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 1', hdc_code: '081', required_fields: ['opv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 2, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 2', hdc_code: '082', required_fields: ['opv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: false, target_age_months: 4, note: 'ปฏิทิน 2569 ใช้ IPV แทนที่เข็ม 2 และ 4 เดือน — เปิดใช้กฎนี้เฉพาะข้อมูลปฏิทินเก่า' },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 3', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 6 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 4', hdc_code: '084', required_fields: ['opv4_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV เข็ม 5', hdc_code: '085', required_fields: ['opv5_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 48 },
    
    // ── MMR (เช็ค 2 เข็ม) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 9 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR เข็ม 2', hdc_code: '073', required_fields: ['mmr2_date'], logic_type: 'ALL', is_required_for_v2: true, target_age_months: 18 },
    
// ── Rota (BRANCH: ได้ครบชุดชนิด 2 เข็ม หรือชุด 3 เข็ม ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota เข็ม 1', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 2 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota (ครบถ้วนตามเกณฑ์)', hdc_code: 'R12/R23', required_fields: ['rv21_date', 'rv22_date'], branch_alt_fields: ['rv31_date', 'rv32_date', 'rv33_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 6 },

    // ── JE / LAJE (แยกรายเข็ม Single Responsibility สำหรับเด็ก 5 ปี) ──
    // ── JE / LAJE (BRANCH: ได้ชนิดใดชนิดหนึ่งถือว่าผ่าน) ──
    { age_group: '5yr', view_type: 2, vaccine_group: 'JE', display_name: 'LAJE/JE 1 ปี', hdc_code: 'J11/051', required_fields: ['j11_date'], branch_alt_fields: ['je1_date', 'je2_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 12 },
    { age_group: '5yr', view_type: 2, vaccine_group: 'JE', display_name: 'LAJE เข็ม 2 / JE เข็ม 3', hdc_code: 'J12/053', required_fields: ['j12_date'], branch_alt_fields: ['je3_date'], logic_type: 'BRANCH', is_required_for_v2: true, target_age_months: 30 },
  ];

  const now = new Date();
  // เติม date_checks เป็นค่าจริงทุก rule ตั้งแต่ seed — ไม่ต้องพึ่งการอนุมานฝั่ง frontend
  // (แหล่งที่มา: TARGET_AGE_MONTHS_BY_FIELD ผ่าน buildSeedDateChecks_)
  const seeded = rules.map(r => r.date_checks === undefined
    ? { ...r, date_checks: buildSeedDateChecks_(r, rules.filter(x => x.age_group === r.age_group)) }
    : r);

  const rows = seeded.map(r => {
    const targetAge = computeTargetAgeMonths(r);
    // Issue #26 (Decision E): every seeded rule starts a NEW logical lineage — its
    // metric_key is its own freshly generated rule_id. Independently seeded/reset years
    // never recover continuity (safe split preferred over a false merge).
    const newRuleId = Utilities.getUuid();
    return headers.map(header => {
      switch (header) {
        case 'rule_id': return newRuleId;
        case 'metric_key': return newRuleId;
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
        case 'is_active': return r.is_active !== false;
        case 'target_age_months': return targetAge !== null ? targetAge : '';
        case 'date_checks': return r.date_checks === undefined ? '' : JSON.stringify(r.date_checks);
        case 'note': return r.note || '';
        case 'updated_at': return now;
        case 'updated_by': return adminEmail || 'system';
        default: return '';
      }
    });
  });

  // Issue #76: commit สี่เหลี่ยมเดียวแบบตรวจ read-back — เขียนแถวของปีอื่นที่เก็บไว้
  // รวมกับแถว seed ในครั้งเดียว (ยังจัด '@' ให้คอลัมน์ hdc_code ทั้งคอลัมน์เช่นเดิม)
  const commit = commitRulesRectangle_(sheet, headers, [...keptRows, ...rows], data.length - 1);
  if (!commit.verified) {
    logAction('SYSTEM', adminEmail || 'system', 'seed_vaccine_rules',
      `Commit ${commit.commitState} for fiscal_year=${fiscalYear} — no success claimed`);
    return {
      success: false, status: commit.commitState,
      error: commit.commitState === 'commit_failure'
        ? 'vaccine_rules seed commit failed before any value write.'
        : 'vaccine_rules seed commit could not be verified; the sheet may be partially applied — inspect before retrying.'
    };
  }

  logAction('SYSTEM', adminEmail || 'system', 'seed_vaccine_rules',
    `Seeded ${rows.length} vaccine rules for fiscal_year=${fiscalYear}`);

  return { success: true, seeded: rows.length, fiscalYear };
}

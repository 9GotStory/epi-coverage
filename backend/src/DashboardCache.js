/**
 * ──────────────────────────────────────────────
 * Dashboard Cache System (PDPA Compliance)
 * ──────────────────────────────────────────────
 * Stores pre-calculated aggregated summaries of EPI data.
 * This ensures that the public dashboard does not need to download raw PII data.
 */

const DASHBOARD_SUMMARY_SHEET = 'Dashboard_Summaries';

/**
 * Ensures the summary sheet exists and has headers.
 */
function ensureSummarySheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(DASHBOARD_SUMMARY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DASHBOARD_SUMMARY_SHEET);
    sheet.getRange(1, 1, 1, 5).setValues([
      ['id', 'targetTable', 'fiscalYear', 'summaryData', 'updated_at']
    ]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Saves a calculated dashboard summary JSON to the database.
 * @param {string} targetTable - The target table name (e.g. 'Epi_1_Year')
 * @param {number|string} fiscalYear - The fiscal year
 * @param {number|string} quarter - The quarter (1, 2, 3, 4, or 'all')
 * @param {string} summaryData - JSON string of the pre-calculated summary
 */
function saveDashboardSummary(targetTable, fiscalYear, quarter, summaryData) {
  try {
    const sheet = ensureSummarySheet();
    const q = quarter || 'all';
    const id = `${targetTable}_${fiscalYear}_${q}`;
    const updatedAt = new Date();

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    // Search for existing entry
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === id) {
        rowIndex = i + 1; // 1-indexed for getRange
        break;
      }
    }

    if (rowIndex !== -1) {
      // Update existing
      sheet.getRange(rowIndex, 4, 1, 2).setValues([[summaryData, updatedAt]]);
    } else {
      // Insert new
      sheet.appendRow([id, targetTable, fiscalYear, summaryData, updatedAt]);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * Classify a summary row id as an annual candidate for its own (targetTable, fiscalYear).
 * Returns 'canonical' for `<Table>_<FY>_all`, 'legacy' for `<Table>_<FY>`, or null
 * for anything else (quarter rows Q1–Q4 are not annual candidates).
 */
function classifyAnnualRowId_(rowId, rowTargetTable, rowFiscalYear) {
  const id = String(rowId);
  const table = String(rowTargetTable);
  const fiscalYear = String(rowFiscalYear);
  if (id === `${table}_${fiscalYear}_all`) return 'canonical';
  if (id === `${table}_${fiscalYear}`) return 'legacy';
  return null;
}

/**
 * Canonical annual selection (Issue #22) — ONE backend-owned rule:
 * per (targetTable, fiscalYear) the canonical `_all` row wins and the legacy row is
 * selected only when `_all` is absent. Row identity decides BEFORE any parsing, so an
 * unusable `_all` row never silently falls back to a parseable legacy row.
 * @param {Array[]} data - Raw Dashboard_Summaries values including the header row
 * @param {Set<string>|null} fiscalYearsFilter - Allowed fiscal-year strings, or null for all
 * @returns {Map<string, Array>} key `<targetTable>|<fiscalYear>` → selected row
 */
function selectAnnualRows_(data, fiscalYearsFilter) {
  const selected = new Map();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowFiscalYear = String(row[2]);
    if (fiscalYearsFilter && !fiscalYearsFilter.has(rowFiscalYear)) continue;
    const kind = classifyAnnualRowId_(row[0], row[1], row[2]);
    if (!kind) continue;
    const key = `${String(row[1])}|${rowFiscalYear}`;
    const existing = selected.get(key);
    if (kind === 'canonical' || !existing) selected.set(key, row);
  }
  return selected;
}

/** Convert a selected row into the public summary entry; null when summaryData is invalid JSON. */
function toSummaryEntry_(row) {
  try {
    return {
      id: row[0],
      targetTable: row[1],
      fiscalYear: row[2],
      summaryData: JSON.parse(row[3]),
      updated_at: row[4]
    };
  } catch (e) {
    return null; // Ignore invalid JSON strings
  }
}

/** Required base Comparison fields must be present as real numbers — 0 is a valid value. */
function isUsableAnnualSummaryData_(summaryData) {
  if (!summaryData || typeof summaryData !== 'object' || Array.isArray(summaryData)) return false;
  return ['total', 'view2Coverage', 'view2Passed'].every(function (field) {
    const value = summaryData[field];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/**
 * Gets all dashboard summaries for a given fiscal year and quarter.
 * @param {number|string} fiscalYear - The fiscal year to filter by
 * @param {number|string} quarter - The quarter to filter by
 */
function getDashboardSummaries(fiscalYear, quarter) {
  try {
    const sheet = ensureSummarySheet();
    const data = sheet.getDataRange().getValues();
    const q = quarter || 'all';
    const summaries = [];

    if (q === 'all') {
      // Issue #22: backend resolves canonical annual precedence (_all > legacy) —
      // never return both as competing annual candidates.
      const selected = selectAnnualRows_(data, new Set([String(fiscalYear)]));
      for (const row of selected.values()) {
        const entry = toSummaryEntry_(row);
        if (entry) summaries.push(entry);
      }
    } else {
      // Quarter reads keep their existing semantics (suffix match, no legacy fallback).
      const expectedIdSuffix = `_${fiscalYear}_${q}`;
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (String(row[2]) !== String(fiscalYear)) continue;
        if (!String(row[0]).endsWith(expectedIdSuffix)) continue;
        const entry = toSummaryEntry_(row);
        if (entry) summaries.push(entry);
      }
    }

    return { success: true, summaries };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * ดึงข้อมูลสรุปหลายปีพร้อมกัน (สำหรับหน้าเปรียบเทียบปีงบประมาณ)
 * @param {number[]|string} fiscalYears - Array ของปีที่ต้องการ เช่น [2566, 2567, 2568]
 */
function getDashboardSummariesMultiYear(fiscalYears) {
  try {
    // รองรับทั้ง Array และ string ที่คั่นด้วย comma
    let years = fiscalYears;
    if (typeof fiscalYears === 'string') {
      years = fiscalYears.split(',').map(y => y.trim());
    }
    if (!Array.isArray(years) || years.length === 0) {
      return { success: false, error: 'fiscalYears must be a non-empty array' };
    }

    const yearsStr = years.map(String);
    const sheet = ensureSummarySheet();
    const data = sheet.getDataRange().getValues();

    // Issue #22: backend resolves canonical annual precedence (_all > legacy) —
    // at most one annual candidate per (targetTable, fiscalYear).
    const selected = selectAnnualRows_(data, new Set(yearsStr));
    const summaries = [];
    for (const row of selected.values()) {
      const entry = toSummaryEntry_(row);
      if (entry) summaries.push(entry);
    }

    return { success: true, summaries };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * ดึงปีงบประมาณที่มีสรุปประจำปี "ใช้งานได้" แยกตามตารางเป้าหมาย (Issue #22)
 * ใช้เฉพาะข้อมูลรวม (aggregate) จาก Dashboard_Summaries — ไม่มีข้อมูลรายบุคคล
 *
 * "ใช้งานได้" = แถวสรุปประจำปีที่ถูกเลือกตามลำดับความสำคัญ (`_all` ก่อน legacy)
 * และ summaryData แยกวิเคราะห์เป็น JSON ที่มี total / view2Coverage / view2Passed
 * เป็นตัวเลขจริง (0 ถือว่าใช้งานได้) — ไม่เติมค่า 0 แทนค่าที่หายไป
 *
 * @returns {{ success: boolean, tables?: Object<string, number[]>, error?: string }}
 *   เช่น { success: true, tables: { Epi_1_Year: [2567, 2568], Epi_2_Year: [2568] } }
 *   ปีที่ไม่มีแถวสรุปประจำปีใช้งานได้จะไม่ถูกแจ้งว่ามีข้อมูล
 */
function getDashboardSummaryYears() {
  try {
    const sheet = ensureSummarySheet();
    const data = sheet.getDataRange().getValues();

    const selected = selectAnnualRows_(data, null);
    const tables = {};
    for (const row of selected.values()) {
      let summaryData;
      try {
        summaryData = JSON.parse(row[3]);
      } catch (e) {
        continue; // invalid JSON is not usable
      }
      if (!isUsableAnnualSummaryData_(summaryData)) continue;

      const fiscalYear = Number(row[2]);
      if (!Number.isFinite(fiscalYear) || fiscalYear <= 0) continue;

      const table = String(row[1]);
      if (!Array.isArray(tables[table])) tables[table] = [];
      tables[table].push(fiscalYear);
    }
    for (const table of Object.keys(tables)) {
      tables[table] = tables[table].sort((a, b) => a - b);
    }

    return { success: true, tables };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

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
 * Gets all dashboard summaries for a given fiscal year and quarter.
 * @param {number|string} fiscalYear - The fiscal year to filter by
 * @param {number|string} quarter - The quarter to filter by
 */
function getDashboardSummaries(fiscalYear, quarter) {
  try {
    const sheet = ensureSummarySheet();
    const data = sheet.getDataRange().getValues();
    const summaries = [];

    // Skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowId = row[0];
      const rowTargetTable = row[1];
      const rowFiscalYear = row[2];
      const rowSummaryData = row[3];
      const rowUpdatedAt = row[4];

      // Convert fiscalYear to string for safe comparison
      const q = quarter || 'all';
      const expectedIdSuffix = `_${fiscalYear}_${q}`;
      const legacyId = `${rowTargetTable}_${fiscalYear}`;
      
      // If rowId ends with the expected suffix (e.g., _2567_all) OR it's a legacy ID without a quarter
      const isMatch = rowId.endsWith(expectedIdSuffix) || (q === 'all' && rowId === legacyId);

      if (rowFiscalYear.toString() === fiscalYear.toString() && isMatch) {
        try {
          summaries.push({
            id: rowId,
            targetTable: rowTargetTable,
            fiscalYear: rowFiscalYear,
            summaryData: JSON.parse(rowSummaryData),
            updated_at: rowUpdatedAt
          });
        } catch (e) {
          // Ignore invalid JSON strings
        }
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
    const summaries = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowId = row[0];
      const rowFiscalYear = String(row[2]);

      if (yearsStr.includes(rowFiscalYear)) {
        // Only include the yearly summary (quarter = 'all') or legacy summaries without quarter suffix
        if (rowId.endsWith(`_${rowFiscalYear}_all`) || rowId.endsWith(`_${rowFiscalYear}`)) {
          try {
            summaries.push({
              id: rowId,
              targetTable: row[1],
              fiscalYear: row[2],
              summaryData: JSON.parse(row[3]),
              updated_at: row[4]
            });
          } catch (e) {
            // Ignore invalid JSON
          }
        }
      }
    }

    return { success: true, summaries };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

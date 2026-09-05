/**
 * Upsert EPI 1 Year Data
 * Process a chunk of data (usually 500 rows) using a Dictionary Map for O(1) lookups
 * and batch updates for high performance.
 */
function upsertEpiData(chunk, batchId, adminEmail, fiscalYear, targetTable = 'Epi_1_Year') {
  const ss = getSpreadsheet();
  // ใช้ Sheet หลักตามที่ตกลงกันไว้ ไม่แยก Sheet ตามปี
  const sheetName = targetTable;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    // สร้าง Sheet ใหม่อัตโนมัติพร้อม Headers ที่ถูกต้อง
    const schemas = getEpiSchemas();
    if (!schemas[sheetName]) {
      return { success: false, error: `Unknown target table: ${sheetName}` };
    }
    sheet = setupSheetWithHeaders(ss, sheetName, schemas[sheetName], true);
  }
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // Auto-migrate schema (Append missing columns to legacy sheets)
  const schemas = getEpiSchemas();
  const expectedHeaders = schemas[sheetName];
  if (expectedHeaders) {
    const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      const newHeaders = [...headers, ...missingHeaders];
      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
      sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold').setBackground('#f3f3f3');
      headers = newHeaders;
    }
  }

  // Find indices for composite key
  const iHoscode = headers.indexOf('hoscode');
  const iPid = headers.indexOf('pid');
  const iCid = headers.indexOf('cid');
  const iSex = headers.indexOf('sex');
  const iBirth = headers.indexOf('birth');
  const iCheckVhid = headers.indexOf('check_vhid');
  
  if (iHoscode === -1 || iPid === -1 || iCid === -1 || iSex === -1 || iBirth === -1 || iCheckVhid === -1) {
    return { success: false, error: "Missing required columns in database schema for composite key." };
  }

  // Get all existing data
  const existingData = sheet.getDataRange().getValues();
  // Map key -> row index (0-indexed relative to existingData array)
  const existingMap = new Map();
  for (let i = 1; i < existingData.length; i++) {
    const row = existingData[i];
    // Create composite key. Ensure they are treated as strings.
    const key = `${row[iHoscode]}_${row[iPid]}_${row[iCid]}_${row[iSex]}_${row[iBirth]}_${row[iCheckVhid]}`;
    existingMap.set(key, i);
  }

  // Prepare data for Batch Write
  const rowsToInsert = [];
  const rowsToUpdate = [];

  chunk.forEach(record => {
    // Convert record to array matching header order
    const rowData = headers.map(header => {
      if (header === 'batch_id') return batchId;
      if (header === 'fiscal_year') return fiscalYear;
      if (header === 'last_seen_batch') return batchId;
      if (header === 'is_active') return true;
      return record[header] !== undefined ? record[header] : "";
    });

    const key = `${record['hoscode']}_${record['pid']}_${record['cid']}_${record['sex']}_${record['birth']}_${record['check_vhid']}`;
    
    if (existingMap.has(key)) {
      // Update existing row
      const rowIndex = existingMap.get(key);
      rowsToUpdate.push({ rowIdx: rowIndex, newRowData: rowData });
    } else {
      // Insert new row
      rowsToInsert.push(rowData);
    }
  });
  
  if (rowsToUpdate.length > 0) {
    rowsToUpdate.forEach(update => {
      existingData[update.rowIdx] = update.newRowData;
    });

    const updateRange = sheet.getRange(1, 1, existingData.length, headers.length);
    headers.forEach((h, idx) => {
      if (h.includes('hosc') || h.includes('hosp') || h === 'cid' || h.includes('hdc_code') || h === 'config_value') {
        sheet.getRange(1, idx + 1, existingData.length, 1).setNumberFormat('@');
      }
    });
    updateRange.setValues(existingData);
  }

  // Apply inserts
  if (rowsToInsert.length > 0) {
    const startRow = existingData.length + 1;
    const totalReqRows = startRow + rowsToInsert.length - 1;
    
    // ป้องกัน Out of Bounds ถ้าข้อมูลที่อัปโหลดเยอะกว่าจำนวนบรรทัดที่เหลืออยู่
    if (sheet.getMaxRows() < totalReqRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), totalReqRows - sheet.getMaxRows());
    }

    const insertRange = sheet.getRange(startRow, 1, rowsToInsert.length, headers.length);
    headers.forEach((h, idx) => {
      if (h.includes('hosc') || h.includes('hosp') || h === 'cid' || h.includes('hdc_code') || h === 'config_value') {
        sheet.getRange(startRow, idx + 1, rowsToInsert.length, 1).setNumberFormat('@');
      }
    });
    insertRange.setValues(rowsToInsert);
  }

  return { 
    success: true, 
    batch_id: batchId, 
    inserted: rowsToInsert.length, 
    updated: rowsToUpdate.length 
  };
}

/**
 * Cleanup EPI Data
 * Performs soft delete on records not seen in the latest batch, but scoped to the touched hoscodes.
 */
function cleanupEpiData(batchId, touchedHoscodes, adminEmail, fiscalYear, targetTable = 'Epi_1_Year') {
  if (!touchedHoscodes || touchedHoscodes.length === 0) {
    return { success: false, error: 'No touched hoscodes provided.' };
  }

  const ss = getSpreadsheet();
  // ใช้ Sheet หลักตามที่ตกลงกันไว้ ไม่แยก Sheet ตามปี
  const sheetName = targetTable;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: `Sheet not found: ${sheetName}` };
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const iHoscode = headers.indexOf('hoscode');
  const iLastSeenBatch = headers.indexOf('last_seen_batch');
  const iIsActive = headers.indexOf('is_active');
  const iFiscalYear = headers.indexOf('fiscal_year');
  
  if (iHoscode === -1 || iLastSeenBatch === -1 || iIsActive === -1) {
    return { success: false, error: "Missing required columns for cleanup." };
  }

  const existingData = sheet.getDataRange().getValues();
  let deactivatedCount = 0;
  let hasChanges = false;

  for (let i = 1; i < existingData.length; i++) {
    const row = existingData[i];
    const hoscode = String(row[iHoscode]);
    const lastSeen = row[iLastSeenBatch];
    const isActive = row[iIsActive];
    const rowFiscalYear = iFiscalYear !== -1 ? String(row[iFiscalYear]) : null;

    if (touchedHoscodes.includes(hoscode)) {
      // Only cleanup records that belong to the SAME fiscalYear scope.
      // If a record has NO fiscal_year (old data), or it matches the current upload's fiscalYear, we clean it up.
      // This protects data from other fiscal years.
      const isSameScope = (!rowFiscalYear || rowFiscalYear === String(fiscalYear));

      if (isSameScope && lastSeen !== batchId && (isActive === true || isActive === 'TRUE' || isActive === 'true')) {
        existingData[i][iIsActive] = false;
        deactivatedCount++;
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    sheet.getRange(1, 1, existingData.length, headers.length).setValues(existingData);
  }

  logAction('SYSTEM', adminEmail || 'Admin', 'cleanup_epi_data', `Deactivated ${deactivatedCount} records for batch ${batchId}. Touched hoscodes: ${touchedHoscodes.join(', ')}`);

  return { success: true, deactivated: deactivatedCount };
}

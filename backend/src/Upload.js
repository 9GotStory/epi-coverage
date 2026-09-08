/** HDC imports: PID within facility/year (CID fallback only when unmasked); missing fields preserve existing values. */
function epiImportKey(record, fiscalYear) {
  const identity = record.pid ? ['pid', String(record.pid)] : ['cid', String(record.cid || '')];
  return JSON.stringify([String(fiscalYear || ''), String(record.hoscode || ''), ...identity]);
}

function epiSourceColumns(value) {
  try { const columns = JSON.parse(value || '[]'); return Array.isArray(columns) ? columns : []; }
  catch (_) { return []; }
}

function withEpiImportLock(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return work(); }
  finally { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
}

function epiBatchSheet(ss) {
  return setupSheetWithHeaders(ss, 'epi_import_batches', [
    'batch_id', 'target_table', 'fiscal_year', 'mode', 'total_chunks',
    'completed_chunks', 'hoscodes', 'status', 'updated_at'
  ]);
}

function writeEpiRows(sheet, headers, rows) {
  if (sheet.getMaxRows() < rows.length) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows());
  headers.forEach((field, index) => {
    if (field.includes('hosp') || field === 'hoscode' || ['cid', 'pid', 'addr', 'check_vhid', 'check_typearea', 'nation', 'discharge'].includes(field)) {
      sheet.getRange(1, index + 1, rows.length, 1).setNumberFormat('@');
    }
  });
  // Prevent imported text being executed as a Sheet formula, including free-text addresses.
  const safeRows = rows.map(row => row.map(value => typeof value === 'string' && value.startsWith('=') ? "'" + value : value));
  sheet.getRange(1, 1, rows.length, headers.length).setValues(safeRows);
}

function upsertEpiData(chunk, batchId, adminEmail, fiscalYear, targetTable = 'Epi_1_Year', options = {}) {
  const schema = getEpiSchemas()[targetTable];
  const mode = options.mode || 'merge';
  const total = Number(options.totalChunks || 1);
  const index = Number(options.chunkIndex || 0);
  if (!schema || !/^\d{4}$/.test(String(fiscalYear)) || !/^[\w-]{1,100}$/.test(batchId || '') ||
      !['merge', 'sync'].includes(mode) || !Number.isInteger(total) || total < 1 ||
      !Number.isInteger(index) || index < 0 || index >= total || !Array.isArray(chunk) || chunk.length < 1 || chunk.length > 500) {
    return { success: false, error: 'Invalid import scope or chunk.' };
  }
  const systemFields = ['batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at', 'source_columns'];
  for (const record of chunk) {
    if (!record || typeof record !== 'object' || !/^\d{5}$/.test(record.hoscode) || !/^[\d*]{13}$/.test(record.cid) ||
        typeof record.hoscode !== 'string' || typeof record.cid !== 'string' || (record.cid.includes('*') && !record.pid) || (record.pid != null && record.pid !== '' && (typeof record.pid !== 'string' || !/^\d+$/.test(record.pid))) || !/^\d{4}-\d{2}-\d{2}$/.test(record.birth || '') ||
        !record.name || !record.lname) return { success: false, error: 'Invalid HDC record.' };
    for (const field of Object.keys(record)) {
      if (!schema.includes(field) || systemFields.includes(field)) return { success: false, error: 'Unsupported source column: ' + field };
      const value = record[field];
      if ((field === 'birth' || field.endsWith('_date')) && value !== null && value !== '') {
        const parsed = new Date(String(value) + 'T00:00:00Z');
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return { success: false, error: 'Invalid date: ' + field };
      }
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return { success: false, error: 'Invalid value: ' + field };
      if ((field.endsWith('_hospcode') || field.endsWith('_input_hosp')) && value !== null && value !== '' &&
          (typeof value !== 'string' || !/^[A-Za-z0-9]{5}$/.test(value))) return { success: false, error: 'Invalid facility code: ' + field };
    }
  }
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const batches = epiBatchSheet(ss);
    const receipts = batches.getDataRange().getValues();
    let receiptIndex = receipts.findIndex((row, i) => i > 0 && row[0] === batchId);
    let receipt = receiptIndex > 0 ? receipts[receiptIndex] : [batchId, targetTable, String(fiscalYear), mode, total, '[]', '[]', 'uploading', ''];
    if (receipt[1] !== targetTable || String(receipt[2]) !== String(fiscalYear) || receipt[3] !== mode || Number(receipt[4]) !== total) {
      return { success: false, error: 'Batch scope mismatch.' };
    }
    const completed = JSON.parse(receipt[5]);
    const fingerprint = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(chunk)));
    const replay = completed.find(item => item.index === index);
    if (replay) return replay.fingerprint === fingerprint
      ? { success: true, inserted: 0, updated: 0, replayed: true, batch_id: batchId }
      : { success: false, error: 'Chunk contents differ from the original submission.' };
    if (receipt[7] !== 'uploading') return { success: false, error: 'Batch is already finalized.' };
    const facilities = [...new Set([...JSON.parse(receipt[6]), ...chunk.map(record => record.hoscode)])];
    if (receiptIndex > 0 && receipts.slice(receiptIndex + 1).some(row => row[1] === targetTable &&
        String(row[2]) === String(fiscalYear) && JSON.parse(row[6]).some(code => facilities.includes(code)))) {
      return { success: false, error: 'A newer import overlaps this batch. Start a new import.' };
    }
    // Reserve receipt before data writes; a failed chunk remains incomplete and can be retried.
    receipt[6] = JSON.stringify(facilities);
    receipt[8] = new Date().toISOString();
    if (receiptIndex < 1) { receiptIndex = receipts.length; receipts.push(receipt); }
    else receipts[receiptIndex] = receipt;
    writeEpiRows(batches, receipts[0], receipts);
    const sheet = setupSheetWithHeaders(ss, targetTable, schema);
    syncAllSchemasToExistingSheets(ss, { [targetTable]: schema });
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const objects = rows.slice(1).map(row => arrayToObj(headers, row));
    const lookup = new Map();
    const cidLookup = new Map();
    const duplicateCids = new Set();
    objects.forEach((record, i) => {
      const key = epiImportKey(record, record.fiscal_year);
      if (lookup.has(key)) throw new Error('Duplicate identity in existing sheet. Review duplicates before importing.');
      lookup.set(key, i + 1);
      if (/^\d{13}$/.test(String(record.cid))) {
        const cidKey = JSON.stringify([String(record.fiscal_year), String(record.hoscode), String(record.cid)]);
        if (cidLookup.has(cidKey)) duplicateCids.add(cidKey);
        cidLookup.set(cidKey, i + 1);
      }
    });
    let inserted = 0, updated = 0;
    chunk.forEach(record => {
      const key = epiImportKey(record, fiscalYear);
      let rowIndex = lookup.get(key);
      const cidKey = JSON.stringify([String(fiscalYear), record.hoscode, record.cid]);
      if (rowIndex === undefined && /^\d{13}$/.test(record.cid) && !duplicateCids.has(cidKey)) rowIndex = cidLookup.get(cidKey);
      const previous = rowIndex === undefined ? {} : arrayToObj(headers, rows[rowIndex]);
      if (/^\d{13}$/.test(String(previous.cid)) && /^\d{13}$/.test(record.cid) && String(previous.cid) !== record.cid) {
        throw new Error('PID matches a different unmasked CID. Review identity before importing.');
      }
      const known = epiSourceColumns(previous.source_columns);
      // Legacy nonempty values are evidence; an empty legacy column is not.
      const evidenced = Object.keys(previous).filter(field => !systemFields.includes(field) && previous[field] !== '' && previous[field] != null);
      const merged = { ...previous, ...record, batch_id: batchId, fiscal_year: String(fiscalYear),
        last_seen_batch: batchId, is_active: true,
        source_columns: JSON.stringify([...new Set([...known, ...evidenced, ...Object.keys(record)])]) };
      const values = headers.map(field => merged[field] == null ? '' : merged[field]);
      if (rowIndex === undefined) { lookup.set(key, rows.length); rows.push(values); inserted++; }
      else { rows[rowIndex] = values; lookup.set(key, rowIndex); updated++; }
      if (/^\d{13}$/.test(record.cid)) cidLookup.set(cidKey, lookup.get(key));
    });
    writeEpiRows(sheet, headers, rows);
    completed.push({ index, fingerprint });
    receipt[5] = JSON.stringify(completed);
    receipt[6] = JSON.stringify([...new Set([...JSON.parse(receipt[6]), ...chunk.map(record => record.hoscode)])]);
    receipt[8] = new Date().toISOString();
    if (receiptIndex < 1) { receiptIndex = receipts.length; receipts.push(receipt); }
    else receipts[receiptIndex] = receipt;
    writeEpiRows(batches, receipts[0], receipts);
    return { success: true, batch_id: batchId, inserted, updated };
  });
}

/** Finalize only a complete batch; merge imports never deactivate absent people. */
function cleanupEpiData(batchId, touchedHoscodes, adminEmail, fiscalYear, targetTable = 'Epi_1_Year') {
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const batches = epiBatchSheet(ss);
    const receipts = batches.getDataRange().getValues();
    const receiptIndex = receipts.findIndex((row, i) => i > 0 && row[0] === batchId);
    if (receiptIndex < 1) return { success: false, error: 'Import batch not found.' };
    const receipt = receipts[receiptIndex];
    if (receipt[1] !== targetTable || String(receipt[2]) !== String(fiscalYear)) return { success: false, error: 'Batch scope mismatch.' };
    if (receipt[7] === 'complete') return { success: true, deactivated: 0, replayed: true };
    if (JSON.parse(receipt[5]).length !== Number(receipt[4])) return { success: false, error: 'Cannot finalize an incomplete batch.' };
    const facilities = JSON.parse(receipt[6]); // Scope comes from validated records, never caller input.
    if (receipt[3] === 'sync' && receipts.slice(receiptIndex + 1).some(row => row[1] === targetTable &&
        String(row[2]) === String(fiscalYear) && JSON.parse(row[6]).some(code => facilities.includes(code)))) {
      return { success: false, error: 'A newer import overlaps this batch. Import a fresh full file before syncing.' };
    }
    let deactivated = 0;
    if (receipt[3] === 'sync') {
      const sheet = ss.getSheetByName(targetTable);
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0];
      const activeIndex = headers.indexOf('is_active');
      rows.slice(1).forEach(row => {
        const record = arrayToObj(headers, row);
        if (String(record.fiscal_year) === String(fiscalYear) && facilities.includes(String(record.hoscode)) &&
            record.last_seen_batch !== batchId && String(record.is_active).toLowerCase() === 'true') {
          row[activeIndex] = false; deactivated++;
        }
      });
      if (deactivated) writeEpiRows(sheet, headers, rows);
    }
    receipt[7] = 'complete'; receipt[8] = new Date().toISOString();
    writeEpiRows(batches, receipts[0], receipts);
    logAction('SYSTEM', adminEmail || 'Admin', 'cleanup_epi_data', `Batch ${batchId}: ${deactivated} deactivated (${receipt[3]}).`);
    return { success: true, deactivated };
  });
}

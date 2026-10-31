/** Match the full identity; a CID must never bypass PID/sex/birth/village differences. */
function epiImportKey(record, fiscalYear, timeZone = 'UTC') {
  const text = value => String(value == null ? '' : value).trim();
  const identity = text(record.pid) ? ['pid', text(record.pid)] : ['cid', text(record.cid)];
  // Sheet Date cells represent a calendar date in the spreadsheet's timezone.
  const birth = Object.prototype.toString.call(record.birth) === '[object Date]'
    ? Utilities.formatDate(record.birth, timeZone, 'yyyy-MM-dd')
    : text(record.birth).slice(0, 10);
  return JSON.stringify([text(fiscalYear), text(record.hoscode), ...identity,
    text(record.sex), birth, text(record.check_vhid)]);
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

/** Ensure exactly one logical upload_excel audit event exists for (batchId, chunkIndex); repair reconstructs from ORIGINAL receipt metadata only. */
function ensureUploadAudit(batchId, index, meta) {
  if (!meta || (meta.userId == null && meta.email == null)) return; // legacy receipts carry nothing truthful to reconstruct from
  const marker = `Batch ${batchId} chunk ${index + 1}/`;
  const sheet = getSpreadsheet().getSheetByName('audit_logs');
  if (sheet) {
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][3] === 'upload_excel' && String(rows[i][4]).includes(marker)) return; // event already exists (incl. ambiguous append failure)
    }
  }
  logAction(meta.userId, meta.email, 'upload_excel',
    `Batch ${batchId} chunk ${index + 1}/${meta.totalChunks} [${meta.targetTable} FY ${meta.fiscalYear} ${meta.mode}]: inserted ${meta.inserted}, updated ${meta.updated}`);
}

function writeEpiRows(sheet, headers, rows) {
  if (sheet.getMaxRows() < rows.length) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows());
  headers.forEach((field, index) => {
    if (field.includes('hosp') || field === 'hoscode' || ['cid', 'pid', 'addr', 'check_vhid', 'check_typearea', 'nation', 'discharge'].includes(field)) {
      sheet.getRange(1, index + 1, rows.length, 1).setNumberFormat('@');
    }
  });
  // Prevent imported text being executed as a Sheet formula (=, +, -, @ prefixes — Issue #77),
  // including free-text names and addresses. The escape apostrophe is consumed by Sheets,
  // so stored values read back exactly as imported.
  const safeRows = rows.map(row => row.map(sanitizeSheetText));
  sheet.getRange(1, 1, rows.length, headers.length).setValues(safeRows);
}

function upsertEpiData(chunk, batchId, auth, fiscalYear, targetTable = 'Epi_1_Year', options = {}) {
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
    const timeZone = ss.getSpreadsheetTimeZone();
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
    if (replay) {
      if (replay.fingerprint !== fingerprint) return { success: false, error: 'Chunk contents differ from the original submission.' };
      ensureUploadAudit(batchId, index, replay.audit); // repair a missing audit from ORIGINAL metadata; never duplicate an existing one
      return { success: true, inserted: 0, updated: 0, replayed: true, batch_id: batchId };
    }
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
    objects.forEach((record, i) => {
      const key = epiImportKey(record, record.fiscal_year, timeZone);
      if (lookup.has(key)) throw new Error('Duplicate identity in existing sheet. Review duplicates before importing.');
      lookup.set(key, i + 1);
    });
    let inserted = 0, updated = 0;
    chunk.forEach(record => {
      const key = epiImportKey(record, fiscalYear, timeZone);
      const rowIndex = lookup.get(key);
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
    });
    writeEpiRows(sheet, headers, rows);
    const auditMeta = { userId: auth && auth.userId, email: auth && auth.email, inserted, updated,
      targetTable, fiscalYear: String(fiscalYear), mode, chunkIndex: index, totalChunks: total };
    completed.push({ index, fingerprint, audit: auditMeta });
    receipt[5] = JSON.stringify(completed);
    receipt[6] = JSON.stringify([...new Set([...JSON.parse(receipt[6]), ...chunk.map(record => record.hoscode)])]);
    receipt[8] = new Date().toISOString();
    if (receiptIndex < 1) { receiptIndex = receipts.length; receipts.push(receipt); }
    else receipts[receiptIndex] = receipt;
    writeEpiRows(batches, receipts[0], receipts);
    ensureUploadAudit(batchId, index, auditMeta); // after the receipt is durable; a failure here surfaces instead of a false audited success
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
    // Issue #80: Router ส่งอีเมลจาก session ที่ตรวจสอบแล้วเสมอ — fallback 'unknown' แทน
    // ชื่อ 'Admin' แบบ generic เมื่อบัญชีไม่มีอีเมล
    logAction('SYSTEM', adminEmail || 'unknown', 'cleanup_epi_data', `Batch ${batchId}: ${deactivated} deactivated (${receipt[3]}).`);
    return { success: true, deactivated };
  });
}

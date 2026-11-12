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
  const columns = [
    'batch_id', 'target_table', 'fiscal_year', 'mode', 'total_chunks',
    'completed_chunks', 'hoscodes', 'status', 'updated_at', 'preflight'
  ];
  const sheet = setupSheetWithHeaders(ss, 'epi_import_batches', columns);
  // Receipts sheets created before Issue #111 gain 'preflight' once; later calls only read the header row.
  if (!sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].includes('preflight')) {
    syncAllSchemasToExistingSheets(ss, { epi_import_batches: columns });
  }
  return sheet;
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
    `Batch ${batchId} chunk ${index + 1}/${meta.totalChunks} [${meta.targetTable} FY ${meta.fiscalYear} ${meta.mode}]: inserted ${meta.inserted}, updated ${meta.updated}` +
    (meta.preflight ? `; ${meta.preflight}` : ''));
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

/** Issue #111: a sync shrinking the active cohort of the touched facilities by more than this needs a typed confirmation. */
const EPI_SYNC_SHRINK_THRESHOLD = 0.2;
/** Record Identity (CONTEXT.md §3): the only fields a preflight receives. */
const EPI_RECORD_IDENTITY_FIELDS = ['hoscode', 'pid', 'cid', 'sex', 'birth', 'check_vhid'];

function epiImportScopeValid(batchId, fiscalYear, targetTable, mode) {
  return !!getEpiSchemas()[targetTable] && /^\d{4}$/.test(String(fiscalYear)) && /^[\w-]{1,100}$/.test(batchId || '') && ['merge', 'sync'].includes(mode);
}

function epiIsCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Shape of the Record Identity fields, shared by preflight and import so the two can never drift. */
function epiRecordIdentityValid(record) {
  return !!record && typeof record === 'object' && typeof record.hoscode === 'string' && /^\d{5}$/.test(record.hoscode) &&
    typeof record.cid === 'string' && /^[\d*]{13}$/.test(record.cid) && !(record.cid.includes('*') && !record.pid) &&
    (record.pid == null || record.pid === '' || (typeof record.pid === 'string' && /^\d+$/.test(record.pid))) &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.birth || '');
}

/** Issue #136: the Age Group (in years) an EPI table reports on, e.g. 'Epi_2_Year' → 2. */
function epiTableAge(targetTable) {
  return Number(/^Epi_(\d)_Year$/.exec(targetTable)[1]);
}

/**
 * Issue #136: the Cohort Birth Range (CONTEXT.md §46) of an Age Group for a Fiscal Year (BE): 1 Oct to 30 Sep,
 * inclusive, shifted back by the age. CE `yyyy-MM-dd`, so a validated birth compares as a string.
 */
function epiCohortBirthRange(fiscalYear, age) {
  const endYear = Number(fiscalYear) - 543 - age;
  return { start: `${endYear - 1}-10-01`, end: `${endYear}-09-30` };
}

/** Issue #136: the Fiscal Year (BE) whose Cohort Birth Range for this age contains a `yyyy-MM-dd` birth. */
function epiCohortFiscalYear(birth, age) {
  return String(Number(birth.slice(0, 4)) + 543 + age + (Number(birth.slice(5, 7)) >= 10 ? 1 : 0));
}

/** Counts-only audit text (Issue #111 Q11, #136) — never identities. */
function epiPreflightAuditText(preflight) {
  const required = preflight.requiredConfirmations;
  const confirmation = required == null ? 'confirmation not required' : 'typed ' + [
    ...(required.existingChildren != null ? [`existing children ${required.existingChildren}`] : []),
    ...(required.outsideCohort != null ? [`outside cohort ${required.outsideCohort}`] : []),
  ].join(', ');
  const range = preflight.cohortBirthRange;
  const outside = `outside cohort birth range ${range.start}..${range.end}: ${preflight.outsideCohort}` +
    (preflight.outsideCohortFiscalYear ? ` (births match FY ${preflight.outsideCohortFiscalYear})` : '');
  return `preflight: matched ${preflight.matched}, new ${preflight.newRows}, would deactivate ${preflight.wouldDeactivate} of ${preflight.activeBefore} active; ` +
    `zero-match facilities [${preflight.risk.zeroMatchHoscodes.join(', ')}], shrink over threshold ${preflight.risk.shrinkOverThreshold}; ${outside}; ${confirmation}`;
}

function epiChunkKeyFingerprint(records, fiscalYear, timeZone) {
  const keys = records.map(record => epiImportKey(record, fiscalYear, timeZone));
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(keys)));
}

/** Other receipts whose progress would make this preflight's counts stale (same table/FY, overlapping facilities). */
function epiOverlapSnapshot(receipts, batchId, targetTable, fiscalYear, hoscodes) {
  return receipts.slice(1).filter(row => row[0] !== batchId && row[1] === targetTable && String(row[2]) === String(fiscalYear) &&
    JSON.parse(row[6] || '[]').some(code => hoscodes.includes(code))).map(row => `${row[0]}@${row[8]}`).sort();
}

/**
 * Issue #111: read-only preview of an import, recorded as a 'preflight' receipt before any EPI write.
 * keyChunks mirrors the upload chunks but carries identity-key fields only; the response holds counts
 * and facility codes, never identities.
 */
function preflightEpiImport(keyChunks, batchId, auth, fiscalYear, targetTable = 'Epi_1_Year', mode = 'merge') {
  if (!epiImportScopeValid(batchId, fiscalYear, targetTable, mode) || !Array.isArray(keyChunks) || keyChunks.length < 1 ||
      keyChunks.some(chunk => !Array.isArray(chunk) || chunk.length < 1 || chunk.length > 500)) {
    return { success: false, error: 'Invalid import scope or chunk.' };
  }
  for (const key of keyChunks.flat()) {
    if (!epiRecordIdentityValid(key) || Object.keys(key).some(field => !EPI_RECORD_IDENTITY_FIELDS.includes(field)) ||
        !epiIsCalendarDate(key.birth)) return { success: false, error: 'Invalid HDC record.' };
  }
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const timeZone = ss.getSpreadsheetTimeZone();
    const batches = epiBatchSheet(ss);
    const receipts = batches.getDataRange().getValues();
    if (receipts.some((row, i) => i > 0 && row[0] === batchId)) return { success: false, error: 'Batch already exists. Start a new import.' };

    const incoming = new Map(); // import key → Record Identity fields
    keyChunks.flat().forEach(key => incoming.set(epiImportKey(key, fiscalYear, timeZone), key));
    const hoscodes = [...new Set([...incoming.values()].map(key => key.hoscode))].sort();
    const facility = Object.fromEntries(hoscodes.map(code => [code, { hoscode: code, activeBefore: 0, matched: 0, newRows: 0, wouldDeactivate: 0, outsideCohort: 0 }]));
    const existing = new Set();
    const existingActive = new Set(); // only these count as "matching a current child" for the zero-match risk
    const sheet = ss.getSheetByName(targetTable); // never created here: preflight is read-only for EPI data
    if (sheet && sheet.getLastRow() > 1) {
      const rows = sheet.getDataRange().getValues();
      rows.slice(1).map(row => arrayToObj(rows[0], row)).forEach(record => {
        const key = epiImportKey(record, record.fiscal_year, timeZone);
        existing.add(key);
        const stats = facility[String(record.hoscode)];
        if (!stats || String(record.fiscal_year) !== String(fiscalYear) || String(record.is_active).toLowerCase() !== 'true') return;
        stats.activeBefore++;
        existingActive.add(key);
        if (mode === 'sync' && !incoming.has(key)) stats.wouldDeactivate++;
      });
    }
    const age = epiTableAge(targetTable);
    const cohortBirthRange = epiCohortBirthRange(fiscalYear, age);
    const outsideYears = new Set();
    const matchedActive = Object.fromEntries(hoscodes.map(code => [code, 0]));
    incoming.forEach((identity, key) => {
      const stats = facility[identity.hoscode];
      if (existing.has(key)) stats.matched++; else stats.newRows++;
      if (existingActive.has(key)) matchedActive[identity.hoscode]++;
      // Issue #136: a correct file has every child inside the selected Cohort Birth Range.
      if (identity.birth < cohortBirthRange.start || identity.birth > cohortBirthRange.end) {
        stats.outsideCohort++;
        outsideYears.add(epiCohortFiscalYear(identity.birth, age));
      }
    });

    const byHoscode = hoscodes.map(code => facility[code]);
    const sum = field => byHoscode.reduce((total, stats) => total + stats[field], 0);
    const counts = { matched: sum('matched'), newRows: sum('newRows'), wouldDeactivate: sum('wouldDeactivate'), activeBefore: sum('activeBefore'),
      outsideCohort: sum('outsideCohort') };
    const risk = {
      // A match against an already-deactivated row would silently reactivate it, so it is not a reassuring match.
      zeroMatchHoscodes: byHoscode.filter(stats => stats.activeBefore > 0 && matchedActive[stats.hoscode] === 0).map(stats => stats.hoscode),
      shrinkOverThreshold: mode === 'sync' && counts.activeBefore > 0 && counts.wouldDeactivate / counts.activeBefore > EPI_SYNC_SHRINK_THRESHOLD,
      outsideCohort: counts.outsideCohort > 0,
    };
    // Each risk condition has its own typed number, so one warning can never hide another (Issue #136).
    // Sync: children that would be deactivated. Merge: file rows that do not match a current child (new rows + reactivations).
    const notMatchingActive = incoming.size - Object.values(matchedActive).reduce((total, count) => total + count, 0);
    const required = {
      ...(risk.zeroMatchHoscodes.length > 0 || risk.shrinkOverThreshold ? { existingChildren: mode === 'sync' ? counts.wouldDeactivate : notMatchingActive } : {}),
      ...(risk.outsideCohort ? { outsideCohort: counts.outsideCohort } : {}),
    };
    const summary = { ...counts, byHoscode, risk, cohortBirthRange,
      outsideCohortFiscalYear: outsideYears.size === 1 ? [...outsideYears][0] : null,
      requiredConfirmations: Object.keys(required).length ? required : null, shrinkThreshold: EPI_SYNC_SHRINK_THRESHOLD };
    const record = { ...summary, hoscodes, preflightAt: new Date().toISOString(), preflightBy: auth && auth.email, confirmedAt: null,
      chunkKeyFingerprints: keyChunks.map(chunk => epiChunkKeyFingerprint(chunk, fiscalYear, timeZone)),
      overlapSnapshot: epiOverlapSnapshot(receipts, batchId, targetTable, fiscalYear, hoscodes) };
    // hoscodes stay '[]' until the first chunk is written, so an abandoned preflight never counts as an overlapping import.
    receipts.push([batchId, targetTable, String(fiscalYear), mode, keyChunks.length, '[]', '[]', 'preflight', record.preflightAt, JSON.stringify(record)]);
    writeEpiRows(batches, receipts[0], receipts);
    return { success: true, batchId, targetTable, fiscalYear: String(fiscalYear), mode, ...summary };
  });
}

/**
 * Issue #111/#136: the uploading admin types each number the preflight computed, keyed like `requiredConfirmations`;
 * only the server-side counts count. A single number (the pre-#136 format) is not a confirmation.
 */
function confirmEpiImport(batchId, typedNumbers, auth) {
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const batches = epiBatchSheet(ss);
    const receipts = batches.getDataRange().getValues();
    const receipt = receipts.find((row, i) => i > 0 && row[0] === batchId);
    if (!receipt || receipt[7] !== 'preflight' || !receipt[9]) return { success: false, error: 'No pending preflight for this batch.' };
    const preflight = JSON.parse(receipt[9]);
    const required = preflight.requiredConfirmations;
    if (required == null) return { success: true, required: false };
    if ((auth && auth.email) !== preflight.preflightBy) return { success: false, error: 'Only the admin who ran the preflight can confirm.' };
    const typed = typedNumbers && typeof typedNumbers === 'object' && !Array.isArray(typedNumbers) ? typedNumbers : {};
    if (Object.keys(required).some(name => String(typed[name] == null ? '' : typed[name]).trim() !== String(required[name]))) {
      return { success: false, error: 'Typed number does not match.' };
    }
    preflight.confirmedAt = new Date().toISOString();
    preflight.confirmedBy = auth && auth.email;
    receipt[9] = JSON.stringify(preflight);
    writeEpiRows(batches, receipts[0], receipts);
    logAction(auth && auth.userId, auth && auth.email, 'confirm_epi_import',
      `Batch ${batchId} [${receipt[1]} FY ${receipt[2]} ${receipt[3]}]: ${epiPreflightAuditText(preflight)}; facilities [${preflight.hoscodes.join(', ')}]`);
    return { success: true, required: true };
  });
}

function upsertEpiData(chunk, batchId, auth, fiscalYear, targetTable = 'Epi_1_Year', options = {}) {
  const schema = getEpiSchemas()[targetTable];
  const mode = options.mode || 'merge';
  const total = Number(options.totalChunks || 1);
  const index = Number(options.chunkIndex || 0);
  if (!epiImportScopeValid(batchId, fiscalYear, targetTable, mode) || !Number.isInteger(total) || total < 1 ||
      !Number.isInteger(index) || index < 0 || index >= total || !Array.isArray(chunk) || chunk.length < 1 || chunk.length > 500) {
    return { success: false, error: 'Invalid import scope or chunk.' };
  }
  const systemFields = ['batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at', 'source_columns'];
  for (const record of chunk) {
    if (!epiRecordIdentityValid(record) || !record.name || !record.lname) return { success: false, error: 'Invalid HDC record.' };
    for (const field of Object.keys(record)) {
      if (!schema.includes(field) || systemFields.includes(field)) return { success: false, error: 'Unsupported source column: ' + field };
      const value = record[field];
      if ((field === 'birth' || field.endsWith('_date')) && value !== null && value !== '' && !epiIsCalendarDate(value)) {
        return { success: false, error: 'Invalid date: ' + field };
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
    const receiptIndex = receipts.findIndex((row, i) => i > 0 && row[0] === batchId);
    if (receiptIndex < 1) return { success: false, error: 'Run the import preflight first.' }; // Issue #111: fail closed
    const receipt = receipts[receiptIndex];
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
    if (!['preflight', 'uploading'].includes(receipt[7])) return { success: false, error: 'Batch is already finalized.' };
    const preflight = receipt[9] ? JSON.parse(receipt[9]) : null;
    if (!preflight) return { success: false, error: 'Run the import preflight first.' };
    // Issue #136: the Cohort Birth Range check never ran on a pre-#136 receipt. Refuse only its first write, so an import already writing finishes.
    if (receipt[7] === 'preflight' && !preflight.cohortBirthRange) return { success: false, error: 'Preflight is out of date. Start a new import.' };
    if (preflight.requiredConfirmations != null && !preflight.confirmedAt) return { success: false, error: 'Typed confirmation required.' };
    if (epiChunkKeyFingerprint(chunk, fiscalYear, timeZone) !== preflight.chunkKeyFingerprints[index]) {
      return { success: false, error: 'Chunk does not match the preflighted file.' };
    }
    const facilities = [...new Set([...JSON.parse(receipt[6]), ...chunk.map(record => record.hoscode)])];
    if (receipts.slice(receiptIndex + 1).some(row => row[1] === targetTable &&
        String(row[2]) === String(fiscalYear) && JSON.parse(row[6]).some(code => facilities.includes(code)))) {
      return { success: false, error: 'A newer import overlaps this batch. Start a new import.' };
    }
    // Staleness matters only before the first write; once writing, later progress elsewhere must not strand this batch half-done.
    const firstWrite = receipt[7] === 'preflight';
    if (firstWrite && JSON.stringify(epiOverlapSnapshot(receipts, batchId, targetTable, fiscalYear, preflight.hoscodes)) !== JSON.stringify(preflight.overlapSnapshot)) {
      return { success: false, error: 'Data changed since preflight. Start a new import.' };
    }
    // Reserve receipt before data writes; a failed chunk remains incomplete and can be retried.
    receipt[6] = JSON.stringify(facilities);
    receipt[7] = 'uploading';
    receipt[8] = new Date().toISOString();
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
      targetTable, fiscalYear: String(fiscalYear), mode, chunkIndex: index, totalChunks: total,
      ...(firstWrite ? { preflight: epiPreflightAuditText(preflight) } : {}) };
    completed.push({ index, fingerprint, audit: auditMeta });
    receipt[5] = JSON.stringify(completed);
    receipt[6] = JSON.stringify([...new Set([...JSON.parse(receipt[6]), ...chunk.map(record => record.hoscode)])]);
    receipt[8] = new Date().toISOString();
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
    if (!receipt[9]) return { success: false, error: 'Run the import preflight first.' }; // Issue #111: legacy receipts cannot finalize
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

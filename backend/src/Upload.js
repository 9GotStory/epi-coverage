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
    'completed_chunks', 'hoscodes', 'status', 'updated_at', 'preflight', 'finalize', 'undo'
  ];
  const sheet = setupSheetWithHeaders(ss, 'epi_import_batches', columns);
  // Older receipts sheets gain 'preflight' (Issue #111) and 'finalize'/'undo' (Issue #139) once; later calls only read the header row.
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (columns.some(column => !header.includes(column))) {
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

/** Issue #140: while an Import Undo of a table and Fiscal Year is unfinished, no Import may write to it (ADR-0010). */
const EPI_UNFINISHED_UNDO_REFUSAL = { success: false, reason: 'unfinished_undo', error: 'An Import Undo of this table and fiscal year is unfinished. Finish it first.' };
function epiHasUnfinishedUndo(receipts, targetTable, fiscalYear) {
  return receipts.some((row, i) => i > 0 && row[1] === targetTable && String(row[2]) === String(fiscalYear) && row[7] === 'undoing');
}

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

/** Audit label of each risk condition's typed number (Issue #136), keyed like `requiredConfirmations`. */
const EPI_CONFIRMATION_AUDIT_LABEL = { existingChildren: 'existing children', outsideCohort: 'outside cohort' };

/** Counts-only audit text (Issue #111 Q11, #136) — never identities. */
function epiPreflightAuditText(preflight) {
  const required = preflight.requiredConfirmations;
  const confirmation = required == null ? 'confirmation not required'
    : 'typed ' + Object.entries(required).map(([name, count]) => `${EPI_CONFIRMATION_AUDIT_LABEL[name]} ${count}`).join(', ');
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
    if (epiHasUnfinishedUndo(receipts, targetTable, fiscalYear)) return EPI_UNFINISHED_UNDO_REFUSAL;

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
      outsideCohortBirthRange: counts.outsideCohort > 0,
    };
    // Each risk condition has its own typed number, so one warning can never hide another (Issue #136).
    // Sync: children that would be deactivated. Merge: file rows that do not match a current child (new rows + reactivations).
    const notMatchingActive = incoming.size - Object.values(matchedActive).reduce((total, count) => total + count, 0);
    const required = {
      ...(risk.zeroMatchHoscodes.length > 0 || risk.shrinkOverThreshold ? { existingChildren: mode === 'sync' ? counts.wouldDeactivate : notMatchingActive } : {}),
      ...(risk.outsideCohortBirthRange ? { outsideCohort: counts.outsideCohort } : {}),
    };
    const summary = { ...counts, byHoscode, risk, cohortBirthRange,
      outsideCohortFiscalYear: outsideYears.size === 1 ? [...outsideYears][0] : null,
      requiredConfirmations: Object.keys(required).length ? required : null, shrinkThreshold: EPI_SYNC_SHRINK_THRESHOLD };
    const record = { ...summary, hoscodes, preflightAt: new Date().toISOString(), preflightBy: auth && auth.email, confirmedAt: null,
      chunkKeyFingerprints: keyChunks.map(chunk => epiChunkKeyFingerprint(chunk, fiscalYear, timeZone)),
      overlapSnapshot: epiOverlapSnapshot(receipts, batchId, targetTable, fiscalYear, hoscodes) };
    // hoscodes stay '[]' until the first chunk is written, so an abandoned preflight never counts as an overlapping import.
    receipts.push([batchId, targetTable, String(fiscalYear), mode, keyChunks.length, '[]', '[]', 'preflight', record.preflightAt, JSON.stringify(record), '', '']);
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
    // Issue #136: the Cohort Birth Range check never ran on a pre-#136 receipt, so it cannot be confirmed either.
    if (!preflight.cohortBirthRange) return { success: false, error: 'Preflight is out of date. Start a new import.' };
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
  const systemFields = ['batch_id', 'fiscal_year', 'last_seen_batch', 'is_active', 'ai_analysis', 'ai_analyzed_at', 'source_columns', 'deactivated_by_batch'];
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
    // Issue #144 (ADR-0011): finalize a batch whose chunks are all written, reporting the result on top of this chunk's.
    const finalizeOnto = result => {
      const finalized = epiFinalizeBatch(ss, batches, receipts, receiptIndex, auth);
      return finalized.success ? { ...result, finalized: true, deactivated: finalized.deactivated } : finalized;
    };
    if (replay) {
      if (replay.fingerprint !== fingerprint) return { success: false, error: 'Chunk contents differ from the original submission.' };
      ensureUploadAudit(batchId, index, replay.audit); // repair a missing audit from ORIGINAL metadata; never duplicate an existing one
      const replayed = { success: true, inserted: 0, updated: 0, replayed: true, batch_id: batchId };
      if (receipt[7] === 'complete') {
        ensureFinalizeAudits(receipts, receiptIndex); // a replay: this batch's missing event is rebuilt too
        return { ...replayed, finalized: true, deactivated: epiRecordedDeactivations(receipt) };
      }
      // Every chunk is written but the finalize was cut off, so resending a chunk finishes it.
      if (receipt[7] === 'uploading' && completed.length === total) return finalizeOnto(replayed);
      return { ...replayed, finalized: false };
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
    if (firstWrite && epiHasUnfinishedUndo(receipts, targetTable, fiscalYear)) return EPI_UNFINISHED_UNDO_REFUSAL; // preflighted before the undo started
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
        last_seen_batch: batchId, is_active: true, deactivated_by_batch: '', // Issue #139: active again, so no batch deactivated it
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
    const written = { success: true, batch_id: batchId, inserted, updated };
    // The chunk that completes the batch finalizes it, so no client step sits between writing and finalizing.
    return completed.length === total ? finalizeOnto(written) : { ...written, finalized: false };
  });
}

/** Finalize only a complete batch; merge imports never deactivate absent people. */
function cleanupEpiData(batchId, touchedHoscodes, auth, fiscalYear, targetTable = 'Epi_1_Year') {
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const batches = epiBatchSheet(ss);
    const receipts = batches.getDataRange().getValues();
    const receiptIndex = receipts.findIndex((row, i) => i > 0 && row[0] === batchId);
    if (receiptIndex < 1) return { success: false, error: 'Import batch not found.' };
    const receipt = receipts[receiptIndex];
    if (receipt[1] !== targetTable || String(receipt[2]) !== String(fiscalYear)) return { success: false, error: 'Batch scope mismatch.' };
    // Issue #144 (ADR-0011): the last chunk already finalized it; this endpoint is a replay for the previous frontend.
    if (receipt[7] === 'complete') {
      ensureFinalizeAudits(receipts, receiptIndex); // a replay: this batch's missing event is rebuilt too
      return { success: true, deactivated: epiRecordedDeactivations(receipt), replayed: true };
    }
    return epiFinalizeBatch(ss, batches, receipts, receiptIndex, auth);
  });
}

/** Issue #144: the count the finalize recorded; a receipt finalized before Issue #139 has no marker. */
function epiRecordedDeactivations(receipt) {
  return receipt[10] ? Number(JSON.parse(receipt[10]).deactivated) || 0 : 0;
}

/**
 * Issue #144 (ADR-0011): finalize a batch whose chunks are all written, under the caller's import lock.
 * Repeatable: a finalize cut off after its row write is finished, and the count is every row this batch deactivated.
 */
function epiFinalizeBatch(ss, batches, receipts, receiptIndex, auth) {
  const receipt = receipts[receiptIndex];
  const [batchId, targetTable, fiscalYear, mode] = receipt;
  if (['undoing', 'undone'].includes(receipt[7])) return { success: false, error: 'This import was undone.' }; // Issue #139/#140: never finalize it again
  if (!receipt[9]) return { success: false, error: 'Run the import preflight first.' }; // Issue #111: legacy receipts cannot finalize
  if (JSON.parse(receipt[5]).length !== Number(receipt[4])) return { success: false, error: 'Cannot finalize an incomplete batch.' };
  const facilities = JSON.parse(receipt[6]); // Scope comes from validated records, never caller input.
  if (mode === 'sync' && receipts.slice(receiptIndex + 1).some(row => row[1] === targetTable &&
      String(row[2]) === String(fiscalYear) && JSON.parse(row[6]).some(code => facilities.includes(code)))) {
    return { success: false, error: 'A newer import overlaps this batch. Import a fresh full file before syncing.' };
  }
  let deactivated = 0;
  if (mode === 'sync') {
    syncAllSchemasToExistingSheets(ss, { [targetTable]: getEpiSchemas()[targetTable] }); // a batch written before Issue #139 lacks the column
    const sheet = ss.getSheetByName(targetTable);
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const activeIndex = headers.indexOf('is_active');
    const deactivatedByIndex = headers.indexOf('deactivated_by_batch');
    let changed = false;
    rows.slice(1).forEach(row => {
      const record = arrayToObj(headers, row);
      if (String(record.fiscal_year) !== String(fiscalYear) || !facilities.includes(String(record.hoscode))) return;
      if (record.last_seen_batch !== batchId && String(record.is_active).toLowerCase() === 'true') {
        row[activeIndex] = false; row[deactivatedByIndex] = batchId; changed = true;
      }
      if (row[deactivatedByIndex] === batchId) deactivated++;
    });
    if (changed) writeEpiRows(sheet, headers, rows);
  }
  receipt[7] = 'complete'; receipt[8] = new Date().toISOString();
  // Issue #139: the marker that this batch's deactivations are recorded row by row, which Import Undo requires.
  // Issue #146 (ADR-0012): the actor lets a lost cleanup_epi_data event be rebuilt with the admin who finalized.
  const actor = { userId: auth && auth.userId, email: auth && auth.email };
  receipt[10] = JSON.stringify({ at: receipt[8], deactivated, deactivationRecorded: true, actor });
  writeEpiRows(batches, receipts[0], receipts);
  ensureFinalizeAudits(receipts, receiptIndex, { finalizedNow: true });
  return { success: true, deactivated };
}

/**
 * Issue #146 (ADR-0012): exactly one cleanup_epi_data event per finalized batch. The current batch's event comes first and
 * its failure surfaces; then the lost event of every other complete receipt with a recorded actor is rebuilt, best-effort.
 * A legacy receipt has no actor and nothing truthful to rebuild from.
 */
function ensureFinalizeAudits(receipts, currentIndex, { finalizedNow = false } = {}) {
  const sheet = getSpreadsheet().getSheetByName('audit_logs');
  const audited = new Set((sheet ? sheet.getDataRange().getValues().slice(1) : [])
    .filter(row => row[3] === 'cleanup_epi_data').map(row => (/^Batch ([^:]+):/.exec(String(row[4])) || [])[1]));
  const ensure = (receipt, rebuilt) => {
    const finalize = receipt[10] ? JSON.parse(receipt[10]) : null;
    if (receipt[7] !== 'complete' || !finalize || !finalize.actor || audited.has(receipt[0])) return;
    // Issue #80: fallback 'unknown' แทนชื่อ 'Admin' แบบ generic เมื่อบัญชีไม่มีอีเมล
    const email = finalize.actor.email || 'unknown';
    const details = `Batch ${receipt[0]}: ${finalize.deactivated} deactivated (${receipt[3]}).`;
    // A rebuilt event keeps the Finalize time, so the As-of Date never moves past the latest real Finalize.
    if (rebuilt) logAction('SYSTEM', email, 'cleanup_epi_data', `${details} Recorded late at ${new Date().toISOString()}.`, finalize.at);
    else logAction('SYSTEM', email, 'cleanup_epi_data', details);
  };
  ensure(receipts[currentIndex], !finalizedNow);
  receipts.forEach((receipt, i) => {
    if (i < 1 || i === currentIndex) return;
    try { ensure(receipt, true); } catch (error) { /* left for the next sweep: another batch's event never fails this request */ }
  });
}

/** Issue #139: Thai-free reason codes; the client words them (ADR-0009). */
const EPI_UNDO_REFUSAL_ERROR = {
  no_batch: 'No import to undo for this table and fiscal year.',
  in_progress: 'The latest import is still uploading.',
  already_undone: 'The latest import was already undone.',
  not_recorded: 'The latest import was made before Import Undo existed.',
  updated_existing: 'The latest import updated existing records.',
  newer_import: 'A newer import has written to the same facilities.',
  stale: 'The undo preview is out of date. Review it again.',
  unfinished_mismatch: 'The records no longer match the unfinished undo.',
};

/** Row index of the latest receipt of (table, FY) that wrote data; a receipt still in 'preflight' has written nothing. */
function epiLatestWrittenReceipt(receipts, targetTable, fiscalYear) {
  for (let i = receipts.length - 1; i > 0; i--) {
    if (receipts[i][1] === targetTable && String(receipts[i][2]) === String(fiscalYear) && JSON.parse(receipts[i][6] || '[]').length > 0) return i;
  }
  return -1;
}

/** Issue #139: why a written receipt cannot be undone exactly, or null when it can (ADR-0009). */
function epiUndoRefusal(receipts, index) {
  const receipt = receipts[index];
  if (receipt[7] === 'uploading') return 'in_progress';
  if (receipt[7] === 'undone') return 'already_undone';
  if (receipt[7] === 'undoing') return null; // Issue #140: an Unfinished Import Undo passed every check when it started (ADR-0010)
  const finalize = receipt[10] ? JSON.parse(receipt[10]) : null;
  const chunks = JSON.parse(receipt[5] || '[]');
  if (receipt[7] !== 'complete' || !finalize || finalize.deactivationRecorded !== true ||
      chunks.some(chunk => !chunk.audit || typeof chunk.audit.updated !== 'number')) return 'not_recorded';
  if (chunks.some(chunk => chunk.audit.updated > 0)) return 'updated_existing';
  const hoscodes = JSON.parse(receipt[6]);
  if (receipts.slice(index + 1).some(row => row[1] === receipt[1] && String(row[2]) === String(receipt[2]) &&
      JSON.parse(row[6] || '[]').some(code => hoscodes.includes(code)))) return 'newer_import';
  return null;
}

/** What undoing a receipt would change: its active inserted rows go inactive, the rows its cleanup deactivated come back. */
function epiUndoEffect(sheet, receipt) {
  const batchId = receipt[0];
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [[]];
  const headers = rows[0];
  const facility = {};
  const deactivate = [], reactivate = [];
  let activeAfter = 0;
  rows.forEach((row, i) => {
    if (i === 0) return;
    const record = arrayToObj(headers, row);
    if (String(record.fiscal_year) !== String(receipt[2])) return;
    const active = String(record.is_active).toLowerCase() === 'true';
    const code = String(record.hoscode);
    const stats = () => (facility[code] = facility[code] || { hoscode: code, wouldDeactivate: 0, wouldReactivate: 0 });
    if (active && record.last_seen_batch === batchId) { deactivate.push(i); stats().wouldDeactivate++; }
    else if (!active && record.deactivated_by_batch === batchId) { reactivate.push(i); stats().wouldReactivate++; activeAfter++; }
    else if (active) activeAfter++;
  });
  const byHoscode = Object.keys(facility).sort().map(code => facility[code]);
  return { headers, rows, deactivate, reactivate, byHoscode, activeAfter, wouldDeactivate: deactivate.length, wouldReactivate: reactivate.length };
}

/** Who wrote the batch, from the per-chunk audit metadata: an admin's email or user id, never a child's identity. */
function epiImportedBy(receipt) {
  const actors = JSON.parse(receipt[5] || '[]').map(chunk => chunk.audit && (chunk.audit.email || chunk.audit.userId)).filter(Boolean);
  return [...new Set(actors)].join(', ') || null;
}

/**
 * Issue #139: read-only preview of Import Undo for the latest written batch of one table and Fiscal Year.
 * Counts and facility codes only; the server decides eligibility (ADR-0009).
 */
function previewEpiImportUndo(targetTable, fiscalYear, auth) {
  if (!getEpiSchemas()[targetTable] || !/^\d{4}$/.test(String(fiscalYear))) return { success: false, error: 'Invalid import scope.' };
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const scope = { success: true, targetTable, fiscalYear: String(fiscalYear) };
    const batches = ss.getSheetByName('epi_import_batches'); // never created here: preview is read-only
    const receipts = batches ? batches.getDataRange().getValues() : [];
    const index = epiLatestWrittenReceipt(receipts, targetTable, fiscalYear);
    if (index < 1) return { ...scope, eligible: false, reason: 'no_batch' };
    const receipt = receipts[index];
    const finalize = receipt[10] ? JSON.parse(receipt[10]) : null;
    const batch = { ...scope, batchId: receipt[0], mode: receipt[3], importedAt: finalize ? finalize.at : null, importedBy: epiImportedBy(receipt) };
    const reason = epiUndoRefusal(receipts, index);
    if (reason) return { ...batch, eligible: false, reason };
    const effect = epiUndoEffect(ss.getSheetByName(targetTable), receipt);
    if (receipt[7] === 'undoing') {
      // Issue #140: the counts are the plan's; the rows may already be reversed, so they cannot be recounted.
      const plan = JSON.parse(receipt[11]);
      return { ...batch, eligible: true, unfinished: true, startedBy: plan.by, startedAt: plan.at, wouldDeactivate: plan.deactivated,
        wouldReactivate: plan.reactivated, activeAfter: effect.activeAfter, summariesWillBeRemoved: effect.activeAfter === 0 };
    }
    return { ...batch, eligible: true, wouldDeactivate: effect.wouldDeactivate, wouldReactivate: effect.wouldReactivate,
      byHoscode: effect.byHoscode, activeAfter: effect.activeAfter, summariesWillBeRemoved: effect.activeAfter === 0 };
  });
}

/**
 * Issue #139: undo the batch the admin previewed. Under the import lock the server re-checks eligibility and the
 * counts, then deactivates the rows the batch inserted and reactivates the rows its cleanup deactivated. Soft only.
 */
function undoEpiImport(batchId, expected, auth) {
  if (!/^[\w-]{1,100}$/.test(batchId || '') || !expected || typeof expected !== 'object' ||
      !Number.isInteger(expected.wouldDeactivate) || !Number.isInteger(expected.wouldReactivate)) {
    return { success: false, error: 'Invalid undo request.' };
  }
  const refuse = reason => ({ success: false, reason, error: EPI_UNDO_REFUSAL_ERROR[reason] });
  return withEpiImportLock(() => {
    const ss = getSpreadsheet();
    const batches = epiBatchSheet(ss);
    const receipts = batches.getDataRange().getValues();
    const index = receipts.findIndex((row, i) => i > 0 && row[0] === batchId);
    if (index < 1) return refuse('no_batch');
    const receipt = receipts[index];
    const [, targetTable, fiscalYear, mode] = receipt;
    // Undo is one step: only the latest written batch of the table and year, never an earlier one.
    const reason = epiUndoRefusal(receipts, index) || (epiLatestWrittenReceipt(receipts, targetTable, fiscalYear) !== index ? 'newer_import' : null);
    if (reason) return refuse(reason);
    const sheet = ss.getSheetByName(targetTable);
    const effect = epiUndoEffect(sheet, receipt);
    let plan;
    if (receipt[7] === 'undoing') {
      // Issue #140: finish an Unfinished Import Undo from its plan. Its rows are either untouched or already reversed; anything else is refused.
      plan = JSON.parse(receipt[11]);
      if (expected.wouldDeactivate !== plan.deactivated || expected.wouldReactivate !== plan.reactivated) return refuse('stale');
      const untouched = effect.wouldDeactivate === plan.deactivated && effect.wouldReactivate === plan.reactivated;
      if (!untouched && (effect.wouldDeactivate || effect.wouldReactivate)) return refuse('unfinished_mismatch');
    } else {
      if (effect.wouldDeactivate !== expected.wouldDeactivate || effect.wouldReactivate !== expected.wouldReactivate) return refuse('stale');
      // ADR-0010: the plan is recorded before any row changes, so an interrupted undo is never mistaken for a finished one.
      plan = { by: auth && (auth.email || auth.userId), actor: { userId: auth && auth.userId, email: auth && auth.email },
        at: new Date().toISOString(), deactivated: effect.wouldDeactivate, reactivated: effect.wouldReactivate };
      receipt[7] = 'undoing'; receipt[8] = plan.at; // the new updated_at makes overlapping open preflights stale
      receipt[11] = JSON.stringify(plan);
      writeEpiRows(batches, receipts[0], receipts);
    }

    // Every step below is safe to repeat, so finishing an Unfinished Import Undo is running them again.
    const activeIndex = effect.headers.indexOf('is_active');
    const deactivatedByIndex = effect.headers.indexOf('deactivated_by_batch');
    effect.deactivate.forEach(i => { effect.rows[i][activeIndex] = false; });
    effect.reactivate.forEach(i => { effect.rows[i][activeIndex] = true; effect.rows[i][deactivatedByIndex] = ''; });
    if (effect.deactivate.length || effect.reactivate.length) writeEpiRows(sheet, effect.headers, effect.rows);
    const summariesRemoved = effect.activeAfter === 0;
    // CONTEXT.md §44: no Active Records means no Dashboard Summary, so none may outlive the rows it summarized.
    // Deleted before the audit, so the single audit records what really happened to the summaries.
    if (summariesRemoved) deleteDashboardSummaries(targetTable, fiscalYear);
    const finisher = auth && (auth.email || auth.userId);
    ensureUndoAudit(batchId, plan,
      `Batch ${batchId} [${targetTable} FY ${fiscalYear} ${mode}]: deactivated ${plan.deactivated}, reactivated ${plan.reactivated}; ` +
      `facilities [${JSON.parse(receipt[6]).join(', ')}]; summaries removed ${summariesRemoved}` +
      (finisher !== plan.by ? `; finished by ${finisher}` : ''));
    const finishedAt = new Date().toISOString();
    receipt[7] = 'undone'; receipt[8] = finishedAt; // undone only once every step is complete (ADR-0010)
    receipt[11] = JSON.stringify({ ...plan, summariesRemoved, ...(finisher !== plan.by ? { finishedBy: finisher, finishedAt } : {}) });
    writeEpiRows(batches, receipts[0], receipts);
    return { success: true, deactivated: plan.deactivated, reactivated: plan.reactivated, summariesRemoved };
  });
}

/** Issue #140: exactly one undo_epi_import event per Batch, attributed to the admin who started the undo (ADR-0010). */
function ensureUndoAudit(batchId, plan, details) {
  const marker = `Batch ${batchId} [`;
  const sheet = getSpreadsheet().getSheetByName('audit_logs');
  if (sheet) {
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][3] === 'undo_epi_import' && String(rows[i][4]).startsWith(marker)) return; // already audited, incl. an ambiguous append failure
    }
  }
  logAction(plan.actor.userId, plan.actor.email, 'undo_epi_import', details);
}

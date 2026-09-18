/**
 * Issue #14: แหล่งค่าคงที่เชิงปฏิบัติการของ OpenData แห่งเดียว (ไม่ใช่ระบบ config แบบไดนามิก)
 * ข้อเท็จจริงระดับอำเภอ (จังหวัด/อำเภอ) เป็นค่าคงที่ฝั่งเซิร์ฟเวอร์ ห้ามรับจากผู้ใช้
 */
const OPENDATA_CONSTANTS = {
  DATASETS: ['s_epi1', 's_epi2', 's_epi3', 's_epi5', 's_epi_complete'],
  ENDPOINT: 'https://opendata.moph.go.th/api/report_data',
  PROVINCE: '54',           // แพร่
  AREACODE_PREFIX: '5406',  // อำเภอสอง
  LIMIT: 10000,
  CACHE_TTL_SECONDS: 21600, // 6 ชั่วโมง
};

/**
 * Issue #15: นิยามคอลัมน์ที่จำเป็นของ `opendata_cache` แหล่งเดียว (authoritative)
 * syncOpenData / setupDatabase / getCachedOpenData ต้องใช้นิยามนี้ ห้ามสร้างรายการซ้ำ
 */
const OPENDATA_CACHE_COLUMNS = ['sync_id', 'table_name', 'fiscal_year', 'hospcode', 'areacode', 'raw_json', 'updated_at'];

/** คอลัมน์ที่เส้นทางอ่านต้องใช้จริง (data-bearing) — ขาด/ซ้ำ ต้อง fail closed */
const OPENDATA_CACHE_READ_COLUMNS = ['table_name', 'fiscal_year', 'hospcode', 'raw_json'];

/**
 * Issue #15: ตรวจหัวคอลัมน์จริงของชีต — คืน duplicate/missing ของคอลัมน์ที่จำเป็น
 * พร้อมแผนที่ชื่อ → ดัชนีจริง (zero-based) ของคอลัมน์ที่หาเจอเท่านั้น ไม่สันนิษฐานตำแหน่ง
 */
function inspectOpenDataCacheHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String) : [];
  const duplicates = OPENDATA_CACHE_COLUMNS.filter(column => headers.filter(header => header === column).length > 1);
  const missing = OPENDATA_CACHE_COLUMNS.filter(column => !headers.includes(column));
  const columns = {};
  for (const column of OPENDATA_CACHE_COLUMNS) {
    const index = headers.indexOf(column);
    if (index !== -1) columns[column] = index;
  }
  return { duplicates, missing, columns, headerWidth: headers.length };
}

/**
 * Issue #15: สัญญาสคีมา `opendata_cache` แห่งเดียว (ใช้ร่วมกับ setupDatabase และ sync)
 * - ครบและไม่ซ้ำ → { ok: true, columns } โดยไม่แตะชีต
 * - ขาดบางคอลัมน์ → เติมเฉพาะคอลัมน์ที่ขาดต่อท้ายตามลำดับนิยาม ไม่สลับ/ไม่เขียนแถวเกา
 *   และห้ามสร้าง sync_id/updated_at ย้อนหลังให้แถวประวัติ (เซลล์ใหม่คงว่าง)
 * - คอลัมน์ที่จำเป็นซ้ำ → fail closed ไม่กลายพันธุ์ชีต ไม่เลือกตัวซ้ำตัวแรกโดยเงียบ ๆ
 */
function ensureOpenDataCacheSchema(sheet) {
  const inspection = inspectOpenDataCacheHeaders(sheet);
  if (inspection.duplicates.length > 0) {
    return { ok: false, error: 'opendata_cache duplicate required columns: ' + inspection.duplicates.join(', ') };
  }
  if (inspection.missing.length > 0) {
    const startColumn = inspection.headerWidth + 1;
    const neededWidth = inspection.headerWidth + inspection.missing.length;
    if (sheet.getMaxColumns() < neededWidth) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), neededWidth - sheet.getMaxColumns());
    }
    // เขียนเฉพาะแถวหัวคอลัมน์ใหม่ — แถวข้อมูลเดิมไม่ถูกเขียนใหม่ เซลล์ใหม่คงว่างตามธรรมชาติ
    sheet.getRange(1, startColumn, 1, inspection.missing.length).setValues([inspection.missing]);
    return ensureOpenDataCacheSchema(sheet);
  }
  return { ok: true, columns: inspection.columns };
}

/**
 * Issue #14: นโยบายปีงบประมาณที่รองรับ อนุมานจากแหล่งเดียวคือ getAvailableYears() ฝั่งเซิร์ฟเวอร์
 * ปรับเป็น string ทุกค่า; ถ้าแหล่งหลักประเมินไม่ได้ ให้ fail closed (ไม่มีปีที่พิสูจน์ได้ว่ารองรับ)
 * ห้ามสร้าง allowlist ปีแบบสแตติกชุดที่สอง
 */
function supportedOpenDataYears() {
  try {
    const years = getAvailableYears();
    return (Array.isArray(years) ? years : Array.from(years || [])).map(String);
  } catch (e) {
    console.error('supportedOpenDataYears failed, failing closed:', e);
    return [];
  }
}

/**
 * Issue #14: ตัวจัดประเภทการตอบกลับอัปสตรีมแบบใช้ร่วมกัน — ไม่โยน SyntaxError ดิบออกมาเลย
 * ลำดับการพิจารณา: (A) non-2xx → http_error โดยไม่อ่าน body; (B) 2xx แล้ว parse ไม่ได้ →
 * non_json (HTML/ข้อความ) หรือ malformed_json (คล้าย JSON แต่พัง); (C) JSON ที่ parse ได้ →
 * json_error (มี error ตามสัญญาอัปสตรีม) / success (data เป็น array, รวมแถวว่าง) / invalid_contract
 * การวินิจฉัยเป็น metadata แบบมีขอบเขตเท่านั้น — ห้ามเก็บ body ดิบของอัปสตรีม
 */
function classifyOpenDataResponse(response) {
  const status = response.getResponseCode();
  const contentType = String((response.getHeaders && response.getHeaders()['Content-Type']) || '');
  const diagnostic = `opendata_upstream status=${status} content-type=${contentType || 'unknown'}`.slice(0, 200);
  if (status < 200 || status >= 300) {
    return { category: 'http_error', diagnostic };
  }
  const content = response.getContentText();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const trimmed = String(content || '').trim();
    const category = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'malformed_json' : 'non_json';
    return { category, diagnostic };
  }
  if (parsed && typeof parsed === 'object' && parsed.error != null) {
    return { category: 'json_error', error: String(parsed.error).slice(0, 200), diagnostic };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
    return { category: 'success', data: parsed.data, response: parsed, diagnostic };
  }
  return { category: 'invalid_contract', diagnostic };
}

/**
 * Issue #14: ตรวจคำขอสาธารณะ getOpenData ก่อนแตะ cache/fallback/upstream —
 * ปฏิเสธแบบ deterministic ทั้ง payload ผิดรูป / dataset ไม่รองรับ / ปีผิดรูปแบบ / ปีไม่รองรับ
 */
function validateOpenDataRequest(payload) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Invalid getOpenData payload.' };
  }
  if (!OPENDATA_CONSTANTS.DATASETS.includes(payload.tableName)) {
    return { valid: false, error: 'Unsupported OpenData dataset: ' + String(payload.tableName).slice(0, 50) };
  }
  const year = String(payload.year == null ? '' : payload.year);
  if (!/^\d{4}$/.test(year)) {
    return { valid: false, error: 'Malformed fiscal year: ' + year.slice(0, 10) };
  }
  if (!supportedOpenDataYears().includes(year)) {
    return { valid: false, error: 'Unsupported fiscal year: ' + year };
  }
  return { valid: true, year };
}

/**
 * Proxy สำหรับดึงข้อมูลจาก MOPH OpenData API เพื่อแก้ปัญหา CORS ฝั่ง Frontend
 * และเพิ่มระบบ Cache 6 ชั่วโมง ป้องกันการดึงข้อมูลซ้ำซ้อนจนโดนบล็อก (เก็บเฉพาะผลสำเร็จ)
 * การจัดประเภทการตอบกลับทั้งหมดผ่าน classifyOpenDataResponse แห่งเดียว
 * @param {object} payload - เช่น { tableName: "s_epi1", year: "2567", province: "54" }
 */
function fetchOpenDataProxy(payload) {
  // 1. สร้าง Cache Key จาก Payload (ใช้ v2 เพื่อล้าง Cache เดิมที่ติด Error)
  const cacheKey = "opendata_v3_" + payload.tableName + "_" + payload.year + "_" + payload.province + "_" + (payload.amp || "all");
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);

  // 2. ถ้ามีใน Cache ส่งกลับทันที
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  // 3. ถ้าไม่มีใน Cache ให้ยิง API ไปขอกระทรวง
  try {
    // ตาม Spec HDC ต้องแนบ type: "json" ไปด้วยเสมอ
    const requestPayload = { ...payload, type: "json", limit: OPENDATA_CONSTANTS.LIMIT };

    const options = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(OPENDATA_CONSTANTS.ENDPOINT, options);
    const result = classifyOpenDataResponse(response);
    if (result.category !== 'success') {
      // ความล้มเหลวที่จัดประเภทแล้ว: ส่งกลับซอง error แบบปลอดภัย ไม่แคช ไม่โยน SyntaxError ดิบ
      console.error('OpenData upstream failure:', result.diagnostic);
      return { error: 'OpenData upstream ' + result.category + (result.error ? ': ' + result.error : ''), diagnostic: result.diagnostic };
    }

    // 4. เก็บลง Cache เฉพาะกรณีที่ดึงสำเร็จ และ body ไม่ได้ประกาศ statusCode 400/404
    //    (สัญญาเดิมก่อน Issue #14: ส่งกลับให้คำขอปัจจุบัน แต่ห้ามจำ error ลง cache)
    const bodyStatus = result.response && result.response.statusCode;
    if (bodyStatus !== 400 && bodyStatus !== 404) {
      try {
        cache.put(cacheKey, JSON.stringify(result.response), OPENDATA_CONSTANTS.CACHE_TTL_SECONDS);
      } catch (e) {
        console.error("Failed to cache OpenData:", e);
      }
    }

    return result.response;
  } catch (error) {
    console.error("OpenData Fetch Error: ", error);
    return { error: "Failed to fetch OpenData: " + String(error).slice(0, 200) };
  }
}

/**
 * ฟังก์ชัน ETL (Data Lake): ดึงข้อมูลจาก HDC OpenData เก็บลง Google Sheet อัตโนมัติ
 * ทำงานผ่าน Time-driven trigger ทุกวัน
 */
/** Issue #16: bounded sync-lock timeout (ms) — implementation-owned, finite/positive */
const OPENDATA_SYNC_LOCK_TIMEOUT_MS = 30000;

/**
 * Issue #16: Transaction-safe OpenData sync lifecycle.
 * Bounded ScriptLock ครอบ lifecycle ทั้งหมด (schema → inventory → fetch → build
 * → commit → verification → audit) ปล่อย lock ใน finally เสมอ; busy → ไม่ทำงานใด ๆ
 * ใช้ classifier (#14) ตัดสินผลต่อคู่ dataset/FY, สคีมา/คอลัมน์อ้างชื่อ (#15),
 * แทนที่แคชด้วย setValues สี่เหลี่ยมเดียว (padding ลบหางเดิม ไม่ clear ก่อนเขียน),
 * ตรวจ commit แบบมีขอบเขต และ audit สรุปกระชับ sanitized หนึ่งรายการ
 */
function syncOpenData() {
  // 1. Bounded lock BEFORE any schema/inventory/upstream/cache work (Issue #16)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(OPENDATA_SYNC_LOCK_TIMEOUT_MS)) {
    return { success: false, status: 'sync_busy', error: 'OpenData sync lock busy; no sync work performed.' };
  }
  try {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName('opendata_cache');
    if (!sheet) {
      sheet = ss.insertSheet('opendata_cache');
      ensureOpenDataCacheSchema(sheet);
      sheet.getRange(1, 1, 1, OPENDATA_CACHE_COLUMNS.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // 2. Schema authority + semantic column mapping (Issue #15); fail closed on ambiguity
    const schema = ensureOpenDataCacheSchema(sheet);
    if (!schema.ok) {
      return { success: false, status: 'schema_invalid', error: schema.error };
    }
    const col = schema.columns;
    const width = OPENDATA_CACHE_COLUMNS.length;

    let yearsToSync = [];
    try {
      yearsToSync = Array.from(getAvailableYears()).map(String);
    } catch (e) {
      const d = new Date();
      const currentYear = d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
      yearsToSync = [String(currentYear), String(currentYear - 1)];
    }

    const syncId = Utilities.getUuid();
    const updatedAt = new Date().toISOString();

    // Inventory by header names — never row[1]/row[2] positional assumptions
    const oldManagedRowCount = sheet.getLastRow() > 1 ? sheet.getLastRow() - 1 : 0;
    const oldRows = oldManagedRowCount > 0
      ? sheet.getRange(2, 1, oldManagedRowCount, width).getValues() : [];

    let finalRows = [];
    let successfulPairs = 0, failedPairs = 0, freshRows = 0, retainedRows = 0;
    const failedPairIds = [];

    const buildFreshRow = (tableName, year, source) => {
      const row = Array(width).fill('');
      row[col.sync_id] = syncId;
      row[col.table_name] = tableName;
      row[col.fiscal_year] = year;
      row[col.hospcode] = source.hospcode || '';
      row[col.areacode] = source.areacode || '';
      row[col.raw_json] = JSON.stringify(source);
      row[col.updated_at] = updatedAt;
      return row;
    };

    for (const year of yearsToSync) {
      for (const tableName of OPENDATA_CONSTANTS.DATASETS) {
        // 3. Shared classifier decides every pair outcome (Issue #14)
        let outcome;
        try {
          const response = UrlFetchApp.fetch(OPENDATA_CONSTANTS.ENDPOINT, {
            method: "POST",
            contentType: "application/json",
            payload: JSON.stringify({ tableName: tableName, year: year, province: OPENDATA_CONSTANTS.PROVINCE, type: "json", limit: OPENDATA_CONSTANTS.LIMIT }),
            muteHttpExceptions: true
          });
          outcome = classifyOpenDataResponse(response);
        } catch (e) {
          outcome = { category: 'http_error', diagnostic: 'request_failed' };
        }

        if (outcome.category === 'success') {
          successfulPairs++;
          const filtered = (outcome.data || []).filter(row => row.areacode && String(row.areacode).startsWith(OPENDATA_CONSTANTS.AREACODE_PREFIX));
          for (const source of filtered) finalRows.push(buildFreshRow(tableName, year, source));
          freshRows += filtered.length; // valid zero-row response still counts as a successful pair
        } else {
          failedPairs++;
          failedPairIds.push(tableName + ':' + year); // compact sanitized identifier only
          for (const row of oldRows) {
            if (String(row[col.table_name]) === tableName && String(row[col.fiscal_year]) === String(year)) {
              finalRows.push([...row]); // retained history stays byte-identical (no fabricated metadata)
              retainedRows++;
            }
          }
        }
      }
    }

    // 4. Truthful upstream status from pair outcomes — never from finalRows.length
    const status = failedPairs === 0 ? 'success' : (successfulPairs === 0 ? 'upstream_failure' : 'partial_success');

    // 5. One padded rectangular replacement (no clear-before-write, no separate tail write)
    // P2-1: commit-phase exceptions (write/flush/verification read) must not escape
    // before a sanitized failure summary — they become deterministic non-success
    // results with an audit emitted while the lock is still held.
    const newRowCount = finalRows.length;
    const replacementHeight = Math.max(oldManagedRowCount, newRowCount);
    let commitState = 'verified';   // mismatch path: 'uncertain'
    let commitFailure = null;       // thrown path: 'commit_failure' | 'commit_uncertain'
    if (replacementHeight > 0) {
      const matrix = finalRows.map(row => row.slice(0, width));
      while (matrix.length < replacementHeight) matrix.push(Array(width).fill(''));
      let writeCompleted = false;
      try {
        sheet.getRange(2, 1, replacementHeight, width).setValues(matrix);
        writeCompleted = true;
        SpreadsheetApp.flush();

        // 6. Bounded post-write verification of the committed rectangle
        const readBack = sheet.getRange(2, 1, replacementHeight, width).getValues();
        if (JSON.stringify(readBack) !== JSON.stringify(matrix)) commitState = 'uncertain';
      } catch (e) {
        // Before the write returns → previous cache untouched → commit_failure.
        // After the write returned (flush/read) → actual committed state unknown → commit_uncertain.
        // No raw exception text into result/audit; no rollback; no retry.
        commitFailure = writeCompleted ? 'commit_uncertain' : 'commit_failure';
      }
    }

    // 7. One compact sanitized audit summary (semantic keys; no raw bodies)
    const finalStatus = commitFailure || (commitState === 'uncertain' ? 'commit_uncertain' : status);
    const commitFlag = commitFailure === 'commit_failure' || commitState === 'uncertain'
      ? (commitFailure === 'commit_failure' ? 'failed' : 'uncertain') : 'verified';
    const summary = JSON.stringify({
      status: finalStatus,
      success: successfulPairs, failed: failedPairs,
      fresh: freshRows, retained: retainedRows,
      failed_pairs: failedPairIds, commit: commitFlag
    });
    try { logAction('SYSTEM', 'Cron', 'sync_opendata', summary); } catch (e) { /* audit failure must not undo the committed cache or mask the intended result */ }

    if (finalStatus === 'commit_failure' || finalStatus === 'commit_uncertain') {
      return { success: false, status: finalStatus,
        error: finalStatus === 'commit_failure'
          ? 'OpenData cache commit failed.'
          : 'OpenData cache commit verification uncertain.',
        count: newRowCount, fresh_rows: freshRows, retained_rows: retainedRows,
        successful_pairs: successfulPairs, failed_pairs: failedPairs, syncedAt: updatedAt };
    }
    return { success: true, status: status, count: newRowCount, fresh_rows: freshRows, retained_rows: retainedRows,
      successful_pairs: successfulPairs, failed_pairs: failedPairs, syncedAt: updatedAt };
  } finally {
    lock.releaseLock(); // exactly once, on success and on every failure path
  }
}

/**
 * ดึงข้อมูลจาก Data Lake (Google Sheet) แทนการดึงสดๆ จาก API กระทรวง
 */
function getCachedOpenData(tableName, year, hospcode = 'all') {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('opendata_cache');
  if (!sheet || sheet.getLastRow() <= 1) {
    // Fallback: ถ้ายังไม่มี Cache เลย ให้ไปดึงผ่าน Proxy
    return fetchOpenDataProxy({ tableName, year, province: OPENDATA_CONSTANTS.PROVINCE });
  }

  // Issue #15: อ่านผ่านชื่อหัวคอลัมน์เท่านั้น — สคีมาซ้ำ/ขาดคอลัมน์ที่ใช้อ่านต้อง fail closed
  // (ห้ามเปลี่ยนสคีมาไม่ถูกต้องให้กลายเป็นผลลัพธ์ว่างที่สำเร็จโดยเงียบ ๆ)
  const inspection = inspectOpenDataCacheHeaders(sheet);
  const duplicatedReadColumns = OPENDATA_CACHE_READ_COLUMNS.filter(column => inspection.duplicates.includes(column));
  const missingReadColumns = OPENDATA_CACHE_READ_COLUMNS.filter(column => !(column in inspection.columns));
  if (duplicatedReadColumns.length > 0 || missingReadColumns.length > 0) {
    const problem = duplicatedReadColumns.length > 0
      ? 'duplicate columns: ' + duplicatedReadColumns.join(', ')
      : 'missing columns: ' + missingReadColumns.join(', ');
    return { statusCode: 500, error: 'opendata_cache schema invalid (' + problem + ')' };
  }
  const tableIdx = inspection.columns.table_name;
  const yearIdx = inspection.columns.fiscal_year;
  const hospIdx = inspection.columns.hospcode;
  const jsonIdx = inspection.columns.raw_json;

  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[tableIdx] === tableName && String(row[yearIdx]) === String(year)) {
      if (hospcode === 'all' || String(row[hospIdx]) === String(hospcode)) {
        try {
          records.push(JSON.parse(row[jsonIdx]));
        } catch(e) {}
      }
    }
  }

  // จำลองโครงสร้าง Response ให้เหมือน MOPH API
  return { statusCode: 200, data: records, isFromCache: true };
}

/**
 * สร้าง Trigger ให้ syncOpenData ทำงานทุกวันตอนตี 2
 */
function setupOpenDataTrigger() {
  // ลบ Trigger เดิมก่อน (ป้องกันซ้ำ)
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'syncOpenData') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // สร้าง Trigger ใหม่ ตอนตี 2
  ScriptApp.newTrigger('syncOpenData')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
    
  return { success: true, message: "Trigger setup complete" };
}

/**
 * ──────────────────────────────────────────────────────────
 * SheetText.js — shared formula-injection escape (Issue #77)
 *
 * Google Sheets parses a cell value whose first character is =, +, - or @ as a
 * formula; Apps Script setValues/appendRow behave like the Sheets API USER_ENTERED
 * option, so imported/admin free text carrying such a prefix would execute when
 * someone opens the sheet. The write paths that persist user-influenced strings
 * (EPI imports, vaccine rules, facility names, AI analyses, user accounts/sessions,
 * audit log rows) escape through sanitizeSheetText — one rule, not per-path regexes.
 *
 * Escape semantics (why the escape apostrophe is data-safe):
 * - Sheets consumes a LEADING apostrophe as a "treat as text" directive, so the
 *   stored cell reads back via getValues EXACTLY as the original text — identifiers,
 *   leading zeroes and free text round-trip unchanged.
 * - Escaping is idempotent: an escaped value starts with ', never a trigger, and a
 *   value read back from Sheets arrives unescaped and re-escapes identically —
 *   merge/rewrite cycles never stack apostrophes.
 * ──────────────────────────────────────────────────────────
 */

/** Prefix the escape apostrophe when the text would otherwise parse as a formula. */
function sanitizeSheetText(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

/** Inverse of sanitizeSheetText: strip the escape apostrophe the sanitizer adds.
 * Sheets consumes it on write, so a sanitized cell legitimately reads back as the
 * pre-escape text; write-verification compares against both states. */
function unescapeSheetText(value) {
  return typeof value === 'string' && /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

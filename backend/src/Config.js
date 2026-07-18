/**
 * ใส่ ID ของ Google Sheet ที่ต้องการใช้เป็นฐานข้อมูล
 * (สามารถดู ID ได้จาก URL ของ Google Sheet: https://docs.google.com/spreadsheets/d/[ตรงนี้คือ_ID]/edit)
 */
const SPREADSHEET_ID = "1-P8kxVMl_urXzcEnuomewWiPSvvha6PW5KHvxBPJUmQ";

/**
 * ดึง Object Spreadsheet หลักของระบบ
 */
function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    throw new Error("❌ กรุณาตั้งค่า SPREADSHEET_ID ในไฟล์ Config.js ก่อนรันครับ");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * คำสั่งสำหรับสร้างคอลัมน์ในแต่ละชีตตาม schema.md อัตโนมัติ
 * ทำตาม Best Practice คือตั้งค่า range.setNumberFormat("@") ล่วงหน้าเพื่อกันเลข 0 หาย
 */
function setupDatabase() {
  const ss = getSpreadsheet();
  
  const schemas = {
    'Users': ['id', 'google_id', 'email', 'name', 'hoscode', 'role', 'status', 'created_at', 'last_login'],
    'Epi_1_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'mmr1_date',
      'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'Epi_2_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date',
      'mmr1_date', 'mmr2_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'je1_date', 'je2_date', 'j11_date',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'Epi_3_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date',
      'mmr1_date', 'mmr2_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'je1_date', 'je2_date', 'je3_date', 'j11_date', 'j12_date',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'Epi_5_Year': [
      'hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
      'bcg_date', 'bcg_hospcode', 'hbv1_date', 'hbv2_date', 'hbv3_date', 'hbv4_date',
      'dtp1_date', 'dtp2_date', 'dtp3_date', 'dtp4_date', 'dtp5_date', 'hib1_date', 'hib2_date', 'hib3_date',
      'ipv1_date', 'ipv2_date', 'opv1_date', 'opv2_date', 'opv3_date', 'opv4_date', 'opv5_date',
      'mmr1_date', 'mmr2_date', 'rv21_date', 'rv22_date', 'rv31_date', 'rv32_date', 'rv33_date',
      'pcv1_date', 'pcv2_date', 'pcv3_date', 'pcv4_date', 'je1_date', 'je2_date', 'je3_date', 'j11_date', 'j12_date',
      'result', 'batch_id', 'fiscal_year', 'last_seen_batch', 'is_active'
    ],
    'facilities': ['hoscode', 'hosname', 'is_active'],
    'audit_logs': ['log_id', 'user_id', 'email', 'action', 'details', 'timestamp'],
    'configs_system': ['config_key', 'config_value', 'description'],
    'sessions': ['session_id', 'user_id', 'token', 'ip_address', 'user_agent', 'expires_at', 'created_at'],
    'config': ['key', 'value', 'description'] // เพิ่ม config สำหรับ Dynamic Targets
  };

  const textFormatSheets = ['Users', 'Epi_1_Year', 'Epi_2_Year', 'Epi_3_Year', 'Epi_5_Year', 'facilities']; // ชีตที่ต้องการป้องกันเลข 0 นำหน้าหาย

  for (const [sheetName, columns] of Object.entries(schemas)) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    
    // ตั้งค่า Header (แถวที่ 1)
    const headerRange = sheet.getRange(1, 1, 1, columns.length);
    headerRange.setValues([columns]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#f3f3f3");
    
    // ป้องกันเลข 0 หาย (บังคับให้เป็น Text "@")
    if (textFormatSheets.includes(sheetName)) {
      // ตั้ง Format Text ให้ทั้งชีต ยกเว้นหัวตาราง
      sheet.getRange(2, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat("@");
    }
    
    // ตั้งค่า Default สำหรับ config sheet (ถ้าเพิ่งสร้างใหม่หรือยังไม่มีข้อมูล)
    if (sheetName === 'config' && sheet.getLastRow() <= 1) {
      const defaultConfigs = [
        ['target_q1', 50, 'เป้าหมายพื้นฐาน ไตรมาส 1'],
        ['target_q2', 70, 'เป้าหมายพื้นฐาน ไตรมาส 2'],
        ['target_q3', 80, 'เป้าหมายพื้นฐาน ไตรมาส 3'],
        ['target_q4', 90, 'เป้าหมายพื้นฐาน ไตรมาส 4'],
        ['target_mmr_q1', 95, 'MMR ไตรมาส 1 (Override)'],
        ['target_mmr_q2', 95, 'MMR ไตรมาส 2 (Override)'],
        ['target_mmr_q3', 95, 'MMR ไตรมาส 3 (Override)'],
        ['target_mmr_q4', 95, 'MMR ไตรมาส 4 (Override)'],
        ['target_view2_q4', 90, 'Fully Immunized ไตรมาส 4 (มุมมองที่ 2)']
      ];
      sheet.getRange(2, 1, defaultConfigs.length, 3).setValues(defaultConfigs);
    }
  }

  // ลบชีตตั้งต้น (Sheet1) ถ้ามีและไม่ได้ใช้งาน
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  return { message: "Database sheets and columns setup completed successfully." };
}

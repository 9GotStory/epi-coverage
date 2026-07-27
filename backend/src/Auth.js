/**
 * ตรวจสอบ Google JWT Token
 * @param {string} idToken 
 * @returns {object|null} { sub, email, name, ... } หรือ null ถ้าไม่ถูกต้อง
 */
function verifyGoogleToken(idToken) {
  // Use a hash or substring of the token to stay within cache key limits (max 250 chars)
  const cacheKey = 'jwt_' + idToken.substring(idToken.length - 100); 
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const result = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() === 200 && result.sub) {
      // Cache valid token data for 30 minutes
      cache.put(cacheKey, JSON.stringify(result), 1800);
      return result;
    }
    return null;
  } catch (error) {
    console.error("Token verification error: ", error);
    return null;
  }
}

/**
 * เช็กสิทธิ์ว่า Token ถูกต้อง และดึงข้อมูล User ว่ามี role อะไร
 * (เพื่อทำ Role-Based Access Control)
 */
function validateTokenAndGetRole(token) {
  if (!token) return { valid: false, error: "No token provided" };
  
  const ss = getSpreadsheet();
  const sessionSheet = ss.getSheetByName('sessions');
  const sessionData = sessionSheet.getDataRange().getValues();
  
  let userId = null;
  const now = new Date();
  
  for (let i = 1; i < sessionData.length; i++) {
    const rowSessionId = sessionData[i][0]; // Session ID col (this is what frontend sends)
    const rowExpiresAt = new Date(sessionData[i][5]); // ExpiresAt col
    
    if (rowSessionId === token) {
      if (now > rowExpiresAt) {
        return { valid: false, error: "Token expired" };
      }
      userId = sessionData[i][1]; // UserId (System ID) col
      break;
    }
  }
  
  if (!userId) {
    return { valid: false, error: "Invalid token or session not found" };
  }
  
  // Get User Role and Status
  const userSheet = ss.getSheetByName('Users');
  const userData = userSheet.getDataRange().getValues();
  const headers = userData[0];
  
  const idCol = headers.indexOf('id');
  const roleCol = headers.indexOf('role');
  const statusCol = headers.indexOf('status');
  
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][idCol] === userId) {
      const status = userData[i][statusCol];
      if (status !== 'approved' && status !== 'admin') {
         // Some admins might have status 'approved' and role 'admin', or just check role
         // Assuming if they are rejected or pending, they shouldn't access most things
         if (status === 'rejected' || status === 'pending') {
           return { valid: false, error: `User status is ${status}` };
         }
      }
      return { 
        valid: true, 
        userId: userId, 
        role: userData[i][roleCol] 
      };
    }
  }
  
  return { valid: false, error: "User not found in database" };
}

/**
 * ดึงข้อมูลผู้ใช้จากฐานข้อมูลด้วย Google ID
 */
function getUserByGoogleId(googleId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[headers.indexOf('google_id')] === googleId) {
      return arrayToObj(headers, row);
    }
  }
  return null;
}

/**
 * ดึงข้อมูลผู้ใช้ทั้งหมด (สำหรับ Admin Panel)
 */
function getAllUsers() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let users = [];
  for (let i = 1; i < data.length; i++) {
    users.push(arrayToObj(headers, data[i]));
  }
  return users;
}

/**
 * สร้างผู้ใช้ใหม่ (สถานะ pending)
 */
function createUser(userData) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  
  // แปลง object ให้ตรงกับลำดับ headers
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = headers.map(header => {
    let val = userData[header] || "";
    if (header === 'hoscode' && val) {
      val = "'" + val; // Prepend apostrophe to strictly enforce string type
    }
    return val;
  });
  
  const nextRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(nextRow, 1, 1, headers.length);
  
  range.setNumberFormat("@");
  range.setValues([newRow]);
  
  logAction('SYSTEM', userData.email || 'Unknown', 'create_user', `Created new user ${userData.email}`);
  
  return { success: true, message: "User created and pending approval." };
}

/**
 * Utility: แปลง Array 1D ให้เป็น Object ตาม Headers
 */
function arrayToObj(headers, row) {
  let obj = {};
  headers.forEach((header, index) => {
    obj[header] = row[index];
  });
  return obj;
}

/**
 * อัปเดตสถานะและสิทธิ์ของผู้ใช้ (สำหรับ Admin)
 */
function updateUserStatus(googleId, newStatus, newRole) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const idCol = headers.indexOf('google_id');
  const statusCol = headers.indexOf('status');
  const roleCol = headers.indexOf('role');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === googleId) {
      const email = data[i][headers.indexOf('email')];
      let details = [];
      if (newStatus) {
        sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
        details.push(`status to ${newStatus}`);
      }
      if (newRole) {
        sheet.getRange(i + 1, roleCol + 1).setValue(newRole);
        details.push(`role to ${newRole}`);
      }
      
      if (details.length > 0) {
        // Here we just use a generic 'Admin' email since we don't have the calling admin's email easily available in the backend payload
        // We will pass adminEmail in the payload from frontend
        logAction('SYSTEM', 'Admin', 'update_user_status', `Updated ${email} ${details.join(' and ')}`);
      }
      return { success: true, message: `User updated successfully.` };
    }
  }
  return { error: "User not found." };
}

/**
 * อัปเดตสังกัด รพ.สต. (hoscode) ของผู้ใช้
 */
function updateUserFacility(googleId, newHoscode) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const idCol = headers.indexOf('google_id');
  const hoscodeCol = headers.indexOf('hoscode');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === googleId) {
      const email = data[i][headers.indexOf('email')];
      
      if (newHoscode) {
        // Prepend apostrophe to preserve leading zeros in Excel/Sheets
        const safeHoscode = "'" + newHoscode;
        const range = sheet.getRange(i + 1, hoscodeCol + 1);
        range.setNumberFormat("@");
        range.setValue(safeHoscode);
        
        logAction('SYSTEM', 'Admin', 'update_user_facility', `Updated ${email} facility to ${newHoscode}`);
        return { success: true, message: `User facility updated successfully.` };
      }
    }
  }
  return { error: "User not found." };
}

/**
 * อัปเดตเวลาเข้าใช้งานล่าสุด
 */
function updateLastLogin(googleId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const idCol = headers.indexOf('google_id');
  const lastLoginCol = headers.indexOf('last_login');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === googleId) {
      sheet.getRange(i + 1, lastLoginCol + 1).setValue(new Date().toISOString());
      return { success: true };
    }
  }
  return { error: "User not found." };
}

/**
 * สร้างเซสชันใหม่เมื่อล็อกอินสำเร็จ
 */
function createSession(userId, token, ipAddress, userAgent) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('sessions');
  
  const sessionId = Utilities.getUuid();
  const createdAt = new Date();
  // หมดอายุใน 24 ชั่วโมง
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
  
  sheet.appendRow([sessionId, userId, token, ipAddress, userAgent, expiresAt, createdAt.toISOString()]);
  
  logAction(userId, 'SYSTEM', 'login', `User logged in from ${ipAddress}`);
  
  return { success: true, session_id: sessionId };
}

/**
 * ลบเซสชัน (Logout)
 */
function deleteSession(token) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('sessions');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    // frontend sends session_id which is in column 1 (index 0)
    if (data[i][0] === token) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, message: "Session not found." };
}

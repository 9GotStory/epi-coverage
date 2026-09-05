function doGet(e) {
  return handleRequest('GET', e);
}

function doPost(e) {
  return handleRequest('POST', e);
}

function handleRequest(method, e) {
  try {
    // 1. รับค่า Action (ดึงจาก Query Parameter ก่อน)
    let action = e.parameter.action;
    let body = {};

    // 2. ถ้าเป็น POST ให้ลอง Parse JSON จาก Body
    if (method === 'POST' && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
      if (!action && body.action) {
        action = body.action;
      }
    }
    
    // 3. ดึง Token เพื่อ Authentication
    const authToken = e.parameter.auth_token || body.auth_token;
    
    // 4. Public Actions (ไม่ใช้ Token)
    const publicActions = [
      'setup', 'verifyToken', 'loginWithGoogle', 'createUser', 'updateLastLogin',
      'getTargetConfig', 'getDashboardSummaries', 'getDashboardSummariesMultiYear', 'getVaccineRules', 'getAvailableYears', 'getEpiData', 'debugBounds', 'debugGetEpiData', 'forceSyncOpenData', 'setupOpenDataTrigger', 'getOpenData'
    ];
    if (publicActions.includes(action)) {
      switch (action) {
        case 'setup': return responseJson(setupDatabase());
        case 'verifyToken': return responseJson(verifyGoogleToken(body.idToken));
        case 'loginWithGoogle': return responseJson(loginWithGoogle(body.accessToken, body.ipAddress || '', body.userAgent || ''));
        case 'createUser': return responseJson(createUser(body.userData));
        case 'updateLastLogin': return responseJson(updateLastLogin(body.googleId));
        case 'getTargetConfig': return responseJson(getTargetConfig());
        case 'getDashboardSummaries': return responseJson(getDashboardSummaries(body.fiscalYear || e.parameter.fiscalYear, body.quarter || e.parameter.quarter));
        case 'getDashboardSummariesMultiYear': return responseJson(getDashboardSummariesMultiYear(body.fiscalYears));
        case 'getVaccineRules': return responseJson(getVaccineRules(body.fiscalYear || e.parameter.fiscalYear, body.ageGroup || e.parameter.ageGroup));
        case 'getAvailableYears': return responseJson(getAvailableYears());
        case 'forceSyncOpenData': return responseJson(syncOpenData());
        case 'setupOpenDataTrigger': return responseJson(setupOpenDataTrigger());
        case 'getOpenData': return responseJson(getCachedOpenData(body.payload.tableName, body.payload.year, body.payload.amp ? 'all' : 'all'));
        case 'debugBounds': {
          const ss = getSpreadsheet();
          return responseJson({ 
            sample: ss.getSheetByName('Epi_1_Year') ? (function() { const v = ss.getSheetByName('Epi_1_Year').getRange(1, 1, 2, 42).getValues(); const h = v[0]; const d = v[1]; const o = {}; for(let i=0; i<h.length; i++) o[h[i]] = d[i]; return o; })() : {},
            1: ss.getSheetByName('Epi_1_Year') ? ss.getSheetByName('Epi_1_Year').getLastRow() : -1,
            2: ss.getSheetByName('Epi_2_Year') ? ss.getSheetByName('Epi_2_Year').getLastRow() : -1,
            3: ss.getSheetByName('Epi_3_Year') ? ss.getSheetByName('Epi_3_Year').getLastRow() : -1,
            5: ss.getSheetByName('Epi_5_Year') ? ss.getSheetByName('Epi_5_Year').getLastRow() : -1
          });
        }
        case 'getEpiData': return responseJson(getEpiData(e.parameter.hoscode || body.hoscode, e.parameter.targetTable || body.targetTable, body.fiscalYear || e.parameter.fiscalYear));
        case 'debugGetEpiData': {
          const ss = getSpreadsheet();
          const sheet = ss.getSheetByName('Epi_1_Year');
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          let records = [];
          for (let i = 1; i < Math.min(5, data.length); i++) {
            records.push(arrayToObj(headers, data[i]));
          }
          return responseJson({ rawRecords: records });
        }
        case 'debugBounds': {
          const ss = getSpreadsheet();
          const sheet = ss.getSheetByName('Epi_1_Year');
          return responseJson({ rows: sheet ? sheet.getLastRow() : -1, cols: sheet ? sheet.getLastColumn() : -1, name: ss.getName() });
        }
      }
    }

    // 5. Authentication (ต้องมี Token)
    const authResult = validateTokenAndGetRole(authToken);
    if (!authResult.valid) {
      return responseJson({ error: 'Unauthorized: ' + authResult.error }, 401);
    }
    
    // 6. Admin Actions (ต้องเป็น Admin เท่านั้น)
    const adminActions = [
      'getAllUsers', 'getUsers', 'updateUserStatus', 'updateUserFacility',
      'upsertFacility', 'upsertEpiData', 'cleanupEpiData', 'getAuditLogs',
      'saveDashboardSummary',
      'seedVaccineRules', 'saveVaccineRule', 'cloneVaccineRules', 'batchSaveRules', 'suggestRuleTargetAges'
    ];
    if (adminActions.includes(action) && authResult.role !== 'admin') {
      return responseJson({ error: 'Forbidden: Admin access required' }, 403);
    }
    
    // 7. Dispatch Protected Routing
    switch (action) {
      case 'getAllUsers': return responseJson(getAllUsers());
      case 'upsertEpiData': return responseJson(upsertEpiData(body.chunk, body.batchId, body.adminEmail, body.fiscalYear, body.targetTable));
      case 'cleanupEpiData': return responseJson(cleanupEpiData(body.batchId, body.touchedHoscodes, body.adminEmail, body.fiscalYear, body.targetTable));

      case 'getUsers': return responseJson(getUsers());
      case 'getFacilities': return responseJson(getFacilities());
      case 'getAuditLogs': return responseJson(getAuditLogs(e.parameter.email, e.parameter.actionType));
      case 'upsertFacility': return responseJson(upsertFacility(body.hoscode, body.hosname, body.isActive, body.adminEmail));
      case 'getEpiData': return responseJson(getEpiData(e.parameter.hoscode || body.hoscode, e.parameter.targetTable || body.targetTable, body.fiscalYear || e.parameter.fiscalYear));
      case 'updateUserStatus': return responseJson(updateUserStatus(body.googleId, body.status, body.role));
      case 'updateUserFacility': return responseJson(updateUserFacility(body.googleId, body.hoscode));
      case 'deleteSession': return responseJson(deleteSession(body.token));
      case 'saveDashboardSummary': return responseJson(saveDashboardSummary(body.targetTable, body.fiscalYear, body.quarter, body.summaryData));
      case 'saveAiAnalysis': return responseJson(saveAiAnalysis(body.recordKey, body.targetTable, body.aiAnalysis, body.adminEmail));
      case 'analyzeVaccineData': return responseJson(analyzeVaccineData(body.prompt, body.recordKey, body.targetTable, e.parameter.email || body.adminEmail));
      // A1: Migration + Dynamic Sheet (Removed legacy year-based endpoints)
      // B2: Vaccine Rules CRUD
      case 'seedVaccineRules': return responseJson(seedVaccineRules(body.fiscalYear, body.adminEmail, body.force));
      case 'saveVaccineRule': return responseJson(saveVaccineRule(body.rule, body.adminEmail));
      case 'cloneVaccineRules': return responseJson(cloneRulesFromYear(body.fromYear, body.toYear, body.adminEmail));
      case 'batchSaveRules': return responseJson(batchSaveRules(body.fiscalYear, body.ageGroup, body.rules, body.adminEmail));
      case 'suggestRuleTargetAges': return responseJson(suggestRuleTargetAges(body.rules));
      default:
        return responseJson({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (error) {
    console.error(error);
    return responseJson({ error: error.toString() }, 500);
  }
}

function responseJson(data, statusCode = 200) {
  // เนื่องจาก GAS ไม่สามารถปรับ HTTP Status Code ของ ContentService ได้โดยตรง 
  // เราจึงส่งค่าผ่าน JSON structure แทน
  const result = {
    status: statusCode,
    data: data
  };
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

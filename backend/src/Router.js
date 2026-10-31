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
      'verifyToken', 'loginWithGoogle', 'createUser',
      'getTargetConfig', 'getDashboardSummaries', 'getDashboardSummariesMultiYear', 'getDashboardSummaryYears', 'getVaccineRules', 'getAvailableYears', 'getOpenData'
    ];
    if (publicActions.includes(action)) {
      switch (action) {
        case 'verifyToken': return responseJson(verifyGoogleToken(body.idToken));
        case 'loginWithGoogle': return responseJson(loginWithGoogle(body.accessToken, body.ipAddress || '', body.userAgent || ''));
        case 'createUser': return responseJson(createUser(body.userData));
        case 'getTargetConfig': return responseJson(getTargetConfig());
        case 'getDashboardSummaries': return responseJson(getDashboardSummaries(body.fiscalYear || e.parameter.fiscalYear, body.quarter || e.parameter.quarter));
        case 'getDashboardSummariesMultiYear': return responseJson(getDashboardSummariesMultiYear(body.fiscalYears));
        // Issue #22: aggregate-only comparison-usable years (public summary-read class)
        case 'getDashboardSummaryYears': return responseJson(getDashboardSummaryYears());
        case 'getVaccineRules': return responseJson(getVaccineRules(body.fiscalYear || e.parameter.fiscalYear, body.ageGroup || e.parameter.ageGroup));
        case 'getAvailableYears': return responseJson(getAvailableYears());
        case 'getOpenData': {
          // Issue #14: deterministic public-boundary validation before any cache/fallback/upstream access
          const validation = validateOpenDataRequest(body.payload);
          if (!validation.valid) return responseJson({ error: validation.error }, 400);
          return responseJson(getCachedOpenData(body.payload.tableName, validation.year));
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
      'setup', 'getAllUsers', 'updateUserStatus', 'updateUserFacility',
      'upsertFacility', 'upsertEpiData', 'cleanupEpiData', 'getAuditLogs',
      'saveDashboardSummary', 'forceSyncOpenData', 'setupOpenDataTrigger',
      'seedVaccineRules', 'saveVaccineRule', 'cloneVaccineRules', 'batchSaveRules', 'suggestRuleTargetAges', 'suggestRuleDateChecks'
    ];
    if (adminActions.includes(action) && !['admin', 'superadmin'].includes(authResult.role)) {
      return responseJson({ error: 'Forbidden: Admin access required' }, 403);
    }
    
    // 7. Dispatch Protected Routing
    switch (action) {
      case 'getAllUsers': return responseJson(getAllUsers());
      case 'setup': return responseJson(setupDatabase());
      // Issue #37: manual invocation source originates server-side in this
      // backend literal — client-supplied source values (body/query) are never
      // read or forwarded.
      case 'forceSyncOpenData': return responseJson(syncOpenData('manual'));
      case 'setupOpenDataTrigger': return responseJson(setupOpenDataTrigger());
      case 'upsertEpiData': return responseJson(upsertEpiData(body.chunk, body.batchId, authResult, body.fiscalYear, body.targetTable, body.options));
      case 'cleanupEpiData': return responseJson(cleanupEpiData(body.batchId, body.touchedHoscodes, authResult.email, body.fiscalYear, body.targetTable));

      // Issue #80: as-of timestamp สำหรับผู้ใช้ทุกสถานะ — คืนเฉพาะเวลาล่าสุดของ cleanup_epi_data
      // (data-minimized) ไม่เปิด audit_logs ฉบับเต็มซึ่งเป็น admin action
      case 'getLatestImportTime': return responseJson(getLatestImportTime());
      case 'getFacilities': return responseJson(getFacilities());
      case 'getAuditLogs': return responseJson(getAuditLogs(e.parameter.email, e.parameter.actionType));
      // Issue #80: audit identity มาจาก session ที่ตรวจสอบแล้ว (authResult) เท่านั้น
      // ไม่ใช้ body.adminEmail ที่ client ส่งมา (spoofable attribution)
      case 'upsertFacility': return responseJson(upsertFacility(body.hoscode, body.hosname, body.isActive, authResult.email));
      case 'getEpiData': return responseJson(getAuthorizedEpiData(authResult, e.parameter.hoscode || body.hoscode, e.parameter.targetTable || body.targetTable, body.fiscalYear || e.parameter.fiscalYear));
      case 'updateUserStatus': return responseJson(updateUserStatus(body.googleId, body.status, body.role, authResult));
      case 'updateUserFacility': return responseJson(updateUserFacility(body.googleId, body.hoscode, authResult));
      case 'deleteSession': return responseJson(deleteSession(authToken));
      case 'saveDashboardSummary': return responseJson(saveDashboardSummary(body.targetTable, body.fiscalYear, body.quarter, body.summaryData));
      case 'saveAiAnalysis': return responseJson(saveAiAnalysis(body.recordKey, body.targetTable, body.aiAnalysis, authResult));
      case 'analyzeVaccineData': return responseJson(analyzeVaccineData(body.prompt, body.recordKey, body.targetTable, authResult));
      // A1: Migration + Dynamic Sheet (Removed legacy year-based endpoints)
      // B2: Vaccine Rules CRUD (Issue #80: ใช้อีเมลจาก authResult ไม่ใช้ body.adminEmail)
      case 'seedVaccineRules': return responseJson(seedVaccineRules(body.fiscalYear, authResult.email, body.force));
      case 'saveVaccineRule': return responseJson(saveVaccineRule(body.rule, authResult.email));
      case 'cloneVaccineRules': return responseJson(cloneRulesFromYear(body.fromYear, body.toYear, authResult.email));
      case 'batchSaveRules': return responseJson(batchSaveRules(body.fiscalYear, body.ageGroup, body.rules, authResult.email));
      case 'suggestRuleTargetAges': return responseJson(suggestRuleTargetAges(body.rules));
      case 'suggestRuleDateChecks': return responseJson(suggestRuleDateChecks(body.rules));
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

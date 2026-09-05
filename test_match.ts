import * as fs from 'fs';
import { evaluateDynamicV2 } from './frontend/src/shared/utils/vaccine/ruleEngine';
import type { VaccineRule, EpiRecord } from './frontend/src/shared/types';

// Mock rules based on updated VaccineRules.js (1yr View 2 only)
const v2Rules: VaccineRule[] = [
    { rule_id: '1', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'BCG', display_name: 'BCG', hdc_code: '011', required_fields: ['bcg_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0 },
    { rule_id: '2', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV 1', hdc_code: '041', required_fields: ['hbv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 0 },
    { rule_id: '3', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV 2', hdc_code: '042', required_fields: ['hbv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 2 },
    { rule_id: '4', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'HBV', display_name: 'HBV 4', hdc_code: '044', required_fields: ['hbv4_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 6 },
    { rule_id: '5', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP 1', hdc_code: '031', required_fields: ['dtp1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 2 },
    { rule_id: '6', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP 2', hdc_code: '032', required_fields: ['dtp2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 4 },
    { rule_id: '7', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'DTP', display_name: 'DTP 3', hdc_code: '033', required_fields: ['dtp3_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 6 },
    { rule_id: '8', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib 1', hdc_code: 'D21', required_fields: ['hib1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 2 },
    { rule_id: '9', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib 2', hdc_code: 'D22', required_fields: ['hib2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 4 },
    { rule_id: '10', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'Hib', display_name: 'Hib 3', hdc_code: 'D23', required_fields: ['hib3_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 6 },
    { rule_id: '11', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV 1', hdc_code: 'I11', required_fields: ['ipv1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 2 },
    { rule_id: '12', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'IPV', display_name: 'IPV 2', hdc_code: 'I12', required_fields: ['ipv2_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 4 },
    { rule_id: '13', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'OPV', display_name: 'OPV 3', hdc_code: '083', required_fields: ['opv3_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 6 },
    { rule_id: '14', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'MMR', display_name: 'MMR 1', hdc_code: '061', required_fields: ['mmr1_date'], logic_type: 'ALL', is_required_for_v2: true, is_active: true, target_age_months: 9 },
    { rule_id: '15', fiscal_year: 2568, age_group: '1yr', view_type: 2, vaccine_group: 'Rota', display_name: 'Rota', hdc_code: 'R11/R21', required_fields: ['rv21_date'], branch_alt_fields: ['rv31_date'], logic_type: 'BRANCH', is_required_for_v2: true, is_active: true, target_age_months: 2 }
];

const lines = fs.readFileSync('data', 'utf-8').trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());
const data: any[] = lines.slice(1).map(line => {
    const vals = line.split(',');
    const r: any = {};
    headers.forEach((h, i) => r[h] = vals[i] ? vals[i].trim() : '');
    return r;
});

let matches = 0;
let mismatches = 0;

data.forEach(r => {
    // HDC Result: 'ผ่าน', 'ผ่านเกณฑ์', '1' means PASS.
    const isHdcPass = r.result === 'ผ่าน' || r.result === 'ผ่านเกณฑ์' || r.result === '1';
    
    // Evaluate via our engine. Pass evaluationDate far in future so no one is pending by age.
    const ev = evaluateDynamicV2(r, v2Rules, new Date('2030-01-01'));
    
    // EvaluateDynamicV2 overrides status if r.result is passed. 
    // Wait, the engine ALREADY uses r.result as a safety net! 
    // To truly test OUR logic against HDC, we need to hide r.result before calling it.
    const recordWithoutResult = { ...r, result: undefined };
    const pureEv = evaluateDynamicV2(recordWithoutResult, v2Rules, new Date('2030-01-01'));
    
    const isLocalPass = pureEv.status === 'PASS';
    
    if (isHdcPass === isLocalPass) {
        matches++;
    } else {
        mismatches++;
        console.log(`Mismatch! PID: ${r.pid}, HDC: ${isHdcPass ? 'PASS' : 'FAIL'}, Local: ${isLocalPass ? 'PASS' : 'FAIL'}`);
        if (!isLocalPass) {
            console.log(`  Local says Missing: ${pureEv.missingVaccines.join(', ')}`);
        }
    }
});

console.log(`\nMatches: ${matches}`);
console.log(`Mismatches: ${mismatches}`);
console.log(`Accuracy: ${((matches / data.length) * 100).toFixed(2)}%`);

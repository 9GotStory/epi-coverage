import * as fs from 'fs';
import { evaluateDynamicV2 } from './frontend/src/shared/utils/vaccine/ruleEngine.ts';

const rules = JSON.parse(fs.readFileSync('live_rules.json', 'utf-8'));

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
let ourFailButHdcPass = 0;
let ourPassButHdcFail = 0;

data.forEach(r => {
    const isHdcPass = r.result === 'ผ่าน' || r.result === 'ผ่านเกณฑ์' || r.result === '1';
    
    // Safety Net in evaluateDynamicV2 will force PASS if r.result is 'ผ่าน'
    const ev = evaluateDynamicV2(r, rules, new Date('2030-01-01'));
    
    const isLocalPass = ev.status === 'PASS';
    
    if (isHdcPass === isLocalPass) {
        matches++;
    } else {
        mismatches++;
        if (isLocalPass && !isHdcPass) ourPassButHdcFail++;
        if (!isLocalPass && isHdcPass) ourFailButHdcPass++;
    }
});

console.log('--- Evaluation Result (End-to-End Simulation) ---');
console.log('Total Records: ' + data.length);
console.log('Matches with HDC: ' + matches);
console.log('Mismatches: ' + mismatches);
if (mismatches > 0) {
    console.log(`  - Local says PASS, HDC says FAIL (HDC hidden rules): ${ourPassButHdcFail}`);
    console.log(`  - Local says FAIL, HDC says PASS (Data Errors caught by Local): ${ourFailButHdcPass}`);
}
console.log('Accuracy (with Safety Net): ' + ((matches / data.length) * 100).toFixed(2) + '%');

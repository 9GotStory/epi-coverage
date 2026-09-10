import { sortRulesForDisplay, isOutPlanRule } from '../utils/vaccine/rulePresentation';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';

interface VaccineRulesGuideProps {
  rules: VaccineRule[];
  viewType: 1 | 2;
  isLoading?: boolean;
  error?: string | null;
}

function describeLogic(rule: VaccineRule): string {
  const fields = rule.required_fields.join(', ');
  const alt = (rule.branch_alt_fields || []).join(', ');
  if (rule.logic_type === 'ANY') return `ANY: มีเข็มใดเข็มหนึ่ง [${fields}]`;
  if (rule.logic_type === 'BRANCH') return `BRANCH: ครบ [${fields}] หรือครบ [${alt}]`;
  return `ALL: ต้องครบทุกเข็ม [${fields}]`;
}

/**
 * หัวข้อ "รายการและขอบเขตการประเมิน" — แสดงจาก vaccine_rules ทั้งหมด
 * (กรองด้วย view_type + is_active) ไม่มีรายการ hardcode
 */
export function VaccineRulesGuide({ rules, viewType, isLoading, error }: VaccineRulesGuideProps) {
  const activeRules = sortRulesForDisplay(rules.filter(rule => rule.view_type === viewType && rule.is_active));

  return (
    <details className="border rounded-lg p-3">
      <summary className="cursor-pointer font-semibold">รายการและขอบเขตการประเมิน</summary>
      {isLoading ? (
        <p className="text-sm text-muted-foreground mt-3">กำลังโหลดเกณฑ์...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive mt-3">โหลดเกณฑ์ไม่สำเร็จ: {error}</p>
      ) : activeRules.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-3">ไม่มีเกณฑ์วัคซีนที่เปิดใช้งานสำหรับปีและกลุ่มอายุนี้</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {activeRules.map(rule => (
            <li key={rule.rule_id} className="text-sm">
              <span className="font-medium">{rule.display_name}</span>
              {isOutPlanRule(rule) && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">นอกแผน — ไม่นับในความครบถ้วน</span>}
              <span className="text-muted-foreground">
                {' '}{rule.vaccine_group && `· กลุ่ม ${rule.vaccine_group} `}· HDC: {rule.hdc_code || '-'}
                {rule.target_age_months !== undefined && rule.target_age_months !== null && ` · อายุเป้าหมาย ${rule.target_age_months} เดือน`}
                {' '}{describeLogic(rule)}
                {rule.note && ` · ${rule.note}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {viewType === 1 && (
        <p className="text-sm text-muted-foreground mt-3">ไม่มีคอลัมน์ต้นทางจะแสดง "ข้อมูลไม่พอประเมิน" และไม่นับเป็นขาดวัคซีน ส่วนเซลล์ว่างแสดงว่าไม่มีวันที่ในข้อมูลที่นำเข้า</p>
      )}
    </details>
  );
}

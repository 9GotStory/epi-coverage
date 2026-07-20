import type { ReactNode } from 'react';
import type { VaccineRule } from '../utils/vaccine/ruleEngine';

interface DynamicVaccineGuideProps {
  rules: VaccineRule[];
  viewType: number;
  title: string;
  fallbackContent: ReactNode;
  theme?: 'blue' | 'indigo';
}

export function DynamicVaccineGuide({ rules, viewType, title, fallbackContent, theme = 'blue' }: DynamicVaccineGuideProps) {
  // Filter rules that match the view type and are active
  const activeRules = rules.filter(r => r.view_type === viewType && r.is_active);

  // If no rules are found from the backend (or all deleted), use the hardcoded fallback
  if (rules.length === 0) {
    return <>{fallbackContent}</>;
  }

  // Style mappings based on theme
  const styles = {
    blue: {
      container: "bg-white/70 p-4 rounded-lg border border-blue-100/50 mt-3 text-xs shadow-sm",
      title: "font-semibold mb-3 text-blue-900 border-b border-blue-100 pb-2",
      grid: "grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-blue-800",
      ruleName: "font-medium text-blue-900",
      ruleDesc: "text-[11px] text-blue-700",
      code: "bg-blue-100 px-1 py-0.5 rounded font-mono text-[10px]"
    },
    indigo: {
      container: "bg-white/60 p-4 rounded-lg border border-indigo-100/50 mt-3 text-xs",
      title: "font-semibold mb-3 text-indigo-900 border-b border-indigo-100 pb-2",
      grid: "grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-indigo-800",
      ruleName: "font-medium text-indigo-900",
      ruleDesc: "text-[11px] text-indigo-700",
      code: "bg-indigo-100 px-1 py-0.5 rounded font-mono text-[10px]"
    }
  };

  const currentStyle = styles[theme];

  // Otherwise, render dynamically based on the active rules
  return (
    <div className={currentStyle.container}>
      <p className={currentStyle.title}>
        {title}
      </p>
      <div className={currentStyle.grid}>
        {activeRules.length === 0 ? (
          <div className="text-zinc-500 italic col-span-2">ไม่มีเกณฑ์วัคซีนที่เปิดใช้งานอยู่</div>
        ) : (
          activeRules.map((rule) => (
            <div key={rule.rule_id} className="flex flex-col gap-0.5">
              <span className={currentStyle.ruleName}>
                {rule.display_name} {rule.vaccine_group && `(${rule.vaccine_group})`}
              </span>
              <span className={currentStyle.ruleDesc}>
                รหัส 43 แฟ้ม (HDC): <code className={currentStyle.code}>{rule.hdc_code || '-'}</code>
                {rule.required_fields && rule.required_fields.length > 0 && (
                  <span className="ml-1 text-zinc-500">
                    [คอลัมน์ Excel: {rule.required_fields.join(', ')}]
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

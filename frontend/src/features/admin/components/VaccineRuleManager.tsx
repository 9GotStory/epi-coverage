import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../shared/components/ui/card';
import { Button } from '../../../shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../shared/components/ui/select';
import { useVaccineRules } from '../../../shared/hooks/useVaccineRules';
import { fetchApi } from '../../../shared/lib/api';
import { toast } from 'sonner';
import { RuleEditModal } from './RuleEditModal';
import { Pencil } from 'lucide-react';
import type { VaccineRule } from '../../../shared/utils/vaccine/ruleEngine';
import { getCurrentFiscalYear } from '../../../shared/utils/dateUtils';
import { useAvailableYears } from '../../../shared/hooks/useAvailableYears';

export const VaccineRuleManager = () => {
  const currentYear = getCurrentFiscalYear();
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const { years: availableYears } = useAvailableYears();
  const [ageGroup, setAgeGroup] = useState<string>('1yr');
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingRule, setEditingRule] = useState<VaccineRule | null>(null);

  const { rules, isLoading, error, setRules } = useVaccineRules(fiscalYear, ageGroup);

  const handleSeedRules = async () => {
    try {
      setIsProcessing(true);
      const res = await fetchApi('seedVaccineRules', { fiscalYear });
      if (res.data?.success) {
        toast.success(`สร้างกฎเริ่มต้นสำหรับปี ${fiscalYear} สำเร็จ`);
        window.location.reload(); // Simple reload to refresh hook data
      } else {
        toast.error(res.data?.error || 'เกิดข้อผิดพลาดในการสร้างกฎ');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการสร้างกฎ');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloneRules = async (fromYear: number) => {
    try {
      setIsProcessing(true);
      const res = await fetchApi('cloneVaccineRules', { fromYear, toYear: fiscalYear });
      if (res.data?.success) {
        toast.success(`คัดลอกกฎจากปี ${fromYear} สำเร็จ`);
        window.location.reload();
      } else {
        toast.error(res.data?.error || 'เกิดข้อผิดพลาดในการคัดลอกกฎ');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการคัดลอกกฎ');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveModal = (updatedRule: VaccineRule) => {
    setRules((prev) => prev.map(r => r.rule_id === updatedRule.rule_id ? updatedRule : r));
    // Also update session storage cache
    const cacheKey = `vaccine_rules_${fiscalYear}_${ageGroup}`;
    const newRules = rules.map(r => r.rule_id === updatedRule.rule_id ? updatedRule : r);
    sessionStorage.setItem(cacheKey, JSON.stringify(newRules));
  };

  const handleBatchSave = async () => {
    try {
      setIsProcessing(true);
      const res = await fetchApi('batchSaveRules', { 
        fiscalYear, 
        ageGroup, 
        rules 
      });
      if (res.data?.success) {
        toast.success('บันทึกเกณฑ์วัคซีนทั้งหมดลงฐานข้อมูลสำเร็จ!');
      } else {
        toast.error(res.data?.error || 'เกิดข้อผิดพลาดในการบันทึก');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>จัดการเกณฑ์การประเมินวัคซีน (Vaccine Rules Engine)</CardTitle>
          <CardDescription>
            ตั้งค่าเงื่อนไขการประเมินวัคซีนแยกตามปีงบประมาณ สามารถปรับเปลี่ยนได้โดยไม่ต้องแก้โค้ด
          </CardDescription>
        </div>
        {rules.length > 0 && (
          <Button onClick={handleBatchSave} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-700 text-white">
            บันทึกการแก้ไขทั้งหมด (Batch Save)
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="w-[200px]">
            <label className="text-sm font-medium mb-1 block">ปีงบประมาณ</label>
            <Select value={String(fiscalYear)} onValueChange={(v) => setFiscalYear(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(year => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[200px]">
            <label className="text-sm font-medium mb-1 block">กลุ่มอายุ</label>
            <Select value={ageGroup} onValueChange={setAgeGroup}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1yr">เด็กอายุ 1 ปี</SelectItem>
                <SelectItem value="2yr">เด็กอายุ 2 ปี</SelectItem>
                <SelectItem value="3yr">เด็กอายุ 3 ปี</SelectItem>
                <SelectItem value="5yr">เด็กอายุ 5 ปี</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-slate-500">กำลังโหลด...</div>
        ) : error ? (
          <div className="py-8 text-center text-red-500">{error}</div>
        ) : rules.length === 0 ? (
          <div className="py-12 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
            <h3 className="text-lg font-medium text-slate-700 mb-2">ยังไม่มีเกณฑ์วัคซีนสำหรับปี {fiscalYear}</h3>
            <p className="text-slate-500 mb-6">คุณสามารถสร้างเกณฑ์เริ่มต้น (Default) หรือคัดลอกเกณฑ์จากปีที่ผ่านมา</p>
            <div className="flex justify-center gap-4">
              <Button onClick={handleSeedRules} disabled={isProcessing}>
                สร้างเกณฑ์เริ่มต้น (Default Rules)
              </Button>
              <Button variant="outline" onClick={() => handleCloneRules(fiscalYear - 1)} disabled={isProcessing}>
                คัดลอกเกณฑ์จากปี {fiscalYear - 1}
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">ชื่อเกณฑ์</th>
                  <th className="py-3 px-4">มุมมอง (View)</th>
                  <th className="py-3 px-4">เงื่อนไข (Logic)</th>
                  <th className="py-3 px-4">ฟิลด์ที่ต้องการ</th>
                  <th className="py-3 px-4">สถานะ</th>
                  <th className="py-3 px-4 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map(rule => (
                  <tr key={rule.rule_id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800">{rule.display_name}</div>
                      <div className="text-xs text-slate-500">{rule.vaccine_group} • HDC: {rule.hdc_code || '-'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-xs ${rule.view_type === 1 ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        View {rule.view_type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">{rule.logic_type}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs max-w-[200px] truncate" title={rule.required_fields.join(', ')}>
                        {rule.required_fields.join(', ')}
                      </div>
                      {rule.logic_type === 'BRANCH' && rule.branch_alt_fields && rule.branch_alt_fields.length > 0 && (
                        <div className="text-xs text-slate-500 truncate" title={rule.branch_alt_fields.join(', ')}>
                          OR: {rule.branch_alt_fields.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {rule.is_active ? (
                        <span className="text-green-600 font-medium">Active</span>
                      ) : (
                        <span className="text-slate-400">Inactive</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setEditingRule(rule)}>
                        <Pencil className="w-4 h-4 text-slate-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {editingRule && (
        <RuleEditModal
          rule={editingRule}
          isOpen={!!editingRule}
          onClose={() => setEditingRule(null)}
          onSave={handleSaveModal}
        />
      )}
    </Card>
  );
};

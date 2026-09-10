import { getRuleDateChecks } from '../../../shared/utils/vaccine/dateWarnings';
import { buildFieldLabelMap } from '../../../shared/utils/vaccine/rulePresentation';
import { vaccineFieldLabel } from '../../../shared/utils/vaccine/hdcData';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../shared/components/ui/card';
import { Button } from '../../../shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../shared/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/components/ui/dropdown-menu';
import { useVaccineRules } from '../../../shared/hooks/useVaccineRules';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { fetchApi } from '../../../shared/lib/api';
import { toast } from 'sonner';
import { RuleEditModal } from './RuleEditModal';
import { Pencil, ArrowRight, Wand2, ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { VaccineRule } from '../../../shared/utils/vaccine/ruleEngine';
import { getCurrentFiscalYear } from '../../../shared/utils/dateUtils';
import { useAvailableYears } from '../../../shared/hooks/useAvailableYears';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from 'react-router-dom';
import { AlertCircle, CheckCircle2, RotateCw, RotateCcw } from 'lucide-react'; // RotateCcw ใช้ในเมนูเครื่องมือ

// หมายเหตุ: "ค่าเริ่มต้นอายุเป้าหมาย" ไม่ได้ฮาร์ดโค้ดที่นี่อีกต่อไป
// แหล่งเดียวคือ TARGET_AGE_MONTHS_BY_FIELD ฝั่ง Backend (VaccineRules.js)
// ปุ่ม "อัปเดตอายุเป้าหมาย (Auto)" ดึงค่าผ่าน endpoint suggestRuleTargetAges

interface VaccineRuleManagerProps {
  onDirtyChange?: (isDirty: boolean) => void;
}

function describeDateChecks(rule: VaccineRule, rules: VaccineRule[]) {
  const checks = getRuleDateChecks(rule, rules);
  // ป้ายชื่อเข็มมาจาก vaccine_rules (display_name) โดย fallback ที่ vaccineFieldLabel
  const labels = buildFieldLabelMap(rules);
  const name = (field: string) => labels.get(field) ?? vaccineFieldLabel(field);
  return [
    `ตรวจฉีดก่อนวันเกิด: ${checks.before_birth ? 'เปิด' : 'ปิด'}`,
    `ฉีดตรงวันเกิด: ${checks.allow_on_birth ? 'อนุญาต' : 'ไม่อนุญาต'}`,
    `ห้ามวันซ้ำ: ${checks.same_day_pairs.map(p => `${name(p.field)} กับ ${name(p.other_field)}`).join(', ') || 'ไม่มี'}`,
    `ลำดับวันที่: ${checks.ordered_pairs.map(p => `${name(p.field)} ต้องไม่หลัง ${name(p.other_field)}`).join(', ') || 'ไม่มี'}`,
  ].join('; ');
}

export const VaccineRuleManager = ({ onDirtyChange }: VaccineRuleManagerProps) => {
  const currentYear = getCurrentFiscalYear();
  // เครื่องมือจัดการเกณฑ์ (Auto/Restore) แสดงเฉพาะ admin และ superadmin
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const { years: availableYears } = useAvailableYears();
  const [ageGroup, setAgeGroup] = useState<string>('1yr');
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingRule, setEditingRule] = useState<VaccineRule | null>(null);
  const [hasUnsavedChangesState, setHasUnsavedChangesState] = useState(false);
  const [draftRules, setDraftRules] = useState<VaccineRule[] | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [needsResync, setNeedsResync] = useState(false);

  const setHasUnsavedChanges = (val: boolean) => {
    setHasUnsavedChangesState(val);
    onDirtyChange?.(val);
  };

  const hasUnsavedChanges = hasUnsavedChangesState;

  const queryClient = useQueryClient();
  const { rules, isLoading, error } = useVaccineRules(fiscalYear, ageGroup);
  
  const displayRules = draftRules || rules;
  
  const modifiedRuleDiffs = draftRules ? draftRules.filter(draft => {
    const original = rules.find(r => r.rule_id === draft.rule_id);
    if (!original) return false;
    return JSON.stringify(original) !== JSON.stringify(draft);
  }) : [];
  
  const modifiedRuleNames = modifiedRuleDiffs.map(r => r.display_name);

  // Prevent closing tab/window if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Standard way to show browser prompt
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Prevent in-app navigation if there are unsaved changes
  const blocker = useBlocker(hasUnsavedChanges);

  const handleYearChange = (v: string) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('คุณมีการเปลี่ยนแปลงที่ยังไม่ได้กด Batch Save หากเปลี่ยนปีงบประมาณตอนนี้ข้อมูลที่แก้ไว้จะหายไป ต้องการเปลี่ยนปีงบประมาณหรือไม่?')) return;
    }
    setHasUnsavedChanges(false);
    setDraftRules(null);
    setFiscalYear(Number(v));
  };

  const handleAgeGroupChange = (v: string) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('คุณมีการเปลี่ยนแปลงที่ยังไม่ได้กด Batch Save หากเปลี่ยนกลุ่มอายุตอนนี้ข้อมูลที่แก้ไว้จะหายไป ต้องการเปลี่ยนกลุ่มอายุหรือไม่?')) return;
    }
    setHasUnsavedChanges(false);
    setDraftRules(null);
    setAgeGroup(v);
  };

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

  const handleRestoreDefaults = async () => {
    if (!window.confirm(`คุณแน่ใจหรือไม่ที่จะลบเกณฑ์วัคซีนทั้งหมดของปี ${fiscalYear} และคืนค่าเริ่มต้น? การกระทำนี้ไม่สามารถยกเลิกได้`)) return;
    try {
      setIsProcessing(true);
      const res = await fetchApi('seedVaccineRules', { fiscalYear, force: true });
      if (res.data?.success) {
        toast.success(`คืนค่าเริ่มต้นสำหรับปี ${fiscalYear} สำเร็จ`);
        setDraftRules(null);
        setHasUnsavedChanges(false);
        queryClient.invalidateQueries({ queryKey: ['vaccineRules'] });
      } else {
        toast.error(res.data?.error || 'เกิดข้อผิดพลาดในการคืนค่าเริ่มต้น');
      }
    } catch (err: any) {
      toast.error(err.message || 'เกิดข้อผิดพลาดในการคืนค่าเริ่มต้น');
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
        queryClient.invalidateQueries({ queryKey: ['vaccineRules'] });
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
    const currentRules = draftRules || rules;
    const newRules = currentRules.map(r => r.rule_id === updatedRule.rule_id ? updatedRule : r);
    setDraftRules(newRules);
    setHasUnsavedChanges(true);
    setEditingRule(null);
  };

  const handleAutoSetTargetAge = async () => {
    const currentRules = draftRules || rules;
    if (!currentRules || currentRules.length === 0) return;

    try {
      setIsProcessing(true);
      // ขอค่าเริ่มต้นจาก Backend (แหล่งเดียว: TARGET_AGE_MONTHS_BY_FIELD ใน VaccineRules.js)
      const res = await fetchApi('suggestRuleTargetAges', { rules: currentRules });
      const suggestions: { rule_id: string; target_age_months: number | null }[] = res.data?.suggestions || [];

      const byId = new Map(suggestions.map(s => [s.rule_id, s.target_age_months]));
      let hasChanges = false;
      const newRules = currentRules.map(rule => {
        const suggested = byId.get(rule.rule_id);
        // ไม่มีค่าเริ่มต้น (null) → ไม่แตะ ให้ Admin ตั้งค่าเองผ่านหน้าแก้ไข
        if (suggested === null || suggested === undefined) return rule;
        if (rule.target_age_months !== suggested) {
          hasChanges = true;
          return { ...rule, target_age_months: suggested };
        }
        return rule;
      });

      if (hasChanges) {
        setDraftRules(newRules);
        setHasUnsavedChanges(true);
        toast.success('อัปเดตอายุเป้าหมายจากค่าเริ่มต้นสำเร็จ! โปรดกดยืนยันบันทึกเพื่อบันทึกลงฐานข้อมูล');
      } else {
        toast.info('อายุเป้าหมายทุกเกณฑ์ถูกตั้งค่าไว้ตรงกับค่าเริ่มต้นอยู่แล้ว');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('ดึงค่าเริ่มต้นอายุเป้าหมายไม่สำเร็จ: ' + (err.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutoSetDateChecks = async () => {
    const currentRules = draftRules || rules;
    if (!currentRules || currentRules.length === 0) return;

    try {
      setIsProcessing(true);
      // ขอคู่เข็มที่ถูกต้องจาก backend — ตรรกะเดียวกับตอน seed (แหล่งเดียว TARGET_AGE_MONTHS_BY_FIELD)
      const res = await fetchApi('suggestRuleDateChecks', { rules: currentRules });
      const suggestions: { rule_id: string; date_checks: NonNullable<VaccineRule['date_checks']> }[] = res.data?.suggestions || [];
      const byId = new Map<string, NonNullable<VaccineRule['date_checks']>>(
        suggestions.map(s => [s.rule_id, s.date_checks] as [string, NonNullable<VaccineRule['date_checks']>]),
      );

      let hasChanges = false;
      const newRules = currentRules.map((rule): VaccineRule => {
        const suggested = byId.get(rule.rule_id);
        if (!suggested) return rule;
        if (JSON.stringify(rule.date_checks) === JSON.stringify(suggested)) return rule;
        hasChanges = true;
        return { ...rule, date_checks: suggested };
      });

      if (hasChanges) {
        setDraftRules(newRules);
        setHasUnsavedChanges(true);
        toast.success('อัปเดตคู่เข็มตรวจวันที่จากค่าเริ่มต้นสำเร็จ! โปรดตรวจทาน diff และกดยืนยันบันทึก');
      } else {
        toast.info('คู่เข็มตรวจวันที่ทุกเกณฑ์ตรงกับค่าเริ่มต้นอยู่แล้ว');
      }
    } catch (err: any) {
      toast.error('แนะนำคู่เข็มไม่สำเร็จ: ' + (err.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBatchSaveClick = () => {
    setShowConfirmModal(true);
  };

  const executeBatchSave = async () => {
    try {
      setIsProcessing(true);
      const res = await fetchApi('batchSaveRules', { 
        fiscalYear, 
        ageGroup, 
        rules: draftRules || rules 
      });
      if (res.data?.success) {
        toast.success('บันทึกเกณฑ์วัคซีนทั้งหมดลงฐานข้อมูลสำเร็จ!');
        setHasUnsavedChanges(false);
        setDraftRules(null);
        setShowConfirmModal(false);
        setNeedsResync(true);
        queryClient.invalidateQueries({ queryKey: ['vaccineRules'] });
        queryClient.invalidateQueries({ queryKey: ['dashboardSummaries'] });
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
        {displayRules.length > 0 && (
          <Button 
            onClick={handleBatchSaveClick} 
            disabled={isProcessing || !hasUnsavedChanges} 
            className={`transition-all ${hasUnsavedChanges ? 'bg-blue-600 hover:bg-blue-700 text-white ring-2 ring-blue-300 ring-offset-2 animate-pulse' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
          >
            บันทึกการแก้ไขทั้งหมด (Batch Save)
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {hasUnsavedChanges && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="w-full">
              <h4 className="font-semibold text-amber-800">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก (Draft)</h4>
              <p className="text-sm text-amber-700 mt-1">ตารางด้านล่างแสดงผลฉบับร่าง กรุณากดปุ่ม <strong>"บันทึกการแก้ไขทั้งหมด"</strong> ด้านบนขวา เพื่อบันทึกลงฐานข้อมูลจริง</p>
              
              {modifiedRuleNames.length > 0 && (
                <div className="mt-3 p-3 bg-white/60 rounded border border-amber-100">
                  <span className="text-xs font-semibold text-amber-800 mb-1 block">รายการเกณฑ์วัคซีนที่ถูกแก้ไข:</span>
                  <ul className="list-disc list-inside text-sm text-amber-700 space-y-0.5">
                    {modifiedRuleNames.map((name, i) => (
                      <li key={i}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {needsResync && !hasUnsavedChanges && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-emerald-800">บันทึกข้อมูลกฎสำเร็จแล้ว!</h4>
                <p className="text-sm text-emerald-700 mt-1">เพื่อให้ Dashboard แสดงผลตัวเลขใหม่ล่าสุดตามกฎที่คุณเพิ่งแก้ คุณต้องสั่งประมวลผลข้อมูลใหม่</p>
              </div>
            </div>
            <Link to="/upload">
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap shadow-sm">
                <RotateCw className="w-4 h-4 mr-2" />
                ไปหน้าอัปโหลดเพื่อ Re-sync
              </Button>
            </Link>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="w-[200px]">
            <label className="text-sm font-medium mb-1 block">ปีงบประมาณ</label>
            <Select value={String(fiscalYear)} onValueChange={handleYearChange}>
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
            <Select value={ageGroup} onValueChange={handleAgeGroupChange}>
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
          
          {isAdmin && displayRules.length > 0 && (
            <div className="flex items-end mb-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="bg-white" disabled={isProcessing}>
                    <SlidersHorizontal className="w-4 h-4 mr-2" />
                    เครื่องมือจัดการเกณฑ์
                    <ChevronDown className="w-4 h-4 ml-1 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>ตั้งค่าจากค่าเริ่มต้นของระบบ (Auto)</DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleAutoSetTargetAge} disabled={isProcessing}>
                    <Wand2 className="w-4 h-4 mr-2 text-purple-600 shrink-0" />
                    <div className="flex flex-col">
                      <span>อัปเดตอายุเป้าหมาย (Auto)</span>
                      <span className="text-xs text-slate-500">ดึงอายุเป้าหมายทุกเกณฑ์จากตารางมาตรฐาน</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAutoSetDateChecks} disabled={isProcessing}>
                    <Wand2 className="w-4 h-4 mr-2 text-purple-600 shrink-0" />
                    <div className="flex flex-col">
                      <span>อัปเดตคู่เข็มตรวจวันที่ (Auto)</span>
                      <span className="text-xs text-slate-500">เติมคู่ห้ามวันซ้ำ / ลำดับวันที่ให้ทุกเกณฑ์</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleRestoreDefaults} disabled={isProcessing} className="text-red-600 focus:text-red-700 focus:bg-red-50">
                    <RotateCcw className="w-4 h-4 mr-2 shrink-0" />
                    <div className="flex flex-col">
                      <span>คืนค่าเริ่มต้น (Restore)</span>
                      <span className="text-xs text-red-400">ล้างกฎของปีนี้ทั้งหมดแล้ว seed ใหม่ — การแก้ไขทั้งหมดจะหาย</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-slate-500">กำลังโหลด...</div>
        ) : error ? (
          <div className="py-8 text-center text-red-500">{error}</div>
        ) : displayRules.length === 0 ? (
          <div className="py-12 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
            <h3 className="text-lg font-medium text-slate-700 mb-2">ยังไม่มีเกณฑ์วัคซีนสำหรับปี {fiscalYear}</h3>
            {isAdmin ? (
              <>
                <p className="text-slate-500 mb-6">คุณสามารถสร้างเกณฑ์เริ่มต้น (Default) หรือคัดลอกเกณฑ์จากปีที่ผ่านมา</p>
                <div className="flex justify-center gap-4">
                  <Button onClick={handleSeedRules} disabled={isProcessing}>
                    สร้างเกณฑ์เริ่มต้น (Default Rules)
                  </Button>
                  <Button variant="outline" onClick={() => handleCloneRules(fiscalYear - 1)} disabled={isProcessing}>
                    คัดลอกเกณฑ์จากปี {fiscalYear - 1}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-slate-500 mb-6">กรุณาติดต่อผู้ดูแลระบบเพื่อสร้างเกณฑ์วัคซีนสำหรับปีนี้</p>
            )}
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
                {displayRules.map(rule => (
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
          allRules={displayRules}
          rule={editingRule}
          isOpen={!!editingRule}
          onClose={() => setEditingRule(null)}
          onSave={handleSaveModal}
          fiscalYear={fiscalYear}
          ageGroup={ageGroup}
        />
      )}

      {/* Unsaved Changes Navigation Blocker Modal */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl border border-red-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <AlertCircle className="w-7 h-7" />
              <h3 className="text-xl font-bold">ยังไม่ได้บันทึกข้อมูล!</h3>
            </div>
            <p className="text-slate-600 mb-6 text-base">
              คุณมีการเปลี่ยนแปลงฉบับร่างที่ยังไม่ได้กด <strong>"Batch Save"</strong><br/>
              หากเปลี่ยนหน้าตอนนี้ข้อมูลที่แก้ไว้จะหายไปทั้งหมด ต้องการดำเนินการต่อหรือไม่?
            </p>
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="outline" size="lg" onClick={() => blocker.reset?.()} className="font-medium">
                ยกเลิก (อยู่หน้านี้ต่อ)
              </Button>
              <Button size="lg" className="bg-red-600 hover:bg-red-700 text-white font-medium" onClick={() => {
                queryClient.resetQueries({ queryKey: ['vaccineRules'] }); // Clear optimistic cache
                blocker.proceed?.();
              }}>
                ยืนยันที่จะทิ้งการเปลี่ยนแปลง
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Save Confirmation Diff Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-2xl border border-blue-100 max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-2 text-blue-600 shrink-0">
              <CheckCircle2 className="w-7 h-7" />
              <h3 className="text-xl font-bold">ยืนยันการบันทึกการเปลี่ยนแปลง</h3>
            </div>
            <p className="text-slate-600 mb-4 text-sm shrink-0">
              กรุณาตรวจสอบการเปลี่ยนแปลงด้านล่างนี้ก่อนทำการบันทึกลงฐานข้อมูล
            </p>
            
            <div className="overflow-y-auto pr-2 flex-1 min-h-[100px]">
              {modifiedRuleDiffs.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  <p className="text-slate-500 font-medium">ไม่มีการเปลี่ยนแปลงข้อมูล</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {modifiedRuleDiffs.map(draft => {
                    const original = rules.find(r => r.rule_id === draft.rule_id)!;
                    const hasNameChange = original.display_name !== draft.display_name;
                    
                    const renderStringDiff = (label: string, oldVal: string, newVal: string) => (
                      <div className="grid grid-cols-[120px_1fr] gap-4 items-center p-3 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                        <span className="text-slate-500 font-medium text-sm">{label}:</span>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 px-3 py-2 bg-rose-50/50 border border-rose-100 rounded-md text-rose-700 line-through decoration-rose-300 opacity-75 text-sm truncate" title={oldVal}>
                            {oldVal}
                          </div>
                          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 shadow-sm border border-slate-200">
                            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                          <div className="flex-1 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 font-medium text-sm shadow-sm truncate" title={newVal}>
                            {newVal}
                          </div>
                        </div>
                      </div>
                    );

                    const renderArrayDiff = (label: string, oldArr: string[], newArr: string[]) => (
                      <div className="grid grid-cols-[120px_1fr] gap-4 items-start p-3 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                        <span className="text-slate-500 font-medium text-sm pt-2">{label}:</span>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 flex flex-wrap gap-1.5 p-2 bg-rose-50/50 border border-rose-100 rounded-md min-h-[40px] items-center">
                            {oldArr.length === 0 ? <span className="text-rose-400 text-xs italic px-1">ไม่มีข้อมูล</span> : oldArr.map((val, i) => (
                              <span key={i} className="px-2 py-0.5 bg-rose-100/80 text-rose-700 text-xs rounded-full line-through decoration-rose-400 opacity-80">{val}</span>
                            ))}
                          </div>
                          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 shadow-sm border border-slate-200 mt-1.5">
                            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                          <div className="flex-1 flex flex-wrap gap-1.5 p-2 bg-emerald-50 border border-emerald-200 rounded-md min-h-[40px] items-center shadow-sm">
                            {newArr.length === 0 ? <span className="text-emerald-500 text-xs italic px-1">ไม่มีข้อมูล</span> : newArr.map((val, i) => (
                              <span key={i} className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs rounded-full font-medium shadow-sm border border-emerald-200">{val}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );

                    return (
                      <div key={draft.rule_id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all hover:shadow-md">
                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                            <Pencil className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-800 flex items-center gap-2">
                              {original.display_name}
                              {hasNameChange && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] uppercase font-bold rounded-full tracking-wider">Renamed</span>}
                            </h4>
                            <div className="text-xs text-slate-500 mt-0.5">รหัส: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-mono">{draft.rule_id}</code></div>
                          </div>
                        </div>
                        
                        <div className="p-2 space-y-1 divide-y divide-slate-50">
                          {hasNameChange && renderStringDiff("ชื่อเกณฑ์", original.display_name, draft.display_name)}
                          {original.vaccine_group !== draft.vaccine_group && renderStringDiff("กลุ่มวัคซีน", original.vaccine_group || '-', draft.vaccine_group || '-')}
                          {original.hdc_code !== draft.hdc_code && renderStringDiff("รหัส HDC", original.hdc_code || '-', draft.hdc_code || '-')}
                          {original.target_age_months !== draft.target_age_months && renderStringDiff("อายุเป้าหมาย (เดือน)", original.target_age_months?.toString() || 'ค่าตั้งต้น', draft.target_age_months?.toString() || 'ค่าตั้งต้น')}
                          {original.logic_type !== draft.logic_type && renderStringDiff("เงื่อนไข (Logic)", original.logic_type, draft.logic_type)}
                          {original.view_type !== draft.view_type && renderStringDiff("มุมมอง (View)", `View ${original.view_type}`, `View ${draft.view_type}`)}
                          {original.is_active !== draft.is_active && renderStringDiff("สถานะ", original.is_active ? 'Active' : 'Inactive', draft.is_active ? 'Active' : 'Inactive')}
                          {original.is_required_for_v2 !== draft.is_required_for_v2 && renderStringDiff("บังคับใช้ View 2", original.is_required_for_v2 ? 'ใช่' : 'ไม่ใช่', draft.is_required_for_v2 ? 'ใช่' : 'ไม่ใช่')}
                          {JSON.stringify(original.required_fields) !== JSON.stringify(draft.required_fields) && renderArrayDiff("ฟิลด์ที่ต้องการ", original.required_fields, draft.required_fields)}
                          {JSON.stringify(original.branch_alt_fields || []) !== JSON.stringify(draft.branch_alt_fields || []) && renderArrayDiff("ฟิลด์ทางเลือก", original.branch_alt_fields || [], draft.branch_alt_fields || [])}
                          {JSON.stringify(original.date_checks) !== JSON.stringify(draft.date_checks) && renderStringDiff("ตรวจสอบข้อมูลวันที่", describeDateChecks(original, rules), describeDateChecks(draft, displayRules))}
                          {original.note !== draft.note && renderStringDiff("หมายเหตุ", original.note || '-', draft.note || '-')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100 shrink-0">
              <Button variant="outline" size="lg" onClick={() => setShowConfirmModal(false)} className="font-medium" disabled={isProcessing}>
                ยกเลิก
              </Button>
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white font-medium" onClick={executeBatchSave} disabled={isProcessing || modifiedRuleDiffs.length === 0}>
                {isProcessing ? 'กำลังบันทึก...' : 'ยืนยันการบันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

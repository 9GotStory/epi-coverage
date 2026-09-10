import { getRuleDateChecks } from '../../../shared/utils/vaccine/dateWarnings';
import { buildFieldLabelMap } from '../../../shared/utils/vaccine/rulePresentation';
import { vaccineFieldLabel } from '../../../shared/utils/vaccine/hdcData';
import { useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBlocker } from "react-router-dom";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/ui/dialog";
import { Button } from "../../../shared/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../shared/components/ui/form";
import { Input } from "../../../shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/ui/select";
import { Switch } from "../../../shared/components/ui/switch";
import type { VaccineRule } from "../../../shared/utils/vaccine/ruleEngine";

const ruleSchema = z.object({
  date_checks: z.object({
    before_birth: z.boolean(),
    allow_on_birth: z.boolean(),
    same_day_pairs: z.array(z.object({ field: z.string().min(1), other_field: z.string().min(1) })),
    ordered_pairs: z.array(z.object({ field: z.string().min(1), other_field: z.string().min(1) })),
  }),
  display_name: z.string().min(1, "กรุณาระบุชื่อแสดงผล"),
  vaccine_group: z.string().min(1, "กรุณาระบุกลุ่มวัคซีน (เช่น BCG, HBV)"),
  hdc_code: z.string().optional(),
  view_type: z.number().min(1).max(2),
  logic_type: z.enum(["ALL", "ANY", "BRANCH"]),
  required_fields: z
    .array(z.object({ value: z.string().min(1, "ห้ามเว้นว่าง") }))
    .min(1, "ต้องมีฟิลด์บังคับอย่างน้อย 1 ฟิลด์"),
  branch_alt_fields: z.array(z.object({ value: z.string().min(1, "ห้ามเว้นว่าง") })).optional(),
  is_active: z.boolean(),
  is_required_for_v2: z.boolean(),
  target_age_months: z.number().nullable().optional(),
  note: z.string().optional(),
}).refine(
  (data) => {
    if (data.logic_type === "BRANCH") {
      return data.branch_alt_fields && data.branch_alt_fields.length > 0;
    }
    return true;
  },
  {
    message: "ต้องระบุฟิลด์ทางเลือกสำหรับเงื่อนไขแบบ BRANCH",
    path: ["branch_alt_fields"],
  }
);

type RuleFormValues = z.infer<typeof ruleSchema>;

interface RuleEditModalProps {
  allRules: VaccineRule[];
  rule: VaccineRule | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedRule: VaccineRule) => void;
  // Fallbacks for new rule creation
  fiscalYear: number;
  ageGroup: string;
}

export function RuleEditModal({ rule, allRules, isOpen, onClose, onSave, fiscalYear, ageGroup }: RuleEditModalProps) {
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      date_checks: { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] },
      display_name: "",
      vaccine_group: "",
      hdc_code: "",
      view_type: 1,
      logic_type: "ALL",
      required_fields: [],
      branch_alt_fields: [],
      is_active: true,
      is_required_for_v2: true,
      target_age_months: null,
      note: "",
    },
  });

  const {
    fields: requiredFields,
    append: appendRequired,
    remove: removeRequired,
  } = useFieldArray({
    name: "required_fields",
    control: form.control,
  });

  const {
    fields: branchFields,
    append: appendBranch,
    remove: removeBranch,
  } = useFieldArray({
    name: "branch_alt_fields",
    control: form.control,
  });

  const sameDay = useFieldArray({ control: form.control, name: 'date_checks.same_day_pairs' });
  const ordered = useFieldArray({ control: form.control, name: 'date_checks.ordered_pairs' });
  const currentFields = [...form.watch('required_fields'), ...(form.watch('branch_alt_fields') || [])].map(f => f.value);
  const dateOptions = [...new Set([...allRules.flatMap(r => [...r.required_fields, ...(r.branch_alt_fields || [])]), ...currentFields])].filter(Boolean).sort();
  // ป้ายชื่อวัคซีนมาจาก vaccine_rules (display_name ของ rule ที่ใช้ field นั้น) ไม่ hardcode
  const fieldLabelMap = buildFieldLabelMap(allRules);
  const dateOptionLabel = (value: string) => {
    const label = fieldLabelMap.get(value) ?? vaccineFieldLabel(value);
    return label === value ? value : `${label} (${value})`;
  };

  const logicType = form.watch("logic_type");

  useEffect(() => {
    if (isOpen) {
      if (rule) {
        form.reset({
          date_checks: getRuleDateChecks(rule, allRules),
          display_name: rule.display_name || "",
          vaccine_group: rule.vaccine_group || "",
          hdc_code: rule.hdc_code != null ? String(rule.hdc_code) : "",
          view_type: rule.view_type || 1,
          logic_type: (rule.logic_type as "ALL" | "ANY" | "BRANCH") || "ALL",
          required_fields: rule.required_fields?.map((f) => ({ value: f })) || [],
          branch_alt_fields: rule.branch_alt_fields?.map((f) => ({ value: f })) || [],
          is_active: rule.is_active ?? true,
          is_required_for_v2: rule.is_required_for_v2 ?? true,
          target_age_months: rule.target_age_months ?? null,
          note: rule.note || "",
        });
      } else {
        form.reset({
          date_checks: { before_birth: true, allow_on_birth: false, same_day_pairs: [], ordered_pairs: [] },
      display_name: "",
          vaccine_group: "",
          hdc_code: "",
          view_type: 1,
          logic_type: "ALL",
          required_fields: [],
          branch_alt_fields: [],
          is_active: true,
          is_required_for_v2: true,
          note: "",
        });
      }
    }
  }, [rule, isOpen, form, allRules]);

  const isDirty = form.formState.isDirty;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isOpen && isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("คุณมีการพิมพ์แก้ไขค้างไว้ใน Popup ต้องการทิ้งการเปลี่ยนแปลงและเปลี่ยนหน้าหรือไม่?")) {
        blocker.proceed?.();
      } else {
        blocker.reset?.();
      }
    }
  }, [blocker]);

  // Prevent closing tab/window if popup is dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isOpen && isDirty) {
        e.preventDefault();
        e.returnValue = ''; // Standard way to show browser prompt
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOpen, isDirty]);

  const onSubmit = (data: RuleFormValues) => {
    const own = [...data.required_fields, ...(data.branch_alt_fields || [])].map(f => f.value.trim());
    for (const key of ['same_day_pairs', 'ordered_pairs'] as const) {
      const seen = new Set<string>();
      for (const pair of data.date_checks[key]) {
        const id = key === 'same_day_pairs' ? [pair.field, pair.other_field].sort().join('|') : `${pair.field}|${pair.other_field}`;
        if (pair.field === pair.other_field || (!own.includes(pair.field) && !own.includes(pair.other_field)) || seen.has(id)) {
          form.setError('date_checks', { message: 'กรุณาเลือกคู่เข็มต่างกัน ไม่ซ้ำ และมีอย่างน้อยหนึ่งเข็มอยู่ในเกณฑ์นี้' });
          return;
        }
        seen.add(id);
      }
    }
    const isNew = !rule;
    
    const updatedRule: VaccineRule = {
      ...(rule || {}),
      rule_id: rule?.rule_id || `rule_${Date.now()}`,
      fiscal_year: rule?.fiscal_year || fiscalYear,
      age_group: rule?.age_group || ageGroup,
      
      date_checks: data.date_checks,
      display_name: data.display_name,
      vaccine_group: data.vaccine_group,
      hdc_code: data.hdc_code || "",
      view_type: data.view_type,
      logic_type: data.logic_type,
      required_fields: data.required_fields.map((f) => f.value.trim()),
      branch_alt_fields: data.branch_alt_fields?.map((f) => f.value.trim()) || [],
      is_active: data.is_active,
      is_required_for_v2: data.is_required_for_v2,
      target_age_months: data.target_age_months ?? undefined,
      note: data.note,
    };

    onSave(updatedRule);
    toast.success(isNew ? "สร้างเกณฑ์ใหม่ในหน่วยความจำแล้ว" : "บันทึกการแก้ไขในหน่วยความจำแล้ว");
    onClose();
  };

  const handleClose = () => {
    if (form.formState.isDirty) {
      if (!window.confirm("คุณมีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการยกเลิกและทิ้งการเปลี่ยนแปลงหรือไม่?")) {
        return;
      }
    }
    onClose();
  };

  const viewType = form.watch("view_type");

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>{rule ? "แก้ไขเกณฑ์วัคซีน" : "สร้างเกณฑ์วัคซีนใหม่"}</DialogTitle>
          <DialogDescription>
            {rule ? `ปรับแต่งเงื่อนไขการตรวจสอบวัคซีนของ ${rule.vaccine_group}` : "กำหนดเงื่อนไขการประเมินและรหัสที่ใช้ตรวจสอบสำหรับวัคซีนใหม่"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ชื่อแสดงผล (Display Name)</FormLabel>
                  <FormControl>
                    <Input placeholder="เช่น วัคซีนรวม 4 เดือน" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="vaccine_group"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>กลุ่มวัคซีน (Vaccine Group)</FormLabel>
                    <FormControl>
                      <Input placeholder="เช่น BCG, HBV, DTP" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hdc_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>รหัส HDC (ถ้ามี)</FormLabel>
                    <FormControl>
                      <Input placeholder="เช่น 041, I11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="target_age_months"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>อายุเป้าหมาย (เดือน)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))} value={field.value ?? ''} />
                    </FormControl>
                    <FormDescription>
                      ไม่บังคับกรอก (ถ้าปล่อยว่าง: จะไม่มีสถานะ 'รอดำเนินการ' ถ้าไม่ได้ฉีดจะถือว่าขาดทันที)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="view_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>มุมมอง (View Type)</FormLabel>
                    <Select 
                      onValueChange={(val) => field.onChange(Number(val))} 
                      value={String(field.value)}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="เลือกมุมมอง" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">View 1 (รายบุคคล)</SelectItem>
                        <SelectItem value="2">View 2 (Fully Immunized)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logic_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ประเภทตรรกะ (Logic Type)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="เลือกประเภทตรรกะ" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ALL">ALL (ต้องครบทุกเข็ม)</SelectItem>
                        <SelectItem value="ANY">ANY (แค่เข็มใดเข็มหนึ่ง)</SelectItem>
                        <SelectItem value="BRANCH">BRANCH (มีทางเลือกทดแทน)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>วิธีการตรวจผ่าน</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="is_active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-white">
                      <div className="space-y-0.5">
                        <FormLabel>สถานะใช้งาน</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                {viewType === 2 ? (
                  <FormField
                    control={form.control}
                    name="is_required_for_v2"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-white">
                        <div className="space-y-0.5">
                          <FormLabel>บังคับ View 2</FormLabel>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : (
                  <div className="hidden"></div>
                )}
              </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel>ฟิลด์บังคับ (Required Fields)</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendRequired({ value: "" })}
                  className="h-8 text-xs bg-white"
                >
                  <Plus className="w-3 h-3 mr-1" /> เพิ่มฟิลด์
                </Button>
              </div>
              <div className="space-y-2">
                {requiredFields.map((field, index) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`required_fields.${index}.value`}
                    render={({ field: inputField }) => (
                      <FormItem>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <Input {...inputField} placeholder="เช่น rv21_date" className="bg-white" />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                              onClick={() => removeRequired(index)}
                              disabled={requiredFields.length === 1}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              {form.formState.errors.required_fields?.root && (
                <p className="text-[0.8rem] font-medium text-destructive">
                  {form.formState.errors.required_fields.root.message}
                </p>
              )}
            </div>

            {logicType === "BRANCH" && (
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <FormLabel>ฟิลด์ทางเลือก (Branch Alt Fields)</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendBranch({ value: "" })}
                    className="h-8 text-xs bg-white"
                  >
                    <Plus className="w-3 h-3 mr-1" /> เพิ่มทางเลือก
                  </Button>
                </div>
                <FormDescription>
                  ถ้าฟิลด์บังคับไม่ผ่าน จะมาตรวจฟิลด์เหล่านี้แทน (ต้องผ่านทุกอันในนี้)
                </FormDescription>
                <div className="space-y-2">
                  {branchFields.map((field, index) => (
                    <FormField
                      key={field.id}
                      control={form.control}
                      name={`branch_alt_fields.${index}.value`}
                      render={({ field: inputField }) => (
                         <FormItem>
                           <FormControl>
                            <div className="flex items-center gap-2">
                              <Input {...inputField} placeholder="เช่น rv31_date" className="bg-white" />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                                onClick={() => removeBranch(index)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                           </FormControl>
                           <FormMessage />
                         </FormItem>
                      )}
                    />
                  ))}
                  {branchFields.length === 0 && (
                    <p className="text-sm text-slate-500 italic text-center py-2 bg-slate-50 rounded">
                      ยังไม่มีฟิลด์ทางเลือก
                    </p>
                  )}
                </div>
                {form.formState.errors.branch_alt_fields?.root && (
                  <p className="text-[0.8rem] font-medium text-destructive">
                    {form.formState.errors.branch_alt_fields.root.message}
                  </p>
                )}
              </div>
            )}

            <section className="border rounded-lg p-4 space-y-4">
              <h3 className="font-semibold">ตรวจสอบข้อมูลวันที่</h3>
              {!rule?.date_checks && <p className="text-sm text-zinc-500">เกณฑ์เดิมยังไม่มีการตั้งค่ารายคู่ ระบบแสดงค่าเริ่มต้นให้ตรวจทาน กดบันทึกฉบับร่างและยืนยันบันทึกเพื่อใช้ค่าที่เลือก</p>}
              <p className="text-sm text-zinc-500">ใช้กับเข็มในเกณฑ์นี้ แสดงรายละเอียดในประวัติการรับวัคซีน กฎวันซ้ำเป็นการตรวจข้อมูลตามที่ผู้ดูแลกำหนด ไม่ใช่ข้อห้ามฉีดวัคซีนร่วมกันทางการแพทย์</p>
              {(['before_birth', 'allow_on_birth'] as const).map(key => <FormField key={key} control={form.control} name={`date_checks.${key}`} render={({ field }) => <FormItem className="flex items-center justify-between gap-3">
                <FormLabel>{key === 'before_birth' ? 'เตือนเมื่อฉีดก่อนวันเกิด' : 'อนุญาตวันที่ฉีดตรงวันเกิด'}</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>} />)}
              {([{ key: 'same_day_pairs', array: sameDay, title: 'ห้ามบันทึกวันเดียวกัน', relation: 'กับ' }, { key: 'ordered_pairs', array: ordered, title: 'ลำดับวันที่ฉีด', relation: 'ต้องไม่หลัง' }] as const).map(({ key, array, title, relation }) => <div key={key} className="space-y-2">
                <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{title}</h4><Button type="button" variant="outline" size="sm" onClick={() => array.append({ field: '', other_field: '' })}>เพิ่มคู่เข็ม</Button></div>
                {array.fields.length === 0 && <p className="text-sm text-zinc-500">ไม่ได้กำหนดคู่เข็ม</p>}
                {array.fields.map((pair, index) => <div key={pair.id} className="flex flex-wrap items-center gap-2">
                  {(['field', 'other_field'] as const).map((side, position) => <div key={side} className="flex items-center gap-2 flex-1 min-w-48">
                    {position === 1 && <span className="text-sm">{relation}</span>}
                    <FormField control={form.control} name={`date_checks.${key}.${index}.${side}`} render={({ field }) => <FormItem className="flex-1"><FormControl>
                      <select {...field} aria-label={`${title} ${index + 1} ${position === 0 ? 'เข็มแรก' : 'เข็มที่เปรียบเทียบ'}`} className="border rounded-lg px-3 py-2 text-sm w-full bg-white">
                        <option value="">เลือกเข็มวัคซีน</option>
                        {dateOptions.map(value => <option key={value} value={value}>{dateOptionLabel(value)}</option>)}
                      </select>
                    </FormControl><FormMessage /></FormItem>} />
                  </div>)}
                  <Button type="button" variant="outline" size="sm" onClick={() => array.remove(index)}>ลบคู่เข็ม</Button>
                </div>)}
              </div>)}
              {form.formState.errors.date_checks?.message && <p className="text-sm text-destructive">{form.formState.errors.date_checks.message}</p>}
            </section>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={handleClose} className="bg-white">
                ยกเลิก
              </Button>
              <Button type="submit">
                ตกลง (บันทึกฉบับร่าง)
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

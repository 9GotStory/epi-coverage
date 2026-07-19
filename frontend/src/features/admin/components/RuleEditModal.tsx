import { useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  display_name: z.string().min(1, "กรุณาระบุชื่อแสดงผล"),
  logic_type: z.enum(["ALL", "ANY", "BRANCH"]),
  required_fields: z
    .array(z.object({ value: z.string().min(1, "ห้ามเว้นว่าง") }))
    .min(1, "ต้องมีฟิลด์บังคับอย่างน้อย 1 ฟิลด์"),
  branch_alt_fields: z.array(z.object({ value: z.string().min(1, "ห้ามเว้นว่าง") })).optional(),
  is_active: z.boolean(),
  is_required_for_v2: z.boolean(),
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
  rule: VaccineRule | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedRule: VaccineRule) => void;
}

export function RuleEditModal({ rule, isOpen, onClose, onSave }: RuleEditModalProps) {
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      display_name: "",
      logic_type: "ALL",
      required_fields: [],
      branch_alt_fields: [],
      is_active: true,
      is_required_for_v2: true,
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

  const logicType = form.watch("logic_type");

  useEffect(() => {
    if (rule && isOpen) {
      form.reset({
        display_name: rule.display_name || "",
        logic_type: (rule.logic_type as "ALL" | "ANY" | "BRANCH") || "ALL",
        required_fields: rule.required_fields?.map((f) => ({ value: f })) || [],
        branch_alt_fields: rule.branch_alt_fields?.map((f) => ({ value: f })) || [],
        is_active: rule.is_active ?? true,
        is_required_for_v2: rule.is_required_for_v2 ?? true,
        note: rule.note || "",
      });
    }
  }, [rule, isOpen, form]);

  const onSubmit = (data: RuleFormValues) => {
    if (!rule) return;

    const updatedRule: VaccineRule = {
      ...rule,
      display_name: data.display_name,
      logic_type: data.logic_type,
      required_fields: data.required_fields.map((f) => f.value.trim()),
      branch_alt_fields: data.branch_alt_fields?.map((f) => f.value.trim()) || [],
      is_active: data.is_active,
      is_required_for_v2: data.is_required_for_v2,
      note: data.note,
    };

    onSave(updatedRule);
    toast.success("บันทึกการแก้ไขในหน่วยความจำแล้ว (อย่าลืมกด Batch Save เพื่อบันทึกลงฐานข้อมูล)");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>แก้ไขเกณฑ์วัคซีน</DialogTitle>
          <DialogDescription>
            ปรับแต่งเงื่อนไขการตรวจสอบวัคซีนของ {rule?.vaccine_group}
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

            <div className="grid grid-cols-2 gap-4">
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

              <div className="space-y-4 pt-2">
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
              </div>
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

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={onClose} className="bg-white">
                ยกเลิก
              </Button>
              <Button type="submit">
                ตกลง
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

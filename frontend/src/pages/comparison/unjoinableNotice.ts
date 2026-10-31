import type { ComparisonView } from './model';

/**
 * #58 Phase 1 / #97: measured wording for vaccine entries that lack a stored
 * `metric_key`, scoped to the SELECTED age group + View + fiscal year. Counts
 * come from the reader (verdict buckets already excluded); this helper only
 * formats — it never claims rules have no keys and never fabricates a join.
 */
export function formatUnjoinableVaccineNotice(info: {
  fiscalYear: number;
  view: ComparisonView;
  /** real vaccine entries in the selected age+view+FY breakdown */
  vaccineEntries: number;
  /** of those, entries without a valid stored metric_key */
  unjoinableEntries: number;
}): string {
  const { fiscalYear, view, vaccineEntries, unjoinableEntries } = info;
  const scope = `ปี ${fiscalYear} · View ${view}`;
  if (unjoinableEntries >= vaccineEntries) {
    return `${scope}: ข้อมูลสรุปมีวัคซีน ${vaccineEntries} รายการ โดยทุกรายการยังไม่มีรหัสเชื่อมโยงสำหรับการเปรียบเทียบข้ามปี`;
  }
  return `${scope}: ข้อมูลสรุปมีวัคซีน ${vaccineEntries} รายการ โดย ${unjoinableEntries} รายการยังไม่มีรหัสเชื่อมโยงสำหรับการเปรียบเทียบข้ามปี (อีก ${vaccineEntries - unjoinableEntries} รายการเปรียบเทียบได้)`;
}

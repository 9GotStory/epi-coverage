# Database Schema (Google Sheets)

ระบบใช้ Google Sheets เป็นฐานข้อมูลหลัก โดยแบ่งออกเป็นหลาย Sheet ดังนี้:

คอลัมน์ HDC เพิ่มเติมทุกอายุ, source_columns, epi_import_batches และคีย์อัปเดตปัจจุบันดู [HDC column upgrade](hdc-column-upgrade.md) ทุก `*_date` มีคู่ `*_hospcode` และ `*_input_hosp` เก็บเป็นข้อความ รวม `addr`, `check_typearea`, `nation`, `discharge`, `g_*` ด้วย

## 1. `Users` (จัดการผู้ใช้งาน)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | String | รหัสอ้างอิงผู้ใช้ (UUID) |
| `google_id` | String | รหัสผู้ใช้จาก Google (ได้จาก JWT Payload `sub`) ป้องกันการปลอมแปลงอีเมล |
| `email` | String | อีเมลผู้ใช้ (Primary Key) |
| `name` | String | ชื่อ-นามสกุล |
| `hoscode` | String | รหัสสถานบริการที่สังกัด (เช่น 06422) หากเป็น `00588` (สสอ.สอง) จะเห็นข้อมูลทั้งหมด |
| `role` | Enum | สิทธิ์ผู้ใช้ (`user`, `admin`, `superadmin`) |
| `status` | Enum | สถานะการอนุมัติ (`pending`, `approved`, `rejected`) |
| `created_at` | DateTime | วันที่สมัคร |
| `last_login` | DateTime | วันเวลาที่ล็อกอินล่าสุด |

## 2. `Epi_1_Year` (ข้อมูลวัคซีนเด็ก 1 ปี)
*หมายเหตุ: ทุกฟิลด์ที่มีคำว่า `hosc` หรือ `hosp` จะต้องถูกจัดเก็บแบบ Plain Text เพื่อรักษาเลข 0 นำหน้า*
| Column | Type | Description |
| :--- | :--- | :--- |
| `hoscode` | String | รหัส รพ.สต. ที่ดูแล (Text) |
| `hosname` | String | ชื่อ รพ.สต. |
| `pid` | String | รหัสบุคคล (PID) จากฐานข้อมูล HDC/JHCIS |
| `cid` | String | CID ต้นทาง อาจมี * ปิดบังและซ้ำกัน จับคู่ด้วย PID + hoscode + fiscal_year + sex + birth + check_vhid |
| `name` | String | ชื่อผู้ป่วย (Masked) |
| `lname` | String | นามสกุล (Masked) |
| `sex` | String | เพศ |
| `birth` | Date | วันเกิด (YYYY-MM-DD) สำหรับคำนวณอายุและเป็นส่วนหนึ่งของคีย์อัปเดต |
| `check_vhid` | String | รหัสบ้าน (ถ้ามี) |
| `bcg_date`, `bcg_hospcode` | Date, String | วันที่ฉีด BCG และรหัสสถานพยาบาลที่ฉีด |
| `hbv1_date` ... `hbv4_date` | Date | วันที่ฉีด HBV 1-4 |
| `dtp1_date` ... `dtp3_date` | Date | วันที่ฉีด DTP 1-3 |
| `hib1_date` ... `hib3_date` | Date | วันที่ฉีด Hib 1-3 |
| `ipv1_date`, `ipv2_date` | Date | วันที่ฉีด IPV 1-2 |
| `opv1_date` ... `opv3_date` | Date | วันที่หยอด OPV ต้นทาง; mapping OPV 6 เดือนยังรอยืนยัน ดูเอกสาร upgrade |
| `mmr1_date` | Date | วันที่ฉีด MMR 1 |
| `rv21_date` ... `rv33_date` | Date | วันที่ฉีด Rota (`rv21, rv22` = ชนิด 2 เข็ม หรือ `rv31, rv32, rv33` = ชนิด 3 เข็ม) |
| `pcv1_date` ... `pcv3_date` | Date | วันที่ฉีด PCV 1-3 |
| `batch_id` | String | รหัสรอบการอัปโหลด (UUID สร้างตอนอัปโหลดแต่ละครั้ง) |
| `fiscal_year` | String | ปีงบประมาณของข้อมูลชุดนี้ (ระบุตอนอัปโหลด เพื่อกำหนด Scope) |
| `last_seen_batch` | String | รหัสอ้างอิงรอบการอัปโหลดล่าสุด (ใช้ตรวจสอบเด็กที่ย้ายออกโดยสร้าง Soft Delete) |
| `is_active` | Boolean | สถานะยังอยู่ในพื้นที่หรือไม่ (TRUE/FALSE) |
| `ai_analysis` | String | ผลการวิเคราะห์จาก AI (Gemini) สำหรับเคสที่มีปัญหา (รักษาค่าเดิมเมื่ออัปโหลด แต่ไม่ถือว่าเป็นผลวิเคราะห์ใหม่) |
| `ai_analyzed_at` | DateTime | วันเวลาที่ AI ทำการประมวลผล |

## 3. `Epi_2_Year` (ข้อมูลวัคซีนเด็ก 2 ปี)
*หมายเหตุ: โครงสร้างเหมือนเด็ก 1 ปี แต่เพิ่มคอลัมน์สำหรับวัคซีนเด็ก 2 ปี และเก็บแบบ Plain Text สำหรับ hosc/hosp*
| Column | Type | Description |
| :--- | :--- | :--- |
| `hoscode` - `check_vhid` | String/Date | (โครงสร้างเดียวกับตารางเด็ก 1 ปี) |
| `dtp4_date`, `dtp4_hospcode` | Date, String | วันที่ฉีด DTP เข็ม 4 |
| `opv4_date`, `opv4_hospcode` | Date, String | วันที่หยอด OPV เข็ม 4 |
| `mmr2_date`, `mmr2_hospcode` | Date, String | วันที่ฉีด MMR เข็ม 2 |
| `j11_date`, `j11_hospcode` | Date, String | วันที่ฉีด LAJE เข็ม 1 |
| `je1_date`, `je2_date` | Date | วันที่ฉีด JE 1-2 (ถ้ามี) |
| `batch_id`, `fiscal_year` | String | (เหมือนตารางเด็ก 1 ปี) |
| `last_seen_batch`, `is_active` | String, Boolean| (เหมือนตารางเด็ก 1 ปี) |

## 4. `Epi_3_Year` (ข้อมูลวัคซีนเด็ก 3 ปี)
*หมายเหตุ: โครงสร้างเหมือนเด็ก 1 และ 2 ปี เพิ่มคอลัมน์ LAJE 2 หรือ JE 3 และเก็บแบบ Plain Text สำหรับ hosc/hosp*
| Column | Type | Description |
| :--- | :--- | :--- |
| `hoscode` - `check_vhid` | String/Date | (โครงสร้างเดียวกับตารางเด็ก 1 ปี) |
| `dtp4_date`, `dtp4_hospcode` | Date, String | วันที่ฉีด DTP เข็ม 4 |
| `opv4_date`, `opv4_hospcode` | Date, String | วันที่หยอด OPV เข็ม 4 |
| `mmr2_date`, `mmr2_hospcode` | Date, String | วันที่ฉีด MMR เข็ม 2 |
| `j11_date`, `j11_hospcode` | Date, String | วันที่ฉีด LAJE เข็ม 1 |
| `j12_date`, `j12_hospcode` | Date, String | วันที่ฉีด LAJE เข็ม 2 |
| `je1_date` ... `je3_date` | Date | วันที่ฉีด JE 1-3 |
| `batch_id`, `fiscal_year` | String | (เหมือนตารางเด็ก 1 ปี) |
| `last_seen_batch`, `is_active` | String, Boolean| (เหมือนตารางเด็ก 1 ปี) |
## 5. `facilities` (หน่วยบริการ)
| Column | Type | Description |
| :--- | :--- | :--- |
| `hoscode` | String | รหัสสถานบริการ (Primary Key) |
| `hosname` | String | ชื่อสถานบริการ |
| `is_active` | Boolean | สถานะการเปิดใช้งาน (TRUE/FALSE) |

## 6. `audit_logs` (บันทึกการทำงาน)
| Column | Type | Description |
| :--- | :--- | :--- |
| `log_id` | String | รหัสอ้างอิง (UUID) |
| `user_id` | String | รหัสผู้ใช้ (Foreign Key เชื่อมโยงกับ `id` ใน `Users`) |
| `email` | String | อีเมลผู้กระทำ (เก็บไว้เพื่ออ่านได้ง่ายโดยไม่ต้อง JOIN) |
| `action` | String | การกระทำ (เช่น `login`, `upload_excel`, `approve_user`, `export_data`) |
| `details` | String | รายละเอียด (เช่น "อัปเดตไฟล์ วัคซีน 1 ปี จำนวน 500 records") |
| `timestamp` | DateTime | วันเวลาที่กระทำ (ใช้แสดง As of Date ใน Dashboard) |

## 7. `configs_system` (ค่าตั้งต้นระบบ)
| Column | Type | Description |
| :--- | :--- | :--- |
| `config_key` | String | ชื่อตัวแปร (เช่น `target_coverage_percent`, `current_year`) |
| `config_value` | String | ค่าของตัวแปร |
| `description` | String | คำอธิบาย |

## 8. `sessions` (จัดการเซสชันการเข้าสู่ระบบ)
| Column | Type | Description |
| :--- | :--- | :--- |
| `session_id` | String | รหัสเซสชัน (UUID) |
| `user_id` | String | รหัสผู้ใช้ (Foreign Key เชื่อมโยงกับ `id` ในตาราง `Users`) |
| `token` | String | Session Token หรือ JWT Token ที่เข้ารหัสแล้ว |
| `ip_address` | String | หมายเลข IP ของผู้ใช้งาน |
| `user_agent` | String | ข้อมูลเบราว์เซอร์และอุปกรณ์ (User Agent) |
| `expires_at` | DateTime | วันเวลาที่เซสชันหมดอายุ |
| `created_at` | DateTime | วันเวลาที่สร้างเซสชัน |


## 9. `vaccine_rules` — การตั้งค่าตรวจวันที่

คอลัมน์ `date_checks` เก็บ JSON: `before_birth` (Boolean), `allow_on_birth` (Boolean), `same_day_pairs` และ `ordered_pairs` (รายการ `{field, other_field}`)

- `same_day_pairs`: คู่คอลัมน์ที่ห้ามมีวันฉีดเดียวกัน
- `ordered_pairs`: วันที่ของ `field` ต้องไม่หลัง `other_field` (วันเท่ากันจะเตือนเฉพาะเมื่อตั้งใน same_day_pairs ด้วย)
- คู่ต้องเป็นคนละคอลัมน์ มีอย่างน้อยหนึ่งคอลัมน์อยู่ในเกณฑ์ที่แก้ไข และเป็นคอลัมน์วันที่ที่ระบบรู้จัก
- บันทึกเดี่ยว/กลุ่มตรวจค่าก่อนเขียน และเพิ่มคอลัมน์ท้ายชีตอัตโนมัติหากยังไม่มี การคัดลอกปีคง JSON เดิม
- กฎเก่าที่คอลัมน์ว่างใช้ค่าเริ่มต้นจากคอลัมน์เข็ม: เปรียบเทียบในชุดเดียวกันและอนุญาตวันเกิดเมื่อ target_age_months = 0 เมื่อบันทึกจากหน้าแก้ไขจะเก็บค่ารายคู่ชัดเจน; array ว่างหมายถึงปิดการตรวจคู่ ไม่ย้อนใช้ค่าเริ่มต้น
- รูปแบบวันที่ที่ไม่ใช่วันที่จริงยังแจ้งเสมอ; ก่อน/ตรงวันเกิดและคู่วันซ้ำ/ลำดับใช้ค่าของแต่ละ rule
- การแก้ต้องส่งผ่าน endpoint ที่ตรวจสิทธิ์ admin เดิม ไม่ต้อง reset หรือ seed กฎเพื่อเพิ่มคอลัมน์นี้

## `Epi_5_Year`

เก็บข้อมูลพื้นฐานและวัคซีนเช่นกลุ่ม 3 ปี เพิ่ม `dtp5_date`, `opv5_date`, `pcv4_date` พร้อม `*_hospcode` และ `*_input_hosp` ของทุกเข็ม รองรับ `je3_date` แม้ไฟล์ตัวอย่างไม่มีคอลัมน์นี้ มุมมองที่ 1 แสดงเฉพาะ DTP/OPV 4 ปี

## `opendata_cache` — Data Lake ข้อมูลรวมจาก HDC OpenData

เก็บแถวข้อมูลรวม (aggregate) ที่ ETL ราตรีดึงจาก MOPH OpenData และให้ `getOpenData` อ่านกลับ ไม่ใช่ข้อมูลรายบุคคล

| Column | Type | Description |
| :--- | :--- | :--- |
| `sync_id` | String | รหัสรอบซิงค์ (UUID) ร่วมกันทุกแถวที่เขียนในรอบเดียวกัน |
| `table_name` | String | ชุดข้อมูล OpenData เช่น `s_epi1`, `s_epi_complete` |
| `fiscal_year` | String | ปีงบประมาณของข้อมูลชุดนั้น |
| `hospcode` | String | รหัสหน่วยบริการ (ว่างได้สำหรับแถวระดับพื้นที่) |
| `areacode` | String | รหัสพื้นที่ (อำเภอ/ตำบล) |
| `raw_json` | String (JSON) | แถวข้อมูลดิบจาก OpenData หนึ่งรายการต่อแถว |
| `updated_at` | String (ISO 8601) | เวลาที่รอบซิงค์เขียนแถวนี้ เก็บเป็นข้อความ ISO 8601 ตามสัญญาข้อความของชีตนี้ (เช่น `2026-09-28T11:58:46.917Z`) |

ข้อตกลงสคีมา (Issue #15):

- ชื่อหัวคอลัมน์เป็นสิ่งที่ถูกยึดถือ (authoritative) ลำดับฟิสิกัลของคอลัมน์ไม่ใช่ — การอ่าน/เขียนต้องอ้างอิงด้วยชื่อหัวคอลัมน์เท่านั้น
- คอลัมน์ที่จำเป็นขาดหาย → เติมเฉพาะคอลัมน์ที่ขาดต่อท้ายชีตแบบไม่ทำลายล้าง (additive) ตามลำดับนิยาม ไม่สลับลำดับคอลัมน์เดิม และไม่เขียนแถวข้อมูลเดิมใหม่
- หัวคอลัมน์ที่จำเป็นซ้ำกัน → สคีมาไม่ถูกต้อง ระบบปฏิเสธ (fail closed) ไม่เลือกตัวซ้ำตัวแรกโดยเงียบ ๆ และไม่แก้สคีมาโดยอัตโนมัติ
- การเติมคอลัมน์ `sync_id`/`updated_at` ให้ชีตเดิม ห้ามสร้างค่าย้อนหลัง (ไม่มี UUID/เวลาที่ปลอมขึ้น) — เซลล์ของแถวประวัติคงว่างจนกว่ารอบซิงค์ที่สำเร็จจะเขียนแทน
- เส้นทางอ่าน (`getOpenData`) ต้อง fail closed เมื่อคอลัมน์ที่ใช้อ่าน (`table_name`, `fiscal_year`, `hospcode`, `raw_json`) ซ้ำหรือขาด ห้ามตอบเป็นชุดข้อมูลว่างที่ "สำเร็จ" โดยเงียบ ๆ
- การเขียนแถวข้อมูลของ sync กำหนดรูปแบบเซลล์ทั้งช่วงเป็นข้อความ (`@`) ก่อน `setValues` เสมอ และตรวจ read-back แบบ schema-aware: ทุกคอลัมน์ของชีตนี้เป็นสัญญาข้อความ จึงต้องอ่านกลับเป็นสตริงเดิมทุกประการ (รวมถึงเลขศูนย์นำหน้าของ `hospcode`/`areacode` และ `raw_json`) — เซลล์ตัวเลขที่สืบทอดจากแถวเก่ายอมรับได้เฉพาะค่าเดิมหรือสตริงทศนิยมตรงตัวของมันเท่านั้น และเซลล์วันที่จริงที่สืบทอดจากแถวเก่าเทียบได้เฉพาะวันที่จริงที่ตรงช่วงเวลา (instant) เดียวกัน ค่าชนิดอื่นเทียบกันตรง ๆ อย่างเคร่งครัด ส่วนความไม่ตรงกันจริงยังคงเป็น `commit_uncertain` (GAS-VERIFY-02, Issue #34)

## `Dashboard_Summaries` — แคชสรุป Dashboard (ข้อมูลรวม)

เก็บสรุปที่คำนวณล่วงหน้าจากข้อมูลรายบุคคล (ตัวเลขรวมเท่านั้น) เพื่อให้หน้า Dashboard/Comparison เรียกดูได้โดยไม่ต้องดึงข้อมูลรายบุคคล

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | String | `<targetTable>_<fiscalYear>_<quarter\|all>` เช่น `Epi_1_Year_2568_all`, `Epi_1_Year_2568_1` (ไตรมาส 1–4) และรูปแบบรุ่นเดิม `<targetTable>_<fiscalYear>` (legacy) |
| `targetTable` | String | `Epi_1_Year` / `Epi_2_Year` / `Epi_3_Year` / `Epi_5_Year` |
| `fiscalYear` | String/Number | ปีงบประมาณของสรุปชุดนั้น |
| `summaryData` | String (JSON) | สรุปตามมุมมองที่ 1/2 (`total`, `view2Coverage`, `view2Passed`, `view2ApplicableTotal`, `view2PendingCount`, breakdown ตามวัคซีน/หน่วยบริการ) — โครงสร้างมีการวิวัฒน์ตามรุ่น สรุปรุ่นเก่าอาจไม่มีฟิลด์ที่เพิ่มในภายหลัง |
| `updated_at` | DateTime | เวลาที่คำนวณ/เขียนสรุปชุดนั้นล่าสุด (ไม่ใช่เวลาอัปโหลดไฟล์ต้นทาง) |

ข้อตกลง (Issue #22):

- การอ่านสรุปประจำปี: แถว `_all` เป็น canonical และมีลำดับเหนือ legacy เสมอ; legacy ถูกใช้เฉพาะเมื่อไม่มี `_all` ของ (ตาราง, ปี) นั้น — backend ตัดสินครั้งเดียวและคืนแถวเดียว ไม่ส่งคู่แถวให้ฝั่งหน้าเว็บเลือกด้วย `updated_at` และแถว `_all` ที่มีอยู่แม้ใช้งานไม่ได้ก็ไม่ถอยกลับไปใช้ legacy
- การอ่านสรุปไตรมาส 1–4 ยังอิง id ระบุไตรมาสของแต่ละแถวตามเดิม
- ปีที่ "ใช้งานได้" สำหรับ Comparison = ปีที่แถวที่ถูกเลือกตามกฎข้างต้นแยก JSON ได้และมี `total`/`view2Coverage`/`view2Passed` เป็นตัวเลขจริง (0 ถือว่าใช้ได้) — ปีที่ไม่ผ่านเงื่อนไขไม่ถูกแจ้งว่ามีข้อมูลสรุป

ข้อตกลงสรุปรุ่นปัจจุบัน (Issue #23):

- สรุปที่สร้างใหม่ทุกแถว (`_all` และ Q1–Q4) บันทึก `view2ApplicableTotal` (จำนวนที่เข้าเกณฑ์ประเมิน = ตัวหารความครอบคลุม) และ `view2PendingCount` (จำนวนที่ยังไม่เข้าเกณฑ์ตามเงื่อนไข pending ปัจจุบันของระบบ) โดยนับตรงจากการประเมินแต่ละรายการ
- เงื่อนไขที่ระบบรับประกัน: `view2Passed <= view2ApplicableTotal <= total` และ `view2ApplicableTotal + view2PendingCount = total`
- ไม่บันทึก `view2Failed` — ค่าที่ไม่ผ่านในกลุ่มที่เข้าเกณฑ์คำนวณ ณ ขณะใช้งานเป็น `view2ApplicableTotal - view2Passed`
- แถวเก่า (legacy) อาจไม่มีสองฟิลด์นี้ ยังคงใช้งานได้ตามฟิลด์ที่มี และไม่มีการ migrate/backfill แถวเดิมใน Issue #นี้

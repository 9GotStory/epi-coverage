# Database Schema (Google Sheets)

ระบบใช้ Google Sheets เป็นฐานข้อมูลหลัก โดยแบ่งออกเป็นหลาย Sheet ดังนี้:

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
| `cid` | String | รหัสบัตร ปชช. (Masked) ใช้ร่วมเป็น Composite Key |
| `name` | String | ชื่อผู้ป่วย (Masked) |
| `lname` | String | นามสกุล (Masked) |
| `sex` | String | เพศ |
| `birth` | Date | วันเกิด (YYYY-MM-DD) สำหรับคำนวณอายุและยืนยันตัวตน |
| `check_vhid` | String | รหัสบ้าน (ถ้ามี) |
| `bcg_date`, `bcg_hospcode` | Date, String | วันที่ฉีด BCG และรหัสสถานพยาบาลที่ฉีด |
| `hbv1_date` ... `hbv4_date` | Date | วันที่ฉีด HBV 1-4 |
| `dtp1_date` ... `dtp3_date` | Date | วันที่ฉีด DTP 1-3 |
| `hib1_date` ... `hib3_date` | Date | วันที่ฉีด Hib 1-3 |
| `ipv1_date`, `ipv2_date` | Date | วันที่ฉีด IPV 1-2 |
| `opv1_date` ... `opv3_date` | Date | วันที่หยอด OPV (`opv1_date` = 2 เดือน, `opv2_date` = 4 เดือน, `opv3_date` = 6 เดือน ตามลำดับเข็ม) |
| `mmr1_date` | Date | วันที่ฉีด MMR 1 |
| `rv21_date` ... `rv33_date` | Date | วันที่ฉีด Rota (`rv21, rv22` = ชนิด 2 เข็ม หรือ `rv31, rv32, rv33` = ชนิด 3 เข็ม) |
| `pcv1_date` ... `pcv3_date` | Date | วันที่ฉีด PCV 1-3 |
| `batch_id` | String | รหัสรอบการอัปโหลด (UUID สร้างตอนอัปโหลดแต่ละครั้ง) |
| `fiscal_year` | String | ปีงบประมาณของข้อมูลชุดนี้ (ระบุตอนอัปโหลด เพื่อกำหนด Scope) |
| `last_seen_batch` | String | รหัสอ้างอิงรอบการอัปโหลดล่าสุด (ใช้ตรวจสอบเด็กที่ย้ายออกโดยสร้าง Soft Delete) |
| `is_active` | Boolean | สถานะยังอยู่ในพื้นที่หรือไม่ (TRUE/FALSE) |
| `ai_analysis` | String | ผลการวิเคราะห์จาก AI (Gemini) สำหรับเคสที่มีปัญหา (ล้างข้อมูลอัตโนมัติเมื่ออัปโหลดไฟล์ใหม่) |
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

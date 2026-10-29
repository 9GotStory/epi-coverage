# Technical Specifications (Spec)

## 1. สถาปัตยกรรมระบบ (System Architecture)
- **Frontend:** React (SPA)
- **Backend/API:** Google Apps Script (GAS) 
- **Database:** Google Sheets
- **Hosting:** GitHub Pages หรือ Cloudflare Pages

## 2. Technology Stack (Frontend)
- **Framework:** Vite + React (TypeScript 100%)
- **UI & Styling:** Tailwind CSS v4 + Shadcn UI
- **State Management & API Fetching:** `@tanstack/react-query` (ทำ Caching และ Auto-retry)
- **Table Data:** `@tanstack/react-table` (รองรับ Virtualization ป้องกันเบราว์เซอร์ค้าง)
- **Data Visualization:** `recharts` (สำหรับทำ Dashboard ระดับ สสอ.)
- **Excel Parsing (Import):** `xlsx` (SheetJS) — อ่านไฟล์ฝั่ง Browser
- **Excel Export:** `xlsx` (SheetJS) — ใช้ไลบรารีเดียวกันในการ Export รายชื่อออกเป็นไฟล์ .xlsx
- **PDF Export:** `jspdf` + `jspdf-autotable` — สร้าง PDF รายชื่อส่ง อสม.
- **Authentication:** `@react-oauth/google`

## 3. Architecture & Code Best Practices

### 3.1 ความปลอดภัย (Security & API Protection)
- **JWT Verification:** ฝั่ง React จะได้รับ ID Token (JWT) จาก Google และส่ง Token นี้พร้อมกับ API Request ทุกครั้ง เพื่อให้ GAS นำไปถอดรหัส (Verify) ยืนยันตัวตนว่า Request มาจากผู้ใช้จริง ป้องกันการ Spoofing สวมรอย
- **Environment Variables:** เก็บ URL ของ GAS Web App และ Client ID ของ Google ไว้ในไฟล์ `.env` เสมอ ห้าม Hardcode และต้องเพิ่ม `.env` ไว้ใน `.gitignore` ทุกครั้ง
- **GAS Deployment Settings:** ตั้งค่า Web App ดังนี้: `Execute as: Me (owner)` และ `Who has access: Anyone` เพื่อให้ API รับ Request จากฝั่ง React ได้ (การตรวจสอบสิทธิ์จะทำผ่าน JWT Token แทน)
- **OpenData Read API / CORS Boundary:** ปัจจุบัน Frontend ไม่มี OpenData dashboard หรือ View 3 และไม่เรียก OpenData API แล้ว แต่ GAS ยังคงรองรับ `getOpenData` สำหรับอ่าน `opendata_cache` (รวม fallback ของ Backend ตามสัญญาเดิม) หากมี Browser consumer ในอนาคต ต้องเรียกผ่าน GAS API แทนการเรียก MOPH OpenData โดยตรงซึ่งติดข้อจำกัด CORS; การตรวจสอบคำขอและสิทธิ์ให้ยึดตาม Backend Router ที่ใช้งานจริง การดึง OpenData เพื่อซิงค์เป็นความรับผิดชอบของ GAS โดยใช้ direct transport หรือ authenticated relay ตามการกำหนดค่าและ [ADR-0005](adr/0005-route-opendata-through-external-relay.md) ไม่ใช่หน้าที่ของ Frontend
- **OpenData Sync (Rate-limit-aware):** การซิงค์ MOPH/HDC OpenData เป็นความรับผิดชอบของ Backend (GAS) แบบ fail-closed และคำนึงถึง rate limit ของต้นทาง — คำขอทุก dataset/FY pair เป็นแบบ sequential พร้อม pacing ระหว่างคู่ และ bounded transient retry (เฉพาะ 429 / 5xx) คู่ที่ล้มเหลวจะคง last-known-good cache ไว้ และ source ของการเรียก (manual/trigger) ถูกบันทึกใน sanitized sync audit เดิม — เหตุผลและข้อจำกัดโดยละเอียดอยู่ที่ [ADR-0004](adr/0004-rate-limit-safe-moph-opendata-sync.md) เมื่อมีการกำหนดค่า relay (Script Properties คู่เดียวแบบ atomic) ช่องทางการดึงข้อมูลจะวิ่งผ่าน external fetch relay แบบ authenticated ที่แยกเป็น deployable ของตัวเอง (`relay/`) โดย lifecycle/cache/audit ยังอยู่ที่ GAS ทั้งหมด — ดู [ADR-0005](adr/0005-route-opendata-through-external-relay.md)

### 3.2 ประสิทธิภาพ (Performance & Scalability)
- **Batch Processing:** 
  - การบันทึกข้อมูลลง Google Sheets ผ่าน GAS ต้องจัดกลุ่มข้อมูลเป็น Array 2 มิติ และใช้คำสั่ง `setValues()` เพียงครั้งเดียว 
  - หลีกเลี่ยงการใช้ `setValue()` ภายในลูปเด็ดขาด เพื่อป้องกันปัญหา Time-out (เกิน 6 นาที)
- **Data Formatting:**
  - การจัดการข้อมูลประเภท "รหัสสถานบริการ" (`hoscode`, `bcg_hospcode`, ฯลฯ) ที่มีเลข 0 นำหน้า 
  - ฝั่ง Frontend จะแปลงข้อมูลเป็น String ทันทีตอนอ่านจาก Excel
  - ฝั่ง GAS จะใช้คำสั่ง `range.setNumberFormat("@")` (Plain Text format) ก่อน `setValues()` เสมอ เป็น Best Practice ของ Google API

### 3.3 โครงสร้างโค้ด (Code Structure)
- นำหลักการ **Feature-Sliced Design (FSD)** มาใช้ในการจัดโครงสร้างโปรเจกต์ React:
  - `src/features/auth` (จัดการ Login, OAuth, สิทธิ์ผู้ใช้งาน)
  - `src/features/vaccine-1yr` (Dashboard ติดตามวัคซีน 1 ปี — มุมมองที่ 1 และ 2)
  - `src/features/upload` (จัดการการอัปโหลดไฟล์ Excel และ Batch Sync)
  - `src/features/admin` (จัดการผู้ใช้, อนุมัติสมาชิก)
- โครงสร้างนี้จะช่วยให้สามารถต่อยอดระบบวัคซีน 2 ปี, 3 ปี และ 5 ปี ได้อย่างเป็นระเบียบในอนาคต

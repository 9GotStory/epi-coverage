# Task List — EPI Coverage System (Phase 1: วัคซีน 1 ปี)

---

## Phase 0: Project Setup (ตั้งค่าโปรเจกต์)

- `[x]` **0.1** สร้างโปรเจกต์ React ด้วย Vite + TypeScript
  - `npm create vite@latest frontend -- --template react-ts`
- `[x]` **0.2** ติดตั้ง Dependencies ทั้งหมด
  - UI: `tailwindcss@4`, `shadcn/ui`
  - Data: `@tanstack/react-query`, `@tanstack/react-table`
  - Chart: `recharts`
  - Excel/PDF: `xlsx`, `jspdf`, `jspdf-autotable`
  - Auth: `@react-oauth/google`
  - Router: `react-router-dom`
- `[x]` **0.3** ตั้งค่า Tailwind CSS v4 และ Shadcn UI
- `[x]` **0.4** ตั้งค่าโครงสร้างโฟลเดอร์ Feature-Sliced Design (FSD)
- `[x]` **0.5** สร้างไฟล์ `.env.example` และเพิ่ม `.env` ใน `.gitignore`
- `[x]` **0.6** ตั้งค่า React Router (แนะนำใช้ `createBrowserRouter` + Lazy Load)
- `[x]` **0.7** ตั้งค่า React Query Client (QueryClientProvider + retry config)
- `[x]` **0.8** สร้าง TypeScript Type Definitions ใน `src/shared/types/`
  - `User`, `EpiRecord`, `Facility`, `AuditLog`, `VaccineStatus` interface
  - `UserRole` enum (`user`, `admin`, `superadmin`)
  - `UserStatus` enum (`pending`, `approved`, `rejected`)

---

## Phase 1: Google Apps Script (GAS) Backend

- `[x]` **1.1** สร้าง Google Sheets ใหม่พร้อมกำหนด Sheet ทั้ง 6 แผ่น
  - `Users`, `Epi_1_Year`, `facilities`, `audit_logs`, `configs_system`, `sessions`
- `[x]` **1.2** กำหนดหัวคอลัมน์ทุก Sheet ตาม `schema.md`
  - ⚠️ คอลัมน์ที่มี `hosc`/`hosp` ต้องตั้ง Format เป็น Plain Text (`@`) ก่อน
- `[x]` **1.3** เขียน GAS `doGet(e)` — Router หลัก (dispatch ตาม `action` param)
- `[x]` **1.4** เขียน GAS `doPost(e)` — Router POST (dispatch ตาม `action` param)
- `[x]` **1.5** เขียนฟังก์ชัน JWT Verify (`verifyGoogleToken`)
- `[x]` **1.6** เขียน API: `getUserByGoogleId` — ดึงข้อมูล user จาก `Users` sheet
- `[x]` **1.7** เขียน API: `createUser` — สร้าง user ใหม่ (status = pending)
- `[x]` **1.8** เขียน API: `approveUser` / `rejectUser` — Admin อนุมัติสมาชิก (ถูกควบรวมใน `updateUserStatus`)
- `[ ]` **1.9** เขียน API: `getFacilities` — ดึงรายชื่อ รพ.สต. ทั้งหมด
- `[ ]` **1.10** เขียน API: `uploadEpiData` — บันทึกข้อมูลวัคซีน Excel
  - Upsert by `cid`
  - Batch write ด้วย `setValues()` (ห้ามใช้ลูป `setValue()`)
  - ตั้ง `setNumberFormat("@")` สำหรับคอลัมน์ `hoscode`, `bcg_hospcode`, ฯลฯ
  - สร้าง `batch_id` และอัปเดต `last_seen_batch`
  - Soft Delete: ตั้ง `is_active = false` สำหรับ CID ที่ไม่ปรากฏในรอบนี้
  - บันทึก `audit_logs`
- `[ ]` **1.11** เขียน API: `getEpiData` — ดึงข้อมูล `Epi_1_Year` (filter by hoscode + `is_active=true`)
- `[x]` **1.12** เขียน API: `updateUserStatus` — Admin อัปเดต role/status ของผู้ใช้
- `[ ]` **1.13** เขียน API: `getAuditLogs` — ดึงประวัติการทำงาน (ตัวกรอง by email/action)
- `[ ]` **1.14** เขียน API: `getOpenData` — Proxy เรียก OpenData API (แก้ CORS)
- `[x]` **1.15** Deploy GAS เป็น Web App (`Execute as: Me`, `Who has access: Anyone`)

---

## Phase 2: Authentication Feature (`features/auth`)

- `[x]` **2.1** หน้า Login — Google OAuth Button
- `[x]` **2.2** หลัง Login: ตรวจสอบ user ใน DB
  - ถ้ามี + approved → ไป Dashboard
  - ถ้ามี + pending → หน้า "รอการอนุมัติ"
  - ถ้ายังไม่มี → หน้า First-time Setup
- `[x]` **2.3** หน้า First-time Setup — เลือก รพ.สต. ที่สังกัด
- `[x]` **2.4** สร้าง AuthContext / useAuth hook (เก็บ user info + token)
- `[x]` **2.5** Route Guard (`ProtectedRoute`) — ตรวจสอบ role ก่อนเข้าหน้า
- `[x]` **2.6** หน้า "รอการอนุมัติ" (Pending Screen)
- `[x]` **2.7** บันทึก Session + Logout (clear session)

---

## Phase 6: Admin Panel (`features/admin`) -- (ทำก่อน Phase 3 ตาม Request)

- `[x]` **6.1** หน้าจัดการผู้ใช้ (เฉพาะ superadmin/admin)
  - รายการผู้ใช้ pending / approved / rejected
  - ปุ่มอนุมัติ / ปฏิเสธ
- `[x]` **6.2** หน้าจัดการหน่วยบริการ `facilities`
  - เพิ่ม / แก้ไข รพ.สต.
  - เปิด/ปิด is_active
- `[x]` **6.3** หน้า Audit Logs (ดูประวัติการทำงาน)

---

## Phase 3: Data Upload Feature (`features/upload`)

- `[x]` **3.1** หน้า Upload — Drag & Drop / Browse ไฟล์ Excel
- `[x]` **3.2** อ่านไฟล์ด้วย `xlsx` (SheetJS) ฝั่ง Browser
  - แปลงคอลัมน์ `hosc`/`hosp` เป็น String ทันที
  - แปลง `<NA>` เป็น `null`
- `[x]` **3.3** Preview ข้อมูลก่อน Upload (แสดงจำนวน rows, ตัวอย่างข้อมูล)
- `[x]` **3.4** Validation ข้อมูลก่อนส่ง (ตรวจ required columns)
- `[x]` **3.5** ส่งข้อมูล Batch ไปยัง GAS API (`uploadEpiData`)
- `[x]` **3.6** แสดง Progress / Result (สำเร็จกี่ records, ข้อผิดพลาด)

---

## App Shell & Layout Implementation (FSD + Apple Design)

- `[x]` **L.1** สร้าง `GlobalNav` และ `SubNav` ใน `widgets/layout`
- `[x]` **L.2** สร้าง `AppLayout` เพื่อหลีกเลี่ยง Circular Dependency ตามหลัก FSD
- `[x]` **L.3** นำ `AppLayout` ไปครอบ `ProtectedRoute` ใน `Router.tsx`
- `[x]` **L.4** อัปเกรด GlobalNav ด้วย `NavLink` (Active State)
- `[x]` **L.5** รองรับ Mobile Responsive (Hamburger Menu)

---

## Phase 4: EPI Tracking Dashboard (`features/vaccine-1yr`)

### มุมมองที่ 1: รายบุคคล / รายช่วงอายุ
- `[x]` **4.1** ดึงข้อมูล `Epi_1_Year` จาก GAS API (filter by hoscode + is_active)
- `[x]` **4.2** คำนวณ "อายุเป็นเดือน" ณ วันปัจจุบัน จาก `birth` date
- `[x]` **4.3** Logic ตรวจสอบวัคซีนขาด ตามช่วงอายุ (ตาม `features.md` มุมมองที่ 1)
  - แรกเกิด: BCG, HBV1
  - 2 เดือน: DTP1, HBV2, Hib1, IPV1, Rota1, PCV1
  - 4 เดือน: DTP2, HBV3, Hib2, IPV2, Rota2, PCV2
  - 6 เดือน: DTP3, HBV4, Hib3, OPV, Rota3(ถ้ามี), PCV3
  - 9 เดือน: MMR
- `[x]` **4.4** Logic Rota: เช็ค `rv21/rv22` (2 เข็ม) หรือ `rv31/rv32/rv33` (3 เข็ม)
- `[x]` **4.5** ตาราง Virtual List แสดงรายชื่อเด็กที่ขาดวัคซีน (ใช้ `@tanstack/react-table`)
- `[x]` **4.6** ตัวกรอง: สถานบริการ, ชนิดวัคซีนที่ขาด
- `[x]` **4.7** แสดง "ข้อมูลอัปเดตล่าสุด ณ วันที่..." (As of Date จาก `audit_logs`)

### มุมมองที่ 2: Fully Immunized (เด็กอายุครบ 1 ปี)
- `[x]` **4.8** Logic ประเมิน Fully Immunized (ตาม `features.md` มุมมองที่ 2)
  - BCG 1 ครั้ง, HBV: `hbv1+hbv2+hbv4`, DTP: 3 ครั้ง, Hib: 3 ครั้ง
  - IPV: 2 ครั้ง, OPV: 1 ครั้ง, MMR: 1 ครั้ง, Rota: ครบถ้วน
- `[x]` **4.9** แสดงสรุป Coverage Rate ของ รพ.สต. (ผ่าน / ไม่ผ่าน / รอ)
- `[x]` **4.10** Export รายชื่อเด็กที่ต้องติดตาม เป็น Excel (`.xlsx`)
- `[x]` **4.11** Export รายชื่อเด็กที่ต้องติดตาม เป็น PDF

---

## Phase 5: OpenData Dashboard (`features/opendata`)

- `[x]` **5.1** ดึงข้อมูลจาก GAS Proxy → OpenData `s_epi1`
- `[x]` **5.2** แสดงกราฟ Bar Chart: ร้อยละความครอบคลุมวัคซีนรายเดือน/ไตรมาส
- `[x]` **5.3** ตัวกรอง: ปีงบประมาณ, เดือน, ไตรมาส, รพ.สต.
- `[x]` **5.4** เปรียบเทียบตัวเลขระหว่าง "ข้อมูลรายบุคคล (Excel Upload)" กับ "ตัวเลขรวม (OpenData)"

---

## Phase 7: UI/UX Polish

- `[ ]` **7.1** Responsive Design (Mobile + Desktop)
- `[x]` 1. **Database & Types**
  - `[x]` 1.1 Update `frontend/src/shared/types/index.ts` (add `dtp5_date`, `opv5_date`)
  - `[x]` 1.2 Update `backend/Code.gs` (add `Epi_5_Year` sheet setup)
- `[x]` Update `chartUtils.ts` with `formatEpi1AllVaccines` aggregation logic
- `[x]` Create `VaccineGaugeGrid.tsx` component (Recharts `RadialBarChart`)
- `[x]` Create `VaccineRadarChart.tsx` component (Recharts `RadarChart`)
- `[x]` Update `OpenDataDashboard.tsx` to include new components in Top/Middle sections
- `[x]` Verify UI layout and data accuracy
- `[x]` **7.5** Empty State (กรณีไม่มีข้อมูล)
- `[x]` **7.6** Error Boundary

---

## Phase 8: Testing & Deploy

- `[ ]` **8.1** ทดสอบ Upload Excel จริงด้วยไฟล์ `วัคซีน 1 ปี.xlsx`
- `[ ]` **8.2** ตรวจสอบเลข 0 นำหน้า hoscode ไม่หาย (06422, 00588, 11170)
- `[ ]` **8.3** ทดสอบ Soft Delete (อัปโหลดไฟล์ใหม่แล้วเช็ค is_active)
- `[ ]` **8.4** ทดสอบ Fully Immunized Logic กับข้อมูลจริง
  - สร้าง test case: เด็กที่มี `hbv1_date` + `hbv2_date` + `hbv4_date` → ผ่าน HBV
  - สร้าง test case: เด็กที่มีแค่ `hbv1_date` + `hbv2_date` (2 ครั้ง) → ไม่ผ่าน HBV
  - เด็กที่ `hbv3_date` มีค่า (วัคซีนรวม) แต่ขาด `hbv4_date` → ไม่ผ่าน HBV
- `[ ]` **8.5** ทดสอบ GAS Proxy OpenData API (เช็ค CORS ไม่ติด)
- `[ ]` **8.6** Build Production + Deploy (GitHub Pages / Cloudflare Pages)

---

## Phase 8: Multi-Year Scope Upload

- [x] **8.1** Update UI: Add Fiscal Year Dropdown in EpiUpload.tsx
- [x] **8.2** Update API: Add fiscalYear to payload and EpiDataRow
- [x] **8.3** Update Backend: Router.js to receive fiscalYear
- [x] **8.4** Update Backend: Upload.js (upsertEpiData and cleanupEpiData) to handle fiscalYear scoping
- [x] **8.5** Update Schema Docs: Add fiscal_year to docs/schema.md

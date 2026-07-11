# EPI Coverage — Project Agent Rules

> กฎเหล่านี้มีผลบังคับใช้กับ AI Agent ทุกตัวที่ทำงานในโปรเจกต์นี้
> อ่านและปฏิบัติตามก่อนเริ่มพัฒนาทุก Phase โดยไม่มีข้อยกเว้น

---

## 🔴 MANDATORY: อ่านก่อนพัฒนาทุกครั้ง

ก่อนเขียนโค้ดหรือแก้ไขไฟล์ใดๆ ในโปรเจกต์นี้ **ต้องอ่านไฟล์เหล่านี้ทุกครั้ง**:

1. **`DESIGN.md`** — Design System (Apple-inspired) สำหรับทุก UI Component
   - สี, Typography, Spacing, Radius, Component specs ทั้งหมด
   - ห้าม hardcode ค่าใดๆ โดยไม่อ้างอิงจาก Design Token

2. **`docs/schema.md`** — Database Schema (Google Sheets)
   - ชื่อ Column และ Type ที่แน่นอน
   - ⚠️ คอลัมน์ `hosc`/`hosp` ต้องเป็น Plain Text เสมอ

3. **`docs/features.md`** — Business Logic & Vaccine Criteria (HDC Standard)
   - Logic 3 มุมมอง (มุมมองที่ 1, 2, 3)
   - Column Mapping ระหว่าง Excel, Sheet, และ OpenData API

4. **`docs/spec.md`** — Technical Specifications
   - Tech Stack, Security, Performance, FSD Structure

---

## 🔵 MANDATORY: ใช้ context7 ค้นหาก่อนพัฒนาแต่ละ Phase

ก่อนเริ่มพัฒนา Phase ใด ให้ค้นหา Best Practice ผ่าน **context7** เพื่อให้โค้ดทันสมัยและถูกต้อง:

### Phase 0 — Project Setup
```
ค้นหา: "Vite React TypeScript setup"
ค้นหา: "Tailwind CSS v4 setup with Vite"
ค้นหา: "shadcn/ui installation React"
ค้นหา: "Feature-Sliced Design structure React TypeScript"
```

### Phase 1 — Google Apps Script (GAS)
```
ค้นหา: "Google Apps Script doGet doPost Web App"
ค้นหา: "Google Apps Script setValues batch write performance"
ค้นหา: "Google Apps Script JWT verification Google tokeninfo"
ค้นหา: "Google Apps Script UrlFetchApp proxy API"
```

### Phase 2 — Authentication
```
ค้นหา: "@react-oauth/google useGoogleLogin"
ค้นหา: "React Context TypeScript authentication pattern"
ค้นหา: "react-router-dom v6 ProtectedRoute"
```

### Phase 3 — Data Upload
```
ค้นหา: "SheetJS xlsx read file browser TypeScript"
ค้นหา: "React file upload drag and drop"
```

### Phase 4 — EPI Dashboard
```
ค้นหา: "@tanstack/react-table virtualization"
ค้นหา: "@tanstack/react-virtual rowVirtualizer"
ค้นหา: "React date calculation age in months"
```

### Phase 5 — OpenData Dashboard
```
ค้นหา: "recharts BarChart TypeScript"
ค้นหา: "@tanstack/react-query useQuery"
```

### Phase 6 — Admin Panel
```
ค้นหา: "shadcn/ui DataTable admin pattern"
```

### Phase 7 — Export
```
ค้นหา: "SheetJS xlsx export file browser"
ค้นหา: "jspdf jspdf-autotable TypeScript"
```

---

## ⚙️ Coding Standards

### TypeScript
- ใช้ TypeScript 100% — ห้าม `any` โดยไม่มีเหตุผล
- ทุก Type/Interface ต้องอยู่ใน `src/shared/types/`
- ใช้ Type ร่วมกันระหว่าง Features เสมอ

### UI & Styling
- ใช้ **Tailwind CSS v4** สำหรับ Utility Classes
- ใช้ **Shadcn UI** สำหรับ Base Components
- ทุก Component ต้องอ้างอิง Design Token จาก `DESIGN.md` เช่น:
  - สี Primary: `#0066cc` (Action Blue)
  - Border Radius Pill: `9999px`
  - Typography Body: `17px / 400 / -0.374px letter-spacing`
  - Shadow (เฉพาะ product/hero imagery เท่านั้น): `rgba(0,0,0,0.22) 3px 5px 30px`
- ห้ามใช้ Shadow บน Card, Button, หรือ Text
- ห้ามใช้ Gradient เพื่อตกแต่ง

### GAS Backend
- ห้าม `setValue()` ใน Loop — ใช้ `setValues()` เท่านั้น (Array 2D)
- ต้อง `range.setNumberFormat("@")` ก่อน `setValues()` เสมอ สำหรับคอลัมน์ที่มี `hosc`/`hosp`
- ทุก API Endpoint ต้อง Verify JWT Token ก่อน Process ทุกครั้ง

### Data Integrity
- คอลัมน์ `hoscode`, `bcg_hospcode` ฯลฯ ต้องเป็น String ตลอด
- เลข 0 นำหน้า (เช่น `06422`, `00588`) ห้ามหายเด็ดขาด
- `cid` คือ Primary Key สำหรับ Upsert

### Feature-Sliced Design (FSD)
```
src/
├── app/             — App setup, providers, router
├── features/
│   ├── auth/        — Login, OAuth, session
│   ├── vaccine-1yr/ — View 1+2 (individual data from Excel)
│   ├── opendata/    — View 3 (HDC aggregate from API)
│   ├── upload/      — Excel upload, batch sync
│   └── admin/       — User management
└── shared/
    ├── components/  — Reusable UI components
    ├── hooks/       — Shared custom hooks
    └── types/       — Global TypeScript types
```
- ห้าม Feature A import โดยตรงจาก Feature B
- Shared logic ต้องอยู่ใน `shared/`

### Security
- ห้าม Hardcode GAS URL หรือ Google Client ID — ใช้ `.env` เท่านั้น
- `.env` ต้องอยู่ใน `.gitignore` ทุกครั้ง

---

## 📋 Vaccine Logic Reference (อย่าจำผิด)

### Fully Immunized (มุมมองที่ 2) — HBV Logic ที่สำคัญมาก
```
HBV ผ่าน = hbv1_date AND hbv2_date AND hbv4_date ต้องมีค่าทั้ง 3
           (hbv3_date = วัคซีนรวม 4 เดือน ไม่นับ)
```

### Rota Logic
```
ผ่าน = (rv21_date AND rv22_date) — ชนิด 2 เข็ม
     OR (rv31_date AND rv32_date AND rv33_date) — ชนิด 3 เข็ม
```

### OPV Mapping (OpenData ≠ ชื่อที่คาดหวัง)
```
opv1_date ใน Sheet  = OPV 6 เดือน (ไม่ใช่ 3 ครั้ง)
opv3 ใน OpenData API = Column name ของ OPV (ตั้งชื่อตาม API จริง)
```

---

## 🔗 OpenData API (มุมมองที่ 3) — CORS Note
- ❌ React Browser **ห้ามเรียก** `https://opendata.moph.go.th/api/...` โดยตรง
- ✅ ต้องผ่าน **GAS Proxy** เสมอ (`UrlFetchApp` ไม่มีปัญหา CORS)
- Schema: `s_epi1` (รายช่วงอายุ), `s_epi_complete` (Fully Immunized ทุกช่วงอายุ)

---

> **อ่านครบแล้ว? ดำเนินการต่อได้เลยครับ**

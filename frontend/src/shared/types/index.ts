export type UserRole = 'user' | 'admin' | 'superadmin';

export type UserStatus = 'pending' | 'approved' | 'rejected';

export interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  hoscode: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date | string;
  last_login?: Date | string;
}

export interface Facility {
  hoscode: string;
  hosname: string;
  is_active: boolean;
}

export interface AuditLog {
  log_id: string;
  user_id: string;
  email: string;
  action: string;
  details: string;
  timestamp: Date | string;
}

export interface EpiRecord {
  hoscode: string;
  hosname: string;
  pid: string;
  cid: string;
  name: string;
  lname: string;
  sex?: string | number;
  birth: Date | string;
  check_vhid?: string;
  
  // Vaccines
  bcg_date?: string;
  bcg_hospcode?: string;
  
  hbv1_date?: string;
  hbv2_date?: string;
  hbv3_date?: string;
  hbv4_date?: string;
  
  dtp1_date?: string;
  dtp2_date?: string;
  dtp3_date?: string;
  dtp4_date?: string;
  dtp5_date?: string;
  
  hib1_date?: string;
  hib2_date?: string;
  hib3_date?: string;
  
  ipv1_date?: string;
  ipv2_date?: string;
  
  opv1_date?: string;
  opv2_date?: string;
  opv3_date?: string;
  opv4_date?: string;
  opv5_date?: string;
  
  mmr1_date?: string;
  mmr2_date?: string;
  
  rv21_date?: string;
  rv22_date?: string;
  rv31_date?: string;
  rv32_date?: string;
  rv33_date?: string;
  
  pcv1_date?: string | null;
  pcv2_date?: string | null;
  pcv3_date?: string | null;
  pcv4_date?: string | null;
  
  je1_date?: string | null;
  je2_date?: string | null;
  je3_date?: string | null;
  j11_date?: string | null;
  j12_date?: string | null;
  result?: string | null;
  
  // Tracking metadata
  batch_id?: string;
  fiscal_year?: string;
  last_seen_batch?: string;
  is_active?: boolean;
  
  // AI Analysis
  ai_analysis?: string;
  ai_analyzed_at?: string;
}

export interface VaccineStatus {
  isFullyImmunized: boolean; // Keep for backward compatibility initially, though status replaces it
  status?: 'PASS' | 'FAIL' | 'PENDING';
  missingVaccines: string[];
  pendingVaccines?: string[];
  passedVaccines: string[];
}

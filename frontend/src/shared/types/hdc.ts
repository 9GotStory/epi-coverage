import type { EpiRecord } from './index';
export type EpiAge = 1 | 2 | 3 | 5;
export interface View1AgeProps {
  fiscalYear: number;
  quarter: number | 'all';
  data: EpiRecord[];
  isLoading: boolean;
  error: string | null;
  asOfDate: string | null;
}

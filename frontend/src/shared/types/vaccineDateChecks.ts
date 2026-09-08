export interface VaccineDatePair {
  field: string;
  other_field: string;
}

export interface VaccineDateChecks {
  before_birth: boolean;
  allow_on_birth: boolean;
  same_day_pairs: VaccineDatePair[];
  ordered_pairs: VaccineDatePair[];
}

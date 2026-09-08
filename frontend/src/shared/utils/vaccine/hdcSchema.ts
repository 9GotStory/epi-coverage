import type { EpiAge } from '../../types/hdc';
const baseDoses = ['bcg', 'hbv1', 'hbv2', 'hbv3', 'hbv4', 'dtp1', 'dtp2', 'dtp3', 'hib1', 'hib2', 'hib3', 'ipv1', 'ipv2', 'opv1', 'opv2', 'opv3', 'mmr1', 'rv21', 'rv22', 'rv31', 'rv32', 'rv33', 'pcv1', 'pcv2', 'pcv3'];
export function hdcSourceFields(age: EpiAge): string[] {
  const doses = [...baseDoses];
  if (age >= 2) doses.push('dtp4', 'opv4', 'mmr2', 'je1', 'je2', 'j11');
  if (age >= 3) doses.push('je3', 'j12');
  if (age === 5) doses.push('dtp5', 'opv5', 'pcv4');
  return ['hoscode', 'hosname', 'pid', 'cid', 'name', 'lname', 'sex', 'birth', 'check_vhid',
    'addr', 'check_typearea', 'nation', 'discharge', 'result',
    'g_hbv', 'g_dtp', 'g_hib', 'g_opv', 'g_mmr', 'g_rv', 'g_pcv',
    ...doses.flatMap(dose => [`${dose}_date`, `${dose}_hospcode`, `${dose}_input_hosp`])];
}

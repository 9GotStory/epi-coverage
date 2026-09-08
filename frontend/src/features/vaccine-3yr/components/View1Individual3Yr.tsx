import type { View1AgeProps } from '../../../shared/types/hdc';
import { View1AgeRecords } from '../../../shared/components/View1AgeRecords';

export function View1Individual3Yr(props: View1AgeProps) {
  return <View1AgeRecords key={`${props.fiscalYear}-${props.quarter}`} {...props} age={3} />;
}

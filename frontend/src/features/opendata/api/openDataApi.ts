import { fetchApi } from '../../../shared/lib/api';

export interface OpenDataPayload {
  tableName: 's_epi1' | 's_epi2' | 's_epi3' | 's_epi5';
  year: string; // e.g., '2569'
  province: string; // '54'
  amp?: string; // '06'
}

export async function fetchOpenData(payload: OpenDataPayload) {
  const response = await fetchApi('getOpenData', { payload });
  if (response.data && response.data.error) {
    throw new Error(response.data.error);
  }
  // MOPH OpenData returns data inside a 'data' array property
  return Array.isArray(response.data) ? response.data : (response.data?.data || []);
}

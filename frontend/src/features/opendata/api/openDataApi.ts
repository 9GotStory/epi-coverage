import { fetchApi } from '../../../shared/lib/api';

export interface OpenDataPayload {
  tableName: 's_epi1' | 's_epi2' | 's_epi3' | 's_epi5' | 's_epi_complete';
  year: string; // e.g., '2569'
  province: string; // '54'
}

export async function fetchOpenData(payload: OpenDataPayload) {
  const response = await fetchApi('getOpenData', { payload });
  if (response.data && response.data.error) {
    throw new Error(response.data.error);
  }
  // MOPH OpenData returns either a direct array or a `{ data: [...] }` envelope.
  // Issue #17: anything else is malformed — it must surface as an error, never
  // silently become an empty dataset.
  if (Array.isArray(response.data)) {
    return response.data;
  }
  if (response.data && Array.isArray(response.data.data)) {
    return response.data.data;
  }
  throw new Error('Malformed OpenData response');
}

export async function forceSyncOpenData() {
  const response = await fetchApi('forceSyncOpenData', {});
  if (response.data && response.data.error) {
    throw new Error(response.data.error);
  }
  return response.data;
}

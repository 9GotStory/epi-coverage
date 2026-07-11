import { useQuery } from '@tanstack/react-query';
import { fetchOpenData, type OpenDataPayload } from '../api/openDataApi';

export function useOpenData(payload: OpenDataPayload, enabled: boolean = true) {
  return useQuery({
    queryKey: ['opendata', payload.tableName, payload.year, payload.province, payload.amp],
    queryFn: () => fetchOpenData(payload),
    enabled: enabled,
    staleTime: 1000 * 60 * 60, // 1 hour stale time (since data changes daily)
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
}

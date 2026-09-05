import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export function useFacilities() {
  return useQuery({
    queryKey: ['facilities'],
    queryFn: async () => {
      const response = await fetchApi('getFacilities');
      if (response.data && response.data.error) {
        throw new Error(response.data.error);
      }
      return Array.isArray(response.data) ? response.data : (response.data?.data || []);
    },
    staleTime: 60 * 60 * 1000, // Cache for 1 hour since facilities rarely change
  });
}

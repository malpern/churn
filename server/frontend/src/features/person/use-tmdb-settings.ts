import { useQuery } from "@tanstack/react-query";

import { fetchTmdbSettings } from "@/api/client";
import { useAuth } from "@/features/auth/AuthProvider";

/** The TMDB key's state. Administrators only; everyone else gets nothing. */
export function useTmdbSettings() {
  const { session } = useAuth();
  const isAdmin = session?.user?.isAdmin === true;
  const query = useQuery({
    queryKey: ["tmdb-settings"],
    queryFn: fetchTmdbSettings,
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  return { isAdmin, settings: isAdmin ? query.data : undefined, loading: query.isLoading };
}

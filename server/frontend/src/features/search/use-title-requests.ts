import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import { createRequest, fetchRequestOptions } from "@/api/client";
import type { CreateRequestInput, SearchResult } from "@/api/types";
import { useRequestDefaults } from "@/features/search/use-request-defaults";

interface RequestMutationVariables {
  input: CreateRequestInput;
  result: SearchResult;
}

/** Every cached list of title cards, so a request shows as requested everywhere. */
const CARD_CACHES: QueryKey[] = [
  ["search"],
  ["recommendations"],
  ["discover"],
  ["similar"],
];

/**
 * Requesting a title from a card: the request options and defaults, the
 * request itself, per-card errors and the "Pick a version" link it leaves
 * behind. Shared by Find something new and the movie page's "More like this".
 */
export function useTitleRequests() {
  const queryClient = useQueryClient();
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const [requestLinks, setRequestLinks] = useState(
    () => queryClient.getQueryData<Record<string, string>>(["search-request-links"]) ?? {},
  );

  const optionsQuery = useQuery({
    queryKey: ["request-options"],
    queryFn: fetchRequestOptions,
    staleTime: 5 * 60_000,
  });
  const defaults = useRequestDefaults(optionsQuery.data);

  const requestMutation = useMutation({
    mutationFn: ({ input }: RequestMutationVariables) => createRequest(input),
    onSuccess: (data, variables) => {
      const key = requestKey(variables.input);
      const href =
        data.id === undefined
          ? undefined
          : data.service === "sonarr"
            ? `#/library/show/sonarr/${data.id}`
            : `#/library/movie/radarr/${data.id}`;
      if (key && href) {
        const links = queryClient.setQueryData<Record<string, string>>(
          ["search-request-links"],
          (previous) => ({ ...previous, [key]: href }),
        );
        if (links) setRequestLinks(links);
      }
      const viewAction = href
        ? { label: "Pick a version", onClick: () => { window.location.hash = href; } }
        : undefined;
      if (data.status === "added") {
        toast.success(`Requested ${formatTitle(data.title, data.year)}`, {
          description: "Added to the library. Searching for releases in the background.",
          action: viewAction,
          duration: 12_000,
        });
      } else {
        toast.info(`${formatTitle(data.title, data.year)} is already requested`, {
          action: viewAction,
          duration: 12_000,
        });
      }
      if (key) {
        for (const cache of CARD_CACHES) {
          queryClient.setQueriesData({ queryKey: cache }, (current: unknown) =>
            markRequested(current, key),
          );
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      void queryClient.invalidateQueries({ queryKey: ["requested-library"] });
    },
    onError: (error, { result }) => reportRequestError(result.key, error.message),
  });

  const requestingKey =
    requestMutation.isPending && requestMutation.variables
      ? requestKey(requestMutation.variables.input)
      : null;

  function reportRequestError(key: string, message: string) {
    setRequestErrors((errors) => ({ ...errors, [key]: message }));
  }

  function onRequest(result: SearchResult) {
    if (requestMutation.isPending) return;
    const service = result.kind === "movie" ? "radarr" : "sonarr";
    const serviceOptions = optionsQuery.data?.services[service];
    if (serviceOptions && serviceOptions.state !== "ok") {
      reportRequestError(
        result.key,
        serviceOptions.detail ?? `${service === "sonarr" ? "Sonarr" : "Radarr"} is not ready.`,
      );
      return;
    }
    const serviceDefaults = defaults[service];
    if (serviceDefaults.qualityProfileId === undefined || !serviceDefaults.rootFolderPath) {
      reportRequestError(result.key, "Choose a quality profile and root folder in Request options, then retry.");
      return;
    }
    const input: CreateRequestInput = {
      kind: result.kind,
      options: {
        qualityProfileId: serviceDefaults.qualityProfileId,
        rootFolderPath: serviceDefaults.rootFolderPath,
      },
    };
    if (result.kind === "movie") {
      if (result.tmdbId === undefined) {
        reportRequestError(result.key, "This movie cannot be requested because it has no TMDB ID.");
        return;
      }
      input.tmdbId = result.tmdbId;
    } else {
      if (result.tvdbId === undefined) {
        reportRequestError(result.key, "This series cannot be requested because it has no TVDB ID.");
        return;
      }
      input.tvdbId = result.tvdbId;
    }
    setRequestErrors((errors) => {
      const next = { ...errors };
      delete next[result.key];
      return next;
    });
    requestMutation.mutate({ input, result });
  }

  return {
    onRequest,
    requestingKey,
    requestLinks,
    requestErrors,
    requestDisabled: optionsQuery.isLoading || requestMutation.isPending,
  };
}

/** Mark the card with `key` as requested in any cached card list shape. */
function markRequested(current: unknown, key: string): unknown {
  if (!current || typeof current !== "object") return current;
  const value = current as { results?: SearchResult[]; rows?: Array<{ results: SearchResult[] }> };
  const mark = (results: SearchResult[]) =>
    results.map((result) => (result.key === key ? { ...result, inLibrary: true } : result));
  if (Array.isArray(value.results)) {
    return { ...value, results: mark(value.results) };
  }
  if (Array.isArray(value.rows)) {
    return { ...value, rows: value.rows.map((row) => ({ ...row, results: mark(row.results) })) };
  }
  return current;
}

function requestKey(input: CreateRequestInput): string | null {
  if (input.kind === "movie") {
    return input.tmdbId === undefined ? null : `movie:${input.tmdbId}`;
  }
  return input.tvdbId === undefined ? null : `series:${input.tvdbId}`;
}

function formatTitle(title: string, year?: number): string {
  return year ? `${title} (${year})` : title;
}

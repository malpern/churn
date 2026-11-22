import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, Loader2Icon, SearchIcon } from "lucide-react";

import {
  fetchDiscoverMovies,
  fetchMovieRecommendations,
  fetchSearch,
} from "@/api/client";
import type {
  SearchResult,
  SearchServiceState,
} from "@/api/types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

import { DiscoverRows } from "@/features/search/DiscoverRows";
import { RecommendedMovies } from "@/features/search/RecommendedMovies";
import { useRecommendationPreferences } from "@/features/search/use-recommendation-preferences";
import { SearchResults, SearchResultsSkeleton } from "@/features/search/SearchResults";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useTitleRequests } from "@/features/search/use-title-requests";
import { TmdbSuggestion } from "@/features/person/TmdbSuggestion";


export function SearchSection() {
  const [query, setQuery] = useState("");
  const [showNiche, setShowNiche] = useState(false);
  const debounced = useDebouncedValue(query, 350);
  const term = debounced.trim();
  const searchEnabled = term.length >= 2;
  const requests = useTitleRequests();
  const { onRequest: handleRequest, requestingKey, requestLinks, requestErrors } = requests;

  const searchQuery = useQuery({
    queryKey: ["search", term],
    queryFn: () => fetchSearch(term),
    enabled: searchEnabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const taste = useRecommendationPreferences();
  const recommendationsQuery = useQuery({
    queryKey: ["recommendations", "movies"],
    queryFn: fetchMovieRecommendations,
    staleTime: 10 * 60_000,
  });

  const discoverQuery = useQuery({
    queryKey: ["discover", "movies"],
    queryFn: fetchDiscoverMovies,
    staleTime: 10 * 60_000,
  });

  const hasRecommendations =
    recommendationsQuery.isLoading ||
    discoverQuery.isLoading ||
    (recommendationsQuery.data?.state === "ok" && recommendationsQuery.data.results.length > 0) ||
    (discoverQuery.data?.state === "ok" && discoverQuery.data.rows.length > 0);
  const searchData = searchQuery.data;
  const results = searchData?.results ?? [];
  const serviceNotices = searchData?.services.filter(
    (service) => service.state !== "ok" || service.detail,
  );

  return (
    <section className="flex flex-1 flex-col gap-6">
      <h1 className="sr-only">Search</h1>
      <InputGroup className="h-17 w-full rounded-none border-x-0 border-t-0 border-b border-border bg-transparent shadow-none dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-primary has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        <InputGroupAddon className="pl-0">
          <SearchIcon className="size-5" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type your search here…"
          aria-label="Search movies and series"
          autoComplete="off"
          className="h-full pl-3! text-lg caret-primary placeholder:text-muted-foreground md:text-lg"
        />
        {searchQuery.isFetching ? (
          <InputGroupAddon align="inline-end" className="pr-0">
            <Loader2Icon className="animate-spin" />
          </InputGroupAddon>
        ) : null}
      </InputGroup>

      {serviceNotices?.map((service) => (
        <SearchServiceNotice key={service.id} service={service} />
      ))}

      {searchQuery.error && !searchQuery.data ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Search failed</AlertTitle>
          <AlertDescription>{searchQuery.error.message}</AlertDescription>
          <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void searchQuery.refetch()}>
            Retry search
          </Button>
        </Alert>
      ) : null}

      {!searchEnabled ? (
        <RecommendedMovies
          data={recommendationsQuery.data}
          loading={recommendationsQuery.isLoading}
          onRequest={handleRequest}
          requestingKey={requestingKey}
          requestLinks={requestLinks}
          requestErrors={requestErrors}
          requestDisabled={requests.requestDisabled}
          isFavorite={taste.isFavorite}
          onToggleFavorite={taste.toggleFavorite}
          onDismiss={taste.hide}
        />
      ) : null}

      {!searchEnabled ? (
        <DiscoverRows
          data={discoverQuery.data}
          onRequest={handleRequest}
          requestingKey={requestingKey}
          requestLinks={requestLinks}
          requestErrors={requestErrors}
          requestDisabled={requests.requestDisabled}
          isFavorite={taste.isFavorite}
          onToggleFavorite={taste.toggleFavorite}
          onDismiss={taste.hide}
        />
      ) : null}

      {!searchEnabled ? <TmdbSuggestion placement="search" /> : null}

      {!searchEnabled && !hasRecommendations ? (
        <div className="flex min-h-90 flex-1 items-center justify-center dashed-frame px-6 py-12">
          <p className="text-center text-sm text-muted-foreground">
            Results will appear as you begin typing…
          </p>
        </div>
      ) : null}

      {searchEnabled && searchQuery.isLoading ? <SearchResultsSkeleton /> : null}

      {searchEnabled && searchData && results.length > 0 ? (
        <SearchResults
          query={searchData.query}
          results={results}
          showNiche={showNiche}
          onShowNicheChange={setShowNiche}
          pending={searchQuery.isPlaceholderData}
          requestLinks={requestLinks}
          requestErrors={requestErrors}
          onRequest={handleRequest}
          requestingKey={requestingKey}
          requestDisabled={requests.requestDisabled}
          isFavorite={taste.isFavorite}
          onToggleFavorite={taste.toggleFavorite}
        />
      ) : null}

      {searchEnabled &&
      searchData &&
      results.length === 0 &&
      searchData.services.some((service) => service.state === "ok") ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No results for “{searchData.query}”</EmptyTitle>
            <EmptyDescription>
              Try a different title or check that the title exists in Sonarr or Radarr.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </section>
  );
}

function SearchServiceNotice({ service }: { service: SearchServiceState }) {
  const name = service.id === "sonarr" ? "Sonarr" : "Radarr";
  return (
    <Alert variant={service.state === "unconfigured" ? "default" : "destructive"}>
      <CircleAlertIcon />
      <AlertTitle>
        {service.state === "ok" ? `${name} results are limited` : `${name} is not ready`}
      </AlertTitle>
      <AlertDescription>
        {service.detail ?? `Check that ${name} is running and its API key is configured.`}
      </AlertDescription>
    </Alert>
  );
}



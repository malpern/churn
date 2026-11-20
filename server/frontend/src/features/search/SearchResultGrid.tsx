import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";

import type { SearchResult } from "@/api/types";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchResultCard } from "@/features/search/SearchResultCard";

type Filter = "all" | "movie" | "series";

interface SearchResultGridProps {
  results: SearchResult[];
  resultQuery: string;
  pending: boolean;
  requestLinks: Record<string, string>;
  requestErrors: Record<string, string>;
  onRequest: (result: SearchResult) => void;
  requestingKey: string | null;
  requestDisabled: boolean;
}

export function SearchResultGrid({
  results,
  resultQuery,
  pending,
  requestLinks,
  requestErrors,
  onRequest,
  requestingKey,
  requestDisabled,
}: SearchResultGridProps) {
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fade = grid.current?.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: 130,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    return () => fade?.cancel();
  }, [resultQuery]);
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(
    () => (filter === "all" ? results : results.filter((result) => result.kind === filter)),
    [filter, results],
  );

  return (
    <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
      <TabsList>
        <TabsTrigger value="all">All ({results.length})</TabsTrigger>
        <TabsTrigger value="movie">{`Movies (${countKind(results, "movie")})`}</TabsTrigger>
        <TabsTrigger value="series">{`Series (${countKind(results, "series")})`}</TabsTrigger>
      </TabsList>
      <span role="status" className="ml-2 text-xs text-muted-foreground">
        {pending ? "Updating results…" : <span className="sr-only">{results.length} results for {resultQuery}</span>}
      </span>
      <TabsContent value={filter}>
        {filtered.length > 0 ? (
          <div ref={grid} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((result) => (
              <SearchResultCard
                key={result.key}
                result={result}
                onRequest={onRequest}
                requestHref={requestLinks[result.key]}
                requestError={requestErrors[result.key]}
                requesting={requestingKey === result.key}
                requestDisabled={requestDisabled}
              />
            ))}
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing in this view</EmptyTitle>
              <EmptyDescription>
                No {filter === "movie" ? "movies" : "series"} match this search.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>
    </Tabs>
  );
}

export function SearchResultGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full rounded-xl" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function countKind(results: SearchResult[], kind: SearchResult["kind"]): number {
  return results.filter((result) => result.kind === kind).length;
}

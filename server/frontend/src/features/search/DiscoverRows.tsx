import { useState } from "react";

import type { DiscoverResponse, SearchResult } from "@/api/types";
import { Button } from "@/components/ui/button";

import { SearchResultCard } from "./SearchResultCard";

/** Cards per row before "Show all": one row on wide screens. */
const COLLAPSED_COUNT = 6;

export type CardRowProps = Omit<DiscoverRowsProps, "data">;

interface DiscoverRowsProps {
  data?: DiscoverResponse;
  onRequest: (result: SearchResult) => void;
  requestingKey: string | null;
  requestLinks: Record<string, string>;
  requestErrors: Record<string, string>;
  requestDisabled: boolean;
  isFavorite: (result: SearchResult) => boolean;
  onToggleFavorite: (result: SearchResult) => void;
  /** Leave out where hiding makes no sense (the parts of a series). */
  onDismiss?: (result: SearchResult) => void;
  /** The card for the page the row sits on, marked as such. */
  currentKey?: string;
}

/**
 * Radarr's Discover, inside churn: trending, popular, and one row per list an
 * admin set up in Radarr. Each row shows one line of cards until opened, so
 * the page stays a browse, not a wall. Nothing renders when Radarr has nothing.
 */
export function DiscoverRows({ data, ...cardProps }: DiscoverRowsProps) {
  if (!data || data.state !== "ok" || data.rows.length === 0) {
    return null;
  }
  return (
    <>
      {data.rows.map((row) => (
        <DiscoverRowSection key={row.id} row={row} {...cardProps} />
      ))}
    </>
  );
}

/** One titled row of cards, one line deep until "Show all". */
export function DiscoverRowSection({
  row,
  onRequest,
  requestingKey,
  requestLinks,
  requestErrors,
  requestDisabled,
  isFavorite,
  onToggleFavorite,
  onDismiss,
  currentKey,
}: CardRowProps & { row: DiscoverResponse["rows"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const headingId = `discover-${row.id.replace(/[^a-z0-9-]/gi, "-")}`;
  const visible = expanded ? row.results : row.results.slice(0, COLLAPSED_COUNT);
  const hidden = row.results.length - COLLAPSED_COUNT;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="font-heading text-xl font-semibold tracking-tight">
            {row.title}
          </h2>
          {row.subtitle ? <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground">{row.subtitle}</p> : null}
        </div>
        {hidden > 0 ? (
          <Button
            variant="link"
            size="sm"
            className="shrink-0 px-0 text-muted-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show fewer" : `Show all ${row.results.length}`}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {visible.map((result) => (
          <SearchResultCard
            key={result.key}
            result={result}
            onRequest={onRequest}
            requestHref={requestLinks[result.key]}
            requestError={requestErrors[result.key]}
            requesting={requestingKey === result.key}
            requestDisabled={requestDisabled}
            favorite={isFavorite(result)}
            onToggleFavorite={onToggleFavorite}
            onDismiss={onDismiss}
            current={result.key === currentKey}
          />
        ))}
      </div>
    </section>
  );
}

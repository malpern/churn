import { FilmIcon, TvIcon } from "lucide-react";

import { MotionImage } from "@/components/MotionImage";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryEntry } from "@/features/library/library-entries";
import { entryHref, entryTitle } from "@/features/library/library-entries";

export function LibraryGrid({ entries, newlyReady }: { entries: LibraryEntry[]; newlyReady: ReadonlySet<string> }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7">
      {entries.map((entry) => (
        <li key={entry.key}>
          <LibraryCard entry={entry} ready={newlyReady.has(entry.key)} />
        </li>
      ))}
    </ul>
  );
}

export function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full rounded-lg" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function LibraryCard({ entry, ready }: { entry: LibraryEntry; ready: boolean }) {
  const title = entryTitle(entry) || "Untitled";
  const year = entry.library?.year ?? entry.requested?.year ?? entry.activity?.year;
  const imageUrl =
    entry.library?.imageUrl ?? entry.requested?.imageUrl ?? entry.activity?.imageUrl;
  const kind = entry.type === "Movie" ? "Movie" : "Show";
  const href = entryHref(entry);

  const body = (
    <>
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
        {imageUrl ? (
          <MotionImage
            src={imageUrl}
            alt={`${title} poster`}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            {entry.type === "Movie" ? (
              <FilmIcon className="text-muted-foreground" />
            ) : (
              <TvIcon className="text-muted-foreground" />
            )}
          </div>
        )}
        {ready ? (
          <span role="status" className="motion-ready absolute top-2 left-2 rounded bg-background px-2 py-1 text-xs font-medium text-primary">
            Ready to play
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
        <span className="truncate text-sm text-muted-foreground">
          {year ? `${year} · ${kind}` : kind}
        </span>
      </div>
    </>
  );

  const className =
    "group flex h-full flex-col gap-2 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

  if (!href) {
    return <div className={className}>{body}</div>;
  }

  return (
    <a href={href} data-library-title className={`${className} motion-poster-card`}>
      {body}
    </a>
  );
}

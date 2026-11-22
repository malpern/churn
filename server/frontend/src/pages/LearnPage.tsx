import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, TriangleAlertIcon } from "lucide-react";

import { fetchLearn, fetchLearnSubject } from "@/api/client";
import type { DiscoverRow, LearnResponse } from "@/api/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { openAtTop } from "@/features/person/CastStrip";
import { useTmdbSettings } from "@/features/person/use-tmdb-settings";
import { DiscoverRowSection } from "@/features/search/DiscoverRows";
import { useRecommendationPreferences } from "@/features/search/use-recommendation-preferences";
import { useTitleRequests } from "@/features/search/use-title-requests";
import { cn } from "@/lib/utils";

/**
 * Learn something: documentaries and docuseries. A shelf for each topic the
 * person said they are into, then what is popular, what is acclaimed, and one
 * subject outside their usual, plus every subject to browse. A subject opens
 * its own page.
 */
export function LearnPage({ subject }: { subject?: string }) {
  const learnQuery = useQuery({ queryKey: ["learn"], queryFn: fetchLearn, staleTime: 10 * 60_000 });
  const subjects = learnQuery.data?.subjects ?? [];

  return (
    <div className="flex flex-col gap-8">
      {subject ? (
        <SubjectView id={subject} subjects={subjects} />
      ) : (
        <>
          <header className="flex flex-col gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Learn something</h1>
            <InterestsLine data={learnQuery.data} />
          </header>
          {subjects.length > 0 ? <SubjectChips subjects={subjects} /> : null}
          {learnQuery.isLoading ? <RowsSkeleton /> : null}
          {learnQuery.data ? <LearnBody data={learnQuery.data} /> : null}
        </>
      )}
    </div>
  );
}

function InterestsLine({ data }: { data?: LearnResponse }) {
  if (!data) return <Skeleton className="h-4 w-80" />;
  return (
    <p className="max-w-prose text-sm text-muted-foreground">
      {data.interests.set ? (
        <>
          Shaped by what you told churn you’re into.{" "}
          <a href="#/recommendations" onClick={openAtTop} className="font-medium text-foreground underline underline-offset-4 hover:no-underline">
            Edit your interests
          </a>
        </>
      ) : (
        <>
          Tell churn what you’d like to learn about and this page will follow it.{" "}
          <a href="#/recommendations" onClick={openAtTop} className="font-medium text-foreground underline underline-offset-4 hover:no-underline">
            Add your interests
          </a>
        </>
      )}
    </p>
  );
}

function SubjectChips({ subjects, current }: { subjects: LearnResponse["subjects"]; current?: string }) {
  return (
    <nav aria-label="Browse by subject">
      {/* One swipeable line on phones, so the films stay near the top; wraps on wider screens. */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {subjects.map((subject) => (
          <li key={subject.id} className="shrink-0">
            <a
              href={`#/learn/${encodeURIComponent(subject.id)}`}
              onClick={openAtTop}
              aria-current={subject.id === current ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                subject.id === current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {subject.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function LearnBody({ data }: { data: LearnResponse }) {
  return (
    <>
      <StateNotice state={data.state} />
      <Rows rows={data.rows} />
      {data.state === "ok" && data.interests.unmatched.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          No shelf yet for {listOf(data.interests.unmatched)}: there aren’t enough well-rated
          documentaries tagged with {data.interests.unmatched.length === 1 ? "it" : "them"}.
        </p>
      ) : null}
    </>
  );
}

function StateNotice({ state }: { state: LearnResponse["state"] }) {
  const { isAdmin } = useTmdbSettings();
  if (state === "ok") return null;
  if (state === "no_key") {
    return (
      <Alert>
        <AlertTitle>This page needs a TMDB key to do much</AlertTitle>
        <AlertDescription>
          {isAdmin ? (
            <span>
              With a free key, each of your interests gets its own shelf, and you can browse
              by subject. Until then it shows the documentaries Radarr suggests.{" "}
              <a href="#/settings" className="underline underline-offset-4">
                Add a key in Settings
              </a>
            </span>
          ) : (
            "Until whoever runs churn adds a TMDB key in Settings, this shows only the documentaries Radarr suggests."
          )}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <TriangleAlertIcon />
      <AlertTitle>{state === "invalid_key" ? "TMDB stopped accepting the key" : "TMDB isn’t answering"}</AlertTitle>
      <AlertDescription>
        {state === "invalid_key" ? (
          isAdmin ? (
            <span>
              Replace it in{" "}
              <a href="#/settings" className="underline underline-offset-4">
                Settings
              </a>
              .
            </span>
          ) : (
            "Ask whoever runs churn to replace it."
          )
        ) : (
          "Try again in a few minutes."
        )}
      </AlertDescription>
    </Alert>
  );
}

function SubjectView({ id, subjects }: { id: string; subjects: LearnResponse["subjects"] }) {
  const subjectQuery = useQuery({
    queryKey: ["learn-subject", id],
    queryFn: () => fetchLearnSubject(id),
    staleTime: 10 * 60_000,
  });
  const label = subjectQuery.data?.subject.label ?? subjects.find((entry) => entry.id === id)?.label;
  return (
    <>
      <header className="flex flex-col gap-3">
        <a
          href="#/learn"
          onClick={openAtTop}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
          Learn something
        </a>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{label ?? " "}</h1>
      </header>
      {subjects.length > 0 ? <SubjectChips subjects={subjects} current={id} /> : null}
      {subjectQuery.isLoading ? <RowsSkeleton /> : null}
      {subjectQuery.isError ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>There’s no subject here</AlertTitle>
          <AlertDescription>Pick one of the subjects above.</AlertDescription>
        </Alert>
      ) : null}
      {subjectQuery.data ? (
        <>
          <StateNotice state={subjectQuery.data.state} />
          <Rows rows={subjectQuery.data.rows} />
        </>
      ) : null}
    </>
  );
}

function Rows({ rows }: { rows: DiscoverRow[] }) {
  const requests = useTitleRequests();
  const taste = useRecommendationPreferences();
  return (
    <>
      {rows.map((row) => (
        <DiscoverRowSection
          key={row.id}
          row={row}
          onRequest={requests.onRequest}
          requestingKey={requests.requestingKey}
          requestLinks={requests.requestLinks}
          requestErrors={requests.requestErrors}
          requestDisabled={requests.requestDisabled}
          isFavorite={taste.isFavorite}
          onToggleFavorite={taste.toggleFavorite}
          onDismiss={taste.hide}
        />
      ))}
    </>
  );
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-6 w-64" />
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="aspect-2/3 w-full" />
        ))}
      </div>
    </div>
  );
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

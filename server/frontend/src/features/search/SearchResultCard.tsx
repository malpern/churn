import { useCallback, useId, useRef } from "react";
import type { ReactNode } from "react";
import {
  CheckIcon,
  ClockIcon,
  FilmIcon,
  HeartIcon,
  Loader2Icon,
  PlusIcon,
  TvIcon,
  XIcon,
} from "lucide-react";

import { MotionImage } from "@/components/MotionImage";
import type { SearchResult } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

interface SearchResultCardProps {
  result: SearchResult;
  onRequest: (result: SearchResult) => void;
  requesting: boolean;
  requestHref?: string;
  requestError?: string;
  requestDisabled: boolean;
  /** Present for movies: a favourite steers recommendations without adding it to the library. */
  favorite?: boolean;
  onToggleFavorite?: (result: SearchResult) => void;
  /** Present on recommendations: never suggest this movie again. */
  onDismiss?: (result: SearchResult) => void;
  /** The movie whose page this card sits on. */
  current?: boolean;
}

export function SearchResultCard({
  result,
  onRequest,
  requesting,
  requestHref,
  requestError,
  requestDisabled,
  favorite = false,
  onToggleFavorite,
  onDismiss,
  current = false,
}: SearchResultCardProps) {
  const errorId = useId();
  const restoreFocus = useRef(false);
  const trackAction = useCallback((node: HTMLButtonElement | HTMLAnchorElement | null) => {
    if (!node) return;
    if (restoreFocus.current) {
      restoreFocus.current = false;
      node.focus({ preventScroll: true });
    }
    return () => {
      restoreFocus.current = document.activeElement === node;
    };
  }, []);
  const available = result.available === true;
  const requested = !available && result.inLibrary === true;

  const facts = [
    result.kind === "movie" ? "Movie" : "Series",
    result.year ? String(result.year) : null,
    // Unreleased films come back rated 0; that is "no rating yet", not a score.
    result.rating === undefined || result.rating <= 0 ? null : `${result.rating.toFixed(1)}/10`,
  ].filter((fact): fact is string => fact !== null);

  return (
    <Card
      className={`group/result gap-0 py-0 ${current ? "ring-2 ring-primary" : ""}`}
      aria-current={current ? "page" : undefined}
    >
      <div className="relative aspect-[2/3] bg-muted">
        {onToggleFavorite || onDismiss ? (
          <div className="absolute top-2 right-2 z-10 flex gap-1.5">
            {onToggleFavorite ? (
              <PosterAction
                label={favorite ? `Remove ${result.title} from favourites` : `Add ${result.title} to favourites`}
                pressed={favorite}
                onClick={() => onToggleFavorite(result)}
              >
                <HeartIcon className={favorite ? "fill-current text-primary" : undefined} />
              </PosterAction>
            ) : null}
            {onDismiss ? (
              <PosterAction label={`Not interested in ${result.title}`} onClick={() => onDismiss(result)}>
                <XIcon />
              </PosterAction>
            ) : null}
          </div>
        ) : null}
        {result.radarrId !== undefined ? (
          <a
            href={`#/library/movie/radarr/${result.radarrId}`}
            aria-label={`Open ${result.title}`}
            className="absolute inset-0 z-[1] rounded-t-xl focus-visible:outline-2 focus-visible:outline-ring"
          />
        ) : null}
        {result.imageUrl ? (
          <MotionImage
            src={result.imageUrl}
            alt={`${result.title} poster`}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            {result.kind === "movie" ? (
              <FilmIcon className="size-8 text-muted-foreground" />
            ) : (
              <TvIcon className="size-8 text-muted-foreground" />
            )}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="truncate text-base" title={result.title}>
            {result.title}
          </CardTitle>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {current ? <span className="font-medium text-primary">This movie · </span> : null}
            {facts.join(" · ")}
          </p>
        </div>

        {result.overview ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{result.overview}</p>
        ) : null}

        <div className="mt-auto flex flex-col gap-1.5">
          {result.inLibrary === null ? (
            <p className="text-xs text-muted-foreground">Status unknown</p>
          ) : null}
          {requestError ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {requestError}
            </p>
          ) : null}
          {available ? (
            <StatusState icon={<CheckIcon />} label="Available" />
          ) : requestHref && requested ? (
            <Button asChild size="sm" className="motion-action-swap w-full">
              <a href={requestHref} ref={trackAction}>
                Pick a version
              </a>
            </Button>
          ) : requested ? (
            <StatusState icon={<ClockIcon />} label="Requested" />
          ) : (
            <Button
              size="sm"
              ref={trackAction}
              className="w-full aria-disabled:opacity-50"
              aria-disabled={requestDisabled || requesting}
              aria-describedby={requestError ? errorId : undefined}
              onClick={() => {
                if (!requestDisabled && !requesting) onRequest(result);
              }}
            >
              {requesting ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {requesting ? "Requesting…" : requestError ? "Retry request" : "Request"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * A small round button on the poster. Out of the way until the card is
 * hovered or focused (always shown on touch screens, which cannot hover); a
 * pressed favourite stays visible so the state is never hidden.
 */
function PosterAction({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-full bg-background/75 text-foreground shadow-sm backdrop-blur-sm transition-opacity duration-150 hover:bg-background focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none [&>svg]:size-4 [@media(hover:none)]:opacity-100 ${
        pressed ? "opacity-100" : "opacity-0 group-hover/result:opacity-100 group-focus-within/result:opacity-100"
      }`}
    >
      {children}
    </button>
  );
}

function StatusState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className="[&>svg]:size-3.5">
        {icon}
      </span>
      {label}
    </div>
  );
}

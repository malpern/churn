import { EyeIcon, FilmIcon, HeartIcon, HeartOffIcon } from "lucide-react";

import type { FavoriteMovieSummary, HiddenMovie } from "@/api/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecommendationPreferences } from "@/features/search/use-recommendation-preferences";

/**
 * Everything that steers "Recommended for you", in one place: the movies a
 * person marked with a heart, and the movies the household said it is not
 * interested in, each with a way to undo it.
 */
export function RecommendationsPage() {
  const taste = useRecommendationPreferences();
  const preferences = taste.preferences;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Recommendations</h1>
      <Card>
        <CardHeader>
          <CardTitle>Favourites</CardTitle>
          <CardDescription>
            Movies you love. They steer your recommendations without being added to the
            library. Add one with the heart on any movie in Find something new. Movies
            you mark as favourites in Jellyfin count too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {taste.loading ? (
            <ListSkeleton />
          ) : preferences && preferences.favorites.length > 0 ? (
            <ul className="flex flex-col divide-y">
              {preferences.favorites.map((movie) => (
                <FavoriteRow key={movie.tmdbId} movie={movie} onRemove={taste.removeFavorite} />
              ))}
            </ul>
          ) : (
            <EmptyLine icon={<HeartIcon />}>No favourites yet.</EmptyLine>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hidden</CardTitle>
          <CardDescription>
            Movies marked "Not interested". They are never recommended again, for anyone
            in the household, because the list is kept in Radarr.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {taste.loading ? (
            <ListSkeleton />
          ) : preferences && preferences.hiddenState !== "ok" ? (
            <Alert>
              <AlertTitle>Radarr is not available</AlertTitle>
              <AlertDescription>
                {preferences.hiddenDetail ?? "The hidden list lives in Radarr."}
              </AlertDescription>
            </Alert>
          ) : preferences && preferences.hidden.length > 0 ? (
            <ul className="flex flex-col divide-y">
              {preferences.hidden.map((movie) => (
                <HiddenRow
                  key={movie.id}
                  movie={movie}
                  pending={taste.unhiding === movie.id}
                  onRestore={taste.unhide}
                />
              ))}
            </ul>
          ) : (
            <EmptyLine icon={<EyeIcon />}>
              Nothing hidden. Use the × on a recommendation to hide it.
            </EmptyLine>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FavoriteRow({
  movie,
  onRemove,
}: {
  movie: FavoriteMovieSummary;
  onRemove: (movie: FavoriteMovieSummary) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex h-15 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
        {movie.imageUrl ? (
          <img src={movie.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <FilmIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <MovieName title={movie.title} year={movie.year} />
      <Button variant="ghost" size="sm" onClick={() => onRemove(movie)}>
        <HeartOffIcon data-icon="inline-start" />
        Remove
      </Button>
    </li>
  );
}

function HiddenRow({
  movie,
  pending,
  onRestore,
}: {
  movie: HiddenMovie;
  pending: boolean;
  onRestore: (id: number) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <MovieName title={movie.title} year={movie.year} />
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => onRestore(movie.id)}>
        <EyeIcon data-icon="inline-start" />
        Show again
      </Button>
    </li>
  );
}

function MovieName({ title, year }: { title: string; year?: number }) {
  return (
    <p className="min-w-0 flex-1 truncate text-sm">
      <span className="font-medium">{title}</span>
      {year ? <span className="text-muted-foreground"> · {year}</span> : null}
    </p>
  );
}

function EmptyLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground [&>svg]:size-4">
      {icon}
      {children}
    </p>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

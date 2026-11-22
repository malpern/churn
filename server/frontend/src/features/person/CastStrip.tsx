import { useQuery } from "@tanstack/react-query";

import { fetchCast } from "@/api/client";
import type { PersonCredit } from "@/api/types";
import { MotionImage } from "@/components/MotionImage";
import { personHash } from "@/hooks/use-hash-route";

/**
 * "Cast & crew" for a title in the library: who directed and wrote it on one
 * line, then the cast as faces. Every name opens that person's page. Jellyfin
 * is the source, so this shows only for titles Jellyfin has. Hidden when
 * Jellyfin lists nobody.
 */
export function CastStrip({ itemId }: { itemId: string }) {
  const castQuery = useQuery({
    queryKey: ["cast", itemId],
    queryFn: () => fetchCast(itemId),
    staleTime: 60 * 60_000,
  });
  const credits = castQuery.data;
  if (!credits || credits.state !== "ok" || (credits.cast.length === 0 && credits.crew.length === 0)) {
    return null;
  }
  return (
    <section aria-labelledby="cast-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="cast-heading" className="font-heading text-xl font-semibold tracking-tight">
          Cast &amp; crew
        </h2>
        {credits.crew.length > 0 ? <CrewLine crew={credits.crew} /> : null}
      </div>
      {credits.cast.length > 0 ? (
        <ul className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          {credits.cast.map((person) => (
            <li key={person.id} className="w-24 shrink-0 snap-start sm:w-28">
              <CastCard person={person} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** "Directed by Ron Howard · Written by Akiva Goldsman", each name a link. */
function CrewLine({ crew }: { crew: PersonCredit[] }) {
  return (
    <p className="text-sm text-muted-foreground">
      {crew.map((person, index) => (
        <span key={person.id}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {person.role ? `${crewVerb(person.role)} ` : null}
          <a
            href={personHash(person.id)}
            onClick={openAtTop}
            className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
          >
            {person.name}
          </a>
        </span>
      ))}
    </p>
  );
}

function crewVerb(role: string): string {
  return role
    .split(", ")
    .map((job, index) => {
      const verb =
        job === "Director" ? "directed" : job === "Writer" ? "written" : job === "Creator" ? "created" : job;
      return index === 0 ? `${verb.charAt(0).toUpperCase()}${verb.slice(1)}` : verb;
    })
    .join(" and ")
    .concat(" by");
}

function CastCard({ person }: { person: PersonCredit }) {
  return (
    <a href={personHash(person.id)} onClick={openAtTop} className="group flex flex-col gap-2 rounded-lg outline-none">
      <div className="motion-poster-card aspect-square overflow-hidden rounded-full bg-muted ring-offset-2 ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-ring">
        {person.imageUrl ? (
          <MotionImage
            src={`${person.imageUrl}&maxWidth=240`}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-2xl font-medium text-muted-foreground">
            {initials(person.name)}
          </span>
        )}
      </div>
      <span className="flex flex-col text-center">
        <span className="line-clamp-2 text-sm font-medium group-hover:underline">{person.name}</span>
        {person.role ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{person.role}</span>
        ) : null}
      </span>
    </a>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

/**
 * Click handler for links that open a new page: start it at the top. Plain
 * hash links keep the scroll position, which is right for back and forward
 * but leaves a newly opened page halfway down.
 */
export function openAtTop(): void {
  window.addEventListener(
    "hashchange",
    () => requestAnimationFrame(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" })),
    { once: true },
  );
}

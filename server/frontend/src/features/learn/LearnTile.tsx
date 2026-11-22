import { ArrowRightIcon, GraduationCapIcon } from "lucide-react";

import { openAtTop } from "@/features/person/CastStrip";

/** The way into the Learn page from Find something new. */
export function LearnTile() {
  return (
    <a
      href="#/learn"
      onClick={openAtTop}
      className="group motion-poster-card flex items-center gap-4 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <GraduationCapIcon className="size-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-heading text-lg font-semibold tracking-tight">Learn something</span>
        <span className="text-sm text-muted-foreground">
          Documentaries and docuseries on what you’re curious about, and on things you haven’t
          thought of yet.
        </span>
      </span>
      <ArrowRightIcon
        className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </a>
  );
}

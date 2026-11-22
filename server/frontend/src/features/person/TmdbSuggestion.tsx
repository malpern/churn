import { useState } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useTmdbSettings } from "./use-tmdb-settings";

const DISMISSED_KEY = "churn:tmdb-suggestion-dismissed";

/**
 * A quiet line suggesting the optional TMDB key. It appears only for an
 * administrator, only once someone in the household has finished a movie or an
 * episode (so churn is set up and in use), and never once a key is added.
 * On Find something new it can be dismissed for good in this browser; on a
 * person's page it stays, because that is where the key makes a difference.
 */
export function TmdbSuggestion({ placement }: { placement: "search" | "person" }) {
  const { settings } = useTmdbSettings();
  const [dismissed, setDismissed] = useState(() => readDismissed());
  if (!settings?.suggest || (placement === "search" && dismissed)) {
    return null;
  }
  const text =
    placement === "person"
      ? "These are their films in your library. Add a free TMDB key in Settings to see everything they’ve made."
      : "Cast pages can show everything someone has made, not just what you have. It needs a free TMDB key.";
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        {text}{" "}
        <a
          href="#/settings"
          className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
        >
          {placement === "person" ? "Add a key" : "Add one in Settings"}
        </a>
      </span>
      {placement === "search" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label="Don’t suggest this again"
          onClick={() => {
            setDismissed(true);
            writeDismissed();
          }}
        >
          <XIcon />
        </Button>
      ) : null}
    </p>
  );
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // A private window can refuse storage; the line just comes back next visit.
  }
}

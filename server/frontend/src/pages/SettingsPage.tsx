import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";

import { ApiClientError, removeTmdbKey, saveTmdbKey } from "@/api/client";
import type { TmdbSettingsResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTmdbSettings } from "@/features/person/use-tmdb-settings";

/**
 * Household settings, for administrators. For now that is the one optional
 * extra churn can use: a TMDB key. Everything else is set up by the installer
 * or lives in the services churn wires together.
 */
export function SettingsPage() {
  const { settings, loading } = useTmdbSettings();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>TMDB</CardTitle>
          <CardDescription className="max-w-prose">
            Optional. With a free key from The Movie Database, an actor’s or director’s page
            shows every film they’ve made, ready to request, not just the ones you have.
            Churn sends TMDB only the ids of the people and films being looked up, never
            what anyone watched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !settings ? (
            <Skeleton className="h-9 w-full max-w-md" />
          ) : settings.configured ? (
            <ConnectedKey settings={settings} />
          ) : (
            <KeyForm />
          )}
          <p className="mt-6 text-xs text-muted-foreground">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function KeyForm() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: (apiKey: string) => saveTmdbKey(apiKey),
    onSuccess: (data) => {
      setValue("");
      queryClient.setQueryData(["tmdb-settings"], data);
      void queryClient.invalidateQueries({ queryKey: ["person"] });
      toast.success("TMDB key added");
    },
  });
  const error =
    save.error instanceof ApiClientError ? save.error.message : save.error ? "Could not save the key" : null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) save.mutate(value.trim());
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="tmdb-key">API key or read access token</FieldLabel>
        <Input
          id="tmdb-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? true : undefined}
        />
        <FieldDescription>
          Make a free account, then copy either value from{" "}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            TMDB’s API settings
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
          . Churn checks it with TMDB before saving.
        </FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      <div>
        <Button type="submit" disabled={!value.trim() || save.isPending}>
          {save.isPending ? "Checking…" : "Save key"}
        </Button>
      </div>
    </form>
  );
}

function ConnectedKey({ settings }: { settings: TmdbSettingsResponse }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: removeTmdbKey,
    onSuccess: (data) => {
      queryClient.setQueryData(["tmdb-settings"], data);
      void queryClient.invalidateQueries({ queryKey: ["person"] });
      toast.success("TMDB key removed");
    },
    onError: () => toast.error("Could not remove the key"),
  });
  const added = [
    settings.addedBy ? `by ${settings.addedBy}` : null,
    settings.addedAt ? `on ${formatDay(settings.addedAt)}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="flex items-center gap-2 text-sm">
        <CheckIcon className="size-4 text-primary" aria-hidden="true" />
        <span>
          Connected{added.length > 0 ? <span className="text-muted-foreground"> · added {added.join(" ")}</span> : null}
        </span>
      </p>
      <Button variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>
        Remove key
      </Button>
    </div>
  );
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
}

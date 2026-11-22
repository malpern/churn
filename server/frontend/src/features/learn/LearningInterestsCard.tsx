import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";

import { ApiClientError, fetchLearnInterests, saveLearnInterests } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { CHATGPT_URL, CLAUDE_URL, LEARNING_PROMPT } from "./learning-prompt";

/**
 * "What you want to learn": a person's own words about their interests. The
 * Learn page builds a shelf for each topic it finds here. Kept per person on
 * the churn server and never shared.
 */
export function LearningInterestsCard() {
  const queryClient = useQueryClient();
  const interestsQuery = useQuery({ queryKey: ["learn-interests"], queryFn: fetchLearnInterests });
  const [draft, setDraft] = useState<string | null>(null);
  const saved = interestsQuery.data;
  const value = draft ?? saved?.text ?? "";

  useEffect(() => {
    if (saved && draft === saved.text) setDraft(null);
  }, [saved, draft]);

  const save = useMutation({
    mutationFn: (text: string) => saveLearnInterests(text),
    onSuccess: (data) => {
      queryClient.setQueryData(["learn-interests"], data);
      void queryClient.invalidateQueries({ queryKey: ["learn"] });
      setDraft(null);
      toast.success(data.text ? "Saved. The Learn page will follow it." : "Cleared");
    },
  });
  const error = save.error instanceof ApiClientError ? save.error.message : save.error ? "Could not save" : null;
  const dirty = saved !== undefined && value.trim() !== saved.text;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(LEARNING_PROMPT);
      toast.success("Prompt copied");
    } catch {
      toast.error("Could not copy. Open ChatGPT or Claude instead; the prompt is filled in.");
    }
  };

  return (
    <Card id="learning">
      <CardHeader>
        <CardTitle>What you want to learn</CardTitle>
        <CardDescription className="max-w-prose">
          Describe what you’re into and what you’d like to know more about. The Learn page on
          Find something new gives each topic its own shelf, and still shows you subjects
          outside them. This stays on the churn server and is only for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {interestsQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(value);
            }}
          >
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="learning-interests" className="sr-only">
                Your interests
              </FieldLabel>
              <Textarea
                id="learning-interests"
                value={value}
                onChange={(event) => setDraft(event.target.value)}
                rows={8}
                maxLength={8000}
                placeholder={"I love how things are made, especially…\n\nTopics: space exploration, jazz, architecture"}
                className="min-h-40"
              />
              <FieldDescription>
                End with a line like <span className="font-medium text-foreground">Topics: jazz, space exploration</span>{" "}
                for the best results; otherwise churn reads the start of each bullet.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            {saved && saved.topics.length > 0 && !dirty ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Topics churn found</span>
                <ul className="flex flex-wrap gap-1.5">
                  {saved.topics.map((topic) => (
                    <li key={topic}>
                      <Badge variant="secondary">{topic}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              {dirty && saved?.text ? (
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Undo changes
                </Button>
              ) : null}
            </div>
          </form>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Not sure what to write? Ask the AI you already use. It knows your interests from your
            conversations; paste its answer above and edit it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={CHATGPT_URL} target="_blank" rel="noreferrer">
                Ask ChatGPT
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={CLAUDE_URL} target="_blank" rel="noreferrer">
                Ask Claude
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyPrompt()}>
              <CopyIcon aria-hidden="true" />
              Copy the prompt
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

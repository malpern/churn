import { useEffect } from "react";

/** Total length of the sign-in moment; the CSS timeline in index.css ends here. */
export const SIGN_IN_FLOURISH_MS = 820;

/**
 * A short brand moment after an active sign-in: the Churn wordmark, a ring
 * that churns once around it, then the layer lifts away to the dashboard that
 * has been rendering underneath the whole time. It never takes input, so it
 * cannot delay anyone who starts clicking straight away.
 */
export function SignInFlourish({ name, onDone }: { name?: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, SIGN_IN_FLOURISH_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div aria-hidden className="signin-flourish pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="signin-flourish-mark relative flex size-36 items-center justify-center">
          <svg className="signin-flourish-ring absolute inset-0 size-full" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="48" pathLength={1} />
          </svg>
          <span className="font-heading text-3xl font-semibold tracking-tight">Churn</span>
        </div>
        {name ? <span className="signin-flourish-name text-sm text-muted-foreground">Welcome back, {name}</span> : null}
      </div>
    </div>
  );
}

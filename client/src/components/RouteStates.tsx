import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';

// Router-wide fallbacks (M-15), set in router.tsx. A route with its own
// pendingComponent (/digest) keeps it.

export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main
      data-testid="route-error"
      className="page-wrap flex min-h-[60vh] items-center justify-center px-4 py-14"
    >
      <section
        role="alert"
        className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 p-10 text-center"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-destructive">
          Something went wrong
        </p>
        <h1 className="display-title mt-2 text-3xl text-[var(--ink)]">
          This page couldn&apos;t load.
        </h1>
        <details className="mt-3 text-left text-xs text-[var(--ink-soft)]">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{message.slice(0, 1000)}</pre>
        </details>
        <div className="mt-6 flex justify-center gap-2">
          <Button size="pill" onClick={() => void router.invalidate()}>
            Retry
          </Button>
          <Button asChild size="pill" variant="outline">
            <Link to="/feed">Back to feed</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

export function RoutePending() {
  return (
    <main
      data-testid="route-pending"
      aria-busy="true"
      className="flex min-h-[60vh] items-center justify-center px-6 py-14"
    >
      <div className="flex items-center gap-3 text-sm text-[var(--ink-muted)]">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--ink)]"
        />
        Loading…
      </div>
    </main>
  );
}

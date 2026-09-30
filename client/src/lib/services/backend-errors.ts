// The Strapi half of ADR-0007's boundary-layer error translation.
// `ollama-errors.ts` is the other half.
//
// Lived inside videos.ts as a private function, so every other service that
// hit a Strapi failure returned `result.error` raw — which is how `/digests`
// ended up rendering "Can't reach Strapi. fetch failed" instead of a
// message that tells the user what to do.

/** Turn a `strapiFetch` failure into something a user can act on.
 *
 * Status `0` = network error (DNS, connection refused, fetch threw).
 * 5xx = backend up but broken. 4xx = caller error (bad query/auth), where
 * the raw message is usually the most informative thing available. */
export function friendlyBackendError(status: number, raw: string): string {
  if (status === 0) {
    return 'Backend unreachable. Check that Strapi is running on port 1340.';
  }
  if (status >= 500) {
    return 'Backend error. Strapi is up but rejected the request — check its console for details.';
  }
  return raw || `Backend error ${status}`;
}

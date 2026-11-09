// Why a transcript fetch failed, in a form callers can branch on. Thrown by
// services/fetcher.ts `fetchAndStore` (and the youtube-transcript.ts
// functions it calls); mapped to HTTP by controllers/fetcher.ts.

export const TRANSCRIPT_FETCH_REASONS = [
  'invalid_id',
  'unavailable',
  'no_captions',
  'blocked',
  'rate_limited',
  'network',
] as const;

export type TranscriptFetchReason = (typeof TRANSCRIPT_FETCH_REASONS)[number];

/** invalid_id → 400; unavailable/no_captions → 404; blocked/rate_limited/network → 502. */
export const TRANSCRIPT_FETCH_STATUS: Record<TranscriptFetchReason, 400 | 404 | 502> = {
  invalid_id: 400,
  unavailable: 404,
  no_captions: 404,
  blocked: 502,
  rate_limited: 502,
  network: 502,
};

export class TranscriptFetchError extends Error {
  readonly reason: TranscriptFetchReason;

  constructor(reason: TranscriptFetchReason, message: string) {
    super(message);
    this.name = 'TranscriptFetchError';
    this.reason = reason;
  }
}

/** The REST answer for a TranscriptFetchError. */
export function transcriptFetchErrorResponse(err: TranscriptFetchError) {
  const status = TRANSCRIPT_FETCH_STATUS[err.reason];
  return {
    status,
    body: {
      data: null,
      error: { status, name: 'TranscriptFetchError', message: err.message, details: { reason: err.reason } },
    },
  };
}

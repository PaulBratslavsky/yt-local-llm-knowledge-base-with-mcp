import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from 'seroval';
import { buildBM25Index } from './transcript';
import { stripVideoForClient, type StrapiVideo } from './videos';

// ---------------------------------------------------------------------------
// Seroval boundary contract
//
// TanStack Start serializes every loader / server-fn return value with
// seroval before streaming it to the browser. A BM25 token table naturally
// grows a `constructor` key (or other Object.prototype names) whenever a
// transcript contains a word like "constructor" (common in programming
// videos).
//
// Through seroval 1.5.x, serializing ANY object with a reserved
// Object.prototype name as an OWN property — corrupted or clean value,
// plain or null-prototype — threw at serialize() time, crashing the loader
// stream. As of seroval 1.6.2 (pulled in transitively by the TanStack
// router/Start 2026-08-22 bump), that is fixed: reserved-name own
// properties are now serialized via computed-property syntax
// (`["constructor"]: value`) and round-trip with full fidelity — verified
// directly against 1.6.2:
//
//   serialize: OK
//   constructor      expected=3 got=3   OK
//   toString         expected=1 got=1   OK
//   hasOwnProperty   expected=2 got=2   OK
//   normalword       expected=7 got=7   OK
//
// `stripVideoForClient` is retained anyway, not because seroval would
// crash without it, but because `transcriptSegments` is a large,
// server-only retrieval structure (BM25 token tables) that the UI never
// reads — the strip is payload hygiene plus defense in depth against any
// future serialization regression, upstream or in-repo. See its doc
// comment in `./videos.ts`.
//
// These tests lock in both eras: what the old behavior demonstrably was
// (for the historical record, not re-asserted below) and what seroval
// guarantees today, so a downgrade or upstream regression in fidelity —
// not just a crash — fails here instead of as a silent data-corruption bug
// in production.
// ---------------------------------------------------------------------------

function expectSerovalSafe(value: unknown, label: string): void {
  expect(() => serialize(value), `${label} must be seroval-serializable`).not.toThrow();
}

// Minimal-but-faithful StrapiVideo. Only the fields that matter for the
// boundary contract are realistic; the rest are nulled.
function makeVideo(overrides: Partial<StrapiVideo> = {}): StrapiVideo {
  return {
    id: 1,
    documentId: 'abc123',
    youtubeVideoId: '4HaFaYMbal0',
    url: 'https://youtu.be/4HaFaYMbal0',
    videoTitle: 'Building a constructor pattern in TypeScript',
    videoAuthor: 'Some Channel',
    videoThumbnailUrl: 'https://i.ytimg.com/vi/4HaFaYMbal0/hqdefault.jpg',
    caption: null,
    createdAt: '2026-05-15T00:00:00.000Z',
    tags: null,
    summaryStatus: 'generated',
    summaryTitle: null,
    summaryDescription: null,
    summaryOverview: null,
    watchVerdict: null,
    verdictSummary: null,
    verdictReason: null,
    valueScore: null,
    valueScoreSource: null,
    signalScores: null,
    signalScore: null,
    finalScore: null,
    readableArticle: null,
    readableArticleGeneratedAt: null,
    readableArticleModel: null,
    summaryGeneratedAt: null,
    aiModel: null,
    transcriptSegments: null,
    summaryEmbedding: null,
    embeddingModel: null,
    embeddingVersion: null,
    embeddingGeneratedAt: null,
    passageEmbeddings: null,
    keyTakeaways: null,
    sections: null,
    actionSteps: null,
    transcript: null,
    ...overrides,
  } as StrapiVideo;
}

// A BM25 index built from text that contains the token "constructor".
// Built clean by the current code, it still ends up with `constructor`
// (and other reserved Object.prototype names) as an own key — the exact
// shape that used to crash the loader stream under seroval 1.5.x.
function makeReservedTokenIndex() {
  const chunks = [
    { id: 0, text: 'first the constructor pattern and the toString method', startWord: 0, timeSec: 0 },
    { id: 1, text: 'then we call super and check hasOwnProperty on the value', startWord: 10, timeSec: 30 },
    { id: 2, text: 'finally valueOf returns the wrapped primitive', startWord: 20, timeSec: 60 },
  ];
  return {
    version: 1 as const,
    bm25: buildBM25Index(chunks),
    durationSec: 90,
  };
}

// Reserved Object.prototype own-property names that used to make seroval
// throw at serialize() time under seroval < 1.6.2. `constructor` is the one
// a real transcript token table produces naturally (BM25 tokens are
// lowercased, and `constructor` is already all-lowercase). `toString` and
// `hasOwnProperty` are exercised here directly — in their exact camelCase
// spelling — to lock in the fidelity measured across the whole reserved-name
// family, not just the one case real transcript data happens to hit.
const RESERVED_NAME_FIDELITY_CASE = {
  constructor: 3,
  toString: 1,
  hasOwnProperty: 2,
  normalword: 7,
} as const;

// Serializes `value`, deserializes it back, and asserts every own key —
// including reserved Object.prototype names — round-trips as an own
// property with its exact original value. A test that only checked
// "didn't throw" would let silent corruption (e.g. a reserved-name key
// silently dropped, or its value coerced) regress unnoticed.
function assertReservedNameRoundTrip(value: Record<string, unknown>): void {
  const roundtripped = deserialize<Record<string, unknown>>(serialize(value));
  for (const key of Object.keys(value)) {
    expect(
      Object.prototype.hasOwnProperty.call(roundtripped, key),
      `expected round-tripped object to retain own key "${key}"`,
    ).toBe(true);
    expect(
      roundtripped[key],
      `expected "${key}" to round-trip with its exact original value`,
    ).toBe(value[key]);
  }
}

describe('seroval boundary contract', () => {
  it('a BM25 index containing reserved-name tokens now serializes and round-trips with full fidelity', () => {
    // Through seroval 1.5.x this threw the moment a transcript said
    // "constructor" (see header comment). seroval 1.6.2 fixed it: the
    // index now serializes successfully, and the value keyed under the
    // reserved name "constructor" survives the round trip unchanged.
    const index = makeReservedTokenIndex();
    expect(() => serialize(index)).not.toThrow();

    const roundtripped = deserialize<typeof index>(serialize(index));
    expect(roundtripped).toEqual(index);
    expect(
      Object.prototype.hasOwnProperty.call(roundtripped.bm25.tf[0], 'constructor'),
    ).toBe(true);
    expect(roundtripped.bm25.tf[0]['constructor']).toBe(index.bm25.tf[0]['constructor']);

    // Lock in fidelity across the full reserved-name family (constructor,
    // toString, hasOwnProperty) — the exact measurement that justified
    // keeping stripVideoForClient as hygiene rather than a crash workaround.
    assertReservedNameRoundTrip(RESERVED_NAME_FIDELITY_CASE);
  });

  it('a video carrying transcriptSegments now crosses the seroval boundary intact', () => {
    // Through seroval 1.5.x this threw as soon as the video's nested
    // transcriptSegments.bm25 contained a reserved-name key. seroval 1.6.2
    // fixed it: the whole video serializes and round-trips with full
    // fidelity, reserved keys included.
    const video = makeVideo({ transcriptSegments: makeReservedTokenIndex() });
    expect(() => serialize(video)).not.toThrow();

    const roundtripped = deserialize<StrapiVideo>(serialize(video));
    expect(roundtripped).toEqual(video);
    expect(roundtripped.transcriptSegments?.bm25.tf[0]['constructor']).toBe(
      video.transcriptSegments?.bm25.tf[0]['constructor'],
    );
  });

  it('stripVideoForClient makes the video seroval-safe', () => {
    const video = makeVideo({ transcriptSegments: makeReservedTokenIndex() });
    const stripped = stripVideoForClient(video);
    expect(stripped!.transcriptSegments).toBeNull();
    expectSerovalSafe(stripped, 'stripped video');
  });

  it('stripped video survives a list/array boundary (feed, digest, search hits)', () => {
    const videos = [
      makeVideo({ transcriptSegments: makeReservedTokenIndex() }),
      makeVideo({ documentId: 'def456', transcriptSegments: makeReservedTokenIndex() }),
    ].map((v) => stripVideoForClient(v));
    expectSerovalSafe(videos, 'feed-style video array');
    expectSerovalSafe(
      { status: 'ok', hits: videos.map((video) => ({ video, score: 0.9 })) },
      'semantic-search-style result',
    );
  });

  it('stripVideoForClient is null-safe', () => {
    expect(stripVideoForClient(null)).toBeNull();
  });
});

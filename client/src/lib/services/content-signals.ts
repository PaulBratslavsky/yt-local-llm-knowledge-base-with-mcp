// Programmatic content-quality signals computed at summary-generation
// time. Five deterministic, reproducible signals derived from the
// transcript text + duration; combined into a composite `signalScore`.
//
// Why this exists: the LLM-only `valueScore` clusters around mental
// anchor values (~25/50/72/85) regardless of underlying quality. These
// programmatic signals ground the score in measurable properties so
// within-bucket ranking is honest. See `docs/value-score-algorithm-plan.md`
// for the full methodology and references.
//
// Sub-metrics are stored alongside the composite so the UI / future
// tuning can inspect each one independently. All sub-metric values and
// the composite are integers 0–100 where higher = better quality.
//
// Topic coherence (the sixth signal in the plan) is intentionally
// deferred — it requires per-chunk embeddings which are computed AFTER
// the summary save in the existing pipeline. Adding it would require
// either reordering the pipeline or doing a follow-up update; not
// worth the complexity for v1.

import { gzipSync } from 'node:zlib';
import { cleanTranscript, STOPWORDS } from './transcript';

// -----------------------------------------------------------------------------
// The one way a transcript becomes signal input
// -----------------------------------------------------------------------------
//
// Every writer that computes a signalScore takes its text from here, and
// only from here. They used to clean their own way: summary generation
// scored the per-caption-segment cleaning it already had in hand, while the
// recompute and backfill paths cleaned the whole joined string. The filler
// list collapses repeated words, and YouTube auto-captions repeat across
// caption boundaries constantly — "…here is" / "is that…" — so the
// per-segment pass kept repeats the whole-string pass removed. Different
// text, different word count, and therefore different speaking-pace,
// lexical-density and compression-ratio signals. Pressing "Generate score"
// straight after a generation moved the user-visible number with no content
// change (issue #5).
//
// Whole-string cleaning is the canonical one, for two reasons. A content
// quality score must not depend on where a captioner happened to break a
// line — segment boundaries are an artifact of caption chunking, not a
// property of the video. And it is what the stored library already holds:
// checked against 100 scored videos, the whole-string result reproduces
// every stored signalScore, while the segment-aware result differs on 7 of
// them. Picking the other one would have restated scores for no gain.
//
// Segment-aware cleaning is still correct for its own job — it keeps one
// start time per surviving word, which is what grounds timecodes
// (ADR-0004). That is chunking's input, not scoring's.

export type SignalInput = {
  cleanedText: string;
  /** Words in `cleanedText`, by the same regex the signal maths has always
   *  used. Kept identical so this change restates no stored score. */
  wordCount: number;
};

export function signalInputForTranscript(rawText: string | null | undefined): SignalInput {
  const cleanedText = cleanTranscript(rawText ?? '');
  return { cleanedText, wordCount: countWords(cleanedText) };
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SignalScores = {
  /** Inverse filler density. 100 = no filler words; lower as filler density rises. */
  fillerDensity: number;
  /** Content-word ratio (Halliday's lexical density approximation via stopword inverse). */
  lexicalDensity: number;
  /** Inverse gzip compression ratio. 100 = highly varied / non-redundant text. */
  compressionRatio: number;
  /** Speaking pace fit. 100 = within natural 130–160 wpm band. */
  speakingPace: number;
  /** Inverse sponsor presence. 100 = no sponsor language detected. */
  sponsorPresence: number;
};

// Default weights for the composite. Each value is the share of the
// composite that the signal contributes. Must sum to 1.0. Tunable later
// via the calibration phase (see plan doc) — for v1 we bias toward
// "filler" and "sponsor" since those are the most user-facing concerns
// in a "is this video worth my time" judgment.
export const SIGNAL_WEIGHTS: Record<keyof SignalScores, number> = {
  fillerDensity: 0.25,
  lexicalDensity: 0.20,
  compressionRatio: 0.20,
  speakingPace: 0.10,
  sponsorPresence: 0.25,
};

// -----------------------------------------------------------------------------
// Filler density
// -----------------------------------------------------------------------------

// Patterns that count as "filler" for the density metric. Distinct from
// the cleaning patterns in transcript.ts (which also strip caption
// artifacts) — these are ONLY the human-speech fillers we want to
// count against the density score.
const FILLER_PATTERNS_DENSITY: RegExp[] = [
  /\b(?:um+|uh+|er+|erm+|hmm+|mm+)\b/gi,
  /\b(?:you know|i mean|kind of|sort of|like I said|to be honest|at the end of the day|basically|literally|honestly|actually|right\??)\b/gi,
];

export function computeFillerDensity(rawText: string): number {
  const totalWords = countWords(rawText);
  if (totalWords === 0) return 0;
  let fillerCount = 0;
  for (const pattern of FILLER_PATTERNS_DENSITY) {
    const matches = rawText.match(pattern);
    if (matches) fillerCount += matches.length;
  }
  // Filler-words/total-words ratio. Real-world transcripts: 1–3% is
  // typical clean speech, 5–10% is heavy filler. We compress the band
  // so 0% → 100, 10%+ → 0 with linear interpolation in between.
  const density = fillerCount / totalWords;
  const score = Math.max(0, Math.min(100, 100 * (1 - density / 0.10)));
  return Math.round(score);
}

// -----------------------------------------------------------------------------
// Lexical density (Halliday approximation)
// -----------------------------------------------------------------------------

// Strict Halliday's measure uses POS-tagged content words (nouns, verbs,
// adjectives, adverbs) divided by total words. POS tagging is overkill
// here; we approximate via stopword-inverse: words that are NOT in our
// stopword set are roughly content words. Less precise than tagged
// tokens but ~95% correlated for prose-length transcripts.
export function computeLexicalDensity(text: string): number {
  const tokens = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  if (tokens.length === 0) return 0;
  const contentTokens = tokens.filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
  const ratio = contentTokens.length / tokens.length;
  // Spoken transcripts typically score 0.40–0.60. Educational dense
  // content can hit 0.65+. Calibrate so 0.30 → 0, 0.60 → 100, linear
  // in between (clamped).
  const score = Math.max(0, Math.min(100, 100 * (ratio - 0.30) / 0.30));
  return Math.round(score);
}

// -----------------------------------------------------------------------------
// Compression ratio (redundancy proxy)
// -----------------------------------------------------------------------------

// gzip exploits local + global repetition. A transcript that says the
// same thing 3 ways compresses MORE than one that says 3 different
// things — so a low ratio (output much smaller than input) signals
// redundancy. We invert so high score = less redundant.
export function computeCompressionRatio(text: string): number {
  if (text.length < 100) return 0; // Too short to be meaningful.
  const raw = Buffer.byteLength(text, 'utf8');
  const compressed = gzipSync(text).length;
  const ratio = compressed / raw;
  // Typical English prose compresses to ~30–40% of original. Highly
  // redundant text compresses tighter (20–25%); novel/dense text
  // compresses worse (40–50%). Invert and rescale: 25% ratio → 0,
  // 50% ratio → 100.
  const score = Math.max(0, Math.min(100, 100 * (ratio - 0.25) / 0.25));
  return Math.round(score);
}

// -----------------------------------------------------------------------------
// Speaking pace
// -----------------------------------------------------------------------------

// Words per minute scored on a bell curve centered on natural speech
// (130–160 wpm). Slow pace (<100 wpm) often signals padding /
// performative pauses; very fast pace (>180 wpm) often signals rushed
// content that's hard to absorb. The sweet spot is in the middle.
export function computeSpeakingPace(
  wordCount: number,
  durationSec: number | null,
): number {
  if (!durationSec || durationSec < 30) return 50; // Too short to score.
  const wpm = wordCount / (durationSec / 60);
  // Distance from optimal band [130, 160]. Inside → 100. Outside,
  // decays linearly: 50 wpm away = 0.
  if (wpm >= 130 && wpm <= 160) return 100;
  const distance = wpm < 130 ? 130 - wpm : wpm - 160;
  const score = Math.max(0, Math.min(100, 100 * (1 - distance / 80)));
  return Math.round(score);
}

// -----------------------------------------------------------------------------
// Sponsor presence
// -----------------------------------------------------------------------------

// Heuristic detection of sponsor segments via common phrases that
// reliably indicate a sponsor read. Counts matches per 1000 words —
// each match is a "sponsor unit" we estimate covers ~30s of read time.
// Imperfect (will miss creative reads, false-positive on legit "use
// X to do Y" mentions) but good enough as a programmatic signal.
const SPONSOR_PATTERNS: RegExp[] = [
  /\bsponsor(?:ed|s|ing)?\s+(?:by|of)\b/gi,
  /\bbrought\s+to\s+you\s+by\b/gi,
  /\btoday'?s\s+sponsor\b/gi,
  /\b(?:use|enter)\s+(?:my|the|promo|coupon)?\s*code\b/gi,
  /\bsign\s+up\s+(?:at|today|now)\b/gi,
  /\bcheck\s+out\s+(?:our|their)\s+(?:link|website|sponsor)\b/gi,
  /\baffiliate\s+link\b/gi,
];

export function computeSponsorPresence(text: string): number {
  const totalWords = countWords(text);
  if (totalWords === 0) return 100;
  let matches = 0;
  for (const pattern of SPONSOR_PATTERNS) {
    const m = text.match(pattern);
    if (m) matches += m.length;
  }
  // 0 matches = 100. Each match deducts 20 points (≈1 sponsor read on
  // a typical 10-min video). 5+ matches = 0.
  const score = Math.max(0, 100 - matches * 20);
  return Math.round(score);
}

// -----------------------------------------------------------------------------
// Composite
// -----------------------------------------------------------------------------

export function computeSignalScores(input: {
  rawText: string;
  cleanedText: string;
  wordCount: number;
  durationSec: number | null;
}): SignalScores {
  return {
    fillerDensity: computeFillerDensity(input.rawText),
    lexicalDensity: computeLexicalDensity(input.cleanedText),
    compressionRatio: computeCompressionRatio(input.cleanedText),
    speakingPace: computeSpeakingPace(input.wordCount, input.durationSec),
    sponsorPresence: computeSponsorPresence(input.rawText),
  };
}

// Weighted average → single 0–100 composite. Same shape the UI uses for
// sort/filter/threshold queries; the per-signal sub-metrics stay on the
// row for inspection and future re-tuning.
export function aggregateSignalScore(scores: SignalScores): number {
  let weighted = 0;
  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    weighted += scores[key as keyof SignalScores] * weight;
  }
  return Math.round(Math.max(0, Math.min(100, weighted)));
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function countWords(text: string): number {
  const m = text.match(/\b[\w'-]+\b/g);
  return m ? m.length : 0;
}

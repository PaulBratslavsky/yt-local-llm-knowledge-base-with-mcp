// Eight 260-word topics, one caption segment each, a minute apart. The
// expected timecodes in the M4 tests were computed with bm25-core at 721f210,
// grounding with findEvidenceForQuote(`${heading}. ${body}`, bm25, 1.0) as
// the app does (recomputed 2026-11-08: top scores 13.267 and 16.584; the
// third section matches no term).
export const TOPICS = [
  ['kubernetes', 'scheduler', 'pods', 'nodes', 'cluster', 'autoscaling'],
  ['sourdough', 'bread', 'flour', 'yeast', 'starter', 'oven'],
  ['marathon', 'training', 'running', 'pace', 'mileage', 'tempo'],
  ['telescope', 'galaxy', 'nebula', 'orbit', 'planet', 'comet'],
  ['espresso', 'grinder', 'crema', 'roast', 'barista', 'portafilter'],
  ['violin', 'orchestra', 'symphony', 'conductor', 'rehearsal', 'concerto'],
  ['glacier', 'avalanche', 'summit', 'crampons', 'altitude', 'ridge'],
  ['compiler', 'parser', 'lexer', 'bytecode', 'optimizer', 'linker'],
];
const words = (v: string[], n: number) => Array.from({ length: n }, (_, i) => v[i % v.length]).join(' ');
export const RAW_SEGMENTS = TOPICS.map((v, i) => ({
  text: words(v, 260),
  startMs: i * 60_000,
  endMs: i * 60_000 + 59_000,
}));
export const DURATION_SEC = 480;
export const SECTIONS = [
  { heading: 'Pulling an espresso shot', body: 'Grinder settings, crema and the portafilter.' },
  { heading: 'Marathon training plan', body: 'Weekly mileage, tempo runs and race pace.' },
  { heading: 'Quantum chromodynamics', body: 'Gluon confinement and asymptotic freedom.' },
];
/** Grounded timeSec per SECTIONS entry. */
export const EXPECTED_SECTION_TIMES = [240, 120, null];

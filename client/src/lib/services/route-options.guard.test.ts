import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Route files cannot be imported outside the Start runtime, so these read
// source. M-15: loaders that start Ollama work never run on hover, and every
// route has an error and a pending state. B-6: the chat API routes load the
// row with its stored index.
const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** The text of the options object passed to createFileRoute(…)(…). */
function routeOptions(text: string): string {
  const start = text.indexOf('createFileRoute(');
  expect(start, 'createFileRoute( not found').toBeGreaterThanOrEqual(0);
  const open = text.indexOf('({', start);
  let depth = 0;
  for (let i = open + 1; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i + 1);
    }
  }
  throw new Error('unbalanced createFileRoute options');
}

describe('route options (M-15, B-6)', () => {
  it.each(['routes/learn.$videoId.tsx', 'routes/digest.tsx'])('%s does not preload its loader', (file) => {
    expect(routeOptions(read(file))).toContain('preload: false,');
  });

  it('router.tsx sets the default error and pending components', () => {
    const text = read('router.tsx');
    expect(text).toContain('defaultErrorComponent: RouteError');
    expect(text).toContain('defaultPendingComponent: RoutePending');
  });

  it.each(['routes/api.chat.tsx', 'routes/api.digest-chat.tsx'])(
    '%s loads the video with the server-only fetch',
    (file) => {
      const text = read(file);
      expect(text).toContain('fetchVideoByVideoIdForServerWithStatusService(');
      expect(text).not.toContain('fetchVideoByVideoIdWithStatusService(');
    },
  );
});

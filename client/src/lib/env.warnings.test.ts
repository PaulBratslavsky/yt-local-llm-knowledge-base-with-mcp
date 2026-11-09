import { describe, it, expect } from 'vitest';
import { envWarnings, startupWarnings } from '#/lib/env';

// A complete, healthy env. Each test perturbs one field so a warning can
// only come from the thing under test.
const healthy = {
  OLLAMA_MODEL: 'gemma3',
  OLLAMA_CHAT_MODEL: 'gemma3',
  STRAPI_URL: 'http://localhost:1340',
  STRAPI_API_TOKEN: 'tok_abc',
};

describe('envWarnings', () => {
  it('is silent when everything is set', () => {
    expect(envWarnings(healthy)).toEqual([]);
  });

  it('warns when STRAPI_API_TOKEN is empty, naming the 403 consequence', () => {
    const out = envWarnings({ ...healthy, STRAPI_API_TOKEN: '' });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('STRAPI_API_TOKEN');
    // The consequence matters more than the symptom: an empty token means
    // requests carry no Authorization header and land as the Public role.
    expect(out[0]).toMatch(/403|Public role/i);
  });

  it('still warns about the pre-existing fields', () => {
    expect(envWarnings({ ...healthy, OLLAMA_MODEL: '' })[0]).toContain('OLLAMA_MODEL');
    expect(envWarnings({ ...healthy, OLLAMA_CHAT_MODEL: '' })[0]).toContain('OLLAMA_CHAT_MODEL');
    expect(envWarnings({ ...healthy, STRAPI_URL: '' })[0]).toContain('STRAPI_URL');
  });

  it('warns when STRAPI_API_TOKEN is entirely unset, not just empty', () => {
    // readEnv returns undefined when the var is absent; empty and absent
    // are the same failure as far as the Authorization header is concerned.
    const out = envWarnings({ ...healthy, STRAPI_API_TOKEN: undefined });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('STRAPI_API_TOKEN');
  });

  it('reports every problem, not just the first', () => {
    const out = envWarnings({
      OLLAMA_MODEL: '',
      OLLAMA_CHAT_MODEL: '',
      STRAPI_URL: '',
      STRAPI_API_TOKEN: '',
    });
    expect(out).toHaveLength(4);
  });
});

describe('startupWarnings', () => {
  const empty = { ...healthy, STRAPI_API_TOKEN: undefined };

  it('warns on the server, where the token is read', () => {
    expect(startupWarnings(empty, { isServer: true })).toHaveLength(1);
  });

  it('is silent in the browser, which never receives server env', () => {
    // env.ts is bundled into the client too; there STRAPI_API_TOKEN is always
    // unset by design, so a warning would be a false alarm.
    expect(startupWarnings(empty, { isServer: false })).toEqual([]);
  });
});

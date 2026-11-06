import type { Core } from '@strapi/strapi';
import components, { COMPONENT_CATEGORY } from './components';

const pascal = (s: string) =>
  s.replace(/(^|-)([a-z0-9])/g, (_m, _d, c: string) => c.toUpperCase());

/**
 * Register this plugin's components.
 *
 * Strapi 5.52 loads components only from the host app's `src/components`
 * (core loaders/components.js reads strapi.dirs.dist.components); there is no
 * plugin path for them. Adding them to the component registry during
 * register() — before the database schema sync — makes them usable by this
 * plugin's content types. Proven by a spike on 2026-11-06 (tables created, a
 * repeatable component round-tripped through REST).
 *
 * `strapi.get('components').add` is NOT a documented plugin API. Re-check it
 * on every Strapi upgrade; if it breaks, the fallback is JSON fields.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const toAdd: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(components)) {
    const uid = `${COMPONENT_CATEGORY}.${key}`;
    toAdd[uid] = {
      ...schema,
      __schema__: JSON.parse(JSON.stringify(schema)),
      uid,
      category: COMPONENT_CATEGORY,
      modelType: 'component',
      modelName: key,
      globalId: `Component${pascal(COMPONENT_CATEGORY)}${pascal(key)}`,
    };
  }
  (strapi.get('components') as { add: (c: Record<string, unknown>) => void }).add(toAdd);
  strapi.log.info(`[yt-kb] registered ${Object.keys(toAdd).length} components`);
};

import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  // Explicit origin list. A bare 'strapi::cors' inherits the installed
  // defaults — origin '*' WITH credentials: true — and @strapi/core's
  // matchOrigin() echoes the caller's own Origin back whenever the list
  // contains '*', so the browser permits the read. Combined with the
  // Public-role grants seeded in src/index.ts (create/update on video,
  // transcript, tag; delete on note and digest, no credential required),
  // any page the owner happened to visit could read the whole library and
  // delete notes and digests. Verified against the running instance before
  // this change: Access-Control-Allow-Origin echoed an arbitrary origin
  // with Access-Control-Allow-Credentials: true, and a DELETE preflight
  // returned 204.
  //
  // Nothing in this product calls Strapi from a browser: the client calls
  // it from its own server via strapi-client.ts, and the site calls it only
  // at build time from a Node process. So an empty list costs nothing. The
  // admin panel is same-origin and never consults CORS. Add an origin here
  // literally if a browser ever needs direct access.
  { name: 'strapi::cors', config: { origin: [], credentials: false } },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      jsonLimit: '20mb',
      formLimit: '20mb',
      textLimit: '20mb',
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;

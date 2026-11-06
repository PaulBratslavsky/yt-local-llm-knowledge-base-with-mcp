import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  // 0.0.0.0 is Strapi's own default and the only value a hosted container can
  // be reached on. Strapi Cloud does not inject HOST (its defaults are the
  // secrets: APP_KEYS, ADMIN_JWT_SECRET, API_TOKEN_SALT, JWT_SECRET,
  // TRANSFER_TOKEN_SALT), so a loopback default here would bind inside the
  // container and leave the platform unable to reach the server.
  //
  // For local use, set HOST=127.0.0.1 in server/.env (.env.example does).
  // With the Public role now read-only the LAN exposure is reads only, but
  // loopback is still the right local setting.
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1340),
  app: {
    keys: env.array('APP_KEYS'),
  },
  // Official Strapi MCP server (5.47+), served at /mcp over streamable-http,
  // gated by admin API tokens. The domain tools register onto it from
  // src/index.ts via src/mcp-official/. This replaced the hand-rolled
  // /api/mcp server (retired). Defaults: connect 5s, request 60s.
  mcp: { enabled: env.bool('MCP_ENABLED', true) },
});

export default config;

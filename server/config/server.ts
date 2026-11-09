import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  // 0.0.0.0 is Strapi's own default and the only value a hosted container can
  // be reached on. Strapi Cloud does not inject HOST (its defaults are the
  // secrets: APP_KEYS, ADMIN_JWT_SECRET, API_TOKEN_SALT, JWT_SECRET,
  // TRANSFER_TOKEN_SALT), so a loopback default here would bind inside the
  // container and leave the platform unable to reach the server.
  //
  // For local use, set HOST=127.0.0.1 in server/.env (.env.example does):
  // the admin panel and /mcp should not listen on the LAN.
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1340),
  app: {
    keys: env.array('APP_KEYS'),
  },
  // Official Strapi MCP server (5.47+), served at /mcp over streamable-http,
  // gated by admin API tokens. yt-kb's tools are registered on it by
  // strapi-plugin-yt-kb (config/plugins.ts, `mcp: true`). This replaced the hand-rolled
  // /api/mcp server (retired). Defaults: connect 5s, request 60s.
  mcp: { enabled: env.bool('MCP_ENABLED', true) },
});

export default config;

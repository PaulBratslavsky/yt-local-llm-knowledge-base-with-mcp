import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  // Loopback by default. 0.0.0.0 exposed the Public-role write grants to
  // every device on the network; this app is documented single-user and
  // local-first (docs/adr/0001), so the LAN bind was never a decision.
  // Set HOST explicitly to opt back in.
  host: env('HOST', '127.0.0.1'),
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

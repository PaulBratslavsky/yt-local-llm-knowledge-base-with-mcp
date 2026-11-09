import register from './register';
import bootstrap from './bootstrap';
import contentTypes from './content-types';
import controllers from './controllers';
import services from './services';
import routes from './routes';

type PluginConfig = { mcp?: unknown; proxyUrl?: unknown; import?: unknown; backfillMetadata?: unknown };
const BOOLEAN_KEYS = ['mcp', 'import', 'backfillMetadata'] as const;

export default {
  register,
  bootstrap,
  destroy() {},
  config: {
    // A function, so Strapi calls it with its env helper after .env is loaded
    // (core loaders/plugins/index.js). A value set in the host's
    // config/plugins.ts still wins over these defaults.
    default: ({ env }: { env: (key: string, fallback?: string) => string }) => ({
      // Register the MCP tools.
      mcp: true,
      // Proxy for every YouTube request; same shape as strapi-plugin-youtube-transcripts.
      proxyUrl: env('PROXY_URL', ''),
      // POST /api/yt-kb/import/:type is refused unless true (M5).
      import: false,
      // Refetch missing metadata for stored transcripts at boot (talks to YouTube once per row).
      backfillMetadata: false,
    }),
    validator(config: PluginConfig) {
      for (const key of BOOLEAN_KEYS) {
        if (config[key] !== undefined && typeof config[key] !== 'boolean') {
          throw new Error(`yt-kb: \`${key}\` must be a boolean`);
        }
      }
      if (config.proxyUrl !== undefined && typeof config.proxyUrl !== 'string') {
        throw new Error('yt-kb: `proxyUrl` must be a string');
      }
    },
  },
  contentTypes,
  controllers,
  services,
  routes,
};

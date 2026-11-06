import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  // strapi-plugin-yt-kb, loaded from source while it is developed here.
  // Once published, install it from npm and drop `resolve`.
  'yt-kb': {
    enabled: true,
    resolve: './src/plugins/yt-kb',
    config: {
      // Off until cutover: this app still registers the same 21 tool names
      // against the old api:: data, and the two sets would collide. The
      // plugin's admin permissions are registered regardless, so a token can
      // be granted plugin::yt-kb.* before the switch.
      mcp: false,
    },
  },
});

export default config;

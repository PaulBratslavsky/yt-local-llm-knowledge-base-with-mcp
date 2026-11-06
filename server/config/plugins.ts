import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  // strapi-plugin-yt-kb, loaded from source while it is developed here.
  // Once published, install it from npm and drop `resolve`.
  'yt-kb': {
    enabled: true,
    resolve: './src/plugins/yt-kb',
  },
});

export default config;

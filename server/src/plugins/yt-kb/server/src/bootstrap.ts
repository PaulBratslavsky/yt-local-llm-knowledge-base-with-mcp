import type { Core } from '@strapi/strapi';
import { backfillTranscriptMetadata } from './services/metadata-backfill';
import { maskProxyUrl, testProxyConnection } from './services/youtube-transcript';

// Plugin bootstrap. The proxy check and the optional metadata backfill work as
// in strapi-plugin-youtube-transcripts (YT L1123-1153); neither blocks boot.
export default async ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = strapi.plugin('yt-kb');
  const proxyUrl = (plugin.config('proxyUrl') as string | undefined) || '';

  if (proxyUrl) {
    const masked = maskProxyUrl(proxyUrl);
    strapi.log.info(`[yt-kb] Proxy configured: ${masked}`);
    void testProxyConnection(proxyUrl).then((result) => {
      if (result.success === true) {
        strapi.log.info(`[yt-kb] Proxy connection successful - Outbound IP: ${result.ip}`);
      } else {
        strapi.log.error(`[yt-kb] Proxy connection FAILED (${masked}): ${result.error}`);
        strapi.log.error('[yt-kb] YouTube requests will likely fail. Check the proxy credentials and URL.');
      }
    });
  } else {
    strapi.log.warn(
      '[yt-kb] No proxy configured; YouTube may block datacenter IPs. Set PROXY_URL, or proxyUrl in the yt-kb plugin config (config/plugins.ts).',
    );
  }

  if (plugin.config('backfillMetadata') === true) {
    strapi.log.info('[yt-kb] backfillMetadata is on: refetching metadata for stored transcripts in the background');
    void backfillTranscriptMetadata(strapi, { proxyUrl: proxyUrl || undefined }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.warn(`[yt-kb] metadata backfill did not complete: ${message}`, { message });
    });
  }
};

import { factories } from '@strapi/strapi';
import importer from './importer';

// Plain core controllers, exactly as the app's api:: types had them. The
// UID isn't in Strapi's generated type union for a plugin, hence the casts.
const c = (uid: string) => factories.createCoreController(uid as never);

export default {
  video: c('plugin::yt-kb.video'),
  tag: c('plugin::yt-kb.tag'),
  transcript: c('plugin::yt-kb.transcript'),
  note: c('plugin::yt-kb.note'),
  digest: c('plugin::yt-kb.digest'),
  importer,
};

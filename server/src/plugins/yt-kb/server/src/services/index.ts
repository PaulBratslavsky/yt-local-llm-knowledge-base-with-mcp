import { factories } from '@strapi/strapi';
import importer from './importer';
import fetcher from './fetcher';

const s = (uid: string) => factories.createCoreService(uid as never);

export default {
  video: s('plugin::yt-kb.video'),
  tag: s('plugin::yt-kb.tag'),
  transcript: s('plugin::yt-kb.transcript'),
  note: s('plugin::yt-kb.note'),
  digest: s('plugin::yt-kb.digest'),
  importer,
  fetcher,
};

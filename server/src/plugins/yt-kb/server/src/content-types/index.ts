import video from './video/schema.json';
import tag from './tag/schema.json';
import transcript from './transcript/schema.json';
import note from './note/schema.json';
import digest from './digest/schema.json';

// Keys match info.singularName, so UIDs are plugin::yt-kb.<key>.
export default {
  video: { schema: video },
  tag: { schema: tag },
  transcript: { schema: transcript },
  note: { schema: note },
  digest: { schema: digest },
};

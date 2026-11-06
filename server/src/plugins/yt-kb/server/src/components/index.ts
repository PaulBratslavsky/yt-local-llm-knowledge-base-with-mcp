import actionStep from './action-step.json';
import digestContradictionPosition from './digest-contradiction-position.json';
import digestContradiction from './digest-contradiction.json';
import digestSharedTheme from './digest-shared-theme.json';
import digestUniqueInsight from './digest-unique-insight.json';
import digestVideoTitle from './digest-video-title.json';
import digestViewingOrder from './digest-viewing-order.json';
import section from './section.json';
import takeaway from './takeaway.json';

// Keyed by the name each component is referenced by (`ytkb.<key>`).
export const COMPONENT_CATEGORY = 'ytkb';

export default {
  'action-step': actionStep,
  'digest-contradiction-position': digestContradictionPosition,
  'digest-contradiction': digestContradiction,
  'digest-shared-theme': digestSharedTheme,
  'digest-unique-insight': digestUniqueInsight,
  'digest-video-title': digestVideoTitle,
  'digest-viewing-order': digestViewingOrder,
  section,
  takeaway,
} as Record<string, Record<string, unknown>>;

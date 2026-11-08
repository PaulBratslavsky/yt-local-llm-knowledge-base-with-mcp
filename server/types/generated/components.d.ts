import type { Schema, Struct } from '@strapi/strapi';

export interface YtkbActionStep extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_action_steps';
  info: {
    description: 'A concrete step the reader can take. Repeatable; the post renders these as a numbered plan at the end of the summary.';
    displayName: 'Action step';
  };
  attributes: {
    body: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 600;
      }>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
  };
}

export interface YtkbDigestContradiction extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_digest_contradictions';
  info: {
    description: 'A genuine disagreement between source videos on one concrete topic, with the positions taken by each side.';
    displayName: 'Digest Contradiction';
  };
  attributes: {
    positions: Schema.Attribute.Component<
      'ytkb.digest-contradiction-position',
      true
    > &
      Schema.Attribute.SetMinMax<
        {
          min: 2;
        },
        number
      >;
    topic: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
  };
}

export interface YtkbDigestContradictionPosition
  extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_digest_contradiction_positions';
  info: {
    description: "One video's stance on a contested topic. Nested under a contradiction component (\u22652 positions per topic).";
    displayName: 'Digest Contradiction Position';
  };
  attributes: {
    stance: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 400;
      }>;
    videoTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface YtkbDigestSharedTheme extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_digest_shared_themes';
  info: {
    description: 'A theme that appears across two or more source videos of a digest.';
    displayName: 'Digest Shared Theme';
  };
  attributes: {
    body: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1500;
      }>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    videoTitles: Schema.Attribute.Component<'ytkb.digest-video-title', true>;
  };
}

export interface YtkbDigestUniqueInsight extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_digest_unique_insights';
  info: {
    description: 'What one specific source video uniquely contributes to a digest, beyond what the others cover.';
    displayName: 'Digest Unique Insight';
  };
  attributes: {
    insight: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 600;
      }>;
    videoTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface YtkbDigestVideoTitle extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_digest_video_titles';
  info: {
    description: "Single verbatim video title string. Used inside shared-theme components to list which source videos cover the theme \u2014 a nested repeatable component stands in for a `string[]` field, which Strapi doesn't natively support.";
    displayName: 'Digest Video Title';
  };
  attributes: {
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface YtkbDigestViewingOrder extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_digest_viewing_orders';
  info: {
    description: "One entry in the recommended viewing sequence for a digest's source videos. Populated only when order matters (one video is prerequisite to another).";
    displayName: 'Digest Viewing Order';
  };
  attributes: {
    videoTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    why: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface YtkbSection extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_sections';
  info: {
    description: 'A content section. `timeSec` is optional \u2014 populated for video posts (clickable seek), omitted for articles/blogs.';
    displayName: 'Section';
  };
  attributes: {
    body: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2000;
      }>;
    heading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    timeSec: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
  };
}

export interface YtkbTakeaway extends Struct.ComponentSchema {
  collectionName: 'components_ytkb_takeaways';
  info: {
    description: 'A single key-takeaway bullet. Repeatable on posts (video summaries, future articles/blogs).';
    displayName: 'Takeaway';
  };
  attributes: {
    text: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 280;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'ytkb.action-step': YtkbActionStep;
      'ytkb.digest-contradiction': YtkbDigestContradiction;
      'ytkb.digest-contradiction-position': YtkbDigestContradictionPosition;
      'ytkb.digest-shared-theme': YtkbDigestSharedTheme;
      'ytkb.digest-unique-insight': YtkbDigestUniqueInsight;
      'ytkb.digest-video-title': YtkbDigestVideoTitle;
      'ytkb.digest-viewing-order': YtkbDigestViewingOrder;
      'ytkb.section': YtkbSection;
      'ytkb.takeaway': YtkbTakeaway;
    }
  }
}

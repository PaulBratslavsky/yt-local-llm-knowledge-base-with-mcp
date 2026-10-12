import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import ActionStepList from './ActionStepList.astro';
import SectionList from './SectionList.astro';
import TakeawayList from './TakeawayList.astro';
import VerdictBadge from './VerdictBadge.astro';

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

// No video in the current library is missing these arrays, but older rows
// predate the components and a regeneration can drop one. "None" must render
// as an absent section, not a crash or an empty heading.
describe('a video with nothing in a component array', () => {
  it('renders no Sections block', async () => {
    const html = await container.renderToString(SectionList, {
      props: { videoId: 'abc123', sections: [] },
    });
    expect(html).not.toContain('Sections');
  });

  it('renders no Key takeaways block', async () => {
    const html = await container.renderToString(TakeawayList, {
      props: { takeaways: [] },
    });
    expect(html).not.toContain('Key takeaways');
  });

  it('renders no Action steps block', async () => {
    const html = await container.renderToString(ActionStepList, {
      props: { steps: [] },
    });
    expect(html).not.toContain('Action steps');
  });
});

describe('SectionList', () => {
  it('links a grounded section to its moment in the video', async () => {
    const html = await container.renderToString(SectionList, {
      props: {
        videoId: 'abc123',
        sections: [{ heading: 'Scheduling', body: 'how it works', timeSec: 95 }],
      },
    });

    // Compare the real URL, not Astro's choice of ampersand escape.
    expect(html.replace(/&amp;/g, '&')).toContain(
      'https://www.youtube.com/watch?v=abc123&t=95s',
    );
    expect(html).toContain('01:35');
  });

  // ADR-0004: the pipeline leaves a section ungrounded rather than inventing
  // a timecode, and the page must not invent one either.
  it('renders an ungrounded section as a heading with no link', async () => {
    const html = await container.renderToString(SectionList, {
      props: {
        videoId: 'abc123',
        sections: [{ heading: 'Ungrounded', body: null, timeSec: null }],
      },
    });

    expect(html).toContain('Ungrounded');
    expect(html).toContain('--:--');
    expect(html).not.toContain('t=0s');
    expect(html).not.toContain('<a');
  });
});

describe('VerdictBadge', () => {
  it('shows the verdict and the content score', async () => {
    const html = await container.renderToString(VerdictBadge, {
      props: { verdict: 'worth_it', score: 83 },
    });
    expect(html).toContain('Worth watching');
    expect(html).toContain('Content score 83');
  });

  // A row rated before the hybrid score landed has neither.
  it('renders nothing when a video has no verdict and no score', async () => {
    const html = await container.renderToString(VerdictBadge, {
      props: { verdict: null, score: null },
    });
    expect(html).not.toContain('Worth watching');
    expect(html).not.toContain('Content score');
  });
});

describe('TakeawayList', () => {
  // The model writes markdown into keyTakeaways — 17 of the current library's
  // overviews and many takeaways carry `**bold**` and list markers. Rendered
  // as plain text they show the asterisks.
  it('renders markdown emphasis in a takeaway', async () => {
    const html = await container.renderToString(TakeawayList, {
      props: { takeaways: [{ text: '**Scheduling:** binds pods to nodes' }] },
    });

    expect(html).toContain('<strong>Scheduling:</strong>');
    expect(html).not.toContain('**Scheduling:**');
  });

  it('escapes raw HTML inside a takeaway', async () => {
    const html = await container.renderToString(TakeawayList, {
      props: { takeaways: [{ text: 'before <img src=x onerror="alert(1)"> after' }] },
    });

    expect(html).not.toContain('onerror="');
  });
});

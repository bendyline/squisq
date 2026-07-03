import { parseMarkdown, type MarkdownDocument } from '@bendyline/squisq/markdown';

export interface RoundTripFixture {
  name: string;
  markdown: string;
  doc: MarkdownDocument;
  keyPhrases: string[];
  headingTexts: string[];
}

function makeFixture(
  name: string,
  markdown: string,
  keyPhrases: string[],
  headingTexts: string[],
): RoundTripFixture {
  return {
    name,
    markdown,
    doc: parseMarkdown(markdown),
    keyPhrases,
    headingTexts,
  };
}

export const ROUNDTRIP_FIXTURES = {
  story: makeFixture(
    'story',
    `# River Journal

The field team walked the north bank and recorded water conditions.

## Morning Snapshot

- Water level is steady.
- Team status is ready.
- Safety checks are complete.

## Notes

The crew published an update and linked the [full report](https://example.com/report).
`,
    ['river journal', 'north bank', 'water level', 'team status', 'full report'],
    ['River Journal', 'Morning Snapshot', 'Notes'],
  ),

  mixed: makeFixture(
    'mixed',
    `# Ops Weekly

This week we tracked **launch readiness**, *quality signals*, and risk burn-down.

## Checklist

1. Confirm deployment window.
2. Validate rollback script.
3. Notify stakeholders.

## Outcome

Launch readiness improved and support tickets declined.
`,
    [
      'ops weekly',
      'launch readiness',
      'quality signals',
      'rollback script',
      'support tickets declined',
    ],
    ['Ops Weekly', 'Checklist', 'Outcome'],
  ),

  table: makeFixture(
    'table',
    `# Metrics

| Metric | Value |
| --- | --- |
| Throughput | 120 req/s |
| Error Rate | 0.2% |
| P95 | 180ms |
`,
    ['metrics', 'throughput', '120 req/s', 'error rate', 'p95'],
    ['Metrics'],
  ),
};

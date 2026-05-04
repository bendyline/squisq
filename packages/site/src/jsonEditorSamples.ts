/**
 * Sample schemas + initial values exercising the breadth of `<JsonEditor>`
 * and `<JsonView>` controls.
 */

import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';

export interface JsonEditorSample {
  label: string;
  schema: SquisqAnnotatedSchema;
  initial: unknown;
}

const pageSettings: JsonEditorSample = {
  label: 'Page settings',
  schema: {
    type: 'object',
    squisq: { control: 'group', label: 'Page Settings' },
    properties: {
      title: {
        type: 'string',
        title: 'Page Title',
        squisq: { placeholder: 'Untitled' },
      },
      slug: {
        type: 'string',
        title: 'URL slug',
        squisq: { placeholder: 'my-page', help: 'Lowercase, dashes between words.' },
      },
      accent: {
        type: 'string',
        format: 'color',
        title: 'Accent color',
      },
      density: {
        type: 'string',
        title: 'Density',
        enum: ['comfortable', 'compact'],
        squisq: { enumLabels: { comfortable: 'Comfortable', compact: 'Compact' } },
      },
      theme: {
        type: 'string',
        title: 'Theme',
        enum: ['standard', 'documentary', 'bold', 'cinematic', 'minimalist', 'magazine'],
      },
      published: { type: 'boolean', title: 'Published' },
      tags: {
        type: 'array',
        title: 'Tags',
        items: { type: 'string' },
        squisq: { control: 'chip-bin', addLabel: '+ Add tag' },
      },
    },
  },
  initial: {
    title: 'Welcome',
    slug: 'welcome',
    accent: '#3182ce',
    density: 'comfortable',
    theme: 'standard',
    published: true,
    tags: ['intro', 'home'],
  },
};

const addressBook: JsonEditorSample = {
  label: 'Address book',
  schema: {
    type: 'object',
    squisq: { control: 'group', label: 'Address book' },
    properties: {
      contacts: {
        type: 'array',
        title: 'Contacts',
        squisq: { control: 'card-stack', addLabel: '+ Add contact' },
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Full name' },
            relationship: {
              type: 'string',
              title: 'Relationship',
              enum: ['family', 'friend', 'colleague', 'other'],
            },
            email: { type: 'string', title: 'Email', format: 'email' },
            phone: { type: 'string', title: 'Phone' },
            preferred: { type: 'boolean', title: 'Preferred contact' },
          },
          squisq: { itemLabel: { fromField: 'name' } },
        },
      },
    },
  },
  initial: {
    contacts: [
      {
        name: 'Alex Rivera',
        relationship: 'colleague',
        email: 'alex@example.com',
        phone: '+1 555 0142',
        preferred: true,
      },
      {
        name: 'Jamie Singh',
        relationship: 'friend',
        email: 'jamie@example.com',
        phone: '+1 555 0190',
        preferred: false,
      },
    ],
  },
};

const themeOverride: JsonEditorSample = {
  label: 'Theme override',
  schema: {
    type: 'object',
    squisq: { control: 'group', label: 'Theme overrides' },
    properties: {
      seed: {
        type: 'object',
        title: 'Seed colors',
        properties: {
          primary: { type: 'string', format: 'color', title: 'Primary' },
          secondary: { type: 'string', format: 'color', title: 'Secondary' },
        },
      },
      style: {
        type: 'object',
        title: 'Style',
        properties: {
          borderRadius: {
            type: 'integer',
            title: 'Border radius (px)',
            minimum: 0,
            maximum: 32,
          },
          textShadow: { type: 'boolean', title: 'Text shadow' },
          overlayOpacity: {
            type: 'number',
            title: 'Overlay opacity',
            minimum: 0,
            maximum: 1,
            squisq: { step: 0.05 },
          },
        },
      },
    },
  },
  initial: {
    seed: { primary: '#3182ce', secondary: '#ed8936' },
    style: { borderRadius: 8, textShadow: false, overlayOpacity: 0.4 },
  },
};

const blogPost: JsonEditorSample = {
  label: 'Blog post (with rich text)',
  schema: {
    type: 'object',
    squisq: { control: 'group', label: 'Blog post' },
    properties: {
      title: { type: 'string', title: 'Title' },
      author: { type: 'string', title: 'Author' },
      summary: {
        type: 'string',
        title: 'Summary',
        squisq: { control: 'multiline', placeholder: 'A short tease…' },
      },
      body: {
        type: 'string',
        title: 'Body',
        squisq: { control: 'richtext', placeholder: 'Write the article…' },
      },
      showAuthor: { type: 'boolean', title: 'Show author byline' },
      authorBio: {
        type: 'string',
        title: 'Author bio',
        squisq: {
          control: 'multiline',
          hidden: { field: 'showAuthor', truthy: false },
        },
      },
    },
  },
  initial: {
    title: 'Building Squisq',
    author: 'Mike',
    summary: 'A quick walk through the new JSON editor.',
    body: '## Why\n\nWe needed a friendly editor for **structured data**, not JSON syntax.\n\n- chip bins for arrays of primitives\n- card stacks for arrays of objects\n- color swatches, sliders, toggles\n',
    showAuthor: true,
    authorBio: 'Mike builds tools for content. Loves a good Markdown editor.',
  },
};

export const JSON_EDITOR_SAMPLES: Record<string, JsonEditorSample> = {
  pageSettings,
  addressBook,
  themeOverride,
  blogPost,
};

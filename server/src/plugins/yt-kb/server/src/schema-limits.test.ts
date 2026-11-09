import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Strapi maps a `string` attribute to varchar(255) on PostgreSQL, whatever its
// maxLength. SQLite does not enforce the limit, so a string field that allows
// more than 255 characters works locally and fails on Postgres hosts such as
// Strapi Cloud ("value too long for type character varying(255)"). Longer
// fields must be `text`.
const files = [
  ...readdirSync(join(__dirname, 'components')).filter((f) => f.endsWith('.json')).map((f) => join(__dirname, 'components', f)),
  ...readdirSync(join(__dirname, 'content-types'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(__dirname, 'content-types', e.name, 'schema.json')),
];

describe('schema limits', () => {
  it('has no string attribute that allows more than 255 characters', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const schema = JSON.parse(readFileSync(file, 'utf8')) as { attributes: Record<string, { type: string; maxLength?: number }> };
      for (const [name, attr] of Object.entries(schema.attributes)) {
        if (attr.type === 'string' && (attr.maxLength ?? 0) > 255) offenders.push(`${file.split('/src/')[1]} ${name} (${attr.maxLength})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

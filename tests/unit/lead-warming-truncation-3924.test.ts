import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/lead-warming/engine.ts'), 'utf8');
const start = src.indexOf('async function getEligibleContacts');
const end = src.indexOf('\n}\n\n/**\n * Send a warming message', start);
const fn = src.slice(start, end);

describe('lead-warming selection cannot starve eligible contacts (#3924)', () => {
  it('applies opt-out, cooldown and monthly-cap predicates inside the SQL selector', () => {
    expect(fn).toContain('notInArray(contacts.id, excludedIds)');
    expect(fn).toContain('opted_out = true');
    expect(fn).toContain('next_eligible_at >= ${new Date()}');
    expect(fn).toContain('COALESCE(messages_this_month, 0) >= ${monthlyCap}');
    expect(fn.indexOf('notInArray(')).toBeLessThan(fn.indexOf('.limit(500)'));
    expect(fn).not.toContain('optedOut.map(o => o.contactId)');
    expect(fn).not.toContain('onCooldown.filter(');
  });

  it('orders the bounded window deterministically and reports truncation', () => {
    expect(fn).toContain('.orderBy(contacts.id)');
    expect(fn).toContain("'[lead-warming] eligible window truncated at 500 contacts'");
  });

  it('also orders the birthday window', () => {
    const birthday = src.slice(src.indexOf('birthdayEvent') - 900, src.indexOf('birthdayEvent'));
    expect(birthday).toContain('.orderBy(contacts.id)');
    expect(birthday).toContain('.limit(200)');
  });
});

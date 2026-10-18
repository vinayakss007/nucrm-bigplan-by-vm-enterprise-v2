// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2794 — the two sequence UIs post step shapes `createSequenceSchema` rejects or
 * silently discards.
 *
 * The arbiter here is the route's own schema, not a copy of it:
 * `lib/api/schemas/automation.ts:48-59` declares a step as
 * `{ type: 'email'|'task'|'delay', delay_minutes, template_id, subject, body }`,
 * and Zod strips every key it does not declare. So:
 *
 *  - `app/tenant/automation/sequences/page.tsx` POSTed `action_type: 'send_email'`
 *    and `delay_days` — no `type` at all, so **every** submit was a 400
 *    (`app/api/tenant/sequences/route.ts:75-78`) and the New Sequence dialog could
 *    not create a sequence in any configuration;
 *  - `components/tenant/sequence-builder.tsx` posted a delay step as
 *    `{ delay_days: 1, delay_hours: 0 }`. That parses, and then both keys are
 *    stripped, so the route's `step.delay_minutes || 0`
 *    (`app/api/tenant/sequences/route.ts:107-109`) stores a wait of **zero** while
 *    the builder's own header displays "1 day";
 *  - the same builder offered `call` and `ab_test`, which
 *    `chk_sequence_steps_step_type`
 *    (`drizzle/migrations/0050_data_validation_checks.sql:121-122`) does not admit
 *    and `app/api/cron/process-sequences/route.ts:241-274` does not implement.
 *
 * Each DOM assertion therefore parses the payload the component actually produced
 * with the real schema and checks the **parsed output**, which is what the route
 * writes. Asserting the pre-parse body would pass on the broken builder, whose
 * extra keys are accepted and then dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { createSequenceSchema } from '@/lib/api/schemas';
import {
  SequenceBuilder,
  stepDelayMinutes,
  toWireStep,
  type SequenceStep,
} from '@/components/tenant/sequence-builder';
import SequencesPage from '@/app/tenant/automation/sequences/page';
import { QueryProvider } from '@/lib/query/client';

let posts: Record<string, unknown>[] = [];
let saved: Record<string, unknown> | null = null;

function stubFetch(getBody: unknown = { data: [] }) {
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, status: 201, json: async () => ({ ok: true }) } as Response;
    }
    return { ok: true, status: 200, json: async () => getBody } as Response;
  }));
}

/** Render the builder and add one step per button label, in order. */
async function mountBuilder(types: string[]) {
  render(
    <SequenceBuilder
      onSave={async (sequence) => { saved = sequence as unknown as Record<string, unknown>; }}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('e.g., New Lead Outreach'), {
    target: { value: 'Onboarding' },
  });
  for (const type of types) {
    fireEvent.click(screen.getAllByRole('button', { name: type, exact: true })[0] as HTMLElement);
  }
}

async function saveBuilder() {
  // The builder renders the save button twice — once in the header, once in the
  // summary card that appears as soon as there is a step.
  fireEvent.click(screen.getAllByRole('button', { name: /Save Sequence/ })[0] as HTMLElement);
  await waitFor(() => expect(saved).toBeTruthy());
  return saved as Record<string, unknown>;
}

/** Parse with the route's schema and answer with what the route would write. */
function asStored(payload: Record<string, unknown>) {
  const parsed = createSequenceSchema.safeParse(payload);
  expect(parsed.success, JSON.stringify((parsed.error as { issues?: unknown })?.issues)).toBe(true);
  return (parsed as { data: { steps: Record<string, unknown>[] } }).data;
}

beforeEach(() => {
  saved = null;
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the sequence builder posts steps the create route accepts (#2794)', () => {
  it('saves a three-step sequence the route can create at all', async () => {
    await mountBuilder(['Email', 'Wait', 'Task']);
    const stored = asStored(await saveBuilder());
    expect(stored.steps.map((s) => s.type)).toEqual(['email', 'delay', 'task']);
  });

  it('carries a wait step\'s one day through as delay_minutes', async () => {
    await mountBuilder(['Wait']);
    const stored = asStored(await saveBuilder());
    expect(stored.steps[0]!.delay_minutes).toBe(1440);
  });

  it('keeps an email step\'s nine-hour default instead of dropping it', async () => {
    await mountBuilder(['Email']);
    const stored = asStored(await saveBuilder());
    expect(stored.steps[0]!.delay_minutes).toBe(540);
  });

  it('sends a task\'s title in the column the processor creates the task from', async () => {
    await mountBuilder(['Task']);
    fireEvent.change(screen.getByPlaceholderText('e.g., Follow up call'), {
      target: { value: 'Call the client' },
    });
    const stored = asStored(await saveBuilder());
    // `app/api/cron/process-sequences/route.ts:261` — `title: step.subject || 'Follow up'`.
    expect(stored.steps[0]!.subject).toBe('Call the client');
  });

  it('offers only the step types the table admits', async () => {
    await mountBuilder([]);
    expect(screen.queryByRole('button', { name: 'Call', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'A/B Test', exact: true })).toBeNull();
  });

  // Control — the shape a step read back from the API carries, which the display
  // and the save must agree on.
  it('reads a wait from delay_minutes when that is all the step has', () => {
    const fromApi = { step_number: 1, type: 'delay', delay_minutes: 1440 } as SequenceStep;
    expect(stepDelayMinutes(fromApi)).toBe(1440);
    expect(toWireStep(fromApi, 0).delay_minutes).toBe(1440);
    const fromForm = { step_number: 1, type: 'delay', delay_days: 1 } as SequenceStep;
    expect(stepDelayMinutes(fromForm)).toBe(1440);
  });
});

describe('the New Sequence dialog posts steps the create route accepts (#2794)', () => {
  async function submitDefaultForm() {
    stubFetch({ data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Existing' }] });
    render(<QueryProvider><SequencesPage /></QueryProvider>);
    await waitFor(() => expect(screen.queryByText('Existing')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New Sequence/ }) as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText('e.g. New Lead Welcome Sequence'), {
      target: { value: 'Welcome' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Sequence' }) as HTMLElement);
    await waitFor(() => expect(posts).toHaveLength(1));
    return posts[0] as Record<string, unknown>;
  }

  it('creates the sequence instead of answering 400 on every submit', async () => {
    asStored(await submitDefaultForm());
    expect(posts[0]!.name).toBe('Welcome');
  });

  it('converts the day-granular waits the form shows into delay_minutes', async () => {
    const stored = asStored(await submitDefaultForm());
    expect(stored.steps.map((s) => s.delay_minutes)).toEqual([0, 4320, 10080]);
    expect(stored.steps.map((s) => s.type)).toEqual(['email', 'task', 'email']);
  });

  it('puts a task step\'s content where the task is created from', async () => {
    const stored = asStored(await submitDefaultForm());
    expect(stored.steps[1]!.subject).toBe('Follow up task');
  });
});

import { describe, it, expect } from 'vitest';

describe('api/schemas', () => {
  it('loginSchema accepts valid input', async () => {
    const { loginSchema } = await import('@/lib/api/schemas');
    const result = loginSchema.parse({ email: 'Test@Example.com', password: 'secret' });
    expect(result.email).toBe('test@example.com');
    expect(result.password).toBe('secret');
  });

  it('loginSchema rejects invalid email', async () => {
    const { loginSchema } = await import('@/lib/api/schemas');
    expect(() => loginSchema.parse({ email: 'invalid', password: 'secret' })).toThrow();
  });

  it('signupSchema transforms email to lowercase', async () => {
    const { signupSchema } = await import('@/lib/api/schemas');
    const result = signupSchema.parse({ email: 'User@Test.com', password: '12345678', full_name: 'User', workspace_name: 'Workspace' });
    expect(result.email).toBe('user@test.com');
  });

  it('createContactSchema validates URL fields', async () => {
    const { createContactSchema } = await import('@/lib/api/schemas');
    const result = createContactSchema.parse({
      first_name: 'John',
      email: 'john@test.com',
      website: 'example.com',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.website).toBe('https://example.com');
  });

  it('createContactSchema rejects missing first_name', async () => {
    const { createContactSchema } = await import('@/lib/api/schemas');
    expect(() => createContactSchema.parse({})).toThrow();
  });

  it('createDealSchema accepts valid deal with stage_id', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({
      title: 'Big Deal',
      stage_id: '00000000-0000-0000-0000-000000000000',
      pipeline_id: '00000000-0000-0000-0000-000000000000',
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.title).toBe('Big Deal');
    expect(result.amount).toBe(0);
  });

  it('createDealSchema accepts stage_name from frontend', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({
      title: 'New Deal',
      stage_name: 'lead',
    });
    expect(result.title).toBe('New Deal');
    expect(result.stage_name).toBe('lead');
  });

  it('createDealSchema accepts stage (name string) as fallback', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({
      title: 'Deal via stage',
      stage: 'qualified',
    });
    expect(result.stage).toBe('qualified');
  });

  it('createDealSchema accepts title-only (stage validated by route handler)', async () => {
    const { createDealSchema } = await import('@/lib/api/schemas');
    const result = createDealSchema.parse({ title: 'Minimal Deal' });
    expect(result.title).toBe('Minimal Deal');
    expect(result.stage_id).toBeUndefined();
    expect(result.stage_name).toBeUndefined();
  });

  it('createCompanySchema applies https to bare domain', async () => {
    const { createCompanySchema } = await import('@/lib/api/schemas');
    const result = createCompanySchema.parse({
      name: 'Test Corp',
      website: 'testcorp.com',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.website).toBe('https://testcorp.com');
  });

  it('createCompanySchema preserves https prefix', async () => {
    const { createCompanySchema } = await import('@/lib/api/schemas');
    const result = createCompanySchema.parse({
      name: 'Test Corp',
      website: 'https://testcorp.com',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.website).toBe('https://testcorp.com');
  });

  it('createLeadSchema defaults status to new', async () => {
    const { createLeadSchema } = await import('@/lib/api/schemas');
    const result = createLeadSchema.parse({
      first_name: 'Jane',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.status).toBe('new');
    expect(result.score).toBe(0);
  });

  it('leadQuerySchema coerces and validates lead filters (#1083)', async () => {
    const { leadQuerySchema } = await import('@/lib/api/schemas');
    const result = leadQuerySchema.parse({
      source: 'referral',
      lifecycle_stage: 'opportunity',
      assigned_to: '00000000-0000-0000-0000-000000000000',
      tags: 'vip, enterprise',
      score_min: '20',
      score_max: '80',
    });
    expect(result.source).toBe('referral');
    expect(result.lifecycle_stage).toBe('opportunity');
    expect(result.assigned_to).toBe('00000000-0000-0000-0000-000000000000');
    expect(result.tags).toBe('vip, enterprise');
    // string query params are coerced to numbers
    expect(result.score_min).toBe(20);
    expect(result.score_max).toBe(80);
    // defaults preserved
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(50);
  });

  it('leadQuerySchema rejects out-of-range score and bad UUID (#1083)', async () => {
    const { leadQuerySchema } = await import('@/lib/api/schemas');
    expect(() => leadQuerySchema.parse({ score_min: '5000' })).toThrow();
    expect(() => leadQuerySchema.parse({ assigned_to: 'not-a-uuid' })).toThrow();
  });

  it('createTaskSchema defaults status and priority', async () => {
    const { createTaskSchema } = await import('@/lib/api/schemas');
    const result = createTaskSchema.parse({
      title: 'Test Task',
      contact_id: '00000000-0000-0000-0000-000000000000',
      deal_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      assigned_to: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.status).toBe('pending');
    expect(result.priority).toBe('medium');
  });

  it('bulkDeleteSchema accepts array of UUIDs', async () => {
    const { bulkDeleteSchema } = await import('@/lib/api/schemas');
    const result = bulkDeleteSchema.parse({ ids: ['00000000-0000-0000-0000-000000000000'] });
    expect(result.ids).toHaveLength(1);
  });

  it('bulkDeleteSchema rejects empty array', async () => {
    const { bulkDeleteSchema } = await import('@/lib/api/schemas');
    expect(() => bulkDeleteSchema.parse({ ids: [] })).toThrow();
  });

  it('forgotPasswordSchema accepts valid email', async () => {
    const { forgotPasswordSchema } = await import('@/lib/api/schemas');
    const result = forgotPasswordSchema.parse({ email: 'user@test.com' });
    expect(result.email).toBe('user@test.com');
  });

  it('resetPasswordSchema accepts valid token and password', async () => {
    const { resetPasswordSchema } = await import('@/lib/api/schemas');
    const result = resetPasswordSchema.parse({ token: 'abc123', password: 'newpassword' });
    expect(result.token).toBe('abc123');
    expect(result.password).toBe('newpassword');
  });

  // NOTE: The canonical 2FA schemas live in '@/lib/api/schemas/auth' (the live
  // routes import them from there). Their field is `totp_code`. The former
  // monolith copies (which used `token`/`password`) were dead + wrong and were
  // removed for a single source of truth (#1883).
  it('verify2faSchema validates a 6-digit totp_code', async () => {
    const { verify2faSchema } = await import('@/lib/api/schemas/auth');
    const result = verify2faSchema.parse({ totp_code: '123456' });
    expect(result.totp_code).toBe('123456');
  });

  it('verify2faSchema rejects a non-6-digit totp_code', async () => {
    const { verify2faSchema } = await import('@/lib/api/schemas/auth');
    expect(() => verify2faSchema.parse({ totp_code: '12345' })).toThrow();
    expect(() => verify2faSchema.parse({ totp_code: '1234567' })).toThrow();
    expect(() => verify2faSchema.parse({ totp_code: 'abcdef' })).toThrow();
    expect(() => verify2faSchema.parse({})).toThrow();
  });

  it('disable2faSchema requires a password and accepts an optional totp_code', async () => {
    const { disable2faSchema } = await import('@/lib/api/schemas/auth');
    // password alone is valid (totp_code is optional)
    expect(disable2faSchema.parse({ password: 'mypassword' }).password).toBe('mypassword');
    expect(disable2faSchema.parse({ password: 'mypassword', totp_code: '123456' }).totp_code).toBe('123456');
    expect(() => disable2faSchema.parse({})).toThrow();
    expect(() => disable2faSchema.parse({ password: 'mypassword', totp_code: '123' })).toThrow();
  });

  it('createInvoiceSchema requires at least one line item', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    expect(() => createInvoiceSchema.parse({
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      line_items: [],
    })).toThrow(/line item/i);
  });

  it('createInvoiceSchema rejects a line item missing its description', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    expect(() => createInvoiceSchema.parse({
      title: 'Invoice',
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      line_items: [{ quantity: 1, unit_price: 100 }],
    })).toThrow(/description/i);
  });

  it('createInvoiceSchema defaults status to draft', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    const result = createInvoiceSchema.parse({
      title: 'Invoice for services',
      contact_id: '00000000-0000-0000-0000-000000000000',
      company_id: '00000000-0000-0000-0000-000000000000',
      line_items: [{ description: 'Item', quantity: 1, unit_price: 100 }],
    });
    expect(result.status).toBe('draft');
    expect(result.line_items).toHaveLength(1);
  });

  it('importSchema defaults skip_duplicates to true', async () => {
    const { importSchema } = await import('@/lib/api/schemas');
    const result = importSchema.parse({
      entity_type: 'contacts',
      data: [{ name: 'Test' }],
    });
    expect(result.skip_duplicates).toBe(true);
  });

  it('exportSchema rejects invalid entity_type', async () => {
    const { exportSchema } = await import('@/lib/api/schemas');
    expect(() => exportSchema.parse({ entity_type: 'invalid' })).toThrow();
  });

  it('createBackupSchema defaults to full backup', async () => {
    const { createBackupSchema } = await import('@/lib/api/schemas');
    const result = createBackupSchema.parse({});
    expect(result.backup_type).toBe('full');
  });

  it('createCustomFieldSchema validates fieldKey format', async () => {
    const { createCustomFieldSchema } = await import('@/lib/api/schemas');
    const result = createCustomFieldSchema.parse({ entityType: 'contacts', fieldKey: 'my_field_1', fieldLabel: 'My Field' });
    expect(result.fieldKey).toBe('my_field_1');
  });

  it('createCustomFieldSchema rejects invalid fieldKey', async () => {
    const { createCustomFieldSchema } = await import('@/lib/api/schemas');
    expect(() => createCustomFieldSchema.parse({ entityType: 'contacts', fieldKey: 'my-field!', fieldLabel: 'My Field' })).toThrow();
  });

  it('aiAssistantSchema accepts valid action', async () => {
    const { aiAssistantSchema } = await import('@/lib/api/schemas');
    const result = aiAssistantSchema.parse({ action: 'draft_email' });
    expect(result.action).toBe('draft_email');
  });

  it('createAnnouncementSchema defaults type to info', async () => {
    const { createAnnouncementSchema } = await import('@/lib/api/schemas');
    const result = createAnnouncementSchema.parse({ title: 'Announcement' });
    expect(result.type).toBe('info');
    expect(result.target).toBe('all');
  });

  it('createWebhookSchema requires at least one event', async () => {
    const { createWebhookSchema } = await import('@/lib/api/schemas');
    expect(() => createWebhookSchema.parse({ name: 'Webhook', url: 'https://example.com/hook', events: [] })).toThrow();
  });

  it('updateContactSchema makes all fields optional', async () => {
    const { updateContactSchema } = await import('@/lib/api/schemas');
    const result = updateContactSchema.parse({});
    expect(result).toBeDefined();
  });

  it('preferencesPatchSchema validates locale format', async () => {
    const { preferencesPatchSchema } = await import('@/lib/api/schemas');
    expect(preferencesPatchSchema.parse({ locale: 'en-US' }).locale).toBe('en-US');
    expect(() => preferencesPatchSchema.parse({ locale: 'invalid' })).toThrow();
  });

  it('preferencesPatchSchema validates theme values', async () => {
    const { preferencesPatchSchema } = await import('@/lib/api/schemas');
    expect(() => preferencesPatchSchema.parse({ theme: 'invalid' })).toThrow();
  });

  it('createNoteSchema accepts the `description` wire key and normalizes it to content', async () => {
    const { createNoteSchema } = await import('@/lib/api/schemas');
    // The contact-detail client and the integrations SDK both send the note
    // body as `description`, not `content`.
    const result = createNoteSchema.parse({ description: 'Called back', type: 'call' });
    expect(result.content).toBe('Called back');
    expect(result.type).toBe('call');
  });

  it('createNoteSchema still accepts the canonical `content` key and defaults type to note', async () => {
    const { createNoteSchema } = await import('@/lib/api/schemas');
    const result = createNoteSchema.parse({ content: 'A note' });
    expect(result.content).toBe('A note');
    expect(result.type).toBe('note');
  });

  it('createNoteSchema rejects a payload with neither content nor description', async () => {
    const { createNoteSchema } = await import('@/lib/api/schemas');
    expect(() => createNoteSchema.parse({ type: 'note' })).toThrow();
    expect(() => createNoteSchema.parse({ description: '   ' })).toThrow();
  });

  it('createNoteSchema rejects an invalid activity type', async () => {
    const { createNoteSchema } = await import('@/lib/api/schemas');
    expect(() => createNoteSchema.parse({ content: 'x', type: 'bogus' })).toThrow();
  });

  // #1072 — POST /api/tenant/backup now validates its body with createBackupSchema.
  it('createBackupSchema defaults backup_type to full when omitted', async () => {
    const { createBackupSchema } = await import('@/lib/api/schemas');
    const result = createBackupSchema.parse({});
    expect(result.backup_type).toBe('full');
  });

  it('createBackupSchema accepts the allowed backup_type values', async () => {
    const { createBackupSchema } = await import('@/lib/api/schemas');
    expect(createBackupSchema.parse({ backup_type: 'schema' }).backup_type).toBe('schema');
    expect(createBackupSchema.parse({ backup_type: 'selective' }).backup_type).toBe('selective');
  });

  it('createBackupSchema rejects an out-of-enum backup_type', async () => {
    const { createBackupSchema } = await import('@/lib/api/schemas');
    expect(() => createBackupSchema.parse({ backup_type: 'bogus' })).toThrow();
  });
});

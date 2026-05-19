import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, queryOne, queryMany } from '../../lib/db/client';
import { syncCalculatedFields } from '../../lib/formula/sync';

describe('Calculated Fields Integration', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001'; // Default test tenant
  const userId = '00000000-0000-0000-0000-000000000001';
  const planId = '00000000-0000-0000-0000-000000000001';
  const fieldKey = 'test_score_plus_ten';

  beforeAll(async () => {
    // 1. Ensure test plan exists
    await query(`
      INSERT INTO public.plans (id, name, slug, price_monthly, price_yearly, max_users, max_contacts, max_deals)
      VALUES ($1, 'Test Plan', 'test-plan', 0, 0, 10, 100, 10)
      ON CONFLICT (id) DO NOTHING
    `, [planId]);

    // 2. Ensure test user exists
    await query(`
      INSERT INTO public.users (id, email, password_hash, full_name, is_super_admin)
      VALUES ($1, 'test@nucrm.com', 'hash', 'Test User', true)
      ON CONFLICT (id) DO NOTHING
    `, [userId]);

    // 3. Ensure test tenant exists
    await query(`
      INSERT INTO public.tenants (id, name, slug, plan_id, owner_id)
      VALUES ($1, 'Test Org', 'test-org', $2, $3)
      ON CONFLICT (id) DO NOTHING
    `, [tenantId, planId, userId]);

    // 2. Create a calculated field definition
    await query(`
      INSERT INTO public.custom_field_defs 
      (tenant_id, entity_type, field_key, field_label, field_type, is_calculated, formula)
      VALUES ($1, 'contact', $2, 'Score + 10', 'number', true, '{{score}} + 10')
      ON CONFLICT (tenant_id, entity_type, field_key) DO UPDATE 
      SET formula = EXCLUDED.formula, is_calculated = true
    `, [tenantId, fieldKey]);
  });

  it('automatically calculates field value on sync', async () => {
    // 1. Create a dummy contact
    const contactId = '00000000-0000-0000-0000-000000000099';
    await query(`DELETE FROM public.contacts WHERE id = $1`, [contactId]);
    
    const contact = await queryOne(`
      INSERT INTO public.contacts (id, tenant_id, first_name, last_name, email, score)
      VALUES ($1, $2, 'Test', 'User', 'test@example.com', 75)
      RETURNING *
    `, [contactId, tenantId]);

    expect(contact).toBeDefined();
    expect(contact.score).toBe(75);

    // 2. Trigger sync (this is what the API route does)
    await syncCalculatedFields(tenantId, 'contact', contactId, contact);

    // 3. Verify metadata was updated
    const updatedContact = await queryOne(`SELECT metadata FROM public.contacts WHERE id = $1`, [contactId]);
    
    expect(updatedContact.metadata).toBeDefined();
    expect(updatedContact.metadata[fieldKey]).toBe(85); // 75 + 10
  });

  afterAll(async () => {
    await query(`DELETE FROM public.custom_field_defs WHERE tenant_id = $1 AND field_key = $2`, [tenantId, fieldKey]);
    await query(`DELETE FROM public.contacts WHERE tenant_id = $1 AND first_name = 'Test'`, [tenantId]);
  });
});

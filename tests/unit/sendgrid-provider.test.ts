import { describe, it, expect } from 'vitest';
import { sendgridProvider } from '@/lib/integrations/providers/sendgrid';

describe('sendgridProvider', () => {
  it('should have the correct basic properties', () => {
    expect(sendgridProvider.id).toBe('sendgrid');
    expect(sendgridProvider.name).toBe('SendGrid');
    expect(sendgridProvider.description).toBe('Send transactional emails, track opens/clicks, manage contacts');
    expect(sendgridProvider.category).toBe('email');
    expect(sendgridProvider.icon).toBe('Mail');
    expect(sendgridProvider.docsUrl).toBe('https://docs.sendgrid.com/api-reference');
    expect(sendgridProvider.defaultBaseUrl).toBe('https://api.sendgrid.com/v3');
    expect(sendgridProvider.builtIn).toBe(true);
  });

  it('should define the correct config fields', () => {
    expect(sendgridProvider.configFields).toHaveLength(3);

    const apiKeyField = sendgridProvider.configFields.find((f) => f.key === 'api_key');
    expect(apiKeyField).toBeDefined();
    expect(apiKeyField?.label).toBe('API Key');
    expect(apiKeyField?.type).toBe('string');
    expect(apiKeyField?.required).toBe(true);
    expect(apiKeyField?.placeholder).toBe('SG.xxxxx...');

    const fromEmailField = sendgridProvider.configFields.find((f) => f.key === 'from_email');
    expect(fromEmailField).toBeDefined();
    expect(fromEmailField?.label).toBe('From Email');
    expect(fromEmailField?.type).toBe('string');
    expect(fromEmailField?.required).toBe(true);
    expect(fromEmailField?.placeholder).toBe('noreply@yourdomain.com');

    const fromNameField = sendgridProvider.configFields.find((f) => f.key === 'from_name');
    expect(fromNameField).toBeDefined();
    expect(fromNameField?.label).toBe('From Name');
    expect(fromNameField?.type).toBe('string');
    expect(fromNameField?.required).toBeUndefined();
    expect(fromNameField?.placeholder).toBe('NuCRM');
  });

  it('should define the correct capabilities', () => {
    expect(sendgridProvider.capabilities).toHaveLength(2);

    const sendEmailCapability = sendgridProvider.capabilities.find((c) => c.action === 'send_email');
    expect(sendEmailCapability).toBeDefined();
    expect(sendEmailCapability?.label).toBe('Send Email');
    expect(sendEmailCapability?.description).toBe('Send a transactional email');
    expect(sendEmailCapability?.inputFields).toHaveLength(3);

    if (sendEmailCapability?.inputFields) {
      expect(sendEmailCapability.inputFields.find(f => f.key === 'to')?.required).toBe(true);
      expect(sendEmailCapability.inputFields.find(f => f.key === 'subject')?.required).toBe(true);
      expect(sendEmailCapability.inputFields.find(f => f.key === 'body')?.required).toBe(true);
    }

    const addContactCapability = sendgridProvider.capabilities.find((c) => c.action === 'add_contact');
    expect(addContactCapability).toBeDefined();
    expect(addContactCapability?.label).toBe('Add Contact');
    expect(addContactCapability?.description).toBe('Add to contact list');
    expect(addContactCapability?.inputFields).toHaveLength(3);

    if (addContactCapability?.inputFields) {
      expect(addContactCapability.inputFields.find(f => f.key === 'email')?.required).toBe(true);
      expect(addContactCapability.inputFields.find(f => f.key === 'first_name')?.required).toBeUndefined();
      expect(addContactCapability.inputFields.find(f => f.key === 'last_name')?.required).toBeUndefined();
    }
  });
});

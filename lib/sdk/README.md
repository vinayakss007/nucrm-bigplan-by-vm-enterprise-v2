# NuCRM SDK

A fully-typed, zero-dependency TypeScript SDK for building services and integrations on top of the NuCRM platform.

## Installation & Setup

```typescript
import { NuCRMClient } from '@nucrm/sdk';

const client = new NuCRMClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-instance.nucrm.app',
  timeout: 30000, // optional, defaults to 30s
});
```

## Authentication

The SDK uses API key authentication. Pass your key in the config:

```typescript
const client = new NuCRMClient({
  apiKey: process.env.NUCRM_API_KEY!,
  baseUrl: process.env.NUCRM_BASE_URL!,
});
```

### Token Management

```typescript
// Get current token
const token = client.authSDK.getToken();

// Set a new token
client.authSDK.setToken('new-token');

// Refresh the token
const newToken = await client.authSDK.refreshToken();

// Impersonate a user (admin only)
const { token: impersonatedToken } = await client.authSDK.impersonate('user-id');

// Initiate SSO
const { url } = await client.authSDK.initSSO('google', 'https://app.example.com/callback');
```

## Resources

All resources follow a consistent CRUD pattern with full TypeScript typing.

### Contacts

```typescript
// List contacts with pagination
const contacts = await client.contacts.list({ page: 1, limit: 20, sort: 'createdAt', order: 'desc' });

// Get a single contact
const contact = await client.contacts.get('contact-id');

// Create a contact
const newContact = await client.contacts.create({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
});

// Update a contact
const updated = await client.contacts.update('contact-id', { phone: '+1234567890' });

// Delete a contact
await client.contacts.delete('contact-id');

// Search contacts
const results = await client.contacts.search('jane');
```

### Deals

```typescript
const deals = await client.deals.list({ sort: 'amount', order: 'desc' });
const deal = await client.deals.get('deal-id');
const newDeal = await client.deals.create({ title: 'Enterprise Plan', stageId: 'stage-1', amount: '50000' });
await client.deals.update('deal-id', { stageId: 'stage-2' });
await client.deals.delete('deal-id');
```

### Leads

```typescript
const leads = await client.leads.list();
const lead = await client.leads.get('lead-id');
const newLead = await client.leads.create({ firstName: 'John', lastName: 'Smith', leadStatus: 'new', score: 0 });
```

### Companies

```typescript
const companies = await client.companies.list();
const company = await client.companies.create({ name: 'Acme Corp', industry: 'Technology' });
```

### Tasks

```typescript
const tasks = await client.tasks.list({ filters: { completed: false } });
const task = await client.tasks.create({ title: 'Follow up', priority: 'high', status: 'pending', completed: false });
```

### Tickets

```typescript
const tickets = await client.tickets.list();
const ticket = await client.tickets.create({ subject: 'Bug report', status: 'open', priority: 'medium' });
```

### Invoices

```typescript
const invoices = await client.invoices.list();
const invoice = await client.invoices.create({
  invoiceNumber: 'INV-001',
  status: 'draft',
  totalAmount: '1000.00',
  amountPaid: '0',
  balanceDue: '1000.00',
  issueDate: '2024-01-15',
});
```

### Documents

```typescript
const docs = await client.documents.list();
const doc = await client.documents.create({
  title: 'Proposal',
  type: 'pdf',
  url: 'https://files.example.com/proposal.pdf',
  uploadedBy: 'user-1',
  size: 2048,
  mimeType: 'application/pdf',
});
```

### Quotes

```typescript
const quotes = await client.quotes.list();
const quote = await client.quotes.create({
  quoteNumber: 'Q-001',
  status: 'draft',
  totalAmount: '5000.00',
  items: [{ description: 'Service A', quantity: 1, unitPrice: '5000.00', total: '5000.00' }],
});

// Accept or reject a quote
await client.quotes.accept('quote-id');
await client.quotes.reject('quote-id');
```

### Orders

```typescript
const orders = await client.orders.list();
const order = await client.orders.create({
  orderNumber: 'ORD-001',
  status: 'pending',
  totalAmount: '3000.00',
  items: [{ description: 'Product X', quantity: 2, unitPrice: '1500.00', total: '3000.00' }],
});
```

### Contracts

```typescript
const contracts = await client.contracts.list();
const contract = await client.contracts.create({
  title: 'Service Agreement',
  status: 'draft',
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  value: '120000.00',
});

// Sign a contract
await client.contracts.sign('contract-id');
```

### Subscriptions

```typescript
const subs = await client.subscriptions.list();
const sub = await client.subscriptions.create({
  planName: 'Pro',
  status: 'active',
  amount: '99.00',
  interval: 'monthly',
  startDate: '2024-01-01',
});

// Lifecycle management
await client.subscriptions.cancel('sub-id');
await client.subscriptions.pause('sub-id');
await client.subscriptions.resume('sub-id');
```

### Services

```typescript
const services = await client.services.list();
const service = await client.services.create({
  name: 'Consulting',
  price: '150.00',
  duration: '1h',
  category: 'professional',
  status: 'active',
});
```

### Meetings

```typescript
const meetings = await client.meetings.list();
const meeting = await client.meetings.create({
  title: 'Discovery Call',
  startTime: '2024-01-15T10:00:00Z',
  endTime: '2024-01-15T11:00:00Z',
  attendees: ['user-1', 'contact-1'],
  status: 'scheduled',
});

await client.meetings.cancel('meeting-id');
```

### Activities

Activities are immutable logs (no update/delete):

```typescript
const activities = await client.activities.list();
const activity = await client.activities.create({
  type: 'call',
  subject: 'Follow-up call with prospect',
  entityType: 'contact',
  entityId: 'contact-1',
  performedBy: 'user-1',
});
```

### Forms

```typescript
const forms = await client.forms.list();
const form = await client.forms.create({
  title: 'Contact Us',
  fields: [
    { name: 'name', type: 'text', label: 'Full Name', required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'message', type: 'textarea', label: 'Message' },
  ],
  status: 'active',
});

// Get form submissions
const submissions = await client.forms.getSubmissions('form-id', { page: 1, limit: 50 });
```

### Sequences

```typescript
const sequences = await client.sequences.list();
const sequence = await client.sequences.create({
  name: 'Onboarding Emails',
  status: 'active',
  steps: [
    { type: 'email', delay: 0, template: 'welcome' },
    { type: 'email', delay: 86400, template: 'day-1-tips' },
    { type: 'email', delay: 259200, template: 'day-3-check-in' },
  ],
});

// Enroll/unenroll contacts
await client.sequences.enroll('sequence-id', ['contact-1', 'contact-2']);
await client.sequences.unenroll('sequence-id', ['contact-1']);
```

### Automations

```typescript
const automations = await client.automations.list();
const automation = await client.automations.create({
  name: 'Lead Assignment',
  trigger: 'lead.created',
  actions: [
    { type: 'assign', config: { strategy: 'round-robin' } },
    { type: 'notify', config: { channel: 'slack' } },
  ],
  status: 'active',
});

// Trigger manually
await client.automations.trigger('automation-id', { leadId: 'lead-1' });

// Pause/resume
await client.automations.pause('automation-id');
await client.automations.resume('automation-id');
```

### Reports

```typescript
const reports = await client.reports.list();
const report = await client.reports.create({
  name: 'Monthly Sales',
  type: 'pipeline',
  config: { pipeline: 'main', period: 'monthly' },
});

// Run a report and get data
const data = await client.reports.run('report-id');
```

## Bulk Operations

Perform operations on multiple records at once:

```typescript
// Create many contacts at once
const result = await client.bulk.createMany('contacts', [
  { firstName: 'Alice', lastName: 'A' },
  { firstName: 'Bob', lastName: 'B' },
]);
console.log(`Created: ${result.created}, Errors: ${result.errors.length}`);

// Update many records
await client.bulk.updateMany('contacts', ['id-1', 'id-2'], { assignedTo: 'user-1' });

// Delete many records
await client.bulk.deleteMany('contacts', ['id-1', 'id-2', 'id-3']);
```

## Search

```typescript
// Global search across all entities
const results = await client.search.global('acme', { entities: ['contacts', 'companies'], limit: 20 });

// Advanced filtered search on a specific entity
const filtered = await client.search.advanced('contacts', [
  { field: 'email', operator: 'contains', value: '@acme.com' },
  { field: 'score', operator: 'gt', value: 50 },
]);
```

## File Management

```typescript
// Upload a file (content must be base64-encoded for binary files)
const uploaded = await client.files.upload(
  {
    name: 'proposal.pdf',
    content: '<base64-encoded-content>',
    mimeType: 'application/pdf',
    contentEncoding: 'base64', // default, tells server to decode from base64
  },
  'deal',
  'deal-123'
);

// Upload plain text files with utf8 encoding
const textFile = await client.files.upload({
  name: 'notes.txt',
  content: 'Plain text content here',
  mimeType: 'text/plain',
  contentEncoding: 'utf8',
});

// For large files (>10MB), use presigned upload to bypass body size limits
const { uploadUrl, fileId, expiresAt } = await client.files.uploadPresigned(
  'large-video.mp4',
  'video/mp4',
  'deal',
  'deal-123'
);
// Then PUT the raw file bytes directly to uploadUrl

// Download a file (get temporary URL)
const { url, expiresAt: downloadExpiry } = await client.files.download('file-id');

// Get a presigned URL
const presignedUrl = await client.files.getPresignedUrl('file-id', 3600);

// List files for an entity
const files = await client.files.list({ entityType: 'deal', entityId: 'deal-123' });
```

## Webhooks

### Signature Verification

```typescript
import { WebhookVerifier } from '@nucrm/sdk';

const verifier = new WebhookVerifier('your-webhook-secret');

// In your webhook endpoint
const isValid = verifier.verify(rawBody, request.headers['x-nucrm-signature']);
if (isValid) {
  const payload = verifier.parse(rawBody);
  console.log(`Event: ${payload.event}`, payload.data);
}
```

### Event Routing

```typescript
import { WebhookRouter } from '@nucrm/sdk';

const router = new WebhookRouter('your-webhook-secret');

router.register('contact.created', async (payload) => {
  console.log('New contact:', payload.data);
});

router.register('deal.won', async (payload) => {
  console.log('Deal won!', payload.data);
  // Trigger celebration workflow
});

// In your HTTP handler
app.post('/webhooks/nucrm', async (req, res) => {
  const result = await router.handle(req.body, req.headers['x-nucrm-signature']);
  res.json(result);
});
```

## Realtime Events (SSE)

```typescript
// Connect to realtime events
client.realtime.connect();

// Subscribe to channels
client.realtime.subscribe('deals');
client.realtime.subscribe('contacts');

// Listen for events
client.realtime.on('deal.updated', (event) => {
  console.log('Deal changed:', event.data);
});

// Remove listeners
client.realtime.off('deal.updated');

// Unsubscribe from channel
client.realtime.unsubscribe('deals');

// Disconnect
client.realtime.disconnect();
```

## Module Development

Build custom modules that extend the CRM:

```typescript
import { defineModule } from '@nucrm/sdk';

export default defineModule({
  id: 'my-custom-module',
  name: 'My Custom Module',
  version: '1.0.0',
  description: 'Adds custom functionality to NuCRM',
  pages: [
    { path: '/my-module', title: 'My Module', icon: 'puzzle' },
  ],
  settings: [
    { key: 'apiEndpoint', type: 'string', label: 'API Endpoint', required: true },
    { key: 'enableSync', type: 'boolean', label: 'Enable Auto-Sync' },
  ],
});
```

## Template SDK

Manage templates and modules for the current tenant:

```typescript
// Get current template and enabled features
const { template, modules, features } = await client.templates.getCurrent();

// List available modules
const availableModules = await client.templates.getAvailableModules();

// Enable a module
await client.templates.enableModule('whatsapp-bot');

// Get template configuration
const config = await client.templates.getConfig();
```

## Billing SDK

Check usage limits and manage plans:

```typescript
// Get current plan info
const plan = await client.billing.getCurrentPlan();
console.log(`Plan: ${plan.plan}, Contacts: ${plan.usage['contacts']}/${plan.limits['contacts']}`);

// Check a specific limit
const limit = await client.billing.checkLimit('contacts');
if (!limit.allowed) {
  console.log('Contact limit reached');
}

// Get full usage report
const usage = await client.billing.getUsage();

// Request plan upgrade
const { url } = await client.billing.requestUpgrade('enterprise');
```

## Error Handling

All SDK methods throw `NuCRMError` for API failures:

```typescript
import { NuCRMClient, NuCRMError } from '@nucrm/sdk';

try {
  await client.contacts.get('nonexistent-id');
} catch (error) {
  if (error instanceof NuCRMError) {
    console.log(error.status);  // 404
    console.log(error.code);    // 'NOT_FOUND'
    console.log(error.message); // 'Contact not found'
    console.log(error.details); // { resource: 'contact' }
  }
}
```

### Retry Pattern

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof NuCRMError && error.status >= 500 && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Unreachable');
}

const contact = await withRetry(() => client.contacts.get('id'));
```

## Supported Webhook Events

| Event | Description |
|-------|-------------|
| `contact.created` | A new contact was created |
| `contact.updated` | A contact was updated |
| `contact.deleted` | A contact was deleted |
| `deal.created` | A new deal was created |
| `deal.updated` | A deal was updated |
| `deal.won` | A deal was marked as won |
| `deal.lost` | A deal was marked as lost |
| `lead.created` | A new lead was created |
| `lead.converted` | A lead was converted to contact |
| `task.created` | A new task was created |
| `task.completed` | A task was completed |
| `ticket.created` | A new ticket was created |
| `ticket.resolved` | A ticket was resolved |
| `invoice.created` | A new invoice was created |
| `invoice.paid` | An invoice was paid |
| `company.created` | A new company was created |
| `company.updated` | A company was updated |
| `document.created` | A document was uploaded |
| `document.updated` | A document was updated |
| `document.deleted` | A document was deleted |
| `quote.created` | A quote was created |
| `quote.updated` | A quote was updated |
| `quote.accepted` | A quote was accepted |
| `quote.rejected` | A quote was rejected |
| `order.created` | An order was created |
| `order.updated` | An order was updated |
| `order.fulfilled` | An order was fulfilled |
| `order.cancelled` | An order was cancelled |
| `contract.created` | A contract was created |
| `contract.updated` | A contract was updated |
| `contract.signed` | A contract was signed |
| `contract.expired` | A contract expired |
| `subscription.created` | A subscription was created |
| `subscription.updated` | A subscription was updated |
| `subscription.cancelled` | A subscription was cancelled |
| `subscription.paused` | A subscription was paused |
| `subscription.resumed` | A subscription was resumed |
| `meeting.created` | A meeting was scheduled |
| `meeting.updated` | A meeting was updated |
| `meeting.cancelled` | A meeting was cancelled |
| `form.submitted` | A form was submitted |
| `sequence.created` | A sequence was created |
| `sequence.completed` | A sequence completed |
| `sequence.enrolled` | Contacts enrolled in sequence |
| `automation.created` | An automation was created |
| `automation.triggered` | An automation was triggered |
| `automation.completed` | An automation run completed |

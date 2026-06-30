# NuCRM GraphQL Migration Guide

> **Phase 2 Migration Plan**: REST → GraphQL
>
> **Status**: Planning
>
> **Target**: Replace REST API with GraphQL while maintaining backward compatibility

---

## Overview

This document outlines the migration from NuCRM's REST API to GraphQL for Phase 2. The goal is to:

1. Reduce over-fetching/under-fetching
2. Enable real-time subscriptions
3. Improve developer experience with typed schema
4. Support complex queries in single requests

---

## Recommended GraphQL Stack

| Component | Recommendation | Why |
|-----------|---------------|-----|
| Server | `graphql-yoga` | Lightweight, Next.js compatible |
| Schema | `@graphql-tools/schema` | Schema stitching |
| Validation | `zod` + `graphql-nexus` | Type-safe resolvers |
| Auth | Same middleware (adapt) | Reuse existing auth |
| ORM | Drizzle (existing) | No migration needed |
| DataLoader | `dataloader` | N+1 prevention |

---

## Schema Design

### Core Types

```graphql
# scalar DateTime
# scalar JSON

type User {
  id: ID!
  email: String!
  fullName: String!
  isSuperAdmin: Boolean!
  createdAt: DateTime!
  lastLoginAt: DateTime
}

type Tenant {
  id: ID!
  name: String!
  slug: String!
  status: TenantStatus!
  plan: Plan
  owner: User
  contactCount: Int!
  dealCount: Int!
  createdAt: DateTime!
}

enum TenantStatus {
  active
  trialing
  suspended
  cancelled
}

type Plan {
  id: ID!
  name: String!
  maxContacts: Int!
  maxDeals: Int!
  maxUsers: Int!
  monthlyPrice: Int!
}

type Contact {
  id: ID!
  firstName: String!
  lastName: String
  email: String
  phone: String
  jobTitle: String
  leadStatus: LeadStatus
  leadSource: String
  score: Int
  city: String
  country: String
  tags: [String!]
  customFields: JSON
  company: Company
  assignedTo: User
  createdBy: User
  activities: [Activity!]
  timeline: [TimelineEvent!]
  notes: [Note!]
  createdAt: DateTime!
  updatedAt: DateTime!
}

enum LeadStatus {
  new
  contacted
  qualified
  unqualified
  converted
  lost
}

type Lead {
  id: ID!
  firstName: String!
  lastName: String
  email: String
  phone: String
  leadStatus: LeadStatus
  leadSource: String
  score: Int
  convertedAt: DateTime
  deal: Deal
  tenant: Tenant!
  createdAt: DateTime!
}

type Deal {
  id: ID!
  title: String!
  value: Float
  currency: String
  stage: DealStage!
  pipeline: Pipeline!
  contact: Contact
  company: Company
  expectedCloseDate: DateTime
  actualCloseDate: DateTime
  probability: Int
  notes: String
  createdAt: DateTime!
  updatedAt: DateTime!
}

type DealStage {
  id: ID!
  name: String!
  order: Int!
  probability: Int!
  pipeline: Pipeline!
}

type Pipeline {
  id: ID!
  name: String!
  stages: [DealStage!]!
  isDefault: Boolean!
}

type Company {
  id: ID!
  name: String!
  industry: String
  website: String
  phone: String
  email: String
  address: String
  city: String
  state: String
  country: String
  postalCode: String
  contacts: [Contact!]!
  deals: [Deal!]!
  createdAt: DateTime!
}

type Task {
  id: ID!
  title: String!
  description: String
  status: TaskStatus!
  priority: TaskPriority!
  dueDate: DateTime
  assignedTo: User
  contact: Contact
  deal: Deal
  createdAt: DateTime!
}

enum TaskStatus {
  pending
  in_progress
  completed
  cancelled
}

enum TaskPriority {
  low
  medium
  high
  urgent
}

type Activity {
  id: ID!
  entityType: String!
  entityId: ID!
  eventType: String!
  action: String!
  description: String
  user: User
  createdAt: DateTime!
}

type TimelineEvent {
  id: ID!
  type: String!
  description: String
  user: User
  metadata: JSON
  createdAt: DateTime!
}

type Note {
  id: ID!
  content: String!
  createdBy: User
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Form {
  id: ID!
  name: String!
  fields: JSON!
  isActive: Boolean!
  submissions: Int!
  createdAt: DateTime!
}

type Document {
  id: ID!
  fileName: String!
  fileSize: Int!
  contentType: String!
  uploadedBy: User
  createdAt: DateTime!
}

type ApiKey {
  id: ID!
  name: String!
  prefix: String!
  scopes: [String!]!
  expiresAt: DateTime
  lastUsedAt: DateTime
  createdAt: DateTime!
}

# Connections (for pagination)
type ContactConnection {
  data: [Contact!]!
  total: Int!
  hasMore: Boolean!
}

type DealConnection {
  data: [Deal!]!
  total: Int!
  hasMore: Boolean!
}

type LeadConnection {
  data: [Lead!]!
  total: Int!
  hasMore: Boolean!
}

# Global Search (for data explorer)
type GlobalSearchResult {
  tenants: TenantConnection
  contacts: ContactConnection
  leads: LeadConnection
  deals: DealConnection
  companies: CompanyConnection
  users: UserConnection
  totalAcrossAll: Int!
}

# Input Types
input ContactInput {
  firstName: String!
  lastName: String
  email: String
  phone: String
  jobTitle: String
  companyId: ID
  leadStatus: LeadStatus
  leadSource: String
  tags: [String!]
  notes: String
  customFields: JSON
}

input DealInput {
  title: String!
  value: Float
  currency: String
  stageId: ID!
  contactId: ID
  companyId: ID
  expectedCloseDate: DateTime
  probability: Int
  notes: String
}

input LeadInput {
  firstName: String!
  lastName: String
  email: String
  phone: String
  leadSource: String
}

input TaskInput {
  title: String!
  description: String
  status: TaskStatus
  priority: TaskPriority
  dueDate: DateTime
  assignedToId: ID
  contactId: ID
  dealId: ID
}
```

---

## Query Examples

### Basic Queries

```graphql
# Get contacts with pagination
query GetContacts($limit: Int, $offset: Int, $q: String) {
  contacts(limit: $limit, offset: $offset, q: $q) {
    data {
      id
      firstName
      lastName
      email
      company {
        name
      }
      assignedTo {
        fullName
      }
    }
    total
    hasMore
  }
}

# Get single contact with timeline
query GetContact($id: ID!) {
  contact(id: $id) {
    id
    firstName
    lastName
    email
    phone
    leadStatus
    score
    tags
    customFields
    company {
      id
      name
      industry
    }
    assignedTo {
      id
      fullName
      email
    }
    timeline {
      type
      description
      user {
        fullName
      }
      createdAt
    }
    notes {
      content
      createdBy {
        fullName
      }
      createdAt
    }
    activities {
      eventType
      description
      createdAt
    }
  }
}

# Get deals with pipeline
query GetDeals($stageId: ID, $limit: Int) {
  deals(stageId: $stageId, limit: $limit) {
    data {
      id
      title
      value
      currency
      stage {
        id
        name
        probability
      }
      pipeline {
        name
      }
      contact {
        firstName
        lastName
        email
      }
      expectedCloseDate
      createdAt
    }
    total
  }
}

# Dashboard data in single query
query GetDashboard {
  dashboardStats {
    contacts {
      total
      newThisWeek
      newThisMonth
    }
    deals {
      total
      totalValue
      winRate
    }
    tasks {
      pending
      overdue
      completedToday
    }
  }
  recentContacts(limit: 5) {
    id
    firstName
    lastName
    email
    createdAt
  }
  upcomingTasks(limit: 10) {
    id
    title
    dueDate
    priority
    contact {
      firstName
      lastName
    }
  }
}
```

### Global Search (Data Explorer)

```graphql
query GlobalSearch($q: String!, $type: String, $tenantId: ID) {
  globalSearch(q: $q, type: $type, tenantId: $tenantId) {
    contacts {
      data {
        id
        firstName
        lastName
        email
        tenant {
          name
        }
      }
      total
    }
    deals {
      data {
        id
        title
        value
        tenant {
          name
        }
      }
      total
    }
    companies {
      data {
        id
        name
        industry
        tenant {
          name
        }
      }
      total
    }
    totalAcrossAll
  }
}
```

---

## Mutation Examples

```graphql
# Create contact
mutation CreateContact($input: ContactInput!) {
  createContact(input: $input) {
    id
    firstName
    lastName
    email
    createdAt
  }
}

# Variables
{
  "input": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1-555-0100",
    "leadStatus": "new",
    "tags": ["enterprise"]
  }
}

# Update deal
mutation UpdateDeal($id: ID!, $input: DealInput!) {
  updateDeal(id: $id, input: $input) {
    id
    title
    value
    stage {
      name
    }
    updatedAt
  }
}

# Convert lead to deal
mutation ConvertLead($leadId: ID!, $dealInput: DealInput!) {
  convertLead(leadId: $leadId, dealInput: $dealInput) {
    lead {
      id
      leadStatus
      convertedAt
    }
    deal {
      id
      title
      value
    }
  }
}

# Delete contact
mutation DeleteContact($id: ID!) {
  deleteContact(id: $id)
}
```

---

## Subscriptions (Real-time)

```graphql
# Subscribe to new contacts
subscription OnNewContact($tenantId: ID!) {
  contactCreated(tenantId: $tenantId) {
    id
    firstName
    lastName
    email
    createdAt
  }
}

# Subscribe to deal updates
subscription OnDealUpdated($tenantId: ID!) {
  dealUpdated(tenantId: $tenantId) {
    id
    title
    value
    stage {
      name
    }
    updatedAt
  }
}

# Subscribe to activities
subscription OnActivity($tenantId: ID!, $entityType: String) {
  activity(tenantId: $tenantId, entityType: $entityType) {
    eventType
    description
    user {
      fullName
    }
    createdAt
  }
}
```

---

## Implementation Plan

### Phase 2.1: Setup (Week 1-2)

- [ ] Install dependencies (`graphql-yoga`, `graphql-modules`, `dataloader`)
- [ ] Create GraphQL schema file
- [ ] Setup GraphQL endpoint at `/api/graphql`
- [ ] Add authentication middleware
- [ ] Add rate limiting

### Phase 2.2: Core Resolvers (Week 3-4)

- [ ] Contacts CRUD
- [ ] Leads CRUD
- [ ] Deals CRUD
- [ ] Companies CRUD
- [ ] Tasks CRUD

### Phase 2.3: Advanced Features (Week 5-6)

- [ ] Dashboard queries
- [ ] Global search (data explorer)
- [ ] Forms & Documents
- [ ] User/Profile management
- [ ] Super Admin queries

### Phase 2.4: Real-time (Week 7)

- [ ] WebSocket setup
- [ ] Subscriptions for contacts
- [ ] Subscriptions for deals
- [ ] Activity feed subscriptions

### Phase 2.5: Migration (Week 8)

- [ ] Add deprecation headers to REST endpoints
- [ ] Update Postman collection → GraphQL queries
- [ ] Update test suite
- [ ] Documentation updates

---

## DataLoader Patterns

```typescript
// lib/graphql/dataloaders.ts
import DataLoader from 'dataloader';
import { db } from '@/drizzle/db';
import { contacts, companies, users } from '@/drizzle/schema';
import { eq, inArray } from 'drizzle-orm';

export function createLoaders(tenantId: string) {
  return {
    contactById: new DataLoader(async (ids: string[]) => {
      const results = await db.select()
        .from(contacts)
        .where(inArray(contacts.id, ids));
      
      const map = new Map(results.map(r => [r.id, r]));
      return ids.map(id => map.get(id) || null);
    }),

    companyById: new DataLoader(async (ids: string[]) => {
      const results = await db.select()
        .from(companies)
        .where(inArray(companies.id, ids));
      
      const map = new Map(results.map(r => [r.id, r]));
      return ids.map(id => map.get(id) || null);
    }),

    userById: new DataLoader(async (ids: string[]) => {
      const results = await db.select()
        .from(users)
        .where(inArray(users.id, ids));
      
      const map = new Map(results.map(r => [r.id, r]));
      return ids.map(id => map.get(id) || null);
    }),

    contactsByCompanyId: new DataLoader(async (companyIds: string[]) => {
      const results = await db.select()
        .from(contacts)
        .where(inArray(contacts.companyId, companyIds));
      
      const grouped = new Map<string, typeof results>();
      for (const r of results) {
        if (r.companyId) {
          if (!grouped.has(r.companyId)) grouped.set(r.companyId, []);
          grouped.get(r.companyId)!.push(r);
        }
      }
      return companyIds.map(id => grouped.get(id) || []);
    }),
  };
}
```

---

## Performance Considerations

### Query Complexity Analysis

```typescript
import { createComplexityRule } from 'graphql-query-complexity';

const complexityRule = createComplexityRule({
  maximumComplexity: 100,
  estimators: [
    fieldExtensionsEstimator(),
    simpleEstimator({ defaultComplexity: 1 }),
  ],
  onComplete: (complexity) => {
    if (complexity > 100) {
      throw new Error(`Query too complex: ${complexity}`);
    }
  },
});
```

### Caching Strategy

```typescript
// Use Redis for query caching
const cache = new Redis(process.env.REDIS_URL);

async function cachedQuery(key: string, queryFn: () => Promise<any>, ttl = 300) {
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);
  
  const result = await queryFn();
  await cache.setex(key, ttl, JSON.stringify(result));
  return result;
}
```

---

## Testing GraphQL

### Example Test (Vitest)

```typescript
import { describe, it, expect } from 'vitest';
import { graphql } from 'graphql';
import schema from '@/lib/graphql/schema';
import { createTestContext } from '../helpers';

describe('Contacts GraphQL', () => {
  it('fetches contacts with pagination', async () => {
    const context = await createTestContext();
    
    const result = await graphql({
      schema,
      source: `
        query GetContacts($limit: Int, $offset: Int) {
          contacts(limit: $limit, offset: $offset) {
            data {
              id
              firstName
              lastName
              email
            }
            total
            hasMore
          }
        }
      `,
      variableValues: { limit: 10, offset: 0 },
      contextValue: context,
    });
    
    expect(result.errors).toBeUndefined();
    expect(result.data?.contacts.data).toHaveLength(10);
    expect(result.data?.contacts.total).toBeGreaterThan(0);
  });
});
```

---

## Migration Checklist

### Pre-Migration

- [ ] Audit all REST endpoints
- [ ] Document current API contracts
- [ ] Backup existing test suite
- [ ] Create GraphQL schema draft

### During Migration

- [ ] Implement resolvers one module at a time
- [ ] Maintain REST endpoints (add deprecation headers)
- [ ] Run parallel testing (REST + GraphQL)
- [ ] Monitor performance metrics

### Post-Migration

- [ ] Update all client applications
- [ ] Remove deprecated REST endpoints
- [ ] Update documentation
- [ ] Archive Postman collection

---

## Rollback Plan

If issues arise:

1. **Keep REST endpoints active** during transition
2. **Feature flag** GraphQL vs REST
3. **Gradual rollout** (10% → 50% → 100%)
4. **Monitor error rates** and performance

---

## Resources

- [GraphQL Yoga Docs](https://the-guild.dev/graphql/yoga-server)
- [DataLoader GitHub](https://github.com/graphql/dataloader)
- [GraphQL Schema Best Practices](https://graphql.org/learn/best-practices/)

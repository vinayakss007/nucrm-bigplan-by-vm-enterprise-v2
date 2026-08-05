/**
 * Seed module: Contacts (55 records)
 *
 * Creates contacts linked to companies with varied job titles,
 * lead statuses, lifecycle stages, and scoring.
 */
import * as schema from '../../drizzle/schema';
import { IDS } from './ids';
import { logSection, logDone } from './helpers';
import type { SeedDb } from './types';

// Shared data arrays used for name generation
export const firstNames = [
  'James', 'Emma', 'Oliver', 'Sophia', 'Liam', 'Ava', 'Noah', 'Isabella',
  'Ethan', 'Mia', 'Lucas', 'Charlotte', 'Mason', 'Amelia', 'Logan', 'Harper',
  'Alexander', 'Evelyn', 'Daniel', 'Abigail', 'Henry', 'Emily', 'Sebastian',
  'Elizabeth', 'Jack', 'Sofia', 'Benjamin', 'Ella', 'William', 'Grace', 'Owen',
  'Chloe', 'Elijah', 'Victoria', 'Aiden', 'Riley', 'Jackson', 'Zoey', 'Matthew',
  'Penelope', 'David', 'Lily', 'Joseph', 'Layla', 'Carter', 'Nora', 'Michael',
  'Camila', 'Jayden', 'Hannah', 'Wyatt', 'Aria', 'Gabriel', 'Scarlett', 'Julian',
];

export const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
];

const jobTitles = [
  'CEO', 'CTO', 'VP Sales', 'VP Engineering', 'Director of Marketing',
  'Product Manager', 'Sales Manager', 'Account Executive', 'Software Engineer',
  'HR Director', 'CFO', 'COO', 'Business Development Manager',
  'Marketing Manager', 'Operations Manager',
];

const leadStatuses = ['new', 'contacted', 'qualified', 'won'];
const lifecycleStages = ['subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer', 'evangelist'];

/** Company domains used to generate contact emails. Must align with companies seed order. */
export const companyDomains = [
  'techvision.io', 'healthfirst.com', 'financeflow.co', 'buildright.com',
  'retailhub.io', 'edusmart.io', 'greenenergy.co', 'logitrans.com',
  'mediawave.io', 'aerodynamics.com', 'datastream.ai', 'cloudnine.io',
  'biogenpharma.com', 'foodtech.co', 'autodrive.com', 'proptech.io',
  'cybershield.io', 'agrigrow.co', 'legalease.com', 'sportsfit.io',
  'travelwise.com', 'insuresafe.co', 'nanotech.io', 'globalcg.com',
  'smarthomed.io', 'oceanblue.com', 'pixelperfect.io', 'bcventures.io',
  'pharmacore.com', 'windpower.co',
];

export async function seedContacts(db: SeedDb): Promise<void> {
  logSection('Seeding Contacts');

  const userIds = Object.values(IDS.users);

  const contactsValues = Array.from({ length: 55 }, (_, i) => ({
    id: IDS.contacts[i],
    tenantId: IDS.tenant,
    companyId: IDS.companies[i % 30],
    assignedTo: userIds[i % 4],
    firstName: firstNames[i],
    lastName: lastNames[i],
    email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@${companyDomains[i % 30]}`,
    phone: `+1${String(2000000000 + i * 1111111).slice(0, 10)}`,
    jobTitle: jobTitles[i % jobTitles.length],
    leadStatus: leadStatuses[i % 4],
    lifecycleStage: lifecycleStages[i % 7],
    score: (i * 7 + 10) % 100,
    tags: i % 4 === 0 ? ['vip', 'decision-maker'] : i % 4 === 1 ? ['technical'] : i % 4 === 2 ? ['nurture'] : ['champion'],
    city: ['San Francisco', 'Boston', 'New York', 'Detroit', 'Chicago', 'Austin', 'Denver', 'Memphis', 'Los Angeles', 'Seattle', 'Portland', 'Raleigh', 'San Diego', 'Nashville', 'Detroit', 'Miami', 'Washington DC', 'Des Moines', 'Philadelphia', 'Denver', 'Orlando', 'Hartford', 'Cambridge', 'Chicago', 'San Jose', 'Houston', 'Brooklyn', 'Miami', 'Philadelphia', 'Oklahoma City'][i % 30],
    country: 'US',
  }));

  await db.insert(schema.contacts).values(contactsValues);
  logDone('contacts', 55);
}

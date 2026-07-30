/**
 * Seed module: Companies (30 records)
 *
 * Creates a varied set of companies across industries and sizes.
 */
import * as schema from '../../drizzle/schema';
import { IDS } from './ids';
import { logSection, logDone } from './helpers';
import type { SeedDb } from './types';

export const companiesData = [
  { name: 'TechVision Inc', industry: 'Technology', domain: 'techvision.io', companySize: '51-200', annualRevenue: '5000000', city: 'San Francisco', country: 'US' },
  { name: 'HealthFirst Corp', industry: 'Healthcare', domain: 'healthfirst.com', companySize: '201-500', annualRevenue: '25000000', city: 'Boston', country: 'US' },
  { name: 'FinanceFlow Ltd', industry: 'Finance', domain: 'financeflow.co', companySize: '11-50', annualRevenue: '3000000', city: 'New York', country: 'US' },
  { name: 'BuildRight Manufacturing', industry: 'Manufacturing', domain: 'buildright.com', companySize: '501-1000', annualRevenue: '50000000', city: 'Detroit', country: 'US' },
  { name: 'RetailHub', industry: 'Retail', domain: 'retailhub.io', companySize: '51-200', annualRevenue: '8000000', city: 'Chicago', country: 'US' },
  { name: 'EduSmart Solutions', industry: 'Education', domain: 'edusmart.io', companySize: '11-50', annualRevenue: '1500000', city: 'Austin', country: 'US' },
  { name: 'GreenEnergy Systems', industry: 'Energy', domain: 'greenenergy.co', companySize: '201-500', annualRevenue: '35000000', city: 'Denver', country: 'US' },
  { name: 'LogiTrans Corp', industry: 'Logistics', domain: 'logitrans.com', companySize: '1001-5000', annualRevenue: '120000000', city: 'Memphis', country: 'US' },
  { name: 'MediaWave Digital', industry: 'Media', domain: 'mediawave.io', companySize: '11-50', annualRevenue: '2000000', city: 'Los Angeles', country: 'US' },
  { name: 'AeroSpace Dynamics', industry: 'Aerospace', domain: 'aerodynamics.com', companySize: '5001+', annualRevenue: '500000000', city: 'Seattle', country: 'US' },
  { name: 'DataStream Analytics', industry: 'Technology', domain: 'datastream.ai', companySize: '51-200', annualRevenue: '12000000', city: 'Portland', country: 'US' },
  { name: 'CloudNine Hosting', industry: 'Technology', domain: 'cloudnine.io', companySize: '11-50', annualRevenue: '4000000', city: 'Raleigh', country: 'US' },
  { name: 'BioGen Pharma', industry: 'Healthcare', domain: 'biogenpharma.com', companySize: '201-500', annualRevenue: '45000000', city: 'San Diego', country: 'US' },
  { name: 'FoodTech Innovations', industry: 'Food & Beverage', domain: 'foodtech.co', companySize: '51-200', annualRevenue: '7000000', city: 'Nashville', country: 'US' },
  { name: 'AutoDrive Motors', industry: 'Automotive', domain: 'autodrive.com', companySize: '1001-5000', annualRevenue: '200000000', city: 'Detroit', country: 'US' },
  { name: 'PropTech Realty', industry: 'Real Estate', domain: 'proptech.io', companySize: '11-50', annualRevenue: '6000000', city: 'Miami', country: 'US' },
  { name: 'CyberShield Security', industry: 'Technology', domain: 'cybershield.io', companySize: '51-200', annualRevenue: '15000000', city: 'Washington DC', country: 'US' },
  { name: 'AgriGrow Farms', industry: 'Agriculture', domain: 'agrigrow.co', companySize: '201-500', annualRevenue: '20000000', city: 'Des Moines', country: 'US' },
  { name: 'LegalEase Partners', industry: 'Legal', domain: 'legalease.com', companySize: '11-50', annualRevenue: '5000000', city: 'Philadelphia', country: 'US' },
  { name: 'SportsFit Corp', industry: 'Sports & Fitness', domain: 'sportsfit.io', companySize: '51-200', annualRevenue: '9000000', city: 'Denver', country: 'US' },
  { name: 'TravelWise Inc', industry: 'Travel', domain: 'travelwise.com', companySize: '201-500', annualRevenue: '30000000', city: 'Orlando', country: 'US' },
  { name: 'InsureSafe Group', industry: 'Insurance', domain: 'insuresafe.co', companySize: '501-1000', annualRevenue: '80000000', city: 'Hartford', country: 'US' },
  { name: 'NanoTech Labs', industry: 'Technology', domain: 'nanotech.io', companySize: '11-50', annualRevenue: '3500000', city: 'Cambridge', country: 'US' },
  { name: 'Global Consulting Group', industry: 'Consulting', domain: 'globalcg.com', companySize: '201-500', annualRevenue: '40000000', city: 'Chicago', country: 'US' },
  { name: 'SmartHome Devices', industry: 'Consumer Electronics', domain: 'smarthomed.io', companySize: '51-200', annualRevenue: '11000000', city: 'San Jose', country: 'US' },
  { name: 'OceanBlue Shipping', industry: 'Logistics', domain: 'oceanblue.com', companySize: '1001-5000', annualRevenue: '150000000', city: 'Houston', country: 'US' },
  { name: 'Pixel Perfect Design', industry: 'Design', domain: 'pixelperfect.io', companySize: '1-10', annualRevenue: '800000', city: 'Brooklyn', country: 'US' },
  { name: 'BlockChain Ventures', industry: 'Technology', domain: 'bcventures.io', companySize: '11-50', annualRevenue: '6000000', city: 'Miami', country: 'US' },
  { name: 'PharmaCore Labs', industry: 'Healthcare', domain: 'pharmacore.com', companySize: '501-1000', annualRevenue: '75000000', city: 'Philadelphia', country: 'US' },
  { name: 'WindPower Systems', industry: 'Energy', domain: 'windpower.co', companySize: '201-500', annualRevenue: '28000000', city: 'Oklahoma City', country: 'US' },
];

export async function seedCompanies(db: SeedDb): Promise<void> {
  logSection('Seeding Companies');

  await db.insert(schema.companies).values(
    companiesData.map((c, i) => ({
      id: IDS.companies[i],
      tenantId: IDS.tenant,
      name: c.name,
      industry: c.industry,
      domain: c.domain,
      companySize: c.companySize,
      annualRevenue: c.annualRevenue,
      city: c.city,
      country: c.country,
      website: `https://${c.domain}`,
      isCustomer: i < 10,
      tags: i % 3 === 0 ? ['enterprise', 'priority'] : i % 3 === 1 ? ['smb'] : ['prospect'],
    }))
  );
  logDone('companies', companiesData.length);
}

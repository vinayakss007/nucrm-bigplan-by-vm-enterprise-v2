/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { contacts } from '@/drizzle/schema';
import { eq, and, or, isNull } from 'drizzle-orm';

// ── Types ──

export type ScannedCard = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  website?: string;
  address?: string;
  linkedinUrl?: string;
  rawText: string;
};

// ── OCR Business Card Parsing ──

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,5}\)?[\s\-.]?\d{3,5}[\s\-.]?\d{3,5}/;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-._~]+\/?/i;

const JOB_TITLE_KEYWORDS = [
  'ceo', 'cto', 'cfo', 'coo', 'vp', 'director', 'manager', 'engineer',
  'developer', 'designer', 'analyst', 'consultant', 'founder', 'co-founder',
  'president', 'head', 'lead', 'senior', 'junior', 'chief', 'officer',
  'executive', 'partner', 'associate', 'coordinator', 'specialist',
  'architect', 'administrator', 'supervisor', 'intern',
];

/**
 * Parse structured contact data from OCR text of a business card.
 */
export function parseBusinessCard(ocrText: string): ScannedCard {
  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
  const card: ScannedCard = { rawText: ocrText };

  // Extract email
  const emailMatch = ocrText.match(EMAIL_RE);
  if (emailMatch) {
    card.email = emailMatch[0].toLowerCase();
  }

  // Extract LinkedIn URL (before generic URL)
  const linkedinMatch = ocrText.match(LINKEDIN_RE);
  if (linkedinMatch) {
    card.linkedinUrl = linkedinMatch[0];
  }

  // Extract phone
  const phoneMatch = ocrText.match(PHONE_RE);
  if (phoneMatch) {
    card.phone = phoneMatch[0];
  }

  // Extract website (non-email URL, non-linkedin)
  for (const line of lines) {
    // Skip lines that contain an email address (the domain would match URL_RE)
    if (EMAIL_RE.test(line)) continue;
    if (LINKEDIN_RE.test(line)) continue;
    const urlMatch = line.match(URL_RE);
    if (urlMatch) {
      const url = urlMatch[0];
      if (url.includes('@') || url.toLowerCase().includes('linkedin.com')) continue;
      card.website = url;
      break;
    }
  }

  // Extract job title (look for lines containing title keywords)
  for (const line of lines) {
    const lower = line.toLowerCase();
    // Skip lines that are email/phone/url
    if (EMAIL_RE.test(line) || LINKEDIN_RE.test(line)) continue;
    if (JOB_TITLE_KEYWORDS.some(kw => lower.includes(kw))) {
      card.jobTitle = line;
      break;
    }
  }

  // Extract name (typically the first meaningful line that isn't a title, email, phone, url)
  for (const line of lines) {
    // Skip lines that contain email, phone, URL, or are likely company/address
    if (EMAIL_RE.test(line)) continue;
    if (PHONE_RE.test(line) && line.replace(PHONE_RE, '').trim().length < 3) continue;
    if (URL_RE.test(line) && !line.includes(' ')) continue;
    // Skip job title line
    if (line === card.jobTitle) continue;
    // Name heuristic: typically 2-4 words, no special chars except periods/hyphens
    if (/^[A-Za-z][A-Za-z.\-'\s]{1,60}$/.test(line) && line.split(/\s+/).length <= 5) {
      card.fullName = line;
      const parts = line.split(/\s+/);
      card.firstName = parts[0];
      card.lastName = parts.slice(1).join(' ') || undefined;
      break;
    }
  }

  // Extract company (look for lines that seem like company names - after name and title)
  for (const line of lines) {
    if (line === card.fullName || line === card.jobTitle) continue;
    if (EMAIL_RE.test(line) || LINKEDIN_RE.test(line)) continue;
    if (PHONE_RE.test(line) && line.replace(PHONE_RE, '').trim().length < 3) continue;
    if (URL_RE.test(line) && !line.includes(' ')) continue;
    const lower = line.toLowerCase();
    // Skip if this looks like an address (contains common address words)
    if (/\d{3,}/.test(line) && /(?:street|st|road|rd|avenue|ave|floor|suite|sector)/i.test(line)) {
      card.address = line;
      continue;
    }
    // Company heuristic: contains common suffixes or is a capitalized/multi-word line
    if (/(?:pvt|ltd|llc|inc|corp|limited|solutions|technologies|tech|services|consulting|group|labs|enterprises)/i.test(line)) {
      card.company = line;
      break;
    }
    // If it looks like an address with numbers, capture it
    if (/\d/.test(line) && line.length > 15) {
      if (!card.address) card.address = line;
      continue;
    }
    // Remaining non-name, non-title lines could be company
    if (!card.company && line !== card.fullName && line.length > 1) {
      // Check if it's a title keyword line
      if (JOB_TITLE_KEYWORDS.some(kw => lower.includes(kw))) continue;
      card.company = line;
    }
  }

  return card;
}

// ── vCard Parsing ──

/**
 * Parse a vCard 3.0/4.0 format string into a ScannedCard.
 */
export function parseVCard(vcardText: string): ScannedCard {
  const card: ScannedCard = { rawText: vcardText };

  // Validate vCard format
  if (!vcardText.includes('BEGIN:VCARD') || !vcardText.includes('END:VCARD')) {
    return card;
  }

  const lines = vcardText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Handle FN (Full Name)
    if (line.startsWith('FN:') || line.startsWith('FN;')) {
      const value = extractVCardValue(line);
      if (value) {
        card.fullName = value;
        const parts = value.split(/\s+/);
        card.firstName = parts[0];
        card.lastName = parts.slice(1).join(' ') || undefined;
      }
    }

    // Handle N (Structured Name): N:LastName;FirstName;MiddleName;Prefix;Suffix
    if (line.startsWith('N:') || line.startsWith('N;')) {
      const value = extractVCardValue(line);
      if (value) {
        const parts = value.split(';');
        const lastName = parts[0]?.trim();
        const firstName = parts[1]?.trim();
        if (firstName) card.firstName = firstName;
        if (lastName) card.lastName = lastName;
        if (firstName && lastName) {
          card.fullName = `${firstName} ${lastName}`;
        } else if (firstName) {
          card.fullName = firstName;
        } else if (lastName) {
          card.fullName = lastName;
        }
      }
    }

    // Handle EMAIL
    if (line.toUpperCase().startsWith('EMAIL')) {
      const value = extractVCardValue(line);
      if (value) card.email = value.toLowerCase();
    }

    // Handle TEL (Phone)
    if (line.toUpperCase().startsWith('TEL')) {
      const value = extractVCardValue(line);
      if (value) card.phone = value;
    }

    // Handle ORG (Organization/Company)
    if (line.startsWith('ORG:') || line.startsWith('ORG;')) {
      const value = extractVCardValue(line);
      if (value) card.company = value.split(';')[0]?.trim();
    }

    // Handle TITLE (Job Title)
    if (line.startsWith('TITLE:') || line.startsWith('TITLE;')) {
      const value = extractVCardValue(line);
      if (value) card.jobTitle = value;
    }

    // Handle URL
    if (line.toUpperCase().startsWith('URL')) {
      const value = extractVCardValue(line);
      if (value) {
        if (value.toLowerCase().includes('linkedin.com')) {
          card.linkedinUrl = value;
        } else {
          card.website = value;
        }
      }
    }

    // Handle ADR (Address)
    if (line.startsWith('ADR:') || line.startsWith('ADR;')) {
      const value = extractVCardValue(line);
      if (value) {
        // ADR format: PO Box;Ext;Street;City;Region;PostalCode;Country
        const parts = value.split(';').map(p => p.trim()).filter(Boolean);
        card.address = parts.join(', ');
      }
    }
  }

  return card;
}

function extractVCardValue(line: string): string | undefined {
  // Handle property params like TEL;TYPE=WORK: or EMAIL;TYPE=INTERNET:
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return undefined;
  const value = line.slice(colonIdx + 1).trim();
  return value || undefined;
}

// ── Phone Normalization ──

/**
 * Normalize phone numbers, with special handling for Indian phone numbers.
 * Defaults to Indian country code (+91) when no country code is specified.
 */
export function normalizePhone(phone: string, countryCode: string = '+91'): string {
  // Remove all non-digit and non-plus characters
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If starts with +, preserve country code
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Handle Indian numbers specifically
  if (countryCode === '+91') {
    // Remove leading 0 (trunk prefix for Indian numbers)
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.slice(1);
    }

    // Remove leading 91 if it creates an 11+ digit number (country code without +)
    if (cleaned.startsWith('91') && cleaned.length >= 12) {
      cleaned = cleaned.slice(2);
    }

    // Valid Indian mobile/landline: 10 digits
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }
  }

  // For other cases, prepend country code if we have a valid-length number
  if (cleaned.length >= 7 && cleaned.length <= 15) {
    return `${countryCode}${cleaned}`;
  }

  // Return as-is if we can't normalize
  return phone.replace(/[^\d+]/g, '');
}

// ── Email Normalization ──

/**
 * Normalize email address: lowercase, trim whitespace.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Contact Payload Conversion ──

/**
 * Convert a ScannedCard to a contact creation payload compatible with the contacts API.
 */
export function toContactPayload(
  card: ScannedCard,
  tenantId: string,
  userId: string,
): {
  tenantId: string;
  createdBy: string;
  assignedTo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  website: string | null;
  linkedinUrl: string | null;
  leadSource: string;
  notes: string | null;
} {
  return {
    tenantId,
    createdBy: userId,
    assignedTo: userId,
    firstName: card.firstName || card.fullName || 'Unknown',
    lastName: card.lastName || '',
    email: card.email ? normalizeEmail(card.email) : null,
    phone: card.phone ? normalizePhone(card.phone) : null,
    jobTitle: card.jobTitle || null,
    website: card.website || null,
    linkedinUrl: card.linkedinUrl || null,
    leadSource: 'business_card_scan',
    notes: card.address ? `Address: ${card.address}` : null,
  };
}

// ── Duplicate Detection ──

/**
 * Check if a contact with the given email or phone already exists for the tenant.
 * Returns the duplicate contact ID if found, or null.
 */
export async function detectDuplicate(
  email: string | undefined,
  phone: string | undefined,
  tenantId: string,
): Promise<{ isDuplicate: boolean; duplicateId?: string }> {
  if (!email && !phone) {
    return { isDuplicate: false };
  }

  const conditions = [
    eq(contacts.tenantId, tenantId),
    eq(contacts.isArchived, false),
    isNull(contacts.deletedAt),
  ];

  const matchConditions: ReturnType<typeof eq>[] = [];
  if (email) {
    matchConditions.push(eq(contacts.email, email.toLowerCase()));
  }
  if (phone) {
    matchConditions.push(eq(contacts.phone, phone));
  }

  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(...conditions, or(...matchConditions)))
    .limit(1);

  if (existing) {
    return { isDuplicate: true, duplicateId: existing.id };
  }

  return { isDuplicate: false };
}

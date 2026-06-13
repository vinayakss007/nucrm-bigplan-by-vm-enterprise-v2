import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailDrafts } from '@/drizzle/schema/comm';
import { contacts, companies, deals } from '@/drizzle/schema';
import { tenantModules } from '@/drizzle/schema/modules';
import { eq, and, desc } from 'drizzle-orm';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/ai/email-draft
 * Generate AI-powered email draft
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Ensure tenant has the AI Assistant module installed
    const moduleInstalled = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, ctx.tenantId),
        eq(tenantModules.moduleId, 'ai-assistant'),
        eq(tenantModules.status, 'active')
      )
    });
    if (!moduleInstalled) {
      return NextResponse.json({ error: 'AI Assistant module not installed' }, { status: 403 });
    }

    const body = await request.json();
    const {
      contact_id,
      deal_id,
      purpose,
      tone = 'professional',
      length = 'medium',
      custom_instructions,
    } = body;

    if (!purpose) {
      return NextResponse.json({ error: 'purpose is required' }, { status: 400 });
    }

    // Get contact data
    let contactData: any = null;
    if (contact_id) {
      const contactResults = await db.select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        companyName: companies.name
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(eq(contacts.id, contact_id), eq(contacts.tenantId, ctx.tenantId)));
      
      contactData = contactResults[0];
    }

    // Get deal data
    let dealData: any = null;
    if (deal_id) {
      const dealResults = await db.select({
        id: deals.id,
        title: deals.title,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        companyName: companies.name
      })
      .from(deals)
      .leftJoin(contacts, eq(contacts.id, deals.contactId))
      .leftJoin(companies, eq(companies.id, deals.companyId))
      .where(and(eq(deals.id, deal_id), eq(deals.tenantId, ctx.tenantId)));
      
      dealData = dealResults[0];
    }

    // Generate email based on purpose
    const emailTemplates: Record<string, { subject: string; body: string }> = {
      follow_up: {
        subject: `Following up{{${contactData?.first_name ? `, ${contactData.first_name}` : ''}}}`,
        body: `Hi {{first_name}},

I hope this email finds you well. I wanted to follow up on our {{last_interaction}}.

{{custom_message}}

Would you be available for a quick call this week to discuss further?

Best regards,
{{sender_name}}`,
      },
      introduction: {
        subject: `Introduction from {{sender_company}}`,
        body: `Hi {{first_name}},

I came across {{company_name}} and was impressed by {{company_achievement}}.

I help companies like yours {{value_proposition}}. I'd love to explore if there's a fit.

Are you open to a brief conversation next week?

Best,
{{sender_name}}`,
      },
      check_in: {
        subject: `Checking in{{${contactData?.first_name ? `, ${contactData.first_name}` : ''}}}`,
        body: `Hi {{first_name}},

It's been a while since we last connected. I wanted to check in and see how things are going at {{company_name}}.

{{custom_message}}

Let me know if there's anything I can help with!

Best,
{{sender_name}}`,
      },
      proposal: {
        subject: `Proposal for {{company_name}}`,
        body: `Hi {{first_name}},

Thank you for the opportunity to put together this proposal for {{company_name}}.

Based on our discussions, I believe we can help you {{value_proposition}}.

Key highlights:
- {{highlight_1}}
- {{highlight_2}}
- {{highlight_3}}

I've attached the detailed proposal. Let's schedule a time to review and answer any questions.

Looking forward to your feedback!

Best regards,
{{sender_name}}`,
      },
      closing: {
        subject: `Next steps for {{deal_name}}`,
        body: `Hi {{first_name}},

I'm excited about the opportunity to work together!

To move forward, here are the next steps:
1. {{step_1}}
2. {{step_2}}
3. {{step_3}}

Please let me know if you have any questions or concerns. I'm here to help make this process smooth.

Looking forward to partnering with you!

Best,
{{sender_name}}`,
      },
    };

    const template = emailTemplates[purpose] || emailTemplates['follow_up'];
    if (!template) {
      return NextResponse.json({ error: 'No email template found for this purpose' }, { status: 404 });
    }

    // Replace variables with actual data
    let emailSubject = template.subject;
    let emailBody = template.body;

    if (contactData) {
      emailSubject = emailSubject.replace(/{{first_name}}/g, contactData.firstName || '');
      emailBody = emailBody.replace(/{{first_name}}/g, contactData.firstName || '');
      emailBody = emailBody.replace(/{{company_name}}/g, contactData.companyName || 'your company');
    }

    // Add custom instructions if provided
    if (custom_instructions) {
      emailBody = emailBody.replace(/{{custom_message}}/g, custom_instructions);
    } else {
      emailBody = emailBody.replace(/{{custom_message}}/, '');
    }

    // Save draft
    const drafts = await db.insert(emailDrafts)
      .values({
        tenantId: ctx.tenantId,
        contactId: contact_id || null,
        dealId: deal_id || null,
        purpose,
        subject: emailSubject,
        body: emailBody,
        tone,
        length,
        createdBy: ctx.userId
      } as typeof emailDrafts.$inferInsert)
      .returning();
    
    const draft = drafts[0];

    return NextResponse.json({
      ok: true,
      draft,
      variables: {
        first_name: contactData?.firstName || '',
        company_name: contactData?.companyName || '',
        sender_name: '[Your Name]',
        sender_company: '[Your Company]',
      },
    });
  } catch (error: any) {
    console.error('[AI Email Draft] POST error:', error);
    return apiError(error);
  }
}

/**
 * GET /api/tenant/ai/email-drafts
 * Get email drafts
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const contact_id = searchParams.get('contact_id');
    const deal_id = searchParams.get('deal_id');
    const limit = parseInt(searchParams.get('limit') || '20');

    const conditions = [eq(emailDrafts.tenantId, ctx.tenantId)];

    if (contact_id) {
      conditions.push(eq(emailDrafts.contactId, contact_id));
    }

    if (deal_id) {
      conditions.push(eq(emailDrafts.dealId, deal_id));
    }

    const drafts = await db.select({
      draft: emailDrafts,
      contact: {
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email
      }
    })
    .from(emailDrafts)
    .leftJoin(contacts, eq(contacts.id, emailDrafts.contactId))
    .where(and(...conditions))
    .orderBy(desc(emailDrafts.createdAt))
    .limit(limit);

    // Flatten results for API compatibility
    const flattenedDrafts = drafts.map(d => ({
      ...d.draft,
      first_name: d.contact?.firstName,
      last_name: d.contact?.lastName,
      email: d.contact?.email
    }));

    return NextResponse.json({
      data: flattenedDrafts,
    });
  } catch (error: any) {
    console.error('[AI Email Drafts] GET error:', error);
    return apiError(error);
  }
}

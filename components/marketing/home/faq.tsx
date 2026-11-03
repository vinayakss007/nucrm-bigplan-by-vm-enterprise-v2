/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { Faq } from '@/components/marketing/faq';
import { Container, Section, SectionHeading } from '@/components/marketing/ui';
import { PRICING_FAQ } from '@/lib/marketing/pricing';

/** #faq — the pre-signup questions, accordion-mounted from the pricing corpus. */
export function HomeFaq() {
  return (
    <Section id="faq">
      <Container>
        <SectionHeading eyebrow="Questions" title="The things people ask before signing up" />
        <div className="mt-12">
          <Faq items={PRICING_FAQ} />
        </div>
      </Container>
    </Section>
  );
}

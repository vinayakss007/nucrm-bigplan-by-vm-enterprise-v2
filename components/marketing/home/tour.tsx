/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { ProductTour } from '@/components/marketing/product-tour';
import { Container, Section, SectionHeading } from '@/components/marketing/ui';
import { HOME_TOUR } from '@/lib/marketing/tour';

/** #tour — five tabbed product screens. The tab copy lives in `lib/marketing/tour.ts`. */
export function HomeTour() {
  return (
    <Section id="tour">
      <Container>
        <SectionHeading
          eyebrow="Take a look"
          title="This is what the work actually looks like"
          sub="Five of the screens your team will live in. Every one of them is part of the same product, on the same record."
        />
        <div className="mt-14">
          <ProductTour tabs={HOME_TOUR} />
        </div>
      </Container>
    </Section>
  );
}

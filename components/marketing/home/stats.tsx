/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { AnimatedNumber, Reveal } from '@/components/marketing/reveal';
import { Container, Section } from '@/components/marketing/ui';
import { PLATFORM_STATS } from '@/lib/marketing/site';

/** #scale — the four product-scope numbers, each counting up on reveal. */
export function HomeStats() {
  return (
    <Section id="scale" className="!py-14">
      <Container>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          {PLATFORM_STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 80} className="text-center">
              <div className="mk-h2 mk-grad-violet">
                <AnimatedNumber target={s.value} suffix={s.suffix} />
              </div>
              <div className="mk-h4 mt-2 text-slate-200">{s.label}</div>
              <div className="mk-tiny mt-1">{s.sub}</div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number | string | undefined | null;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  formatter?: (n: number) => string;
}

/**
 * Animated number that counts up from 0 to the target value
 * when it first enters the viewport.
 *
 * Usage:
 *   <AnimatedNumber value={1234} prefix="$" />
 *   <AnimatedNumber value={99.9} suffix="%" />
 */
export function AnimatedNumber({
  value,
  duration = 1200,
  prefix = '',
  suffix = '',
  className = '',
  formatter,
}: AnimatedNumberProps) {
  const numValue = typeof value === 'string' ? parseFloat(value) || 0 : (value ?? 0);
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current || numValue === 0) {
      setDisplay(numValue);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const startTime = performance.now();

          function step(currentTime: number) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = numValue * eased;
            setDisplay(current);

            if (progress < 1) {
              requestAnimationFrame(step);
            } else {
              setDisplay(numValue);
            }
          }

          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [numValue, duration]);

  const formatted = formatter
    ? formatter(display)
    : Number.isInteger(numValue)
      ? Math.round(display).toLocaleString()
      : display.toFixed(1);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}{formatted}{suffix}
    </span>
  );
}

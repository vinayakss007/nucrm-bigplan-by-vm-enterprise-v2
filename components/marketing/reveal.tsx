/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useCallback, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'scale' | 'blur';

/**
 * Scroll-triggered entrance. One observer per element, disconnected after the
 * first intersection so nothing keeps running as the visitor scrolls on.
 *
 * There is no animation library in this project by design, so the transition
 * itself lives in marketing.css (.mk-reveal / .is-in) and this component only
 * toggles the class.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  className = '',
  delay = 0,
  threshold = 0.12,
  direction = 'up',
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Stagger in milliseconds. */
  delay?: number;
  threshold?: number;
  direction?: RevealDirection;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Anything already on screen at mount should not wait for a scroll event.
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  const dirClass = direction === 'up' ? '' : `mk-reveal-${direction}`;

  return (
    <Tag
      ref={ref}
      className={`mk-reveal ${dirClass} ${shown ? 'is-in' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * Counts up to a target once scrolled into view. Eased so it decelerates
 * instead of stopping abruptly.
 */
export function AnimatedNumber({
  target,
  suffix = '',
  prefix = '',
  duration = 1600,
  className = '',
}: {
  target: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started.current) return;
        started.current = true;
        obs.disconnect();

        let t0 = 0;
        const step = (ts: number) => {
          if (!t0) t0 = ts;
          const p = Math.min((ts - t0) / duration, 1);
          setValue(Math.round((1 - Math.pow(1 - p, 3)) * target));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

/**
 * Magnetic button — subtly pulls toward the cursor when nearby.
 * Intensity controls how far the element shifts (default 0.3 = 30% of distance).
 */
export function MagneticButton({
  children,
  className = '',
  intensity = 0.3,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setOffset({
        x: (e.clientX - cx) * intensity,
        y: (e.clientY - cy) * intensity,
      });
    },
    [intensity],
  );

  const handleMouseLeave = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return (
    <Tag
      ref={ref}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: offset.x === 0 && offset.y === 0 ? 'transform 0.4s cubic-bezier(0.16,1,0.3,1)' : 'transform 0.15s ease-out',
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * 3D tilt card — tilts toward cursor with perspective.
 * glare adds a subtle light reflection that follows the cursor.
 */
export function TiltCard({
  children,
  className = '',
  glare = true,
  intensity = 12,
}: {
  children: ReactNode;
  className?: string;
  glare?: boolean;
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotateX = (0.5 - y) * intensity;
      const rotateY = (x - 0.5) * intensity;
      setStyle({
        transform: `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02,1.02,1.02)`,
      });
      setGlarePos({ x: x * 100, y: y * 100, opacity: 0.15 });
    },
    [intensity],
  );

  const handleMouseLeave = useCallback(() => {
    setStyle({});
    setGlarePos({ x: 50, y: 50, opacity: 0 });
  }, []);

  return (
    <div
      ref={ref}
      className={`mk-tilt ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={style}
    >
      {children}
      {glare && (
        <div
          className="mk-tilt-glare pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,${glarePos.opacity}), transparent 60%)`,
          }}
        />
      )}
    </div>
  );
}

/**
 * Word-by-word stagger reveal for hero headlines.
 * Each word fades in and slides up with a stagger delay.
 */
export function StaggerText({
  text,
  className = '',
  wordDelay = 60,
  startDelay = 0,
}: {
  text: string;
  className?: string;
  wordDelay?: number;
  startDelay?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const words = text.split(' ');

  return (
    <span ref={ref} className={className} aria-label={text}>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          className="mk-stagger-word inline-block"
          style={{
            animationDelay: shown ? `${startDelay + i * wordDelay}ms` : undefined,
            opacity: shown ? undefined : 0,
          }}
          aria-hidden
        >
          {word}
          {i < words.length - 1 && '\u00A0'}
        </span>
      ))}
    </span>
  );
}

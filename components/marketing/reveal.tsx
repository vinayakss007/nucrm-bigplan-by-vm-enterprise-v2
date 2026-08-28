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
  // Only arm the CSS "start hidden" state once JS is running on the client.
  // Server-rendered / no-JS markup stays fully visible (progressive
  // enhancement) so a hydration failure can never leave the page blank.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    setArmed(true);

    // Respect reduced-motion: reveal immediately, skip the observer entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }

    // Anything already on screen at mount must reveal on the first client paint
    // instead of waiting for an observer tick that may never come.
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setShown(true);
      return;
    }

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

    // Safety net: guarantee eventual visibility even if the observer never
    // fires (edge cases, background tabs, throttling). This is the core
    // regression guard — content can never stay invisible as a resting state.
    const failSafe = window.setTimeout(() => setShown(true), 1200);

    return () => {
      obs.disconnect();
      window.clearTimeout(failSafe);
    };
  }, [threshold]);

  const dirClass = direction === 'up' ? '' : `mk-reveal-${direction}`;

  return (
    <Tag
      ref={ref}
      className={`mk-reveal ${armed ? 'mk-reveal-armed' : ''} ${dirClass} ${shown ? 'is-in' : ''} ${className}`}
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

    const runCountUp = () => {
      if (started.current) return;
      started.current = true;
      let t0 = 0;
      const step = (ts: number) => {
        if (!t0) t0 = ts;
        const p = Math.min((ts - t0) / duration, 1);
        setValue(Math.round((1 - Math.pow(1 - p, 3)) * target));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started.current) return;
        obs.disconnect();
        runCountUp();
      },
      { threshold: 0.4 },
    );
    obs.observe(el);

    // Safety net: if the observer never fires, still show the final value so
    // the number never stays stuck at 0.
    const failSafe = window.setTimeout(() => {
      if (started.current) return;
      obs.disconnect();
      setValue(target);
      started.current = true;
    }, 1600);

    return () => {
      obs.disconnect();
      window.clearTimeout(failSafe);
    };
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
  // The magnetic pull is applied by writing to the element's style directly
  // inside a requestAnimationFrame, not through React state. mousemove fires
  // far more often than the browser paints, so coalescing to one write per
  // frame caps the work at ~60fps and avoids a React re-render per event.
  const frame = useRef<number | null>(null);
  const nextOffset = useRef({ x: 0, y: 0 });

  const applyOffset = useCallback((x: number, y: number) => {
    const el = ref.current;
    if (!el) return;
    const resting = x === 0 && y === 0;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.transition = resting
      ? 'transform 0.4s cubic-bezier(0.16,1,0.3,1)'
      : 'transform 0.15s ease-out';
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      nextOffset.current = {
        x: (e.clientX - cx) * intensity,
        y: (e.clientY - cy) * intensity,
      };
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        applyOffset(nextOffset.current.x, nextOffset.current.y);
      });
    },
    [intensity, applyOffset],
  );

  const handleMouseLeave = useCallback(() => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    nextOffset.current = { x: 0, y: 0 };
    applyOffset(0, 0);
  }, [applyOffset]);

  // Cancel any pending frame if the component unmounts mid-gesture.
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <Tag
      ref={ref}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transform: 'translate(0px, 0px)', transition: 'transform 0.4s cubic-bezier(0.16,1,0.3,1)' }}
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

  // mousemove fires per pixel of travel; without throttling each event would
  // trigger two setState calls (tilt + glare) and a re-render. Coalesce the
  // latest values into a ref and flush at most once per animation frame.
  const frame = useRef<number | null>(null);
  const pending = useRef<{
    style: React.CSSProperties;
    glare: { x: number; y: number; opacity: number };
  } | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    if (!pending.current) return;
    setStyle(pending.current.style);
    setGlarePos(pending.current.glare);
    pending.current = null;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotateX = (0.5 - y) * intensity;
      const rotateY = (x - 0.5) * intensity;
      pending.current = {
        style: {
          transform: `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02,1.02,1.02)`,
        },
        glare: { x: x * 100, y: y * 100, opacity: 0.15 },
      };
      if (frame.current == null) frame.current = requestAnimationFrame(flush);
    },
    [intensity, flush],
  );

  const handleMouseLeave = useCallback(() => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = null;
    setStyle({});
    setGlarePos({ x: 50, y: 50, opacity: 0 });
  }, []);

  // Cancel any pending frame if the component unmounts mid-gesture.
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

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
  // Server-rendered / no-JS markup stays visible; the fade-in animation only
  // engages once JS has armed it. A hydration failure keeps words readable.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    setArmed(true);

    // Reduced-motion or already-visible-at-mount: reveal on first client paint.
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      el.getBoundingClientRect().top < window.innerHeight
    ) {
      setShown(true);
      return;
    }

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

    // Safety net so words can never stay invisible if the observer never fires.
    const failSafe = window.setTimeout(() => setShown(true), 1200);

    return () => {
      obs.disconnect();
      window.clearTimeout(failSafe);
    };
  }, []);

  const words = text.split(' ');

  return (
    <span ref={ref} className={className} aria-label={text}>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          className={`mk-stagger-word inline-block ${armed ? 'mk-stagger-armed' : ''}`}
          style={{
            animationDelay: shown ? `${startDelay + i * wordDelay}ms` : undefined,
            opacity: armed && !shown ? 0 : undefined,
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

'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { ArrowDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  threshold?: number;
}

export function PullToRefresh({ onRefresh, children, className, disabled = false, threshold = 80 }: PullToRefreshProps) {
  const startY = useRef(0);
  const currentY = useRef(0);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const handleStart = useCallback((clientY: number) => {
    if (disabled || isRefreshing) return;
    const scrollTop = containerRef.current?.scrollTop ?? 0;
    if (scrollTop > 0) return;
    startY.current = clientY;
    currentY.current = clientY;
    isDragging.current = true;
    setIsComplete(false);
  }, [disabled, isRefreshing]);

  const handleMove = useCallback((clientY: number) => {
    if (!isDragging.current || disabled || isRefreshing) return;
    const deltaY = clientY - startY.current;
    if (deltaY <= 0) return;

    currentY.current = clientY;
    const resistance = deltaY > threshold ? 0.2 : 0.5;
    setPullDistance(deltaY * resistance);
  }, [disabled, isRefreshing, threshold]);

  const handleEnd = useCallback(async () => {
    if (!isDragging.current || disabled) return;
    isDragging.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold);
      try {
        await onRefresh();
        setIsComplete(true);
        setTimeout(() => {
          setIsRefreshing(false);
          setIsComplete(false);
          setPullDistance(0);
        }, 600);
      } catch {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [disabled, isRefreshing, pullDistance, threshold, onRefresh]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    handleStart(e.touches[0]?.clientY ?? 0);
  }, [handleStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    handleMove(e.touches[0]?.clientY ?? 0);
  }, [handleMove]);

  const onTouchEnd = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleGlobalEnd = () => {
        if (isDragging.current) handleEnd();
      };
      window.addEventListener('touchend', handleGlobalEnd);
      return () => window.removeEventListener('touchend', handleGlobalEnd);
    }
  }, [handleEnd]);

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 180;

  return (
    <div className={cn('relative', className)}>
      {/* Pull indicator */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center transition-opacity duration-200"
        style={{
          top: `-${Math.max(0, pullDistance)}px`,
          height: `${Math.max(0, pullDistance)}px`,
          opacity: pullDistance > 10 ? 1 : 0,
        }}
      >
        <div className="flex flex-col items-center gap-1">
          {isComplete ? (
            <Check className="w-5 h-5 text-emerald-500 animate-in zoom-in duration-200" />
          ) : isRefreshing ? (
            <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowDown
              className="w-5 h-5 text-muted-foreground transition-transform"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          )}
          {!isRefreshing && !isComplete && pullDistance > 10 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        className="overflow-y-auto"
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.3s ease-out',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default PullToRefresh;

'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface SwipeAction {
  label: string;
  icon?: React.ReactNode;
  color: string;
  bg: string;
  width?: number;
  onClick: () => void;
}

interface SwipeableProps {
  children: React.ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  className?: string;
  disabled?: boolean;
}

const SWIPE_THRESHOLD = 60;
const MAX_SWIPE = 160;

export function Swipeable({ children, leftActions = [], rightActions = [], onSwipeLeft, onSwipeRight, className, disabled = false }: SwipeableProps) {
  const startX = useRef(0);
  const currentX = useRef(0);
  const isDragging = useRef(false);
  const isSwiping = useRef(false);
  const [offset, setOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const allActions = [...leftActions.map((a: SwipeAction, i: number) => ({ ...a, side: 'left' as const, index: i })), ...rightActions.map((a: SwipeAction, i: number) => ({ ...a, side: 'right' as const, index: i }))];

  const resetPosition = useCallback((animate = true) => {
    setIsAnimating(animate);
    setOffset(0);
    setActiveAction(null);
    if (animate) {
      setTimeout(() => setIsAnimating(false), 300);
    }
  }, []);

  const handleStart = useCallback((clientX: number) => {
    if (disabled) return;
    startX.current = clientX;
    currentX.current = clientX;
    isDragging.current = true;
    isSwiping.current = false;
    setIsAnimating(false);
  }, [disabled]);

  const handleMove = useCallback((clientX: number) => {
    if (!isDragging.current || disabled) return;
    const deltaX = clientX - startX.current;
    currentX.current = clientX;

    const hasLeftActions = leftActions.length > 0;
    const hasRightActions = rightActions.length > 0;

    if ((deltaX > 0 && !hasLeftActions) || (deltaX < 0 && !hasRightActions)) return;

    if (Math.abs(deltaX) > 10) {
      isSwiping.current = true;
    }

    const resistance = Math.abs(deltaX) > MAX_SWIPE ? 0.3 : 1;
    const newOffset = deltaX * resistance;

    if ((newOffset > 0 && !hasLeftActions) || (newOffset < 0 && !hasRightActions)) return;

    const clampedOffset = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, newOffset));
    setOffset(clampedOffset);

    const actions = clampedOffset > 0 ? leftActions : rightActions;
    const absOffset = Math.abs(clampedOffset);
    let cumulativeWidth = 0;
    let foundAction: string | null = null;
    for (const action of actions) {
      cumulativeWidth += action.width || 80;
      if (absOffset >= cumulativeWidth * 0.5) {
        foundAction = action.label;
      }
    }
    setActiveAction(foundAction);
  }, [disabled, leftActions, rightActions]);

  const handleEnd = useCallback(() => {
    if (!isDragging.current || disabled) return;
    isDragging.current = false;

    const deltaX = currentX.current - startX.current;
    const absDelta = Math.abs(deltaX);

    if (absDelta < SWIPE_THRESHOLD) {
      resetPosition(true);
      return;
    }

    if (deltaX > 0 && leftActions.length > 0) {
      const firstAction = leftActions[0];
      if (firstAction && absDelta >= (firstAction.width || 80)) {
        firstAction.onClick();
        resetPosition(true);
        onSwipeLeft?.();
        return;
      }
    }

    if (deltaX < 0 && rightActions.length > 0) {
      const firstAction = rightActions[0];
      if (firstAction && absDelta >= (firstAction.width || 80)) {
        firstAction.onClick();
        resetPosition(true);
        onSwipeRight?.();
        return;
      }
    }

    resetPosition(true);
  }, [disabled, leftActions, rightActions, onSwipeLeft, onSwipeRight, resetPosition]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    handleStart(e.touches[0]?.clientX ?? 0);
  }, [handleStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (isSwiping.current) {
      e.preventDefault();
    }
    handleMove(e.touches[0]?.clientX ?? 0);
  }, [handleMove]);

  const onTouchEnd = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    handleStart(e.clientX);
  }, [handleStart]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    handleMove(e.clientX);
  }, [handleMove]);

  const onMouseUp = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  const onMouseLeave = useCallback(() => {
    if (isDragging.current) {
      handleEnd();
    }
  }, [handleEnd]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleGlobalMouseUp = () => {
        if (isDragging.current) handleEnd();
      };
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [handleEnd]);

  const renderActions = (actions: SwipeAction[], side: 'left' | 'right') => {
    const isLeft = side === 'left';
    const offsetValue = isLeft ? Math.max(0, offset) : Math.abs(Math.min(0, offset));

    return (
      <div
        className={cn('absolute top-0 bottom-0 flex', isLeft ? 'left-0 -translate-x-full' : 'right-0 translate-x-full')}
        style={{ width: `${Math.min(offsetValue, MAX_SWIPE)}px` }}
      >
        {actions.map((action, _index) => {
          const width = action.width || 80;
          const isActive = activeAction === action.label;
          return (
            <div
              key={action.label}
              className={cn(
                'flex flex-col items-center justify-center shrink-0 transition-colors',
                action.bg,
                isActive && 'brightness-110'
              )}
              style={{ width: `${width}px` }}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
                resetPosition(true);
              }}
            >
              {action.icon && (
                <div className={cn('w-5 h-5 mb-0.5', action.color)}>
                  {action.icon}
                </div>
              )}
              <span className={cn('text-[10px] font-semibold truncate px-1', action.color)}>
                {action.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden touch-none', className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {renderActions(leftActions, 'left')}
      {renderActions(rightActions, 'right')}
      <div
        className={cn('transition-transform', isAnimating && 'duration-300 ease-out')}
        style={{
          transform: `translateX(${offset}px)`,
          touchAction: 'pan-y',
          userSelect: 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default Swipeable;

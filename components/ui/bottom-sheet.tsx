'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}

export function BottomSheet({ open, onOpenChange, title, children, className, maxHeight = '90vh' }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const isDragging = useRef(false);
  const [translateY, setTranslateY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!open) {
      setTranslateY(0);
      setIsClosing(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const close = useCallback(() => {
    setIsClosing(true);
    setTranslateY(window.innerHeight);
    setTimeout(() => {
      onOpenChange(false);
      setIsClosing(false);
      setTranslateY(0);
    }, 300);
  }, [onOpenChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    const dragHandle = target.closest('[data-drag-handle]');
    if (!dragHandle) return;
    startY.current = e.touches[0]?.clientY ?? 0;
    currentY.current = e.touches[0]?.clientY ?? 0;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const deltaY = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (deltaY < 0) return;
    currentY.current = e.touches[0]?.clientY ?? 0;
    setTranslateY(deltaY);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const deltaY = currentY.current - startY.current;
    if (deltaY > 100) {
      close();
    } else {
      setTranslateY(0);
    }
  }, [close]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      close();
    }
  }, [close]);

  if (!open && !isClosing) return null;

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-200" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={cn(
          'absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300',
          isClosing && 'animate-out slide-out-to-bottom duration-300',
          className
        )}
        style={{
          maxHeight,
          transform: `translateY(${translateY}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        {/* Drag handle */}
        <div
          data-drag-handle
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex items-center justify-center py-3 cursor-grab active:cursor-grabbing"
        >
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-4 pb-3 border-b border-border">
            <h2 className="text-base font-bold">{title}</h2>
            <button
              onClick={close}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto p-4 pb-8" style={{ maxHeight: `calc(${maxHeight} - ${title ? '120px' : '60px'})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default BottomSheet;

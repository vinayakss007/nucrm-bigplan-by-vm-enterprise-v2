'use client';

import React from 'react';
import { clsx } from 'clsx';
import { shadows, borderRadius, colors } from '@/lib/design-tokens';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  hoverable = false,
  padding = 'md',
  onClick,
}) => {
  const baseStyles = clsx(
    'bg-white border rounded-xl transition-all duration-200',
    {
      'hover:shadow-lg cursor-pointer': hoverable,
      'shadow-md': !hoverable,
      'p-3': padding === 'sm',
      'p-4': padding === 'md',
      'p-6': padding === 'lg',
      'p-0': padding === 'none',
    },
    className
  );

  return onClick ? (
    <div className={baseStyles} onClick={onClick}>
      {children}
    </div>
  ) : (
    <div className={baseStyles}>{children}</div>
  );
};

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  children,
  className,
  action,
}) => {
  return (
    <div
      className={clsx(
        'flex items-center justify-between border-b border-gray-200 pb-4 mb-4',
        className
      )}
    >
      {children}
      {action && <div>{action}</div>}
    </div>
  );
};

interface CardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export const CardTitle: React.FC<CardTitleProps> = ({ children, className }) => {
  return (
    <h3
      className={clsx(
        'text-lg font-semibold text-gray-900',
        className
      )}
    >
      {children}
    </h3>
  );
};

interface CardDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export const CardDescription: React.FC<CardDescriptionProps> = ({
  children,
  className,
}) => {
  return (
    <p className={clsx('text-sm text-gray-500 mt-1', className)}>
      {children}
    </p>
  );
};

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

export const CardContent: React.FC<CardContentProps> = ({
  children,
  className,
}) => {
  return <div className={clsx('', className)}>{children}</div>;
};

interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export const CardFooter: React.FC<CardFooterProps> = ({
  children,
  className,
}) => {
  return (
    <div
      className={clsx(
        'border-t border-gray-200 pt-4 mt-4',
        className
      )}
    >
      {children}
    </div>
  );
};

export default Card;

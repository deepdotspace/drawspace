import React, { type ReactNode, type JSX } from 'react'

import { cn } from './utils'

// ============================================================================
// Skeleton - Base skeleton component (shadcn-compatible)
// ============================================================================

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-primary/10', className)}
      {...props}
    />
  )
}

// ============================================================================
// SkeletonText - Text line skeleton
// ============================================================================

interface SkeletonTextProps {
  lines?: number
  lastLineWidth?: string
  className?: string
}

function SkeletonText({
  lines = 3,
  lastLineWidth = '60%',
  className = '',
}: SkeletonTextProps): JSX.Element {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: i === lines - 1 ? lastLineWidth : '100%' }}
        />
      ))}
    </div>
  )
}

// ============================================================================
// SkeletonCard - Card skeleton
// ============================================================================

interface SkeletonCardProps {
  hasImage?: boolean
  className?: string
}

function SkeletonCard({ hasImage = false, className = '' }: SkeletonCardProps): JSX.Element {
  return (
    <div className={cn('border border-border rounded-lg overflow-hidden', className)}>
      {hasImage && <Skeleton className="w-full h-32 rounded-none" />}
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <SkeletonText lines={2} />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}

// ============================================================================
// SkeletonList - List skeleton
// ============================================================================

interface SkeletonListProps {
  items?: number
  className?: string
}

function SkeletonList({ items = 5, className = '' }: SkeletonListProps): JSX.Element {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="w-16 h-6" />
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// SkeletonTable - Table skeleton
// ============================================================================

interface SkeletonTableProps {
  rows?: number
  columns?: number
  className?: string
}

function SkeletonTable({
  rows = 5,
  columns = 4,
  className = '',
}: SkeletonTableProps): JSX.Element {
  return (
    <div className={cn('border border-border rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div className="flex gap-4 p-4 bg-muted/50 border-b border-border">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 p-4 border-b border-border last:border-0">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              className="h-4 flex-1"
              style={{ width: colIndex === 0 ? '40%' : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// SkeletonAvatar - Avatar skeleton
// ============================================================================

interface SkeletonAvatarProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function SkeletonAvatar({ size = 'md', className = '' }: SkeletonAvatarProps): JSX.Element {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  }

  return <Skeleton className={cn(sizes[size], 'rounded-full', className)} />
}

// ============================================================================
// LoadingSpinner - Simple spinner
// ============================================================================

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps): JSX.Element {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }

  return (
    <div
      className={cn(sizes[size], 'border-2 border-muted border-t-primary rounded-full animate-spin', className)}
    />
  )
}

// ============================================================================
// LoadingOverlay - Full-page or container loading
// ============================================================================

interface LoadingOverlayProps {
  children?: ReactNode
  message?: string
  className?: string
}

function LoadingOverlay({
  children,
  message,
  className = '',
}: LoadingOverlayProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16', className)}>
      <LoadingSpinner size="lg" />
      {message && <p className="mt-4 text-muted-foreground">{message}</p>}
      {children}
    </div>
  )
}

export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonList,
  SkeletonTable,
  SkeletonAvatar,
  LoadingSpinner,
  LoadingOverlay,
}

import React, { ReactNode, JSX } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from './utils'

// ============================================================================
// CardGrid - Responsive grid container
// ============================================================================

interface CardGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  columns?: 1 | 2 | 3 | 4
}

export function CardGrid({ children, columns = 3, className = '', ...rest }: CardGridProps): JSX.Element {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  }

  return (
    <div className={cn('grid gap-3 sm:gap-4', gridCols[columns], className)} {...rest}>
      {children}
    </div>
  )
}

// ============================================================================
// GridCard - Base card component (named GridCard to avoid conflict with shadcn Card)
// ============================================================================

interface GridCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  onClick?: () => void
  hoverable?: boolean
}

export function GridCard({ children, onClick, className = '', hoverable = true, ...rest }: GridCardProps): JSX.Element {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative bg-card rounded-xl border border-border overflow-hidden transition-all duration-200',
        // Literal shadow rather than shadow-card-hover token. See
        // Card.tsx + docs/platform/theming-shadows.md.
        hoverable && 'hover:border-border hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.10)] hover:-translate-y-0.5',
        onClick && 'cursor-pointer',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

// ============================================================================
// GridCard.Image - Optional image header
// ============================================================================

interface GridCardImageProps {
  src: string
  alt?: string
  height?: 'sm' | 'md' | 'lg'
  className?: string
}

function GridCardImage({ src, alt = '', height = 'md', className = '' }: GridCardImageProps): JSX.Element {
  const heights = {
    sm: 'h-24',
    md: 'h-36',
    lg: 'h-48',
  }

  return (
    <div className={cn(heights[height], 'overflow-hidden bg-muted', className)}>
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    </div>
  )
}

// ============================================================================
// GridCard.Header - Title area with optional actions
// ============================================================================

interface GridCardHeaderProps {
  children: ReactNode
  actions?: ReactNode
  className?: string
}

function GridCardHeader({ children, actions, className = '' }: GridCardHeaderProps): JSX.Element {
  return (
    <div className={cn('flex items-start justify-between gap-2 p-4 pb-2', className)}>
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// GridCard.Title
// ============================================================================

interface GridCardTitleProps {
  children: ReactNode
  className?: string
}

function GridCardTitle({ children, className = '' }: GridCardTitleProps): JSX.Element {
  return (
    <h3 className={cn('font-semibold text-foreground truncate', className)}>
      {children}
    </h3>
  )
}

// ============================================================================
// GridCard.Content - Main content area
// ============================================================================

interface GridCardContentProps {
  children: ReactNode
  className?: string
}

function GridCardContent({ children, className = '' }: GridCardContentProps): JSX.Element {
  return (
    <div className={cn('px-4 pb-4', className)}>
      {children}
    </div>
  )
}

// ============================================================================
// GridCard.Description - Muted text with line clamp
// ============================================================================

interface GridCardDescriptionProps {
  children: ReactNode
  lines?: 1 | 2 | 3 | 4
  className?: string
}

function GridCardDescription({ children, lines = 2, className = '' }: GridCardDescriptionProps): JSX.Element {
  const lineClamp = {
    1: 'line-clamp-1',
    2: 'line-clamp-2',
    3: 'line-clamp-3',
    4: 'line-clamp-4',
  }

  return (
    <p className={cn('text-sm text-muted-foreground leading-relaxed', lineClamp[lines], className)}>
      {children}
    </p>
  )
}

// ============================================================================
// GridCard.Footer - Bottom area for meta info
// ============================================================================

interface GridCardFooterProps {
  children: ReactNode
  className?: string
}

function GridCardFooter({ children, className = '' }: GridCardFooterProps): JSX.Element {
  return (
    <div className={cn('px-4 pb-4 pt-2 text-xs text-muted-foreground', className)}>
      {children}
    </div>
  )
}

// ============================================================================
// GridCard.Badge - Status badge
// ============================================================================

interface GridCardBadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}

function GridCardBadge({ children, variant = 'default', className = '' }: GridCardBadgeProps): JSX.Element {
  const variants = {
    default: 'bg-muted text-muted-foreground border-border',
    success: 'bg-success/20 text-success border-success/40',
    warning: 'bg-warning/20 text-warning border-warning/40',
    danger: 'bg-destructive/20 text-destructive border-destructive/40',
  }

  return (
    <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded border', variants[variant], className)}>
      {children}
    </span>
  )
}

// ============================================================================
// GridCard.Actions - Common action buttons
// ============================================================================

interface GridCardActionsProps {
  onDelete?: () => void
  onMore?: () => void
}

function GridCardActions({ onDelete, onMore }: GridCardActionsProps): JSX.Element {
  const handleClick = (e: React.MouseEvent, handler?: () => void): void => {
    e.stopPropagation()
    handler?.()
  }

  return (
    <div className="flex items-center gap-1">
      {onMore && (
        <button
          onClick={(e) => handleClick(e, onMore)}
          className="p-2 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => handleClick(e, onDelete)}
          className="p-2 rounded-lg bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// ============================================================================
// Attach sub-components
// ============================================================================

GridCard.Image = GridCardImage
GridCard.Header = GridCardHeader
GridCard.Title = GridCardTitle
GridCard.Content = GridCardContent
GridCard.Description = GridCardDescription
GridCard.Footer = GridCardFooter
GridCard.Badge = GridCardBadge
GridCard.Actions = GridCardActions

export default GridCard

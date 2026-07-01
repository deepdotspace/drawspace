import React, { ReactNode, JSX } from 'react'
import { FileText, Search, Inbox, Plus, FolderOpen, Users, AlertCircle } from 'lucide-react'
import { cn } from './utils'

// ============================================================================
// EmptyState - Customizable empty state component
// ============================================================================

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
  ...rest
}: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)} {...rest}>
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center mb-5">
          <span className="text-muted-foreground">{icon}</span>
        </div>
      )}
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-muted-foreground text-sm max-w-sm mb-6">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <button
              onClick={action.onClick}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 shadow-lg shadow-primary/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Pre-built empty state variants
// ============================================================================

interface EmptyStateVariantProps {
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyItems({ action, className }: EmptyStateVariantProps): JSX.Element {
  return (
    <EmptyState
      icon={<Inbox className="w-8 h-8" />}
      title="No items yet"
      description="Get started by creating your first item."
      action={action ? { label: action.label, onClick: action.onClick } : undefined}
      className={className}
    />
  )
}

interface EmptySearchProps extends EmptyStateVariantProps {
  query?: string
  onClear?: () => void
}

export function EmptySearch({ query, onClear, className }: EmptySearchProps): JSX.Element {
  return (
    <EmptyState
      icon={<Search className="w-8 h-8" />}
      title="No results found"
      description={query ? `No results for "${query}". Try a different search term.` : 'Try adjusting your search or filters.'}
      secondaryAction={onClear ? { label: 'Clear search', onClick: onClear } : undefined}
      className={className}
    />
  )
}

export function EmptyDocuments({ action, className }: EmptyStateVariantProps): JSX.Element {
  return (
    <EmptyState
      icon={<FileText className="w-8 h-8" />}
      title="No documents"
      description="Create a document to start writing."
      action={action ? { label: action.label, onClick: action.onClick } : undefined}
      className={className}
    />
  )
}

export function EmptyProjects({ action, className }: EmptyStateVariantProps): JSX.Element {
  return (
    <EmptyState
      icon={<FolderOpen className="w-8 h-8" />}
      title="No projects"
      description="Create a project to organize your work."
      action={action ? { label: action.label, onClick: action.onClick } : undefined}
      className={className}
    />
  )
}

export function EmptyTeam({ action, className }: EmptyStateVariantProps): JSX.Element {
  return (
    <EmptyState
      icon={<Users className="w-8 h-8" />}
      title="No team members"
      description="Invite people to collaborate with you."
      action={action ? { label: action.label, onClick: action.onClick } : undefined}
      className={className}
    />
  )
}

interface EmptyErrorProps extends EmptyStateVariantProps {
  error?: string
  onRetry?: () => void
}

export function EmptyError({ error, onRetry, className }: EmptyErrorProps): JSX.Element {
  return (
    <EmptyState
      icon={<AlertCircle className="w-8 h-8 text-destructive" />}
      title="Something went wrong"
      description={error || 'An error occurred. Please try again.'}
      action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
      className={className}
    />
  )
}

export default EmptyState

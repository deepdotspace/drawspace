/**
 * UI Components — shadcn/ui-based component library.
 *
 * @example
 * import { Button, Dialog, Badge, Input, useToast } from '../components/ui'
 */

/* Utility */
export { cn } from './utils'

/* Layout */
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from './Card'
export { Separator } from './Separator'
export {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption,
} from './Table'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs'

/* Form */
export { Button, buttonVariants } from './Button'
export type { ButtonProps } from './Button'
export { Input } from './Input'
export { Textarea } from './Textarea'
export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectLabel, SelectItem, SelectSeparator,
} from './Select'
export { Checkbox } from './Checkbox'
export { Switch } from './Switch'
export { Label } from './Label'

/* Data Display */
export { Badge, badgeVariants } from './Badge'
export type { BadgeProps } from './Badge'
export { Avatar, AvatarImage, AvatarFallback } from './Avatar'
export { Progress } from './Progress'
export {
  Skeleton, SkeletonText, SkeletonCard, SkeletonList, SkeletonTable, SkeletonAvatar,
  LoadingSpinner, LoadingOverlay,
} from './Skeleton'
export { CardGrid, GridCard } from './CardGrid'

/* Feedback */
export { Alert, AlertTitle, AlertDescription } from './Alert'
export { ToastProvider, useToast } from './Toast'
export { ErrorScreen, decodeReactError } from './ErrorBoundary'
export type { ErrorScreenProps, DecodedReactError } from './ErrorBoundary'
export {
  EmptyState, EmptyItems, EmptySearch, EmptyDocuments, EmptyProjects, EmptyTeam, EmptyError,
} from './EmptyState'

/* Overlay */
export {
  Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from './Dialog'
export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuGroup,
  DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuRadioGroup,
} from './DropdownMenu'
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './Tooltip'

/* Custom Wrappers */
export { Modal, ConfirmModal } from './Modal'
export { SearchInput } from './SearchInput'

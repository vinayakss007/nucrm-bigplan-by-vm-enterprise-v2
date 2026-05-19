"use client"

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
} from '@radix-ui/react-dialog'
import {
  LayoutDashboard,
  Users,
  Building2,
  TrendingUp,
  CheckSquare,
  Calendar,
  FileBarChart,
  BarChart3,
  Zap,
  Search,
  Plus,
  FileText,
  Settings,
  Mail,
  Bell,
  FolderOpen,
  Trash2,
  Crown,
  Globe,
  Keyboard,
  X,
  ChevronRight,
  Star,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface CommandItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  shortcut?: string
  onClick: () => void
  category: 'navigation' | 'create' | 'settings' | 'help'
  keywords?: string[]
  permission?: string
}

interface RecentItem {
  id: string
  label: string
  href: string
  timestamp: number
}

// Navigation items
const NAVIGATION_ITEMS: CommandItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    onClick: () => window.location.href = '/tenant/dashboard',
    category: 'navigation',
    keywords: ['home', 'overview', 'stats'],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    icon: Users,
    onClick: () => window.location.href = '/tenant/contacts',
    category: 'navigation',
    keywords: ['people', 'leads', 'customers'],
  },
  {
    id: 'companies',
    label: 'Companies',
    icon: Building2,
    onClick: () => window.location.href = '/tenant/companies',
    category: 'navigation',
    keywords: ['organizations', 'accounts', 'businesses'],
  },
  {
    id: 'deals',
    label: 'Deals',
    icon: TrendingUp,
    onClick: () => window.location.href = '/tenant/deals',
    category: 'navigation',
    keywords: ['opportunities', 'pipeline', 'sales'],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: CheckSquare,
    onClick: () => window.location.href = '/tenant/tasks',
    category: 'navigation',
    keywords: ['todos', 'follow-ups', 'reminders'],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: Calendar,
    onClick: () => window.location.href = '/tenant/calendar',
    category: 'navigation',
    keywords: ['meetings', 'schedule', 'events'],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    onClick: () => window.location.href = '/tenant/reports',
    category: 'navigation',
    keywords: ['analytics', 'data', 'export'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    onClick: () => window.location.href = '/tenant/analytics',
    category: 'navigation',
    keywords: ['charts', 'graphs', 'metrics'],
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: Zap,
    onClick: () => window.location.href = '/tenant/automation',
    category: 'navigation',
    keywords: ['workflows', 'triggers', 'actions'],
  },
  {
    id: 'forms',
    label: 'Forms',
    icon: FileText,
    onClick: () => window.location.href = '/tenant/forms',
    category: 'navigation',
    keywords: ['lead capture', 'landing pages'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    onClick: () => window.location.href = '/tenant/notifications',
    category: 'navigation',
    keywords: ['alerts', 'messages'],
  },
  {
    id: 'modules',
    label: 'Modules',
    icon: Zap,
    onClick: () => window.location.href = '/tenant/modules',
    category: 'navigation',
    keywords: ['integrations', 'addons', 'plugins'],
  },
  {
    id: 'trash',
    label: 'Trash',
    icon: Trash2,
    onClick: () => window.location.href = '/tenant/trash',
    category: 'navigation',
    keywords: ['deleted', 'recycle bin'],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    onClick: () => window.location.href = '/tenant/settings/general',
    category: 'navigation',
    keywords: ['preferences', 'configuration'],
  },
  {
    id: 'superadmin',
    label: 'Super Admin',
    icon: Crown,
    onClick: () => window.location.href = '/superadmin/dashboard',
    category: 'navigation',
    keywords: ['admin', 'platform'],
    permission: 'is_super_admin',
  },
]

// Create actions
const CREATE_ITEMS: CommandItem[] = [
  {
    id: 'new-contact',
    label: 'New Contact',
    icon: Plus,
    shortcut: 'N C',
    onClick: () => window.location.href = '/tenant/contacts?action=create',
    category: 'create',
    keywords: ['add', 'person', 'lead'],
  },
  {
    id: 'new-deal',
    label: 'New Deal',
    icon: TrendingUp,
    shortcut: 'N D',
    onClick: () => window.location.href = '/tenant/deals?action=create',
    category: 'create',
    keywords: ['add', 'opportunity'],
  },
  {
    id: 'new-company',
    label: 'New Company',
    icon: Building2,
    shortcut: 'N M',
    onClick: () => window.location.href = '/tenant/companies?action=create',
    category: 'create',
    keywords: ['add', 'organization', 'account'],
  },
  {
    id: 'new-task',
    label: 'New Task',
    icon: CheckSquare,
    shortcut: 'N T',
    onClick: () => window.location.href = '/tenant/tasks?action=create',
    category: 'create',
    keywords: ['add', 'todo', 'follow-up'],
  },
  {
    id: 'new-meeting',
    label: 'New Meeting',
    icon: Calendar,
    shortcut: 'N E',
    onClick: () => window.location.href = '/tenant/calendar?action=create',
    category: 'create',
    keywords: ['schedule', 'event', 'call'],
  },
  {
    id: 'import-contacts',
    label: 'Import Contacts',
    icon: FolderOpen,
    onClick: () => window.dispatchEvent(new CustomEvent('open-import-modal')),
    category: 'create',
    keywords: ['csv', 'upload', 'bulk'],
  },
]

// Keyboard shortcuts
const SHORTCUT_ITEMS: CommandItem[] = [
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    icon: Keyboard,
    shortcut: '?',
    onClick: () => window.dispatchEvent(new CustomEvent('open-shortcuts-modal')),
    category: 'help',
    keywords: ['hotkeys', 'keys', 'commands'],
  },
]

// Simple fuzzy search
function fuzzyMatch(query: string, text: string): boolean {
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  
  // Exact match
  if (textLower.includes(queryLower)) return true
  
  // Fuzzy match
  let queryIndex = 0
  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      queryIndex++
    }
  }
  return queryIndex === queryLower.length
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const router = useRouter()

  // Load recent items from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nucrm_recent_items')
      if (saved) {
        setRecentItems(JSON.parse(saved))
      }
    } catch {}
  }, [])

  // Save recent item
  const saveRecent = useCallback((item: CommandItem) => {
    const newRecent: RecentItem = {
      id: item.id,
      label: item.label,
      href: '', // Will be set based on item
      timestamp: Date.now(),
    }
    
    // Extract href from onClick by matching known patterns
    const onClickStr = item.onClick.toString()
    const hrefMatch = onClickStr.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/)
    if (hrefMatch) {
      newRecent.href = hrefMatch[1] || ''
    }
    
    const updated = [newRecent, ...recentItems.filter(r => r.id !== item.id)].slice(0, 5)
    setRecentItems(updated)
    try {
      localStorage.setItem('nucrm_recent_items', JSON.stringify(updated))
    } catch {}
  }, [recentItems])

  // Filter and search items
  const filteredItems = useMemo(() => {
    if (!search.trim()) {
      return []
    }

    const allItems = [...NAVIGATION_ITEMS.filter(i => !i.permission || i.permission === 'is_super_admin'), ...CREATE_ITEMS]
    
    return allItems.filter(item => {
      // Search in label
      if (fuzzyMatch(search, item.label)) return true
      // Search in keywords
      if (item.keywords?.some(keyword => fuzzyMatch(search, keyword))) return true
      return false
    }).slice(0, 10) // Limit results
  }, [search])

  // Group items by category
  const groupedItems = useMemo(() => {
    if (search.trim()) {
      return { results: filteredItems }
    }

    const groups: Record<string, CommandItem[]> = {}

    if (recentItems.length > 0) {
      groups['recents'] = recentItems.map(r => ({
        id: r.id,
        label: r.label,
        icon: NAVIGATION_ITEMS.find(i => i.id === r.id)?.icon || Globe,
        onClick: () => {
          if (r.href) {
            window.location.href = r.href
          }
          onOpenChange(false)
        },
        category: 'navigation' as const,
      }))
    }

    groups['navigation'] = NAVIGATION_ITEMS.filter(i => !i.permission || i.permission === 'is_super_admin')
    groups['create'] = CREATE_ITEMS

    return groups
  }, [search, filteredItems, recentItems, onOpenChange])

  // Flatten for keyboard navigation
  const allVisibleItems = useMemo(() => {
    return Object.values(groupedItems).flat()
  }, [groupedItems])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % allVisibleItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + allVisibleItems.length) % allVisibleItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selectedItem = allVisibleItems[selectedIndex]
        if (selectedItem) {
          saveRecent(selectedItem)
          selectedItem.onClick()
          onOpenChange(false)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, selectedIndex, allVisibleItems, saveRecent, onOpenChange])

  // Global keyboard shortcut (⌘K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onOpenChange(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange])

  // Reset search and selection when opening
  useEffect(() => {
    if (open) {
      setSearch('')
      setSelectedIndex(0)
    }
  }, [open])

  const CategoryHeader = ({ label, icon: Icon }: { label: string; icon: React.ComponentType<{ className?: string }> }) => (
    <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
      <Icon className="w-3 h-3" />
      {label}
    </div>
  )

  const CommandItemRow = ({ item, index }: { item: CommandItem; index: number }) => {
    const Icon = item.icon
    const isSelected = index === selectedIndex

    return (
      <button
        key={item.id}
        onClick={() => {
          saveRecent(item)
          item.onClick()
          onOpenChange(false)
        }}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
          isSelected
            ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400'
            : 'hover:bg-muted text-foreground'
        )}
      >
        <Icon className={cn('w-4 h-4 shrink-0', isSelected ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground')} />
        <span className="flex-1 text-left truncate">{item.label}</span>
        {item.shortcut && (
          <Badge variant="secondary" className="text-xs h-5 px-1.5">
            {item.shortcut}
          </Badge>
        )}
        {isSelected && <ChevronRight className="w-3 h-3 text-violet-600 dark:text-violet-400" />}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <DialogContent className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
          <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="w-5 h-5 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a command or search..."
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-muted-foreground/30 bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[300px] overflow-y-auto p-2 scrollbar-thin">
              {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category} className="mb-2">
                  {category === 'recents' && (
                    <CategoryHeader label="Recent" icon={Clock} />
                  )}
                  {category === 'navigation' && !search && (
                    <CategoryHeader label="Navigation" icon={Globe} />
                  )}
                  {category === 'create' && !search && (
                    <CategoryHeader label="Create" icon={Plus} />
                  )}
                  {category === 'results' && search && (
                    <CategoryHeader label="Results" icon={Search} />
                  )}
                  <div className="space-y-0.5">
                    {items.map((item, index) => {
                      const globalIndex = allVisibleItems.indexOf(item)
                      return <CommandItemRow key={item.id} item={item} index={globalIndex} />
                    })}
                  </div>
                </div>
              ))}

              {search && filteredItems.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No results found</p>
                  <p className="text-xs mt-1">Try searching for &quot;contacts&quot;, &quot;deals&quot;, etc.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <kbd className="h-4 w-4 rounded border border-muted-foreground/30 bg-muted text-[9px] font-medium flex items-center justify-center">↑</kbd>
                  <kbd className="h-4 w-4 rounded border border-muted-foreground/30 bg-muted text-[9px] font-medium flex items-center justify-center">↓</kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="h-4 px-1 rounded border border-muted-foreground/30 bg-muted text-[9px] font-medium">↵</kbd>
                  to select
                </span>
              </div>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('open-shortcuts-modal'))}
                className="text-xs text-violet-600 hover:underline"
              >
                View all shortcuts
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}

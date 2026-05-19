"use client"

import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
} from '@radix-ui/react-dialog'
import { X, Keyboard, Command, Search, Plus, FileText, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface Shortcut {
  keys: string
  description: string
  category: 'navigation' | 'actions' | 'general'
}

const SHORTCUTS: Shortcut[] = [
  // Global
  { keys: '⌘K', description: 'Open command palette', category: 'general' },
  { keys: '?', description: 'Show keyboard shortcuts', category: 'general' },
  { keys: '⌘/', description: 'Focus search', category: 'general' },
  { keys: 'ESC', description: 'Close modal/dropdown', category: 'general' },
  
  // Navigation
  { keys: 'G D', description: 'Go to Dashboard', category: 'navigation' },
  { keys: 'G C', description: 'Go to Contacts', category: 'navigation' },
  { keys: 'G M', description: 'Go to Companies', category: 'navigation' },
  { keys: 'G P', description: 'Go to Deals (Pipeline)', category: 'navigation' },
  { keys: 'G T', description: 'Go to Tasks', category: 'navigation' },
  { keys: 'G S', description: 'Go to Settings', category: 'navigation' },
  
  // Create
  { keys: 'N C', description: 'New Contact', category: 'actions' },
  { keys: 'N D', description: 'New Deal', category: 'actions' },
  { keys: 'N M', description: 'New Company', category: 'actions' },
  { keys: 'N T', description: 'New Task', category: 'actions' },
  { keys: 'N E', description: 'New Meeting/Event', category: 'actions' },
  
  // Actions
  { keys: '⌘S', description: 'Save current form', category: 'actions' },
  { keys: '⌘Enter', description: 'Submit form', category: 'actions' },
  { keys: '⌘E', description: 'Export to CSV', category: 'actions' },
  { keys: '⌘I', description: 'Import from CSV', category: 'actions' },
  { keys: '⌘⌫', description: 'Delete selected', category: 'actions' },
]

interface ShortcutsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutsModal({ open, onOpenChange }: ShortcutsModalProps) {
  const grouped = {
    general: SHORTCUTS.filter(s => s.category === 'general'),
    navigation: SHORTCUTS.filter(s => s.category === 'navigation'),
    actions: SHORTCUTS.filter(s => s.category === 'actions'),
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <DialogContent className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
          <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                  <Keyboard className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Keyboard Shortcuts</h2>
                  <p className="text-xs text-muted-foreground">Boost your productivity</p>
                </div>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
              {/* General */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Command className="w-3 h-3" />
                  General
                </h3>
                <div className="space-y-2">
                  {grouped.general.map(shortcut => (
                    <div
                      key={shortcut.keys}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <kbd className="inline-flex h-6 items-center gap-1 rounded-md border border-muted-foreground/30 bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                        {shortcut.keys.split(' ').map((key, i) => (
                          <span key={i}>{key}</span>
                        ))}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Search className="w-3 h-3" />
                  Navigation
                </h3>
                <div className="space-y-2">
                  {grouped.navigation.map(shortcut => (
                    <div
                      key={shortcut.keys}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <kbd className="inline-flex h-6 items-center gap-1 rounded-md border border-muted-foreground/30 bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                        {shortcut.keys.split(' ').map((key, i) => (
                          <span key={i}>{key}</span>
                        ))}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Plus className="w-3 h-3" />
                  Actions
                </h3>
                <div className="space-y-2">
                  {grouped.actions.map(shortcut => (
                    <div
                      key={shortcut.keys}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <kbd className="inline-flex h-6 items-center gap-1 rounded-md border border-muted-foreground/30 bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                        {shortcut.keys.split(' ').map((key, i) => (
                          <span key={i}>{key}</span>
                        ))}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border bg-muted/30">
              <p className="text-xs text-muted-foreground text-center">
                💡 Pro tip: Press <kbd className="inline-flex h-4 px-1.5 rounded border border-muted-foreground/30 bg-muted text-[10px] font-medium mx-1">⌘K</kbd> to quickly access any feature
              </p>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}

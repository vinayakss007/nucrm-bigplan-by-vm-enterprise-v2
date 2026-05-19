"use client"

import { useState, useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface DeleteConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  countdownSeconds?: number
  destructive?: boolean
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Confirm Deletion",
  description = "Are you sure you want to delete this item? This action cannot be undone.",
  confirmText = "Delete",
  cancelText = "Cancel",
  countdownSeconds = 5,
  destructive = true,
}: DeleteConfirmProps) {
  const [countdown, setCountdown] = useState(countdownSeconds)
  const [canConfirm, setCanConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      setCountdown(countdownSeconds)
      setCanConfirm(false)
    }
  }, [open, countdownSeconds])

  useEffect(() => {
    if (open && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0) {
      setCanConfirm(true)
    }
  }, [open, countdown])

  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {destructive && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            )}
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-lg bg-muted p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Auto-confirm in</span>
            <span className={`font-mono font-medium ${countdown > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {countdown > 0 ? `${countdown}s` : 'Ready'}
            </span>
          </div>
          {countdown > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/20">
              <div
                className="h-full bg-orange-500 transition-all duration-1000 ease-linear"
                style={{ width: `${((countdownSeconds - countdown) / countdownSeconds) * 100}%` }}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface BulkDeleteConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  count: number
  maxCount?: number
  confirmPlaceholder?: string
}

export function BulkDeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  count,
  maxCount = 100,
  confirmPlaceholder = "DELETE",
}: BulkDeleteConfirmProps) {
  const [typedConfirm, setTypedConfirm] = useState("")

  const isValid = typedConfirm.toUpperCase() === confirmPlaceholder.toUpperCase()
  const isOverLimit = count > maxCount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <DialogTitle>Bulk Delete {count} Items</DialogTitle>
              <DialogDescription className="mt-1">
                This will permanently delete {count} items. This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isOverLimit && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            ⚠️ You are about to delete more than {maxCount} items. Consider breaking this into smaller batches.
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Type <code className="rounded bg-muted px-1">{confirmPlaceholder}</code> to confirm
          </label>
          <input
            type="text"
            value={typedConfirm}
            onChange={(e) => setTypedConfirm(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            placeholder={confirmPlaceholder}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!isValid || isOverLimit}
          >
            Delete {count} Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
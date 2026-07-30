"use client"

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'

const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

// --- Inline Contact Creation ---

interface InlineContactCreateProps {
  onCreated: (contact: { id: string; first_name: string; last_name: string }) => void
}

export function InlineContactCreate({ onCreated }: InlineContactCreateProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/tenant/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name || null,
          email: form.email || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to create contact')
        setSaving(false)
        return
      }
      toast.success('Contact created')
      const newContact = data.data
      onCreated({
        id: newContact.id,
        first_name: newContact.firstName ?? newContact.first_name ?? form.first_name,
        last_name: newContact.lastName ?? newContact.last_name ?? form.last_name,
      })
      setForm({ first_name: '', last_name: '', email: '' })
      setOpen(false)
    } catch {
      toast.error('Failed to create contact')
    }
    setSaving(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700"
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3 h-3 mr-1" />
        Create New
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Contact</DialogTitle>
            <DialogDescription>
              Quickly create a new contact to associate with this deal.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">First Name *</label>
              <input
                value={form.first_name}
                onChange={(e) => setForm(f => ({ ...f, first_name: e.target.value }))}
                required
                className={inp}
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Last Name</label>
              <input
                value={form.last_name}
                onChange={(e) => setForm(f => ({ ...f, last_name: e.target.value }))}
                className={inp}
                placeholder="Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                className={inp}
                placeholder="john@example.com"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Contact'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// --- Inline Company Creation ---

interface InlineCompanyCreateProps {
  onCreated: (company: { id: string; name: string }) => void
}

export function InlineCompanyCreate({ onCreated }: InlineCompanyCreateProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', website: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/tenant/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          website: form.website || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to create company')
        setSaving(false)
        return
      }
      toast.success('Company created')
      const newCompany = data.data
      onCreated({
        id: newCompany.id,
        name: newCompany.name ?? form.name,
      })
      setForm({ name: '', website: '' })
      setOpen(false)
    } catch {
      toast.error('Failed to create company')
    }
    setSaving(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700"
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3 h-3 mr-1" />
        Create New
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Company</DialogTitle>
            <DialogDescription>
              Quickly create a new company to associate with this deal.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Company Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                required
                className={inp}
                placeholder="Acme Inc"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Website</label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm(f => ({ ...f, website: e.target.value }))}
                className={inp}
                placeholder="https://acme.com"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Company'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

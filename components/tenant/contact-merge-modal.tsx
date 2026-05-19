"use client"

import { useState, useCallback } from 'react'
import { X, GitMerge, AlertTriangle, CheckCircle, ArrowRight, User, Mail, Phone, Building } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import toast from 'react-hot-toast'

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  company_name?: string | null
}

interface DuplicatePair {
  contact1: Contact
  contact2: Contact
  matchType: 'exact' | 'email' | 'phone'
}

interface ContactMergeModalProps {
  duplicates: DuplicatePair[]
  loading?: boolean
  onMerge: (primaryId: string, duplicateId: string, strategy: any) => Promise<void>
  onClose: () => void
}

export function ContactMergeModal({ duplicates, loading, onMerge, onClose }: ContactMergeModalProps) {
  const [selectedPair, setSelectedPair] = useState<number | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeStrategy, setMergeStrategy] = useState<Record<string, string>>({
    first_name: 'keep_primary',
    last_name: 'keep_primary',
    email: 'keep_primary',
    phone: 'keep_primary',
    notes: 'keep_primary',
  })

  const handleMerge = async (pairIndex: number) => {
    const pair = duplicates[pairIndex]
    if (!pair) return

    setMerging(true)
    try {
      await onMerge(pair.contact1.id, pair.contact2.id, mergeStrategy)
      toast.success('Contacts merged successfully')
      setSelectedPair(null)
    } catch (error: any) {
      toast.error(error.message || 'Failed to merge contacts')
    }
    setMerging(false)
  }

  const getFieldValue = (contact: Contact, field: string) => {
    return contact[field as keyof Contact] || '—'
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div>
                <Skeleton className="h-5 w-40 mb-1" />
                <Skeleton className="h-4 w-60" />
              </div>
            </div>
            <Skeleton className="w-8 h-8 rounded-lg" />
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (duplicates.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6">
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold mb-1">No Duplicates Found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Great! Your contact list is clean.
            </p>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    )
  }

  const currentPair = selectedPair !== null ? duplicates[selectedPair] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <GitMerge className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-bold">Merge Duplicate Contacts</h2>
              <p className="text-xs text-muted-foreground">
                {duplicates.length} duplicate pair{duplicates.length !== 1 ? 's' : ''} found
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!currentPair ? (
            /* Duplicate List */
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Review each pair carefully before merging. This action cannot be undone.
                </p>
              </div>

              {duplicates.map((pair, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedPair(index)}
                  className="w-full admin-card p-4 hover:border-violet-300 dark:hover:border-violet-700 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex -space-x-2">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold border-2 border-card">
                          {pair.contact1.first_name?.charAt(0) || '?'}
                        </div>
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center text-white text-sm font-bold border-2 border-card">
                          {pair.contact2.first_name?.charAt(0) || '?'}
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {pair.contact1.first_name} {pair.contact1.last_name}
                          </span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {pair.contact2.first_name} {pair.contact2.last_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <Badge variant={pair.matchType === 'exact' ? 'destructive' : pair.matchType === 'email' ? 'default' : 'warning'} className="text-xs">
                            {pair.matchType === 'exact' ? 'Exact Match' : pair.matchType === 'email' ? 'Same Email' : 'Same Phone'}
                          </Badge>
                          {pair.contact1.email === pair.contact2.email && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {pair.contact1.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-violet-600 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Merge Comparison UI */
            <div className="space-y-6">
              <Button variant="ghost" size="sm" onClick={() => setSelectedPair(null)} className="mb-2">
                ← Back to duplicates
              </Button>

              <div className="grid grid-cols-3 gap-4">
                {/* Column Headers */}
                <div className="text-center">
                  <h3 className="text-sm font-bold text-green-600 mb-1">Keep (Primary)</h3>
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center text-white text-xl font-bold mx-auto mb-2">
                    {currentPair.contact1.first_name?.charAt(0) || '?'}
                  </div>
                  <p className="text-sm font-medium">
                    {currentPair.contact1.first_name} {currentPair.contact1.last_name}
                  </p>
                </div>

                <div className="flex items-center justify-center">
                  <GitMerge className="w-8 h-8 text-muted-foreground" />
                </div>

                <div className="text-center">
                  <h3 className="text-sm font-bold text-red-600 mb-1">Merge (Duplicate)</h3>
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center text-white text-xl font-bold mx-auto mb-2">
                    {currentPair.contact2.first_name?.charAt(0) || '?'}
                  </div>
                  <p className="text-sm font-medium">
                    {currentPair.contact2.first_name} {currentPair.contact2.last_name}
                  </p>
                </div>
              </div>

              {/* Field Comparison */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Choose which data to keep:</h4>
                
                {[
                  { key: 'first_name', label: 'First Name', icon: User },
                  { key: 'last_name', label: 'Last Name', icon: User },
                  { key: 'email', label: 'Email', icon: Mail },
                  { key: 'phone', label: 'Phone', icon: Phone },
                ].map(({ key, label, icon: Icon }) => (
                  <div key={key} className="grid grid-cols-3 gap-4 items-center p-3 rounded-lg border border-border">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-sm">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span>{getFieldValue(currentPair.contact1, key)}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-center gap-2">
                      <select
                        value={mergeStrategy[key]}
                        onChange={(e) => setMergeStrategy(s => ({ ...s, [key]: e.target.value }))}
                        className="text-xs rounded-md border border-border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        <option value="keep_primary">Keep Primary</option>
                        <option value="keep_duplicate">Keep Duplicate</option>
                      </select>
                    </div>
                    
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-sm">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span>{getFieldValue(currentPair.contact2, key)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" onClick={() => setSelectedPair(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => handleMerge(selectedPair!)}
                  disabled={merging}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  <GitMerge className="w-4 h-4 mr-2" />
                  {merging ? 'Merging...' : 'Merge Contacts'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

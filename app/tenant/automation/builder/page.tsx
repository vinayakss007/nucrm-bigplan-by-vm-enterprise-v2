'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import WorkflowBuilder from '@/components/tenant/workflow-builder'

export default function WorkflowBuilderPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const workflowId = searchParams.get('id') || undefined

  const handleSave = () => {
    if (!workflowId) {
      // After creating a new workflow, we'd need to reload with the new ID
      // For now, just show a success toast (handled by builder)
    }
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Back button */}
      <div className="px-4 py-2 border-b border-border bg-card">
        <button
          onClick={() => router.push('/tenant/automation')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Automation
        </button>
      </div>

      {/* Builder */}
      <div className="flex-1">
        <WorkflowBuilder workflowId={workflowId} onSave={handleSave} />
      </div>
    </div>
  )
}

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

const WorkflowBuilder = dynamic(() => import('@/components/tenant/workflow-builder'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[600px]">
      <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

function BuilderInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const workflowId = searchParams.get('id') || undefined

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="px-4 py-2 border-b border-border bg-card">
        <button
          onClick={() => router.push('/tenant/automation')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Automation
        </button>
      </div>
      <div className="flex-1">
        <WorkflowBuilder workflowId={workflowId} />
      </div>
    </div>
  )
}

export default function WorkflowBuilderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[600px]">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <BuilderInner />
    </Suspense>
  )
}

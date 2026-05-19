'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Phone, Loader2, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface WhatsAppMessage {
  id: string
  direction: 'inbound' | 'outbound'
  message_type: string
  body: string | null
  status: string
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  error_message: string | null
}

interface Props {
  contactId: string
  contactName: string
  contactPhone: string
}

export default function WhatsAppChat({ contactId, contactName, contactPhone }: Props) {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendingTemplate, setSendingTemplate] = useState(false)
  const [templates, setTemplates] = useState<any[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant/whatsapp/messages?contact_id=${contactId}`)
      if (!res.ok) throw new Error('Failed to load messages')
      const data = await res.json()
      setMessages(data.data || [])
    } catch (err: any) {
      // Silently fail - WhatsApp may not be configured
    } finally {
      setLoading(false)
    }
  }, [contactId])

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/whatsapp/templates')
      if (!res.ok) return
      const data = await res.json()
      setTemplates(data.data || [])
    } catch {
      // Silently fail
    }
  }, [])

  useEffect(() => { loadMessages(); loadTemplates() }, [loadMessages, loadTemplates])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  const sendText = async () => {
    if (!newMessage.trim() || !contactPhone) return
    setSending(true)
    try {
      const res = await fetch('/api/tenant/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: contactPhone.replace(/[^0-9]/g, ''),
          content: { body: newMessage },
          contact_id: contactId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewMessage('')
      toast.success('Message sent')
      loadMessages()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  const sendTemplate = async (templateName: string) => {
    setSendingTemplate(true)
    try {
      const res = await fetch('/api/tenant/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: contactPhone.replace(/[^0-9]/g, ''),
          message_type: 'template',
          template_name: templateName,
          contact_id: contactId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setShowTemplates(false)
      setSelectedTemplate(null)
      toast.success('Template sent')
      loadMessages()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSendingTemplate(false)
    }
  }

  const formatTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const StatusIcon = ({ msg }: { msg: WhatsAppMessage }) => {
    if (msg.direction !== 'outbound') return null
    if (msg.status === 'failed') return <AlertCircle className="w-3 h-3 text-red-500" />
    if (msg.status === 'read') return <CheckCheck className="w-3 h-3 text-blue-500" />
    if (msg.status === 'delivered') return <CheckCheck className="w-3 h-3 text-muted-foreground" />
    if (msg.status === 'sent') return <Check className="w-3 h-3 text-muted-foreground" />
    return <Clock className="w-3 h-3 text-muted-foreground" />
  }

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className={cn('h-16 rounded-xl animate-pulse',
            i % 2 === 0 ? 'bg-muted ml-8' : 'bg-violet-100 dark:bg-violet-900/20 mr-8'
          )} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Phone className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="font-medium text-sm">{contactName || 'WhatsApp Chat'}</p>
            <p className="text-xs text-muted-foreground">{contactPhone}</p>
          </div>
        </div>
        {templates.length > 0 && (
          <button
            onClick={() => setShowTemplates(p => !p)}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent"
          >
            Templates
          </button>
        )}
      </div>

      {/* Template Selector */}
      {showTemplates && (
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <p className="text-xs font-medium text-muted-foreground mb-2">Select a template:</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t: any) => (
              <button
                key={t.id}
                onClick={() => sendTemplate(t.name)}
                disabled={sendingTemplate}
                className="px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                {sendingTemplate && selectedTemplate === t.name ? (
                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                ) : null}
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-muted/20 to-background">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <Phone className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm',
                  msg.direction === 'outbound'
                    ? 'bg-violet-600 text-white rounded-br-md'
                    : 'bg-card border border-border rounded-bl-md'
                )}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{msg.body || `📎 ${msg.message_type} message`}</p>
                <div className={cn('flex items-center justify-end gap-1.5 mt-1',
                  msg.direction === 'outbound' ? 'text-white/70' : 'text-muted-foreground'
                )}>
                  <StatusIcon msg={msg} />
                  <span className="text-[10px]">{formatTime(msg.created_at)}</span>
                </div>
                {msg.error_message && (
                  <p className="text-xs text-red-300 mt-1">{msg.error_message}</p>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border bg-card">
        <div className="flex items-center gap-2">
          <input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            onClick={sendText}
            disabled={sending || !newMessage.trim()}
            className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white flex items-center justify-center disabled:opacity-50 transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}

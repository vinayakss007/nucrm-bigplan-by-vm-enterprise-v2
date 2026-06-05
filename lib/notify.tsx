'use client';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type NotifyType = 'success' | 'error' | 'warning' | 'info';

const icons: Record<NotifyType, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 text-emerald-500" />,
  error: <XCircle className="w-4 h-4 text-red-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  info: <Info className="w-4 h-4 text-blue-500" />,
};

function notify(type: NotifyType, message: string, duration = 4000) {
  const id = toast(
    (t) => (
      <div className="flex items-start gap-3 w-full max-w-sm">
        <div className="shrink-0 mt-0.5">{icons[type]}</div>
        <p className="text-sm font-medium text-foreground flex-1 leading-snug">{message}</p>
        <button
          onClick={() => toast.dismiss(t.id)}
          className="shrink-0 p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ),
    {
      duration,
      style: {
        background: 'hsl(var(--card))',
        color: 'hsl(var(--foreground))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '12px',
        padding: '10px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        fontSize: '13px',
        minWidth: '280px',
        maxWidth: '380px',
      },
    }
  );
  return id;
}

export const notifySuccess = (message: string) => notify('success', message);
export const notifyError = (message: string) => notify('error', message);
export const notifyWarning = (message: string) => notify('warning', message);
export const notifyInfo = (message: string) => notify('info', message);

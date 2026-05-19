import SimpleLeadForm from '@/components/shared/simple-lead-form';

export default function LeadCapturePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">
                Contact Us
              </h1>
              <p className="text-sm text-muted-foreground">
                We'd love to hear from you
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <SimpleLeadForm />

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div className="p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur">
            <div className="text-2xl mb-2">🔒</div>
            <p className="text-xs font-medium">Secure</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Your data is protected</p>
          </div>
          <div className="p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur">
            <div className="text-2xl mb-2">⚡</div>
            <p className="text-xs font-medium">Fast Response</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">We reply within 24 hours</p>
          </div>
          <div className="p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur">
            <div className="text-2xl mb-2">💯</div>
            <p className="text-xs font-medium">Private</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">No spam, ever</p>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Documentation',
  description: 'NuCRM REST API documentation and reference',
};

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <header className="mb-8 sm:mb-12">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">NuCRM API Documentation</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            RESTful API reference for integrating with NuCRM. All endpoints require authentication.
          </p>
        </header>

        <div className="space-y-6 sm:space-y-8">
          <section className="admin-card p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Authentication</h2>
            <p className="text-sm text-muted-foreground mb-3">
              All API requests must include authentication via one of these methods:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <code className="px-2 py-0.5 bg-muted rounded text-xs">Cookie: nucrm_session=&lt;token&gt;</code>
                <span className="text-muted-foreground">— Session cookie (browser)</span>
              </li>
              <li className="flex items-start gap-2">
                <code className="px-2 py-0.5 bg-muted rounded text-xs">Authorization: Bearer &lt;token&gt;</code>
                <span className="text-muted-foreground">— JWT token (API clients)</span>
              </li>
            </ul>
          </section>

          <section className="admin-card p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Base URLs</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="font-mono text-xs">https://api.nucrm.com/api/v2</span>
                <span className="text-xs text-muted-foreground">Production</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="font-mono text-xs">http://localhost:3000/api/v2</span>
                <span className="text-xs text-muted-foreground">Development</span>
              </div>
            </div>
          </section>

          <section className="admin-card p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Resources</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { method: 'GET', path: '/contacts', desc: 'List contacts', tag: 'Contacts' },
                { method: 'POST', path: '/contacts', desc: 'Create contact', tag: 'Contacts' },
                { method: 'GET', path: '/contacts/:id', desc: 'Get contact', tag: 'Contacts' },
                { method: 'PATCH', path: '/contacts/:id', desc: 'Update contact', tag: 'Contacts' },
                { method: 'DELETE', path: '/contacts/:id', desc: 'Delete contact', tag: 'Contacts' },
                { method: 'GET', path: '/companies', desc: 'List companies', tag: 'Companies' },
                { method: 'POST', path: '/companies', desc: 'Create company', tag: 'Companies' },
                { method: 'GET', path: '/deals', desc: 'List deals', tag: 'Deals' },
                { method: 'POST', path: '/deals', desc: 'Create deal', tag: 'Deals' },
                { method: 'GET', path: '/tasks', desc: 'List tasks', tag: 'Tasks' },
                { method: 'POST', path: '/tasks', desc: 'Create task', tag: 'Tasks' },
                { method: 'GET', path: '/invoices', desc: 'List invoices', tag: 'Invoices' },
                { method: 'POST', path: '/invoices', desc: 'Create invoice', tag: 'Invoices' },
                { method: 'POST', path: '/auth/login', desc: 'Login', tag: 'Auth' },
                { method: 'POST', path: '/auth/logout', desc: 'Logout', tag: 'Auth' },
                { method: 'GET', path: '/auth/me', desc: 'Current user', tag: 'Auth' },
              ].map((ep) => (
                <EndpointRow key={ep.method + ep.path} {...ep} />
              ))}
            </div>
          </section>

          <section className="admin-card p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Pagination</h2>
            <p className="text-sm text-muted-foreground mb-3">
              List endpoints support pagination via query parameters:
            </p>
            <div className="space-y-1 text-sm font-mono">
              <p><span className="text-violet-600">limit</span> — Items per page (default: 50, max: 500)</p>
              <p><span className="text-violet-600">offset</span> — Items to skip (default: 0)</p>
            </div>
            <div className="mt-3 p-3 bg-muted rounded text-xs font-mono">
              <p className="text-muted-foreground">Response:</p>
              <pre className="mt-1 text-foreground">{`{
  "data": [...],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}`}</pre>
            </div>
          </section>

          <section className="admin-card p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">Rate Limiting</h2>
            <p className="text-sm text-muted-foreground">
              API requests are limited to <strong>100 requests per minute</strong> per user.
              Rate limit headers are included in every response:
            </p>
            <div className="mt-2 space-y-1 text-sm font-mono">
              <p><span className="text-violet-600">X-RateLimit-Limit</span> — Maximum requests per minute</p>
              <p><span className="text-violet-600">X-RateLimit-Remaining</span> — Remaining requests</p>
              <p><span className="text-violet-600">X-RateLimit-Reset</span> — Seconds until reset</p>
            </div>
          </section>

          <section className="admin-card p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-4">OpenAPI Specification</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Download the full OpenAPI 3.1 specification for use with Swagger UI, Postman, or other tools:
            </p>
            <a
              href="/api/openapi.yaml"
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              Download OpenAPI Spec
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}

function EndpointRow({ method, path, desc }: { method: string; path: string; desc: string; tag: string }) {
  const methodColors: Record<string, string> = {
    GET: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    PATCH: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 transition-colors">
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${methodColors[method] || 'bg-gray-100 text-gray-700'}`}>
        {method}
      </span>
      <code className="text-xs font-mono flex-1 truncate">{path}</code>
      <span className="text-xs text-muted-foreground hidden sm:inline">{desc}</span>
    </div>
  );
}

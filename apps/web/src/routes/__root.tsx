import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Languages, Workflow } from 'lucide-react';
import { LANGUAGES, type Language, language, setLanguage, t } from '@/i18n';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => <p className="p-6 text-sm">{t.common.pageNotFound}</p>,
});

function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Workflow className="size-5 text-primary" aria-hidden />
            {t.app.name}
          </Link>
          <nav className="text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground" activeProps={{ className: 'text-foreground' }}>
              {t.projects.title}
            </Link>
          </nav>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Languages className="size-4" aria-hidden />
            <span className="sr-only">{t.app.language}</span>
            <select
              aria-label={t.app.language}
              className="rounded border border-border bg-card px-1.5 py-0.5 text-xs text-foreground"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {Object.entries(LANGUAGES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

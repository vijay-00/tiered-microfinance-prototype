import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { DemoToolbar } from '@/features/demo/DemoToolbar';
import { GlassShell } from './GlassShell';
import { WalkthroughProvider } from '@/features/demo/Walkthrough';
import { useAppStore } from '@/store/context';

function Notice() {
  const notice = useAppStore((s) => s.notice);
  const dismiss = useAppStore((s) => s.dismissNotice);
  if (!notice) return null;
  return (
    <div role="alert" className="flex items-start gap-3 border-b border-bad/30 bg-bad-soft px-4 py-2 text-sm text-bad">
      <p className="flex-1">{notice}</p>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded p-0.5 hover:bg-bad/10">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function AppShell() {
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const first = useRef(true);

  // Moving to another screen moves focus to it, so keyboard and screen reader
  // users start at the new page rather than back in the sidebar.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <WalkthroughProvider>
      <div className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to main content
        </a>
        <DemoToolbar />
        <Notice />
        <GlassShell ref={main} />
      </div>
    </WalkthroughProvider>
  );
}

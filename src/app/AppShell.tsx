import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DemoToolbar } from '@/features/demo/DemoToolbar';
import { ApexShell } from '@/features/apex/ApexShell';
import { WalkthroughProvider } from '@/features/demo/Walkthrough';
import { selectRoleInfo } from '@/store/selectors';
import { useAppStore } from '@/store/context';
import { Sidebar } from './Sidebar';

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

/** Below the large breakpoint the sidebar folds into a menu that slides in from the left. */
function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="mb-4 lg:hidden">
          <Menu aria-hidden /> Menu
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="max-w-72" aria-describedby={undefined}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Sidebar className="w-full flex-1 border-r-0" onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

export function AppShell() {
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const first = useRef(true);
  const tier = useAppStore(selectRoleInfo).tier;

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
        {tier === 'apex' ? (
          <ApexShell ref={main} />
        ) : (
          <div className="flex flex-1">
            <Sidebar className="hidden lg:flex" />
            <main id="main" ref={main} tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-6">
              <MobileNav />
              <div className="mx-auto max-w-6xl">
                <Outlet />
              </div>
            </main>
          </div>
        )}
      </div>
    </WalkthroughProvider>
  );
}

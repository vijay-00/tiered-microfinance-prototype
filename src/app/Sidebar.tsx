import { NavLink } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { NAV } from './nav';
import { roleInfo } from './roles';

export function Sidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const user = useAppStore(selectCurrentUser);
  const societies = useAppStore((s) => s.world.societies);
  const federation = useAppStore((s) => s.world.federation);
  const info = roleInfo(user.role);
  const society = societies.find((s) => s.id === user.societyId);

  return (
    <aside className={cn('flex w-60 shrink-0 flex-col border-r bg-card', className)}>
      <div className="border-b px-4 py-4">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {info.tier === 'apex' ? 'Apex federation' : 'Credit society'}
        </p>
        <p className="mt-0.5 leading-snug font-semibold">
          {info.tier === 'apex' ? federation.name : society?.name}
        </p>
        {info.tier !== 'apex' && society ? (
          <p className="text-xs text-muted-foreground">{society.district} district</p>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        {NAV[info.tier].map((group, index) => (
          <div key={group.label ?? index} className="mb-3">
            {group.label ? (
              <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
            ) : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                        isActive && 'bg-accent font-medium text-accent-foreground hover:bg-accent',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t px-4 py-3">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground">{user.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge tone="info">{info.label}</Badge>
          {info.readOnly ? <Badge>Read only</Badge> : null}
        </div>
      </div>
    </aside>
  );
}

import {
  BookOpen,
  Building2,
  FileBarChart,
  FileText,
  HandCoins,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  Scale,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Tier } from './roles';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly, for an item whose path prefixes another's. */
  end?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: Record<Tier, NavGroup[]> = {
  society: [
    { items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    {
      label: 'Origination',
      items: [
        { to: '/members', label: 'Members', icon: Users },
        { to: '/applications', label: 'Applications', icon: FileText },
        { to: '/pools', label: 'Pools', icon: Layers },
      ],
    },
    {
      label: 'Servicing',
      items: [
        { to: '/tranches', label: 'Funding', icon: Landmark },
        { to: '/collections', label: 'Collections', icon: HandCoins },
      ],
    },
    {
      label: 'Books',
      items: [
        { to: '/ledger', label: 'Ledger', icon: BookOpen, end: true },
        { to: '/ledger/statements', label: 'Statements', icon: Scale },
        { to: '/reports', label: 'Reports', icon: FileBarChart },
      ],
    },
    { label: 'Admin', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
  ],
  apex: [
    { items: [{ to: '/apex', label: 'Exposure', icon: LayoutDashboard, end: true }] },
    {
      label: 'Lending',
      items: [
        { to: '/apex/requests', label: 'Funding requests', icon: Inbox },
        { to: '/apex/societies', label: 'Societies', icon: Building2 },
      ],
    },
  ],
  member: [{ items: [{ to: '/me', label: 'My loans', icon: Wallet }] }],
};

import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Apple, BellRing, ChevronsLeft, ChevronsRight, CalendarCheck2, Cpu, LayoutGrid, LogOut, Megaphone, Menu, Moon, ReceiptIndianRupee, Settings, Sun, Tags, Ticket, Users, X,
} from 'lucide-react';
import { useSession, useTheme } from '../lib/session';

interface NavItem { to: string; label: string; icon: ReactNode; roles?: string[] }

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutGrid className="w-5 h-5" /> },
  { to: '/members', label: 'Members', icon: <Users className="w-5 h-5" /> },
  { to: '/renewals', label: 'Renewals', icon: <BellRing className="w-5 h-5" /> },
  { to: '/payments', label: 'Payments', icon: <ReceiptIndianRupee className="w-5 h-5" /> },
  { to: '/attendance', label: 'Attendance', icon: <CalendarCheck2 className="w-5 h-5" /> },
  { to: '/content', label: 'Announcements', icon: <Megaphone className="w-5 h-5" /> },
  { to: '/fitness', label: 'Fitness', icon: <Apple className="w-5 h-5" /> },
  { to: '/device', label: 'Device', icon: <Cpu className="w-5 h-5" /> },
  { to: '/plans', label: 'Plans', icon: <Tags className="w-5 h-5" /> },
  { to: '/coupons', label: 'Coupons', icon: <Ticket className="w-5 h-5" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
];
// Phone bottom bar: the four daily tasks; everything else lives under "More".
const MOBILE_MAIN = ['/', '/members', '/renewals', '/payments'];

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon-128.png" alt="Challenge Gym logo" className="w-9 h-9 object-contain shrink-0 rounded-xl bg-ink-950/70 p-1" />
      {!compact && (
        <div className="leading-tight">
          <p className="font-display font-bold text-white">Challenge Gym</p>
          <p className="text-[11px] text-ink-300 font-medium">Admin</p>
        </div>
      )}
    </div>
  );
}

// Tablet/desktop sidebar: "auto" = icon rail on tablets, full on desktop; the toggle pins it
// open or collapsed, remembered on this device until changed again.
type SidebarPref = 'auto' | 'wide' | 'narrow';
const SIDEBAR_KEY = 'cg_admin_sidebar';
const SB = {
  auto: { pad: 'md:pl-20 lg:pl-64', aside: 'md:w-20 lg:w-64', label: 'hidden lg:inline', full: 'hidden lg:flex', rail: 'lg:hidden', align: 'justify-center lg:justify-start px-3 lg:px-4' },
  wide: { pad: 'md:pl-64', aside: 'md:w-64', label: 'inline', full: 'flex', rail: 'hidden', align: 'justify-start px-4' },
  narrow: { pad: 'md:pl-20', aside: 'md:w-20', label: 'hidden', full: 'hidden', rail: '', align: 'justify-center px-3' },
} as const;

export default function Layout() {
  const { session, logout } = useSession();
  const { dark, toggle } = useTheme();
  const [more, setMore] = useState(false);
  const [pref, setPref] = useState<SidebarPref>(() => { try { return (localStorage.getItem(SIDEBAR_KEY) as SidebarPref) || 'auto'; } catch { return 'auto'; } });
  const loc = useLocation();
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  const sb = SB[pref] ?? SB.auto;
  const expanded = pref === 'wide' || (pref === 'auto' && window.matchMedia('(min-width: 1024px)').matches);
  const toggleSidebar = () => {
    const next: SidebarPref = expanded ? 'narrow' : 'wide';
    setPref(next);
    try { localStorage.setItem(SIDEBAR_KEY, next); } catch { /* private mode */ }
  };

  return (
    <div className={`min-h-dvh overflow-x-clip ${sb.pad} md:transition-[padding] md:duration-200`}>
      <aside className={`hidden md:flex fixed inset-y-0 left-0 z-40 flex-col bg-ink-900 border-r border-ink-700 ${sb.aside} py-5 transition-[width] duration-200`}>
        <button onClick={toggleSidebar} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="absolute -right-3 top-7 z-10 w-6 h-6 rounded-full bg-ink-800 border border-ink-600 text-ink-300 hover:text-white hover:bg-ink-700 flex items-center justify-center">
          {expanded ? <ChevronsLeft className="w-3.5 h-3.5" /> : <ChevronsRight className="w-3.5 h-3.5" />}
        </button>
        <div className={`mb-8 flex ${sb.align}`}>
          <span className={sb.rail}><Brand compact /></span>
          <span className={sb.full}><Brand /></span>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-1 px-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} title={n.label}
              className={({ isActive: a }) => `flex items-center gap-3 rounded-2xl h-11 ${sb.align} text-sm font-semibold transition whitespace-nowrap
                ${a ? 'bg-lime text-ink-900' : 'text-ink-300 hover:text-white hover:bg-white/5'}`}>
              {n.icon}<span className={sb.label}>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-3 flex flex-col gap-1">
          <button onClick={toggle} className={`flex items-center gap-3 rounded-2xl h-11 ${sb.align} text-sm font-semibold text-ink-300 hover:text-white hover:bg-white/5 whitespace-nowrap`} title="Theme">
            {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}<span className={sb.label}>{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <div className={`${sb.full} items-center gap-3 rounded-2xl bg-white/5 p-3 mt-2`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{session?.name}</p>
              <p className="text-[11px] text-ink-300 capitalize">{session?.role}</p>
            </div>
            <button onClick={logout} className="icon-btn text-ink-300 hover:text-white" title="Sign out"><LogOut className="w-4 h-4" /></button>
          </div>
          <button onClick={logout} className={`${sb.rail} ${sb.rail === 'hidden' ? '' : 'flex'} items-center justify-center rounded-2xl h-11 text-ink-300 hover:text-white hover:bg-white/5`} title="Sign out"><LogOut className="w-5 h-5" /></button>
        </div>
      </aside>
      {/* Phone top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-ink-900/95 backdrop-blur px-4 h-14 flex items-center justify-between no-print">
        <Brand />
        <button className="icon-btn text-white" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-5 lg:py-8 pb-28 md:pb-10 max-w-[1400px] mx-auto">
        <Outlet />
      </main>

      {/* Phone bottom nav — dark pill with lime active tab (reference design) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 px-3 pt-2 safe-bottom no-print pointer-events-none">
        <div className="pointer-events-auto mx-auto max-w-md bg-ink-900 rounded-full p-1.5 flex items-center justify-between shadow-2xl border border-ink-700">
          {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => {
            const a = isActive(n.to);
            return (
              <NavLink key={n.to} to={n.to} end={n.to === '/'}
                className={`flex items-center justify-center gap-2 h-11 rounded-full transition-all ${a ? 'bg-lime text-ink-900 px-4 font-semibold text-sm' : 'text-ink-300 w-11'}`}>
                {n.icon}{a && <span>{n.label}</span>}
              </NavLink>
            );
          })}
          <button onClick={() => setMore(true)} className={`flex items-center justify-center h-11 w-11 rounded-full ${NAV.some((n) => !MOBILE_MAIN.includes(n.to) && isActive(n.to)) ? 'bg-lime text-ink-900' : 'text-ink-300'}`} aria-label="More">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {more && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute bottom-0 inset-x-0 bg-ink-900 rounded-t-4xl p-5 safe-bottom border-t border-ink-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white font-semibold">{session?.name}</p>
                <p className="text-xs text-ink-300 capitalize">{session?.role}</p>
              </div>
              <button className="icon-btn text-white" onClick={() => setMore(false)} aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.filter((n) => !MOBILE_MAIN.includes(n.to)).map((n) => (
                <NavLink key={n.to} to={n.to} onClick={() => setMore(false)}
                  className={({ isActive: a }) => `flex flex-col items-center gap-2 rounded-3xl py-4 text-xs font-semibold ${a ? 'bg-lime text-ink-900' : 'bg-white/5 text-ink-200'}`}>
                  {n.icon}{n.label}
                </NavLink>
              ))}
              <button onClick={logout} className="flex flex-col items-center gap-2 rounded-3xl py-4 text-xs font-semibold bg-white/5 text-ink-200"><LogOut className="w-5 h-5" />Sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5 lg:mb-7">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold">{title}</h1>
        {subtitle && <p className="muted text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

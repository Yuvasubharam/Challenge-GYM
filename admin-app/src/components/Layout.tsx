import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Apple, BellRing, CalendarCheck2, Cpu, Dumbbell, LayoutGrid, LogOut, Megaphone, Menu, Moon, ReceiptIndianRupee, Settings, Sun, Tags, Ticket, Users, X,
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
      <div className="w-9 h-9 rounded-xl bg-lime text-ink-900 flex items-center justify-center shrink-0"><Dumbbell className="w-5 h-5" strokeWidth={2.5} /></div>
      {!compact && (
        <div className="leading-tight">
          <p className="font-display font-bold text-white">Challenge Gym</p>
          <p className="text-[11px] text-ink-300 font-medium">Admin</p>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { session, logout } = useSession();
  const { dark, toggle } = useTheme();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));

  return (
    <div className="min-h-dvh lg:pl-64 md:pl-20">
      {/* Sidebar — full on desktop, icon rail on tablet */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 flex-col bg-ink-900 border-r border-ink-700 md:w-20 lg:w-64 py-5">
        <div className="px-4 lg:px-5 mb-8 flex justify-center lg:justify-start">
          <span className="lg:hidden"><Brand compact /></span>
          <span className="hidden lg:block"><Brand /></span>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 px-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} title={n.label}
              className={({ isActive: a }) => `flex items-center gap-3 rounded-2xl h-11 px-3 lg:px-4 justify-center lg:justify-start text-sm font-semibold transition
                ${a ? 'bg-lime text-ink-900' : 'text-ink-300 hover:text-white hover:bg-white/5'}`}>
              {n.icon}<span className="hidden lg:inline">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-3 flex flex-col gap-1">
          <button onClick={toggle} className="flex items-center gap-3 rounded-2xl h-11 px-3 lg:px-4 justify-center lg:justify-start text-sm font-semibold text-ink-300 hover:text-white hover:bg-white/5" title="Theme">
            {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}<span className="hidden lg:inline">{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <div className="hidden lg:flex items-center gap-3 rounded-2xl bg-white/5 p-3 mt-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{session?.name}</p>
              <p className="text-[11px] text-ink-300 capitalize">{session?.role}</p>
            </div>
            <button onClick={logout} className="icon-btn text-ink-300 hover:text-white" title="Sign out"><LogOut className="w-4 h-4" /></button>
          </div>
          <button onClick={logout} className="lg:hidden flex items-center justify-center rounded-2xl h-11 text-ink-300 hover:text-white hover:bg-white/5" title="Sign out"><LogOut className="w-5 h-5" /></button>
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

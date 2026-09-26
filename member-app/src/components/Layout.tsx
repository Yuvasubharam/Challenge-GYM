import { NavLink, Outlet } from 'react-router-dom';
import { Dumbbell, Home as HomeIcon, Images, LineChart, Megaphone, ShoppingBag, UserRound, Utensils } from 'lucide-react';
import type { ReactNode } from 'react';

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/', label: 'Home', icon: <HomeIcon className="w-5 h-5" /> },
  { to: '/diet', label: 'Diet', icon: <Utensils className="w-5 h-5" /> },
  { to: '/train', label: 'Train', icon: <Dumbbell className="w-5 h-5" /> },
  { to: '/progress', label: 'Progress', icon: <LineChart className="w-5 h-5" /> },
  { to: '/profile', label: 'Me', icon: <UserRound className="w-5 h-5" /> },
];
// Extra pages reachable from Home on phones; listed in the tablet/desktop sidebar.
const MORE: typeof NAV = [
  { to: '/news', label: 'News & events', icon: <Megaphone className="w-5 h-5" /> },
  { to: '/shop', label: 'Shop', icon: <ShoppingBag className="w-5 h-5" /> },
  { to: '/gallery', label: 'Gallery', icon: <Images className="w-5 h-5" /> },
];

export default function Layout() {
  return (
    <div className="min-h-dvh md:pl-24 lg:pl-64">
      {/* Tablet rail / desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 flex-col md:w-24 lg:w-64 bg-ink-900 border-r border-ink-700 py-6 px-3">
        <div className="flex items-center gap-2.5 px-2 lg:px-3 mb-10 justify-center lg:justify-start">
          <div className="w-10 h-10 rounded-2xl bg-lime text-ink-900 flex items-center justify-center shrink-0"><Dumbbell className="w-5 h-5" strokeWidth={2.5} /></div>
          <span className="hidden lg:block font-display font-bold text-white">Challenge Gym</span>
        </div>
        <nav className="flex flex-col gap-1.5">
          {[...NAV, ...MORE].map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} title={n.label}
              className={({ isActive }) => `${i === NAV.length ? 'mt-4 ' : ''}flex items-center gap-3 h-12 rounded-2xl px-4 justify-center lg:justify-start font-semibold text-sm transition
                ${isActive ? 'bg-lime text-ink-900' : 'text-ink-300 hover:text-white hover:bg-white/5'}`}>
              {n.icon}<span className="hidden lg:inline">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-32 md:pb-12 md:pt-10">
        <Outlet />
      </main>

      {/* Phone: floating dark pill nav with lime active tab (reference design) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 px-4 safe-bottom pointer-events-none">
        <div className="pointer-events-auto mx-auto max-w-sm bg-ink-900 rounded-full p-1.5 flex items-center justify-between shadow-2xl border border-ink-700">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} aria-label={n.label}
              className={({ isActive }) => `flex items-center justify-center gap-2 h-12 rounded-full transition-all
                ${isActive ? 'bg-lime text-ink-900 px-4 font-semibold text-sm' : 'text-ink-300 w-11'}`}>
              {({ isActive }) => <>{n.icon}{isActive && <span>{n.label}</span>}</>}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

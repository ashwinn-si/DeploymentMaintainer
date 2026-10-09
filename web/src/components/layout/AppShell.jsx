import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Navbar } from './Navbar.jsx';
import { DiskBanner } from '../DiskBanner.jsx';

export function AppShell({ deploying = false, outletContext }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dm_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('dm_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="animate-orb-float-1 absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="animate-orb-float-2 absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="animate-orb-float-3 absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />
      </div>
      <Sidebar deploying={deploying} collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      <Navbar deploying={deploying} />

      <div className={`relative z-10 transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-[7rem]' : 'lg:pl-[19.5rem]'}`}>
        <div className="px-4 pt-4 sm:px-6 lg:px-8">
          <DiskBanner />
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="animate-fade-in-up">
            <Outlet context={outletContext} />
          </div>
        </main>
      </div>
    </div>
  );
}


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
    <div className="min-h-dvh">
      <Sidebar deploying={deploying} collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      <Navbar deploying={deploying} />

      <div className={`transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-20' : 'lg:pl-72'}`}>
        <div className="px-4 pt-4 sm:px-6 lg:px-8">
          <DiskBanner />
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet context={outletContext} />
        </main>
      </div>
    </div>
  );
}


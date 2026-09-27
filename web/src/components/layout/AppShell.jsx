import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Navbar } from './Navbar.jsx';
import { DiskBanner } from '../DiskBanner.jsx';

export function AppShell({ deploying = false }) {
  return (
    <div className="min-h-dvh">
      <Sidebar deploying={deploying} />
      <Navbar deploying={deploying} />

      <div className="lg:pl-72">
        <div className="px-4 pt-4 sm:px-6 lg:px-8">
          <DiskBanner />
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

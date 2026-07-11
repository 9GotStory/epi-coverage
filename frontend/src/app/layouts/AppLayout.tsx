import { Outlet } from 'react-router-dom';
import { GlobalNav } from '../../widgets/layout/GlobalNav';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-white pb-20">
      <GlobalNav />
      <main className="w-full pt-[44px]">
        <Outlet />
      </main>
    </div>
  );
}

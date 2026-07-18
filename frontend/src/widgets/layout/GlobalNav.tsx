import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../../shared/contexts/AuthContext';
import { LogOut, ShieldAlert, Menu, X } from 'lucide-react';

export function GlobalNav() {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
  };

  const navLinks = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'EPI Tracking (1 ปี)', path: '/dashboard/epi-1yr', roles: ['superadmin', 'admin', 'user'] },
    { name: 'EPI Tracking (2 ปี)', path: '/dashboard/epi-2yr', roles: ['superadmin', 'admin', 'user'] },
    { name: 'EPI Tracking (3 ปี)', path: '/dashboard/epi-3yr', roles: ['superadmin', 'admin', 'user'] },
    { name: 'EPI Tracking (5 ปี)', path: '/dashboard/epi-5yr', roles: ['superadmin', 'admin', 'user'] },
    { name: 'Upload Data', path: '/upload', roles: ['admin', 'superadmin'], hoscodes: ['00588'] },
    { name: 'Admin Panel', path: '/admin', roles: ['admin', 'superadmin'] }
  ];

  const visibleLinks = navLinks.filter(link => {
    if (link.roles && (!user?.role || !link.roles.includes(user.role))) return false;
    if (link.hoscodes && (!user?.hoscode || !link.hoscodes.includes(user.hoscode))) return false;
    return true;
  });

  return (
    <>
      <nav className="h-[44px] bg-[#000000] text-white w-full flex items-center px-4 md:px-8 text-[12px] font-normal tracking-[-0.12px] z-50 fixed top-0 transition-colors">
        <div className="max-w-[1440px] mx-auto w-full flex items-center justify-between">
          
          {/* Logo / Brand */}
          <Link 
            to="/dashboard" 
            className="flex items-center opacity-80 hover:opacity-100 transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <ShieldAlert className="w-4 h-4 mr-2" />
            <span className="font-semibold tracking-normal text-[14px] hidden sm:block">EPI Coverage</span>
          </Link>

          {/* Desktop Links */}
          <div className="hidden md:flex items-center space-x-8">
            {visibleLinks.map(link => (
              <NavLink 
                key={link.path}
                to={link.path}
                className={({ isActive }) => 
                  `opacity-80 hover:opacity-100 transition-opacity ${isActive ? 'opacity-100 font-medium' : ''}`
                }
              >
                {link.name}
              </NavLink>
            ))}
          </div>

          {/* Right Actions & Mobile Toggle */}
          <div className="flex items-center space-x-4">
            <span className="opacity-80 hidden md:block">
              {user ? (
                <>{user.name} <span className="opacity-50 mx-1">|</span> {user.hoscode}</>
              ) : (
                <>Public View</>
              )}
            </span>
            
            {user ? (
              <button 
                onClick={handleLogout}
                className="opacity-80 hover:opacity-100 transition-opacity flex items-center"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4 md:mr-1" />
                <span className="hidden md:inline">Sign Out</span>
              </button>
            ) : (
              <Link 
                to="/login"
                className="opacity-80 hover:opacity-100 transition-opacity flex items-center bg-white/10 px-3 py-1.5 rounded-full"
              >
                <span>เจ้าหน้าที่ Login</span>
              </Link>
            )}

            {/* Hamburger Toggle */}
            <button 
              className="md:hidden opacity-80 hover:opacity-100 transition-opacity p-1"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Tray */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 top-[44px] bg-black z-40 md:hidden overflow-y-auto px-6 py-8 flex flex-col space-y-6">
          <div className="text-white/60 text-xs mb-4">
            {user ? `${user.name} — ${user.hoscode}` : 'Public View'}
          </div>
          {visibleLinks.map(link => (
            <NavLink 
              key={link.path}
              to={link.path}
              onClick={() => setIsMobileMenuOpen(false)}
              className={({ isActive }) => 
                `text-xl text-white font-semibold tracking-tight border-b border-white/10 pb-4 ${isActive ? 'opacity-100' : 'opacity-80'}`
              }
            >
              {link.name}
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}

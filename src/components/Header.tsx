import React, { useState } from 'react';
import { ShieldAlert, Sparkles, ChevronDown } from 'lucide-react';
import type { UserProfile } from '../types/index.ts';

interface HeaderProps {
  user: UserProfile;
  isAdmin: boolean;
  activeTab: 'home' | 'tasks' | 'referrals' | 'wallet' | 'admin';
  onNavigateTab: (tab: 'home' | 'tasks' | 'referrals' | 'wallet' | 'admin') => void;
  onSwitchUser?: (userId: string, name: string) => void;
  isSimulatedAuth?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  isAdmin,
  activeTab,
  onNavigateTab,
  onSwitchUser,
  isSimulatedAuth,
}) => {
  const [showSimMenu, setShowSimMenu] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
      {/* Simulation / Preview Banner */}
      {isSimulatedAuth && (
        <div className="mb-2 py-1.5 px-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-[11px] text-amber-800 shadow-xs">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Sandbox Preview Mode</span>
          </span>
          <button
            onClick={() => setShowSimMenu(!showSimMenu)}
            className="text-[10px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-md transition flex items-center gap-1"
          >
            <span>Switch Identity</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Switcher Dropdown */}
      {showSimMenu && onSwitchUser && (
        <div className="mb-3 p-3 bg-white border border-slate-200 rounded-2xl shadow-lg space-y-2 text-xs">
          <p className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Test Sandbox Identities:</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              onClick={() => {
                onSwitchUser('2022247489', 'Admin Vivek');
                setShowSimMenu(false);
              }}
              className="py-1.5 px-2.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl font-bold text-[11px] transition text-left"
            >
              👑 Login as Admin
            </button>
            <button
              onClick={() => {
                onSwitchUser('987654321', 'Alex Demo');
                setShowSimMenu(false);
              }}
              className="py-1.5 px-2.5 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-[#0088cc] rounded-xl font-bold text-[11px] transition text-left"
            >
              👤 Regular User
            </button>
            <button
              onClick={() => {
                const randomId = Math.floor(100000000 + Math.random() * 900000000).toString();
                onSwitchUser(randomId, `NewUser_${randomId.slice(-4)}`);
                setShowSimMenu(false);
              }}
              className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-bold text-[11px] transition text-left"
            >
              ✨ Simulate New User
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* User Identity Info */}
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0088cc] to-[#24a1de] p-0.5 flex items-center justify-center shadow-sm">
            {user.photoUrl ? (
              <img
                src={user.photoUrl}
                alt={user.firstName}
                className="w-full h-full rounded-[14px] object-cover bg-white"
              />
            ) : (
              <div className="w-full h-full rounded-[14px] bg-white flex items-center justify-center text-[#0088cc] font-black text-sm">
                {user.firstName[0]}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-900 leading-tight">
                {user.firstName}
              </span>
              {isAdmin && (
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                  ADMIN
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-none mt-0.5 font-medium">
              @{user.username || `id:${user.id}`}
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Balance Chip */}
          <button
            onClick={() => onNavigateTab('wallet')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f0f7fc] hover:bg-[#e4f1fb] border border-[#d0e6f7] rounded-xl cursor-pointer transition shadow-2xs group"
          >
            <span className="w-2 h-2 rounded-full bg-[#0088cc] animate-pulse" />
            <span className="text-xs font-black text-[#0088cc] group-hover:text-[#0077b5]">
              ₹{user.balance.toFixed(2)}
            </span>
          </button>

          {/* Admin Toggle Button */}
          {isAdmin && (
            <button
              onClick={() => onNavigateTab(activeTab === 'admin' ? 'home' : 'admin')}
              className={`p-2 rounded-xl transition ${
                activeTab === 'admin'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
              }`}
              title="Admin Panel"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

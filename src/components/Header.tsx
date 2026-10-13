import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Sparkles, User, RefreshCw } from 'lucide-react';
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
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
      {/* Simulation / Preview Banner */}
      {isSimulatedAuth && (
        <div className="mb-2 py-1 px-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between text-[11px] text-amber-300">
          <span className="flex items-center gap-1.5 truncate">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Sandbox Preview Mode Active</span>
          </span>
          <button
            onClick={() => setShowSimMenu(!showSimMenu)}
            className="text-[10px] font-bold uppercase underline hover:text-white"
          >
            {showSimMenu ? 'Hide Switcher' : 'Switch Identity'}
          </button>
        </div>
      )}

      {/* Switcher Dropdown */}
      {showSimMenu && onSwitchUser && (
        <div className="mb-3 p-3 bg-slate-900 border border-slate-700 rounded-xl space-y-2 text-xs">
          <p className="font-bold text-white text-[11px]">Test Sandbox Identities:</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSwitchUser('2022247489', 'Admin Vivek');
                setShowSimMenu(false);
              }}
              className="flex-1 py-1 px-2 bg-red-600/30 border border-red-500/40 text-red-300 rounded-lg font-bold text-[10px]"
            >
              👑 Login as Admin
            </button>
            <button
              onClick={() => {
                onSwitchUser('987654321', 'Alex Demo');
                setShowSimMenu(false);
              }}
              className="flex-1 py-1 px-2 bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-lg font-bold text-[10px]"
            >
              👤 Login as Regular User
            </button>
            <button
              onClick={() => {
                const randomId = Math.floor(100000000 + Math.random() * 900000000).toString();
                onSwitchUser(randomId, `NewUser_${randomId.slice(-4)}`);
                setShowSimMenu(false);
              }}
              className="flex-1 py-1 px-2 bg-blue-600/30 border border-blue-500/40 text-blue-300 rounded-lg font-bold text-[10px]"
            >
              ✨ Simulate New User
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* User Identity Info */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 flex items-center justify-center shadow-md">
            {user.photoUrl ? (
              <img
                src={user.photoUrl}
                alt={user.firstName}
                className="w-full h-full rounded-[10px] object-cover"
              />
            ) : (
              <div className="w-full h-full rounded-[10px] bg-slate-900 flex items-center justify-center text-emerald-400 font-black text-sm">
                {user.firstName[0]}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white leading-none">
                {user.firstName}
              </span>
              {isAdmin && (
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                  ADMIN
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-none">
              @{user.username || `id:${user.id}`}
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Balance Chip */}
          <div
            onClick={() => onNavigateTab('wallet')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/40 rounded-xl cursor-pointer transition shadow-inner"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-black text-emerald-400">
              ₹{user.balance.toFixed(2)}
            </span>
          </div>

          {/* Admin Toggle Button */}
          {isAdmin && (
            <button
              onClick={() => onNavigateTab(activeTab === 'admin' ? 'home' : 'admin')}
              className={`p-2 rounded-xl transition ${
                activeTab === 'admin'
                  ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                  : 'bg-slate-900 hover:bg-slate-800 text-red-400 border border-red-500/30'
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

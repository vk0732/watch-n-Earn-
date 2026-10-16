import React from 'react';

interface SkeletonProps {
  className?: string;
  dark?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', dark = false }) => {
  return (
    <div
      className={`rounded-xl ${dark ? 'skeleton-shimmer-dark' : 'skeleton-shimmer'} ${className}`}
      aria-hidden="true"
    />
  );
};

/**
 * Home Hero Balance Card Skeleton
 * Matches the exact geometry of the gradient balance card on HomeView
 */
export const HomeBalanceSkeleton: React.FC = () => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0088cc] via-[#1297de] to-[#24a1de] p-6 shadow-xl shadow-sky-500/15 text-white">
      <div className="flex items-center justify-between mb-3">
        <Skeleton dark className="w-28 h-5 rounded-full" />
        <Skeleton dark className="w-20 h-5 rounded-full" />
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <Skeleton dark className="w-40 h-11 rounded-2xl" />
        <Skeleton dark className="w-16 h-4 rounded-lg" />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2.5 mb-5 p-3 rounded-2xl bg-black/10 border border-white/15">
        <div className="flex items-center gap-2.5">
          <Skeleton dark className="w-8 h-8 rounded-xl shrink-0" />
          <div className="space-y-1.5 flex-1">
            <Skeleton dark className="w-14 h-2.5 rounded" />
            <Skeleton dark className="w-20 h-4 rounded" />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton dark className="w-8 h-8 rounded-xl shrink-0" />
          <div className="space-y-1.5 flex-1">
            <Skeleton dark className="w-16 h-2.5 rounded" />
            <Skeleton dark className="w-20 h-4 rounded" />
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Skeleton dark className="h-11 rounded-xl" />
        <Skeleton dark className="h-11 rounded-xl" />
      </div>
    </div>
  );
};

/**
 * Daily Check-In Card Skeleton
 */
export const DailyCheckinSkeleton: React.FC = () => {
  return (
    <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-8 h-8 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="w-28 h-3.5 rounded" />
            <Skeleton className="w-36 h-2.5 rounded" />
          </div>
        </div>
        <Skeleton className="w-20 h-6 rounded-full" />
      </div>

      {/* Day streak bubbles */}
      <div className="grid grid-cols-7 gap-1.5 mb-4">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <Skeleton key={d} className="h-16 rounded-xl" />
        ))}
      </div>

      <Skeleton className="w-full h-10 rounded-xl" />
    </div>
  );
};

/**
 * Tasks Preview on HomeView Skeleton
 */
export const HomeTasksSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Skeleton className="w-12 h-3.5 rounded" />
                <Skeleton className="w-10 h-3.5 rounded" />
              </div>
              <Skeleton className="w-3/4 h-3.5 rounded" />
              <Skeleton className="w-1/2 h-2.5 rounded" />
            </div>
          </div>
          <div className="space-y-1.5 shrink-0 text-right">
            <Skeleton className="w-14 h-5 rounded-lg ml-auto" />
            <Skeleton className="w-16 h-6 rounded-lg ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Full TasksView Skeleton
 */
export const TasksViewSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 pb-4">
      {/* Top Header */}
      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-1.5">
            <Skeleton className="w-36 h-4 rounded" />
            <Skeleton className="w-48 h-3 rounded" />
          </div>
          <Skeleton className="w-14 h-8 rounded-xl" />
        </div>
        <Skeleton className="w-full h-2 rounded-full" />
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5">
        <Skeleton className="w-20 h-8 rounded-xl" />
        <Skeleton className="w-16 h-8 rounded-xl" />
        <Skeleton className="w-18 h-8 rounded-xl" />
        <Skeleton className="w-18 h-8 rounded-xl" />
      </div>

      {/* Task List */}
      <HomeTasksSkeleton count={4} />
    </div>
  );
};

/**
 * Wallet Hero Card Skeleton
 */
export const WalletHeroSkeleton: React.FC = () => {
  return (
    <div className="p-6 bg-gradient-to-br from-[#0088cc] via-[#1095d9] to-[#24a1de] text-white rounded-3xl shadow-xl shadow-sky-500/15">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Skeleton dark className="w-8 h-8 rounded-xl" />
          <Skeleton dark className="w-20 h-3.5 rounded" />
        </div>
        <Skeleton dark className="w-36 h-3.5 rounded" />
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <Skeleton dark className="w-36 h-11 rounded-2xl" />
        <Skeleton dark className="w-14 h-4 rounded" />
      </div>

      <div className="mb-5 p-3 rounded-2xl bg-black/10 border border-white/15 space-y-2">
        <div className="flex justify-between">
          <Skeleton dark className="w-28 h-3 rounded" />
          <Skeleton dark className="w-16 h-3 rounded" />
        </div>
        <Skeleton dark className="w-full h-2 rounded-full" />
      </div>

      <Skeleton dark className="w-full h-11 rounded-xl" />
    </div>
  );
};

/**
 * Redemption History List Skeleton
 */
export const RedemptionListSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center justify-between"
        >
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2">
              <Skeleton className="w-16 h-4 rounded" />
              <Skeleton className="w-24 h-3 rounded font-mono" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="w-4 h-4 rounded-full" />
              <Skeleton className="w-28 h-3 rounded" />
              <Skeleton className="w-20 h-4 rounded" />
            </div>
            <Skeleton className="w-32 h-2.5 rounded" />
          </div>
          <Skeleton className="w-20 h-6 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  );
};

/**
 * Transaction Ledger List Skeleton
 */
export const TransactionListSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-3.5 bg-white border border-slate-200/80 rounded-xl shadow-xs flex items-center justify-between"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
            <div className="space-y-1.5 flex-1 min-w-0">
              <Skeleton className="w-3/5 h-3.5 rounded" />
              <Skeleton className="w-2/5 h-2.5 rounded" />
            </div>
          </div>
          <div className="space-y-1 text-right shrink-0">
            <Skeleton className="w-14 h-4 rounded ml-auto" />
            <Skeleton className="w-16 h-2.5 rounded ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Referral Program Skeleton
 */
export const ReferralViewSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 pb-4">
      {/* Referral Hero */}
      <div className="rounded-3xl bg-gradient-to-br from-[#0088cc] via-[#1095d9] to-[#24a1de] p-6 shadow-xl shadow-sky-500/15 text-white">
        <Skeleton dark className="w-28 h-4 rounded mb-2" />
        <Skeleton dark className="w-48 h-7 rounded mb-2" />
        <Skeleton dark className="w-full h-8 rounded mb-5" />
        <Skeleton dark className="w-full h-10 rounded-xl mb-3" />
        <Skeleton dark className="w-full h-11 rounded-xl" />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-2">
          <Skeleton className="w-24 h-3.5 rounded" />
          <Skeleton className="w-16 h-6 rounded" />
          <Skeleton className="w-28 h-2.5 rounded" />
        </div>
        <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-2">
          <Skeleton className="w-24 h-3.5 rounded" />
          <Skeleton className="w-20 h-6 rounded" />
          <Skeleton className="w-28 h-2.5 rounded" />
        </div>
      </div>

      {/* Referral Ledger Box */}
      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
        <Skeleton className="w-32 h-4 rounded" />
        <div className="space-y-2">
          <Skeleton className="w-full h-12 rounded-xl" />
          <Skeleton className="w-full h-12 rounded-xl" />
        </div>
      </div>
    </div>
  );
};

/**
 * Admin View Skeleton
 */
export const AdminViewSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 pb-4">
      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="w-36 h-5 rounded" />
          <Skeleton className="w-20 h-6 rounded-full" />
        </div>
        <Skeleton className="w-full h-10 rounded-xl" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-2">
            <Skeleton className="w-20 h-3 rounded" />
            <Skeleton className="w-16 h-6 rounded" />
          </div>
        ))}
      </div>

      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
        <Skeleton className="w-40 h-4 rounded" />
        <Skeleton className="w-full h-32 rounded-xl" />
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { PlayCircle, Globe, MessageSquare, CheckCircle2, Clock, Sparkles, Share2 } from 'lucide-react';
import type { Task, TaskType } from '../types/index.ts';

interface TasksViewProps {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({ tasks, onSelectTask }) => {
  const [filter, setFilter] = useState<string>('all');

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return true;
    return t.taskType === filter;
  });

  const completedCount = tasks.filter((t) => t.completed).length;

  const getTypeIcon = (type: TaskType) => {
    switch (type) {
      case 'video':
        return <PlayCircle className="w-5 h-5 text-red-400" />;
      case 'website':
        return <Globe className="w-5 h-5 text-blue-400" />;
      case 'channel':
        return <MessageSquare className="w-5 h-5 text-emerald-400" />;
      case 'social':
        return <Share2 className="w-5 h-5 text-pink-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-amber-400" />;
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Top Header & Progress */}
      <div className="p-5 bg-gradient-to-br from-slate-900 to-slate-850 border border-slate-800 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-white">Watch & Earn Tasks</h2>
            <p className="text-xs text-slate-400">Complete sponsors to earn guaranteed coins</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">Completed</span>
            <p className="text-base font-extrabold text-emerald-400">
              {completedCount} / {tasks.length}
            </p>
          </div>
        </div>

        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
            style={{ width: `${tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {['all', 'video', 'website', 'channel', 'social'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition ${
              filter === f
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            {f === 'all' ? 'All Tasks' : `${f}s`}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl">
            <p className="text-sm text-slate-400">No tasks found in this category.</p>
          </div>
        ) : (
          filteredTasks.map((t) => (
            <div
              key={t.id}
              onClick={() => !t.completed && onSelectTask(t)}
              className={`p-4 rounded-2xl border transition ${
                t.completed
                  ? 'bg-slate-900/40 border-slate-800/60 opacity-60 cursor-default'
                  : 'bg-slate-900 hover:bg-slate-850 border-slate-800 hover:border-emerald-500/50 cursor-pointer shadow-md'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    {getTypeIcon(t.taskType)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-0.5 bg-slate-800 rounded">
                        {t.taskType}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {t.timerSeconds}s
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white leading-snug">{t.title}</h3>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {t.description}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="inline-block text-sm font-extrabold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-xl mb-2">
                    +₹{t.rewardAmount.toFixed(2)}
                  </span>
                  <div>
                    {t.completed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Claimed
                      </span>
                    ) : (
                      <span className="inline-block text-[11px] font-bold text-slate-300 bg-slate-800 px-3 py-1 rounded-lg border border-slate-700 hover:bg-emerald-500 hover:text-slate-950 transition">
                        Start Task
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

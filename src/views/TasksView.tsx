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
        return <PlayCircle className="w-5 h-5 text-red-500" />;
      case 'website':
        return <Globe className="w-5 h-5 text-blue-500" />;
      case 'channel':
        return <MessageSquare className="w-5 h-5 text-[#0088cc]" />;
      case 'social':
        return <Share2 className="w-5 h-5 text-pink-500" />;
      default:
        return <Sparkles className="w-5 h-5 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Top Header & Progress */}
      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Watch & Earn Tasks</h2>
            <p className="text-xs text-slate-500 mt-0.5">Complete tasks to earn guaranteed INR coins</p>
          </div>
          <div className="text-right">
            <span className="text-[11px] text-slate-400 font-medium">Completed</span>
            <p className="text-sm font-black text-[#0088cc]">
              {completedCount} / {tasks.length}
            </p>
          </div>
        </div>

        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#0088cc] to-[#24a1de] transition-all duration-500 rounded-full"
            style={{ width: `${tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {['all', 'video', 'website', 'channel', 'social'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition ${
              filter === f
                ? 'bg-[#0088cc] text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50'
            }`}
          >
            {f === 'all' ? 'All Tasks' : `${f}s`}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-2.5">
        {filteredTasks.length === 0 ? (
          <div className="p-8 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs">
            <p className="text-sm font-medium text-slate-600">No tasks found in this category.</p>
          </div>
        ) : (
          filteredTasks.map((t) => (
            <div
              key={t.id}
              onClick={() => !t.completed && onSelectTask(t)}
              className={`p-4 rounded-2xl border transition shadow-xs ${
                t.completed
                  ? 'bg-slate-50/70 border-slate-200/70 opacity-60 cursor-default'
                  : 'bg-white hover:bg-slate-50/80 border-slate-200/80 hover:border-sky-300 cursor-pointer'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0 mt-0.5">
                    {getTypeIcon(t.taskType)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 px-2 py-0.5 bg-slate-100 rounded-md">
                        {t.taskType}
                      </span>
                      <span className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
                        <Clock className="w-3 h-3 text-slate-400" /> {t.timerSeconds}s
                      </span>
                    </div>
                    <h3 className="text-xs font-bold text-slate-900 leading-snug">{t.title}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
                      {t.description}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="inline-block text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg mb-2">
                    +₹{t.rewardAmount.toFixed(2)}
                  </span>
                  <div>
                    {t.completed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Claimed
                      </span>
                    ) : (
                      <span className="inline-block text-[11px] font-bold text-white bg-[#0088cc] hover:bg-[#0077b5] px-3 py-1 rounded-lg shadow-2xs transition">
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

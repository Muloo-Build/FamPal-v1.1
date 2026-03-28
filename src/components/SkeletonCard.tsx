import React from 'react';

export const SkeletonCard: React.FC = () => (
  <div className="bg-white rounded-[24px] shadow-[0_8px_32px_rgba(24,0,82,0.07)] overflow-hidden animate-pulse">
    {/* Image placeholder */}
    <div className="w-full h-48 bg-slate-100" />
    {/* Content */}
    <div className="p-4 space-y-3">
      <div className="h-4 bg-slate-100 rounded-full w-3/4" />
      <div className="h-3 bg-slate-100 rounded-full w-1/2" />
      <div className="flex gap-2 pt-1">
        <div className="h-5 bg-slate-100 rounded-full w-20" />
        <div className="h-5 bg-slate-100 rounded-full w-16" />
      </div>
    </div>
  </div>
);

export const SkeletonCardList: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-3 px-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white rounded-[24px] shadow-[0_8px_32px_rgba(24,0,82,0.07)] p-3.5 flex gap-3 animate-pulse">
        <div className="w-20 h-20 rounded-[20px] bg-slate-100 shrink-0" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-4 bg-slate-100 rounded-full w-3/4" />
          <div className="h-3 bg-slate-100 rounded-full w-1/2" />
          <div className="flex gap-1.5 pt-1">
            <div className="h-4 bg-slate-100 rounded-full w-16" />
            <div className="h-4 bg-slate-100 rounded-full w-14" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

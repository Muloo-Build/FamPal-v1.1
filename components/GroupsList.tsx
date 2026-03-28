import React, { useState } from 'react';
import { CircleDoc } from '../lib/circles';

const SAMPLE_CIRCLES = [
  { id: 'sample1', name: 'Date Nights', members: 2, places: 5 },
  { id: 'sample2', name: 'Kids Weekends', members: 4, places: 8 },
];

interface GroupsListProps {
  circles: CircleDoc[];
  onCreateCircle: (name: string) => void;
  onJoinCircle: (code: string) => void;
  onSelectCircle: (circle: CircleDoc) => void;
  onDeleteCircle?: (circleId: string) => void;
  isGuest: boolean;
  userId?: string;
  maxCircles?: number;
}

const GroupsList: React.FC<GroupsListProps> = ({ circles, onCreateCircle, onJoinCircle, onSelectCircle, onDeleteCircle, isGuest, userId, maxCircles = 2 }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const canCreateMore = maxCircles === Infinity || circles.length < maxCircles;

  const handleCreate = () => {
    console.log("[FamPal] handleCreate called, name:", newGroupName, "canCreateMore:", canCreateMore);
    if (newGroupName.trim() && canCreateMore) {
      onCreateCircle(newGroupName.trim());
      setNewGroupName('');
      setShowCreate(false);
    }
  };

  const handleJoin = () => {
    if (!joinCode.trim()) return;
    onJoinCircle(joinCode.trim().toUpperCase());
    setJoinCode('');
  };

  const handleDeleteClick = (e: React.MouseEvent, circleId: string) => {
    e.stopPropagation();
    setConfirmDelete(circleId);
  };

  const handleConfirmDelete = (circleId: string) => {
    if (onDeleteCircle) {
      onDeleteCircle(circleId);
    }
    setConfirmDelete(null);
  };

  if (isGuest) {
    return (
      <div className="p-4 pb-10 space-y-4">
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4 mx-auto">
            <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Circles</h3>
          <p className="text-sm text-slate-500 max-w-xs mx-auto mb-6">
            Create private circles to share and plan activities with your partner, family, or friends.
          </p>
        </div>

        <div className="space-y-3 opacity-60">
          {SAMPLE_CIRCLES.map((sample) => (
            <div
              key={sample.id}
              className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/80 z-10" />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">{sample.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {sample.members} members  {sample.places} places
                  </p>
                </div>
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-purple-50 rounded-2xl p-5 text-center mt-6">
          <p className="text-sm font-semibold text-purple-700 mb-3">
            Log in to create or join circles
          </p>
          <p className="text-xs text-purple-500">
            Share places, add notes, and plan adventures together.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-10 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-slate-800">Your Circles</h2>
        {canCreateMore ? (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-purple-500 text-white text-sm font-semibold rounded-xl hover:bg-purple-600 transition-colors"
          >
            + New Circle
          </button>
        ) : (
          <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg">
            {circles.length}/{maxCircles === Infinity ? '∞' : maxCircles} circles
          </span>
        )}
      </div>

      {!canCreateMore && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
          You've reached the maximum of {maxCircles} circles. Delete a circle to create a new one, or upgrade your plan for unlimited circles.
        </div>
      )}

      {showCreate && canCreateMore && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-purple-100">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Create a new circle</h3>
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g., Our Family, Date Nights, Weekend Crew"
            className="w-full px-4 py-3 bg-slate-50 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300 mb-3"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newGroupName.trim()}
              className="flex-1 py-2 bg-purple-500 text-white text-sm font-semibold rounded-xl hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Circle
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewGroupName(''); }}
              className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {circles.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-600 mb-1">No circles yet</h3>
          <p className="text-xs text-slate-400 max-w-xs">
            Create a circle to share favourite places with your partner, family or friends.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 px-5 py-2 bg-purple-500 text-white text-sm font-semibold rounded-xl hover:bg-purple-600 transition-colors"
          >
            Create your first circle
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {circles.map((circle) => {
            const isOwner = userId && circle.createdBy === userId;
            const isConfirming = confirmDelete === circle.id;
            
            return (
              <div key={circle.id} className="relative">
                {isConfirming ? (
                  <div className="bg-red-50 rounded-2xl p-4 shadow-sm border border-red-200">
                    <p className="text-sm text-red-700 mb-3">
                      Delete "{circle.name}"? This will remove all shared places and cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleConfirmDelete(circle.id)}
                        className="flex-1 py-2 bg-red-500 text-white text-sm font-semibold rounded-xl hover:bg-red-600 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectCircle(circle)}
                      className="flex-1 bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-slate-800">{circle.name}</h3>
                          <p className="text-xs text-slate-500 mt-1">
                            Tap to view members and places
                          </p>
                        </div>
                        <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                    {isOwner && onDeleteCircle && (
                      <button
                        onClick={(e) => handleDeleteClick(e, circle.id)}
                        className="w-11 h-11 flex-shrink-0 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl flex items-center justify-center transition-colors"
                        title="Delete circle"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-purple-100">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Join a circle</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter join code"
            className="flex-1 px-4 py-3 bg-slate-50 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <button
            onClick={handleJoin}
            disabled={!joinCode.trim()}
            className="px-4 py-3 bg-purple-500 text-white text-sm font-semibold rounded-xl hover:bg-purple-600 disabled:opacity-50"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupsList;

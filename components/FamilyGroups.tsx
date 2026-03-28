
import React, { useState } from 'react';
import { FamilyGroup } from '../types';

interface FamilyGroupsProps {
  groups: FamilyGroup[];
  onAddGroup: (group: FamilyGroup) => void;
}

const FamilyGroups: React.FC<FamilyGroupsProps> = ({ groups, onAddGroup }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('Family');

  const handleShare = async (group: FamilyGroup) => {
    const text = `Join my FamPal group "${group.name}"! Use code: ${group.inviteCode}`;
    if (navigator.share) {
      await navigator.share({ title: 'Join FamPal', text, url: window.location.origin });
    } else {
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank');
    }
  };

  return (
    <div className="px-5 py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-[#1E293B]">Circles</h1>
          <p className="text-slate-400 text-sm font-bold">Shared discovery groups</p>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-purple-500 font-black shadow-sm border border-slate-50 active:scale-90"
        >
          {showAdd ? (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          )}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white p-8 rounded-[40px] border border-sky-100 shadow-2xl space-y-5 animate-slide-up">
          <h3 className="font-black text-sky-900 text-lg">Create new Circle</h3>
          <input 
            className="w-full h-14 bg-slate-50 rounded-2xl px-5 font-bold border-none text-sm outline-none focus:ring-2 focus:ring-sky-100"
            placeholder="e.g. Weekend Warriors"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <div className="flex gap-2">
            {['Family', 'School', 'Friends'].map(t => (
              <button 
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 h-12 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${type === t ? 'bg-purple-500 text-white shadow-lg shadow-purple-100' : 'bg-slate-50 text-slate-300 hover:text-slate-400'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <button 
            onClick={() => {
              if (!name) return;
              onAddGroup({ id: Date.now().toString(), name, type, members: ['You'], inviteCode: name.toUpperCase().slice(0,3) + '-' + Math.floor(Math.random()*999) });
              setName('');
              setShowAdd(false);
            }}
            className="w-full h-14 bg-[#1E293B] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl"
          >
            Launch Circle
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
        {groups.map(group => (
          <div key={group.id} className="bg-white p-8 rounded-[40px] border border-slate-50 shadow-sm space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[9px] font-black text-sky-400 uppercase tracking-[0.2em]">{group.type}</span>
                <h3 className="text-xl font-black text-[#1E293B] mt-1">{group.name}</h3>
              </div>
              <button 
                onClick={() => handleShare(group)}
                className="w-11 h-11 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center shadow-inner"
              >
                <span className="text-sm">↗</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex -space-x-3">
                {group.members.map((m, i) => (
                  <div key={i} className="h-9 w-9 rounded-full ring-4 ring-white bg-slate-100 flex items-center justify-center text-[10px] font-black text-sky-400 border border-slate-50">
                    {m[0]}
                  </div>
                ))}
              </div>
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{group.members.length} Members</span>
            </div>

            <div className="flex gap-3">
              <button className="flex-1 h-12 bg-slate-50 rounded-2xl text-[9px] font-black text-slate-400 uppercase tracking-widest hover:bg-purple-50 hover:text-purple-500 transition-colors">Shared Log</button>
              <button className="flex-1 h-12 bg-slate-50 rounded-2xl text-[9px] font-black text-slate-400 uppercase tracking-widest hover:bg-purple-50 hover:text-purple-500 transition-colors">Calendar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FamilyGroups;

import React from 'react';
import { MapPin, SearchX, WifiOff, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  type: 'no-results' | 'error' | 'offline' | 'no-saved' | 'no-circles';
  query?: string;
  onRetry?: () => void;
  onClearFilters?: () => void;
}

const CONFIGS = {
  'no-results': {
    icon: SearchX,
    iconColor: '#0052ff',
    title: 'No places found',
    body: (query?: string) => query
      ? `We couldn't find any family-friendly spots matching "${query}". Try broadening your search or adjusting your filters.`
      : 'No family-friendly spots match your current filters. Try adjusting the radius or removing some filters.',
    action: 'Clear filters',
  },
  'error': {
    icon: WifiOff,
    iconColor: '#e53e3e',
    title: 'Something went wrong',
    body: () => 'We had trouble loading places. Check your connection and try again.',
    action: 'Try again',
  },
  'offline': {
    icon: WifiOff,
    iconColor: '#d97706',
    title: 'You\'re offline',
    body: () => 'No internet connection detected. Connect and tap retry to load places near you.',
    action: 'Retry',
  },
  'no-saved': {
    icon: MapPin,
    iconColor: '#0052ff',
    title: 'No saved places yet',
    body: () => 'Tap the bookmark on any place to save it here. Great spots are waiting to be discovered.',
    action: undefined,
  },
  'no-circles': {
    icon: MapPin,
    iconColor: '#0052ff',
    title: 'No circles yet',
    body: () => 'Create a circle to share great family spots with friends or family.',
    action: undefined,
  },
};

export const EmptyState: React.FC<EmptyStateProps> = ({ type, query, onRetry, onClearFilters }) => {
  const config = CONFIGS[type];
  const Icon = config.icon;

  const handleAction = () => {
    if (type === 'no-results' && onClearFilters) onClearFilters();
    else if (onRetry) onRetry();
  };

  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      {/* Icon circle */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
        style={{ backgroundColor: `${config.iconColor}12` }}
      >
        <Icon size={36} style={{ color: config.iconColor }} strokeWidth={1.5} />
      </div>
      {/* Decorative circles */}
      <div className="absolute w-40 h-40 rounded-full bg-[#0052ff]/[0.03] -z-10" />

      <h3 className="text-lg font-bold text-[#180052] mb-2">{config.title}</h3>
      <p className="text-sm text-[#4a5568] leading-relaxed max-w-xs">{config.body(query)}</p>

      {config.action && (onRetry || onClearFilters) && (
        <button
          onClick={handleAction}
          className="mt-6 flex items-center gap-2 bg-[#0052ff] text-white font-bold rounded-full px-6 py-2.5 text-sm shadow-[0_4px_20px_rgba(0,82,255,0.28)] active:scale-95 transition-all"
        >
          <RefreshCw size={14} />
          {config.action}
        </button>
      )}
    </div>
  );
};

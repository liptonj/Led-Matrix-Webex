import { cn } from '@/lib/utils';
import type { WebexStatus } from '@/types';

interface StatusIndicatorProps {
  status: WebexStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const statusColors: Record<WebexStatus, string> = {
  active: 'bg-status-active',
  meeting: 'bg-status-meeting',
  dnd: 'bg-status-dnd',
  away: 'bg-status-away',
  ooo: 'bg-purple',
  offline: 'bg-status-offline',
  unknown: 'bg-status-offline',
};

const statusLabels: Record<WebexStatus, string> = {
  active: 'Available',
  meeting: 'In a Call',
  dnd: 'Do Not Disturb',
  away: 'Away',
  ooo: 'Out of Office',
  offline: 'Offline',
  unknown: 'Unknown',
};

export function StatusIndicator({ 
  status, 
  size = 'md', 
  showLabel = false, 
  className 
}: StatusIndicatorProps) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn(
          'rounded-full',
          sizeClasses[size],
          statusColors[status] || statusColors.unknown
        )}
        role="img"
        aria-label={statusLabels[status]}
      />
      {showLabel && (
        <span className="text-sm">{statusLabels[status]}</span>
      )}
    </span>
  );
}

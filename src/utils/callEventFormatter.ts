export function formatCallEventPreview(body: string, currentUserId?: string): string {
  if (!body) return '';

  if (body.startsWith('[CALL_EVENT]:')) {
    const parts = body.split(':');
    const callType = (parts[1] || 'audio') as 'audio' | 'video';
    let status = parts[2] || 'ended';
    if (status === 'rejected') status = 'declined';
    const duration = parseInt(parts[3] || '0', 10);
    const callerId = parts[4];
    const isCaller = currentUserId && callerId ? currentUserId === callerId : false;

    const icon = callType === 'video' ? '🎥' : '📞';
    const typeLabel = callType === 'video' ? 'Video Call' : 'Voice Call';

    const formatDuration = (secs: number) => {
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
    };

    if (status === 'missed') {
      return isCaller ? `${icon} No Answer` : `${icon} Missed ${typeLabel}`;
    }
    if (status === 'no_response') {
      return `${icon} No Answer`;
    }
    if (status === 'busy') {
      return `${icon} Busy`;
    }
    if (status === 'declined') {
      return `${icon} Declined ${typeLabel}`;
    }
    if (status === 'cancelled' || status === 'cancelled_by_caller') {
      return `${icon} Cancelled ${typeLabel}`;
    }
    if (status === 'ended' || status === 'completed' || status === 'accepted') {
      if (duration > 0) {
        return `${icon} ${typeLabel} • ${formatDuration(duration)}`;
      }
      return `${icon} ${typeLabel}`;
    }

    return `${icon} ${typeLabel}`;
  }

  if (body.startsWith('[GROUP_CALL_EVENT]:')) {
    const parts = body.split(':');
    const callType = (parts[2] || 'audio') as 'audio' | 'video';
    const status = parts[3] || 'ended';
    const duration = parseInt(parts[5] || '0', 10);

    const icon = callType === 'video' ? '🎥' : '📞';
    const typeLabel = callType === 'video' ? 'Group Video Call' : 'Group Voice Call';

    const formatDuration = (secs: number) => {
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
    };

    if (status === 'active' || status === 'ringing') {
      return `${icon} ${typeLabel} In Progress`;
    }
    if (status === 'ended') {
      if (duration > 0) {
        return `${icon} ${typeLabel} • ${formatDuration(duration)}`;
      }
      return `${icon} ${typeLabel}`;
    }

    return `${icon} ${typeLabel}`;
  }

  return body;
}

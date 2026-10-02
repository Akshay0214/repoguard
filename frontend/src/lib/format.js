export function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}
export function formatDateTime(iso) {
    return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
export function formatRelativeTime(iso) {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60)
        return `${diffMins}m ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24)
        return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 30)
        return `${diffDays}d ago`;
    const diffMonths = Math.round(diffDays / 30);
    return `${diffMonths}mo ago`;
}
export function formatNumber(n) {
    return new Intl.NumberFormat('en-US').format(n);
}
export function formatHours(hours) {
    const days = hours / 8;
    if (days >= 1)
        return `${hours}h (~${days.toFixed(1)}d)`;
    return `${hours}h`;
}

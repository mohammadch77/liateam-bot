const RUN = { ok: ['b-ok', 'موفق'], warning: ['b-warn', 'هشدار'], failed: ['b-bad', 'شکست'] };
export const RunBadge = ({ status, big }) => {
  const [cls, label] = RUN[status] || ['b-hidden', status];
  return <span className={`badge ${cls}${big ? ' badge-big' : ''}`}>{label}</span>;
};

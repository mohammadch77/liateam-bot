const RUN = { ok: ['b-ok', 'موفق'], warning: ['b-warn', 'هشدار'], failed: ['b-bad', 'شکست'] };
export const RunBadge = ({ status }) => {
  const [cls, label] = RUN[status] || ['b-hidden', status];
  return <span className={`badge ${cls}`}>{label}</span>;
};

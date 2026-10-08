// Shown instead of a page when Postgres is unreachable. Only the error code is shown (no connection string).
export default function DbError({ error }) {
  console.error('DB error:', error?.code ?? error?.message);
  return (
    <>
      <div className="page-head"><h1>اتصال دیتابیس</h1></div>
      <div className="banner bad">اتصال به PostgreSQL برقرار نشد ({error?.code || 'unknown'}). سرویس دیتابیس و DASHBOARD_DATABASE_URL را بررسی کنید.</div>
    </>
  );
}

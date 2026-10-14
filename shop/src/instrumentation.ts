/** Runs once when the server process starts: validate the environment before any request is served. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupChecks } = await import('@/lib/startup');
    runStartupChecks();
  }
}

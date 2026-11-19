// Runs once when the server starts (Next.js instrumentation hook).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  // Create the first owner account from OWNER_EMAIL so it exists before
  // anyone signs in. Never fatal: sign-in does the same thing as a fallback.
  if (process.env.OWNER_EMAIL) {
    try {
      const { ensureOwner } = await import('./lib/auth');
      await ensureOwner();
      console.log("Owner account ready");
    } catch (error) {
      console.error('Could not ensure the owner account at startup:', error);
    }
  }
}

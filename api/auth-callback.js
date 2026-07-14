// Handle Supabase auth callbacks (password reset, email confirmation, invites).
// Redirects from Supabase email links to the app with the token/code in the URL.

export default async function handler(req, res) {
  const { type, code } = req.query;

  // Redirect to the app with the token so the client-side auth state updates
  // Supabase Auth automatically picks up the session token from the URL
  const redirectPath = {
    recovery: "/auth/reset-password",
    confirmation: "/auth/confirm-email",
    invite: "/app/invite",
  }[type] || "/";

  // Keep the code in the URL so the browser can complete the auth flow
  const fullPath = code ? `${redirectPath}?code=${code}` : redirectPath;
  res.redirect(307, fullPath);
}

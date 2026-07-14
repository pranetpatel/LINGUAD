# Lingua Email Templates Setup

This guide explains how to configure the branded email templates in Supabase.

## Overview

We've created professional, branded email templates for all authentication flows:
- ✅ Email Confirmation (sign-up)
- ✅ Password Reset (forgot password)
- ✅ Invitations (household members)

All templates use the Lingua branding (teal + cream colors, logo, fonts) and are stored in `email-templates/` and migrated via `supabase/migrations/0004_email_templates.sql`.

## Setup Steps

### 1. Apply the Migration

Run the Supabase migration to update email templates:

```bash
supabase migration up
```

Or, if running locally with Supabase CLI:

```bash
supabase db push
```

### 2. Configure SMTP (Already Done ✅)

Since you've already integrated SMTP, Supabase will use your configured mail server to send emails. The templates will automatically use:
- Your SMTP credentials (configured in Supabase dashboard)
- Custom "from" address (e.g., noreply@lingua.family)

### 3. Update Email Branding Links

In `supabase/migrations/0004_email_templates.sql`, update these URLs to match your domain:

- `https://lingua.family/icon-192.png` → Your logo URL
- `https://lingua.family` → Your website
- `https://lingua.family/privacy` → Your privacy policy
- `https://lingua.family/terms` → Your terms of service
- `https://lingua.family/help` → Your help center
- `https://lingua.family/contact` → Your contact page

### 4. Verify Auth Routes

The following routes handle the email link callbacks:

- **Password Reset Confirmation:** `/auth/reset-password`
- **Email Verification:** `/auth/confirm-email`
- **Invite Acceptance:** `/app/invite`

These are automatically handled by Supabase and the app's routing.

## Template Customization

### Colors Used

- **Primary (Teal):** `#1a5f4a` – Main CTA buttons
- **Secondary (Teal):** `#2d7a60` – Hover states
- **Accent (Cream):** `#f4e8d8` – Header text, highlights
- **Text (Charcoal):** `#2d3748` – Body text
- **Fade (Gray):** `#718096` – Secondary text
- **Light Background:** `#f7fafc` – Footer background

### Fonts

- **Display:** Fraunces (serif) – Headlines
- **Body:** Albert Sans (sans-serif) – Body copy

These are loaded via Google Fonts in the HTML.

## Testing Email Templates

### Send a Test Confirmation Email

1. Go to Supabase Dashboard → Authentication → Email Templates
2. Select "Confirmation Email" template
3. Click "Preview" to see the template rendering
4. Create a new test account to trigger a confirmation email

### Test Password Reset

1. Sign in with an account
2. Click "Forgot password?" on the login page
3. Enter the email and check your inbox
4. Click the reset link

### Test Invite Emails

1. Create a new household
2. Go to Settings → Invite Members
3. Enter a new email address
4. Check that inbox for the invite email

## Email Variables

Supabase email templates support these variables:

- `{{ .Email }}` – User's email address
- `{{ .ConfirmationURL }}` – Link to confirm email
- `{{ .RecoveryURL }}` – Link to reset password
- `{{ .InvitationURL }}` – Link to accept invite

These are automatically populated by Supabase when sending emails.

## Customization Guide

To modify colors, fonts, or layout:

1. Edit `email-templates/*.html` directly (for reference)
2. Update `supabase/migrations/0004_email_templates.sql` with your changes
3. Run `supabase migration up` to apply

## Email Service Integration

Since SMTP is configured, emails will be sent with:
- Custom "from" address (set in Supabase settings)
- Custom "reply-to" address
- Full HTML rendering with inline CSS
- Automatic text fallback for clients that don't support HTML

## Troubleshooting

### Emails not sending

1. Check Supabase dashboard → Authentication → Providers → Email
2. Verify SMTP credentials are correct
3. Check email bounce logs in Supabase

### Images not loading

- Ensure `https://lingua.family/icon-192.png` is accessible
- Use absolute URLs (not relative) for all images

### Links going to wrong place

- Verify redirect routes in `api/auth-callback.js`
- Check `redirectTo` parameter in password reset call (in App.jsx)

### Template not updating

- Run `supabase db push` to ensure migration is applied
- Clear browser cache (Supabase caches template renders)
- Check Supabase logs for errors

## File Reference

- `email-templates/` – HTML templates for reference
- `supabase/migrations/0004_email_templates.sql` – Template SQL (applied to Supabase)
- `src/App.jsx` – Forgot password flow UI (lines ~1388+)
- `src/PasswordReset.jsx` – Password reset confirmation page
- `api/auth-callback.js` – Email link callback handler

## Next Steps

1. ✅ Deploy the app (templates + password reset routes)
2. ✅ Test email confirmations with a test account
3. ✅ Test password reset flow
4. ✅ Test invite emails from household settings
5. ✅ Update branding links to your production domains

---

**Questions?** Check the [Supabase Email Templates documentation](https://supabase.com/docs/guides/auth/auth-email-templates).

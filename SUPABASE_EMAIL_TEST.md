# Supabase Email Configuration Test

Quick checklist to verify your email setup is working correctly.

## ✅ Pre-Deployment Verification

### 1. Check SMTP Configuration
In Supabase Dashboard → Authentication → Providers → Email:

- [ ] SMTP Host is set
- [ ] SMTP Port is configured (usually 587 or 465)
- [ ] SMTP User/Password are correct
- [ ] TLS/SSL is enabled
- [ ] "From Email" is set to your domain (e.g., noreply@lingua.family)
- [ ] "From Name" is set (e.g., "Lingua")

### 2. Test Email Sending

#### Method A: Create a test account
1. Go to your app's sign-up form
2. Fill in: name, email (test@example.com), password
3. Check the inbox at test@example.com
4. Should receive branded confirmation email

#### Method B: Use Supabase CLI
```bash
supabase functions invoke email-test --local
```

#### Method C: Check Supabase logs
1. Go to Supabase Dashboard → Logs
2. Filter by "auth.email"
3. Look for successful sends or error messages

### 3. Verify Email Templates Applied

In Supabase Dashboard → Authentication → Email Templates:

- [ ] Confirmation email template is showing (with Lingua branding)
- [ ] Recovery (password reset) template is showing
- [ ] Magic Link (invite) template is showing

**Templates should display:**
- Lingua logo and colors (teal + cream)
- Branded buttons
- Professional layout
- Your website links (lingua.family)

### 4. Test Each Flow

#### Test Confirmation Email
1. Sign up with a new email
2. Check inbox for "Welcome to Lingua! 🎉" subject
3. Click confirmation link
4. Account should be verified

#### Test Password Reset Email
1. Sign in with any account
2. Click "Forgot password?"
3. Enter email → click "Send Reset Link"
4. Check inbox for reset link
5. Click link → set new password
6. Should see success screen

#### Test Invite Email
1. Create a household (sign up)
2. Go to Settings → Invite Members
3. Enter a new email address
4. Check that inbox for invite
5. Click invite link or sign up from link

---

## 🔧 Common Issues & Fixes

### "Email not sending" or "SMTP error"

**Solution:**
```bash
# Check SMTP credentials in dashboard
# 1. Go to Supabase → Authentication → Email
# 2. Test the connection
# 3. Check firewall (port 587 or 465 must be open)
```

### "Email sending but branding isn't showing"

**Solution:**
1. Check migration was applied: `supabase migration list`
2. Verify migration `0004_email_templates.sql` ran successfully
3. Clear browser cache → refresh
4. Re-check email templates in dashboard

### "Links in email go to wrong URL"

**Solution:**
1. Check domain in email templates (`https://lingua.family`)
2. Verify your actual domain and update if different
3. Check API routes exist: `/auth/reset-password`, `/auth/confirm-email`

### "Template shows raw HTML instead of formatted"

**Solution:**
1. Email client issue (check in Gmail/Outlook online versions)
2. Verify HTML is being sent as `text/html`
3. Try resending from a different email client

### "Too many emails or rate limiting"

**Solution:**
1. Check Supabase → Settings → Rate Limits
2. If developing locally, use test email addresses only
3. Consider using dedicated test accounts vs creating new ones constantly

---

## 📊 Email Monitoring

### Supabase Dashboard

Go to **Logs** → Filter by:
- `auth.email` – all email events
- `auth.email_sent` – successful sends
- `auth.email_failed` – failed sends

### What to look for

✅ **Good:**
```
auth.email_sent
event: email_confirmation
to: user@example.com
status: sent
```

❌ **Bad:**
```
auth.email_failed
event: email_confirmation
to: user@example.com
error: SMTP connection failed
```

---

## 🚀 Go-Live Checklist

- [ ] SMTP credentials verified in Supabase
- [ ] Email templates displaying correctly
- [ ] Confirmation email flow works end-to-end
- [ ] Password reset flow works end-to-end
- [ ] Invite email flow works end-to-end
- [ ] Links in emails point to correct URLs
- [ ] Branding colors/logos showing in emails
- [ ] No SMTP errors in Supabase logs
- [ ] "From" address matches your domain
- [ ] Reply-to address configured (optional but recommended)

---

## 📝 Quick Reference: Email Variables

These are auto-filled by Supabase:

```liquid
{{ .Email }}           → user@example.com
{{ .ConfirmationURL }} → https://yourapp.com/auth/confirm?token=...
{{ .RecoveryURL }}     → https://yourapp.com/auth/reset?token=...
{{ .InvitationURL }}   → https://yourapp.com/invite?token=...
```

---

## 🆘 Still Having Issues?

1. Check Supabase Status: https://status.supabase.com
2. Review Supabase Docs: https://supabase.com/docs/guides/auth
3. Check email provider limits (Gmail, Outlook have rate limits)
4. Test with simple text email first (no HTML)

---

**Last Updated:** 2024-07-14
**Email Templates Version:** 1.0
**Next Check:** After first production deployment

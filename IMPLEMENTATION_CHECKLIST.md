# 🚀 Implementation Checklist

Complete this checklist to launch the new authentication & email system.

## Phase 1: Local Development Testing

### 1.1 Install Dependencies
- [ ] Verify `@supabase/supabase-js` is installed
- [ ] Check that all imports in `src/App.jsx` resolve
- [ ] Verify `PasswordReset.jsx` component loads without errors

### 1.2 Database Migrations
- [ ] Run `supabase migration up` (or `supabase db push`)
- [ ] Verify migration `0004_email_templates.sql` applied successfully
- [ ] Check Supabase Dashboard → Email Templates showing 4 templates:
  - [ ] Confirmation (with Lingua branding)
  - [ ] Recovery (with security warning)
  - [ ] Magic Link (for invites)
  - [ ] (Optional: one more for other flows)

### 1.3 Test Sign-Up Flow
- [ ] Click "Join" → Create account form
- [ ] Fill: name, email (personal test email), password
- [ ] Submit → Should see success message
- [ ] Check email inbox → Should receive "Welcome to Lingua! 🎉" email
  - [ ] Email displays Lingua logo
  - [ ] Colors are correct (teal header, cream text)
  - [ ] "Confirm Email Address" button is clickable
  - [ ] Click button → Account confirmed

### 1.4 Test Password Reset Flow
- [ ] Sign in with any account
- [ ] Click "Forgot password?" link
- [ ] Should navigate to forgot password screen
- [ ] Enter email → Click "Send Reset Link"
- [ ] Should see "Check your email" confirmation screen
- [ ] Check email inbox → Should receive "Reset Your Lingua Password" email
  - [ ] Email displays correctly
  - [ ] "Reset Password" button is clickable
  - [ ] Warning notice about 1-hour expiration shows
  - [ ] Click button → Taken to `/auth/reset-password`
  - [ ] Page displays "Reset your password" form
  - [ ] Enter new password twice
  - [ ] Submit → Should see success screen "Password reset!"
  - [ ] Sign in with new password → Works ✅

### 1.5 Test Invite Flow (if available)
- [ ] Create a new household (sign up or existing)
- [ ] Navigate to Settings → Invite Members
- [ ] Enter a new email address
- [ ] Submit invite → Should see success
- [ ] Check email inbox → Should receive "Join a Lingua Household!" email
  - [ ] Email shows inviter name
  - [ ] "Accept Invitation" button works
  - [ ] Click link → Household invite flow

---

## Phase 2: Code Quality & Testing

### 2.1 Code Review
- [ ] `src/App.jsx` changes reviewed:
  - [ ] "Forgot password?" link added to signin view
  - [ ] New "forgotpw" and "resetsent" views implemented
  - [ ] Error handling for email entry
  - [ ] Supabase `resetPasswordForEmail()` called correctly
- [ ] `src/PasswordReset.jsx` reviewed:
  - [ ] Imports are correct
  - [ ] Component handles all states (loading, reset, success, error)
  - [ ] Password validation works (6+ chars, match)
  - [ ] Error messages display correctly
- [ ] `api/auth-callback.js` reviewed:
  - [ ] Redirects for recovery/confirmation/invite paths
  - [ ] Code parameter passed through correctly

### 2.2 Type Checking (if using TypeScript)
- [ ] Run TypeScript compiler (if applicable)
- [ ] No type errors in new components
- [ ] Supabase types correctly imported

### 2.3 Browser Testing
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browser (iPhone/Android)
- [ ] Test on different screen sizes (mobile, tablet, desktop)

### 2.4 Email Client Testing
- [ ] Gmail (web)
- [ ] Gmail (mobile app)
- [ ] Outlook (web)
- [ ] Apple Mail (desktop and mobile)
- [ ] Verify templates render correctly in each

---

## Phase 3: Configuration & Setup

### 3.1 Update Domain References
Find all instances of `https://lingua.family` and update to your domain:
- [ ] In `supabase/migrations/0004_email_templates.sql`:
  - [ ] Logo URL: `https://lingua.family/icon-192.png`
  - [ ] Website: `https://lingua.family`
  - [ ] Privacy: `https://lingua.family/privacy`
  - [ ] Terms: `https://lingua.family/terms`
  - [ ] Help: `https://lingua.family/help`
  - [ ] Contact: `https://lingua.family/contact`

### 3.2 Email Configuration
- [ ] Verify SMTP is configured in Supabase (you mentioned this is done ✅)
- [ ] Check "From Email" address (e.g., noreply@lingua.family)
- [ ] Check "From Name" (e.g., "Lingua")
- [ ] Verify SMTP credentials are correct
- [ ] Test SMTP connection in Supabase dashboard

### 3.3 Environment Variables
- [ ] `VITE_SUPABASE_URL` is set
- [ ] `VITE_SUPABASE_ANON_KEY` is set
- [ ] `SUPABASE_URL` is set (backend)
- [ ] `SUPABASE_ANON_KEY` is set (backend)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set (for admin operations)

### 3.4 API Routes
- [ ] Verify `/auth/reset-password` route exists in app
- [ ] Verify `/auth/confirm-email` route exists
- [ ] Verify `/app/invite` route exists
- [ ] All routes render appropriate components

---

## Phase 4: Pre-Deployment

### 4.1 Git & Version Control
- [ ] All new files added to git:
  - [ ] `src/PasswordReset.jsx`
  - [ ] `api/auth-callback.js`
  - [ ] `supabase/migrations/0004_email_templates.sql`
  - [ ] `email-templates/` (all HTML files)
  - [ ] Documentation files (EMAIL_SETUP.md, etc.)
- [ ] Reviewed git diff for changes:
  - [ ] `src/App.jsx` (password reset UI added)
  - [ ] No accidental changes to other files

### 4.2 Testing Summary
- [ ] All manual tests passed ✅
- [ ] Email templates display correctly ✅
- [ ] Password reset flow works end-to-end ✅
- [ ] Invite flow works ✅
- [ ] Confirmation emails send ✅
- [ ] No console errors in browser ✅
- [ ] No Supabase auth errors ✅

### 4.3 Documentation
- [ ] `EMAIL_SETUP.md` reviewed and up-to-date
- [ ] `AUTH_FLOW_SUMMARY.md` reviewed
- [ ] `BRANDING_GUIDE.md` reviewed
- [ ] `SUPABASE_EMAIL_TEST.md` available for team

### 4.4 Security Review
- [ ] No secrets in code (API keys, SMTP credentials)
- [ ] All credentials in environment variables ✅
- [ ] Password validation (6+ characters)
- [ ] HTTPS enforced (redirectTo URLs)
- [ ] CSRF protection (Supabase handles this) ✅
- [ ] Rate limiting considered (Supabase handles this) ✅

---

## Phase 5: Production Deployment

### 5.1 Pre-Deploy Backup
- [ ] Database backup taken (Supabase auto-backup ✅)
- [ ] Configuration saved

### 5.2 Deploy
```bash
# 1. Commit changes
git add .
git commit -m "feat: add password reset and branded email templates"

# 2. Run migrations on production
# If using Vercel + Supabase:
vercel deploy

# This will:
# - Push code to Vercel
# - Run any new migrations automatically
# - Update environment variables
```

- [ ] Deployment succeeds without errors
- [ ] Vercel build completes ✅
- [ ] Supabase migration applies ✅

### 5.3 Post-Deploy Verification
- [ ] App loads on production URL
- [ ] Sign-up works
- [ ] Receive confirmation email (check spam folder)
- [ ] Email displays correctly (all branding)
- [ ] Password reset works end-to-end
- [ ] Invite flow works
- [ ] No 404 errors for `/auth/reset-password` etc.
- [ ] Check Supabase logs for errors:
  - [ ] No SMTP failures
  - [ ] No auth errors

### 5.4 Monitoring
- [ ] Set up email delivery monitoring (optional):
  - [ ] SendGrid stats
  - [ ] Bounce rate monitoring
  - [ ] Unsubscribe tracking
- [ ] Monitor Supabase logs for issues
- [ ] Check browser console for JavaScript errors
- [ ] Monitor auth flow funnels (signup → confirm → signin)

---

## Phase 6: Communication & Launch

### 6.1 Team Notification
- [ ] Notify team about new password reset feature
- [ ] Share documentation links:
  - [ ] EMAIL_SETUP.md
  - [ ] AUTH_FLOW_SUMMARY.md
  - [ ] BRANDING_GUIDE.md

### 6.2 User Communication (Optional)
- [ ] Update help docs/FAQ
- [ ] Add "Forgot password?" info to support docs
- [ ] Monitor user feedback for any issues

### 6.3 Future Maintenance
- [ ] Set reminders to test email flows monthly
- [ ] Monitor SMTP logs quarterly
- [ ] Update email templates if branding changes
- [ ] Review and update documentation as needed

---

## Quick Reference: Trouble Spots

### Email not sending
→ Check `SUPABASE_EMAIL_TEST.md` for troubleshooting

### Wrong branding in emails
→ Verify migration applied: `supabase migration list`
→ Clear cache and re-check Supabase dashboard

### Links go to wrong URL
→ Update domain references in `supabase/migrations/0004_email_templates.sql`
→ Check that routes exist in app (`/auth/reset-password`, etc.)

### Password reset page doesn't load
→ Verify `src/PasswordReset.jsx` imported and rendered correctly
→ Check route in main app component

### SMTP errors in logs
→ Verify SMTP credentials in Supabase → Authentication → Email
→ Check firewall allows port 587 or 465

---

## 📋 Sign-Off

- **Implemented by:** You 🚀
- **Date:** 2024-07-14
- **Status:** Ready for deployment
- **Next steps:** Follow Phase 5 (Production Deployment)

---

## ✅ Final Checklist

- [ ] All testing completed
- [ ] Team reviewed changes
- [ ] Documentation is clear
- [ ] No blockers remain
- [ ] Ready to deploy! 🎉

**Good to launch?** Yes! Proceed to Phase 5.

---

*Last updated: 2024-07-14*

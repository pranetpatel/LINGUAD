# 🚀 Quick Reference Card

**Keep this open while deploying!**

---

## Deploy in 3 Commands

```bash
# 1. Apply database migration
supabase db push

# 2. Test locally
npm run dev

# 3. Deploy to production
vercel deploy
```

---

## File Location Reference

| Feature | File |
|---------|------|
| Forgot password UI | `src/App.jsx` (lines ~1388-1441) |
| Password reset page | `src/PasswordReset.jsx` |
| Email callback | `api/auth-callback.js` |
| Email templates SQL | `supabase/migrations/0004_email_templates.sql` |
| Confirmation template | `email-templates/confirm-email.html` |
| Password reset template | `email-templates/password-reset.html` |
| Invite template | `email-templates/invite-user.html` |

---

## Email Template Colors

```css
Primary Teal:    #1a5f4a
Secondary Teal:  #2d7a60
Cream/Gold:      #f4e8d8
Charcoal:        #2d3748
Gray:            #718096
```

---

## Testing Checklist (5 min)

- [ ] Sign-up → Check confirmation email arrives
- [ ] Click confirmation link → Account confirmed ✅
- [ ] Click "Forgot password?" → Email form ✅
- [ ] Enter email → See "Check your email" ✅
- [ ] Click reset link → See password reset page ✅
- [ ] Set new password → See success screen ✅
- [ ] Sign in with new password → Works ✅

---

## Domain URLs to Update

Update in `supabase/migrations/0004_email_templates.sql`:

```
https://lingua.family        → Your website
https://lingua.family/icon   → Your logo URL
https://lingua.family/help   → Help center
https://lingua.family/contact → Contact form
```

---

## Supabase Dashboard Checklist

After deploying, verify in Supabase:

1. **Authentication → Email Templates**
   - [ ] Confirmation email shows Lingua branding
   - [ ] Recovery email shows security warning
   - [ ] Magic Link email shows invite message

2. **Logs**
   - [ ] No SMTP errors
   - [ ] Emails showing as "sent"

3. **Settings → Email**
   - [ ] SMTP is configured (you did this already ✅)
   - [ ] From address set (e.g., noreply@lingua.family)

---

## Common Issues & Fixes

| Problem | Solution |
|---------|----------|
| Migration won't run | `supabase status` to check Supabase connection |
| Email not sending | Check Supabase logs → Email section |
| Wrong branding in email | Clear cache, verify migration applied |
| Reset link 404s | Check route exists: `/auth/reset-password` |
| Password update fails | Check user is authenticated in Supabase |

---

## API Routes

Three routes handle email callbacks:

| Route | Purpose | Type |
|-------|---------|------|
| `/auth/reset-password` | Password reset confirmation | React component |
| `/auth/confirm-email` | Email confirmation | Supabase handles |
| `/app/invite` | Household invite acceptance | React component |

---

## Component State Machine

### PasswordReset.jsx

```
loading → reset → success
   ↓        ↓
   └─ error ─┘
```

### App.jsx Forgot Password Views

```
signin → forgotpw → resetsent
   ↑        ↓          ↓
   └─────────┴──────────┘
       (back links)
```

---

## Environment Variables (Verify These)

```
VITE_SUPABASE_URL              = https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY         = eyJhbGc...
SUPABASE_URL                   = https://xxxxx.supabase.co
SUPABASE_ANON_KEY              = eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY      = eyJhbGc... (service role)
```

**Note:** SMTP credentials should be in Supabase dashboard (not env vars)

---

## Database Schema Context

```sql
auth.users
  ├── id (UUID)
  ├── email
  ├── raw_user_meta_data (JSON)
  └── [password encrypted]

households
  ├── id (UUID)
  ├── account_id (UUID → auth.users.id)
  ├── version
  └── data (JSONB)

household_members
  ├── household_id (UUID)
  ├── user_id (UUID → auth.users.id)
  ├── role ('owner' | 'member')
  └── created_at

household_invites
  ├── id (UUID)
  ├── household_id (UUID)
  ├── email
  ├── status ('pending' | 'accepted' | 'revoked')
  ├── member_seed (JSONB)
  └── created_at
```

---

## Vercel Deployment Checklist

Before `vercel deploy`:

- [ ] All files committed to git
- [ ] No uncommitted changes (`git status`)
- [ ] Vercel linked to project
- [ ] Environment variables synced
- [ ] Ready to run migrations

---

## Post-Deployment Verification

1. **Check Vercel Build**
   - Go to Vercel dashboard → Deployments
   - Verify build succeeded (green checkmark)

2. **Check Supabase**
   - Go to Supabase dashboard
   - Migrations → Verify 0004 shows "success"
   - Email Templates → Should see updated templates

3. **Test Production App**
   - Sign up with test email
   - Check inbox for confirmation
   - Test password reset flow

4. **Monitor Logs**
   - Supabase → Logs section
   - Filter by "email" or "auth"
   - Look for successful sends

---

## Documentation Quick Links

| Doc | For |
|-----|-----|
| `EMAIL_SETUP.md` | How to configure everything |
| `IMPLEMENTATION_CHECKLIST.md` | Step-by-step deployment |
| `BRANDING_GUIDE.md` | Design customization |
| `SUPABASE_EMAIL_TEST.md` | Testing & troubleshooting |
| `AUTH_FLOW_SUMMARY.md` | How flows work |
| `DEPLOYMENT_SUMMARY.md` | Overview & status |

---

## Team Communication Template

```
🚀 Password Reset & Email Templates Deployed

✅ What's new:
- Users can now reset forgotten passwords
- All auth emails have Lingua branding
- Professional templates for signup, reset, invites

📧 How it works:
1. Click "Forgot password?" on login
2. Enter email → receive reset link
3. Click link → set new password
4. Sign in with new credentials

📚 Docs available:
- [EMAIL_SETUP.md] - Configuration guide
- [IMPLEMENTATION_CHECKLIST.md] - How we deployed it
- [BRANDING_GUIDE.md] - Design details

❓ Questions? Check the documentation files above.
```

---

## Success Indicators ✅

After deployment, you should see:

- [ ] User can click "Forgot password?" on login
- [ ] Email arrives in user's inbox within 1-2 minutes
- [ ] Email displays with Lingua logo and branding
- [ ] Reset link works and loads password reset page
- [ ] New password works for sign-in
- [ ] Sign-up confirmations also use new branded template
- [ ] Invite emails use new branded template

---

## Rollback Plan (if needed)

```bash
# If something breaks, rollback migration:
# 1. Revert last commit
git revert HEAD

# 2. Force redeploy previous version
vercel deploy --prod

# 3. Contact Supabase if email templates corrupted
# Go to dashboard → Email Templates → edit manually
```

---

**Time to Deploy:** ~10 minutes
**Time to Test:** ~5 minutes
**Total:** ~15 minutes

**Status:** ✅ Ready Now!

---

*Print this page or bookmark it for easy reference during deployment!*

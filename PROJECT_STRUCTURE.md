# Project Structure - Updated

Overview of all files related to authentication and email templates.

## 📂 Complete File Tree

```
lingua-web/
├── api/
│   ├── _auth.js                          # Supabase auth helper
│   ├── _ai.js                            # AI endpoint
│   ├── ai.js                             # AI proxy
│   ├── tts.js                            # Text-to-speech
│   ├── config.js                         # Config endpoint
│   ├── accept-invite.js                  # Accept household invite
│   ├── invite.js                         # Send household invite
│   └── auth-callback.js                  # ✨ NEW: Email callback handler
│
├── src/
│   ├── main.jsx                          # App entry
│   ├── App.jsx                           # ✨ UPDATED: Added forgot password UI
│   ├── supabase.js                       # Supabase client + data layer
│   ├── speechScore.js                    # Speech scoring
│   └── PasswordReset.jsx                 # ✨ NEW: Password reset page
│
├── supabase/
│   ├── config.toml                       # Supabase project config
│   ├── migrations/
│   │   ├── 0001_households.sql           # Households table schema
│   │   ├── 0002_household_on_signup.sql  # Auto-create household trigger
│   │   ├── 0003_household_membership.sql # Membership & invites schema
│   │   └── 0004_email_templates.sql      # ✨ NEW: Branded email templates
│   └── functions/
│       ├── ai/
│       ├── tts/
│       └── ... (cloud functions)
│
├── email-templates/                      # ✨ NEW: Email template files
│   ├── base.html                         # Base template (reference)
│   ├── confirm-email.html                # Sign-up confirmation
│   ├── password-reset.html               # Password reset
│   └── invite-user.html                  # Household invite
│
├── public/
│   ├── icon-192.png                      # Lingua logo (used in emails)
│   ├── icon-512.png
│   ├── manifest.webmanifest
│   └── sw.js
│
├── server/                               # Self-hosted backend (optional)
│   ├── auth.js                           # Local auth (alternative)
│   ├── store.js
│   ├── stores/
│   └── ...
│
├── dist/                                 # Build output
├── node_modules/                         # Dependencies
│
├── .vercel/                              # Vercel config
├── .claude/                              # Claude Code config
├── .gitignore
├── package.json
├── vite.config.js                        # Vite build config
│
├── Documentation/                        # ✨ NEW: Auth & email docs
│   ├── EMAIL_SETUP.md                    # Setup guide
│   ├── AUTH_FLOW_SUMMARY.md              # Flow documentation
│   ├── BRANDING_GUIDE.md                 # Design system
│   ├── SUPABASE_EMAIL_TEST.md            # Testing guide
│   ├── IMPLEMENTATION_CHECKLIST.md       # Deployment checklist
│   ├── DEPLOYMENT_SUMMARY.md             # Executive summary
│   └── PROJECT_STRUCTURE.md              # This file
│
└── README.md                             # Project readme
```

---

## 🎯 What Changed

### New Files (✨ Added)
```
api/auth-callback.js                      # Email callback routing
src/PasswordReset.jsx                     # Password reset component
supabase/migrations/0004_email_templates.sql
email-templates/base.html
email-templates/confirm-email.html
email-templates/password-reset.html
email-templates/invite-user.html
EMAIL_SETUP.md
AUTH_FLOW_SUMMARY.md
BRANDING_GUIDE.md
SUPABASE_EMAIL_TEST.md
IMPLEMENTATION_CHECKLIST.md
DEPLOYMENT_SUMMARY.md
PROJECT_STRUCTURE.md
```

### Updated Files (✏️ Modified)
```
src/App.jsx                               # Added forgot password flow
```

### Unchanged (No changes)
```
All other files remain untouched
```

---

## 📊 Key Directories

### `/email-templates/`
Email HTML templates used by Supabase when sending auth emails.
- Used by: Supabase Auth service
- Purpose: Branded email design
- Format: HTML with inline CSS
- Deploy method: SQL migration

### `/supabase/migrations/`
Database migrations and schema updates.
- `0004_email_templates.sql` – Updates auth.email_templates table
- Auto-runs when: `supabase db push`

### `/api/`
Vercel serverless functions.
- `auth-callback.js` – NEW: Redirects from email links
- Others: AI, TTS, config endpoints

### `/src/`
React frontend components.
- `App.jsx` – UPDATED: Added password reset UI
- `PasswordReset.jsx` – NEW: Reset confirmation page
- `supabase.js` – Supabase client integration

---

## 🔄 Data Flow

### Sign-Up Flow
```
Frontend (App.jsx)
  → Supabase Auth
    → auth.users (database)
      → on_auth_user_created trigger (0002/0003)
        → households table
        → household_members table
      → Email sent via SMTP
        → Uses template from auth.email_templates
          → Uses confirm-email.html design
```

### Forgot Password Flow
```
Frontend (App.jsx: "Forgot password?")
  → supabase.auth.resetPasswordForEmail()
    → Supabase Auth service
      → Email sent via SMTP
        → Uses template from auth.email_templates
          → Uses password-reset.html design
      → Redirect to /auth/reset-password?code=XXX
        → auth-callback.js routes to PasswordReset.jsx
          → User sets new password
            → supabase.auth.updateUser({ password: ... })
```

### Invite Flow
```
Frontend (App.jsx: Invite Members)
  → api/invite.js (Vercel function)
    → Creates row in household_invites
      → Email sent via SMTP
        → Uses template from auth.email_templates
          → Uses invite-user.html design
      → Invitee clicks link
        → api/auth-callback.js routes to /app/invite
          → api/accept-invite.js processes acceptance
```

---

## 🚀 Deployment Paths

### Local Development
```
1. npm run dev          # Start Vite dev server
2. supabase start       # Start local Supabase
3. Test all flows       # Sign-up, reset password, invites
```

### To Production (Vercel + Supabase)
```
1. git commit           # Stage changes
2. vercel deploy        # Deploy to Vercel + run migrations
3. Test production      # Verify email flows work
```

### What Vercel Does
- Builds React app (vite build)
- Deploys to CDN
- Runs API functions (`/api/*`)
- Auto-syncs environment variables

### What Supabase Does
- Runs migrations (0004_email_templates.sql)
- Stores email templates in auth.email_templates
- Sends emails via configured SMTP
- Manages auth flows

---

## 📦 Dependencies

### Frontend
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.110.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.383.0"
  }
}
```

### Backend
```
Node.js 18+ (Vercel functions)
Supabase (managed cloud database + auth)
SMTP Server (for sending emails - already configured)
```

---

## 🔧 Configuration Files

| File | Purpose | Status |
|------|---------|--------|
| `vite.config.js` | Build configuration | ✅ Unchanged |
| `package.json` | Dependencies | ✅ Unchanged |
| `supabase/config.toml` | Supabase project config | ✅ Unchanged |
| `.env.local` (not in repo) | Local environment vars | ℹ️ Needed for local dev |
| `.vercel/project.json` | Vercel project config | ✅ Unchanged |

---

## 🔒 Security Files

No changes to security-related files:
- `api/_auth.js` – Supabase token verification (unchanged)
- RLS policies in migrations (unchanged)
- Auth session handling (unchanged via Supabase)

---

## 📚 Documentation Map

```
Documentation Files
├── EMAIL_SETUP.md
│   ├── SMTP configuration
│   ├── Email template setup
│   ├── Testing instructions
│   └── Troubleshooting
│
├── AUTH_FLOW_SUMMARY.md
│   ├── Complete flow diagrams
│   ├── File descriptions
│   ├── Variables & configuration
│   └── Next steps
│
├── BRANDING_GUIDE.md
│   ├── Colors & fonts
│   ├── Template components
│   ├── Responsive design
│   └── Customization guide
│
├── SUPABASE_EMAIL_TEST.md
│   ├── Verification checklist
│   ├── Testing procedures
│   └── Issue resolution
│
├── IMPLEMENTATION_CHECKLIST.md
│   ├── Phase 1: Local testing
│   ├── Phase 2: Code quality
│   ├── Phase 3: Configuration
│   ├── Phase 4: Pre-deployment
│   ├── Phase 5: Production
│   └── Phase 6: Launch
│
├── DEPLOYMENT_SUMMARY.md
│   ├── What was built
│   ├── Quick start guide
│   ├── Testing checklist
│   └── Next steps
│
└── PROJECT_STRUCTURE.md (this file)
    ├── File tree
    ├── What changed
    ├── Data flow diagrams
    └── Configuration reference
```

---

## ✅ Deployment Checklist Reference

**Before deploying, verify:**
- [ ] All new files present in repo
- [ ] `src/App.jsx` updated with password reset UI
- [ ] `supabase/migrations/0004_email_templates.sql` ready
- [ ] Email templates exist in `/email-templates/`
- [ ] Documentation complete and reviewed
- [ ] SMTP configured in Supabase
- [ ] No secrets in code (all in environment variables)
- [ ] Tests passed locally

---

## 📞 Quick Links

| Document | Purpose |
|----------|---------|
| `EMAIL_SETUP.md` | How to configure SMTP & deploy |
| `AUTH_FLOW_SUMMARY.md` | How the flows work |
| `BRANDING_GUIDE.md` | Design & customization |
| `IMPLEMENTATION_CHECKLIST.md` | Step-by-step deployment |
| `DEPLOYMENT_SUMMARY.md` | Executive summary |

---

## 🎯 Next Actions

1. **Review:** Read `DEPLOYMENT_SUMMARY.md` for overview
2. **Test:** Follow `IMPLEMENTATION_CHECKLIST.md` phase 1 (local testing)
3. **Configure:** Update domain URLs if needed
4. **Deploy:** Follow `IMPLEMENTATION_CHECKLIST.md` phase 5 (production)
5. **Verify:** Test all flows in production

---

**Last Updated:** 2024-07-14
**Status:** ✅ Ready for deployment
**Next Review:** After first production deployment

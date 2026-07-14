# Lingua Email Branding Guide

## 🎨 Visual Identity

### Logo
- **File:** `public/icon-192.png`
- **Size:** 192×192px (60×60px in emails)
- **Format:** PNG with transparency
- **Style:** Teal circle with cream highlights

### Color Palette

#### Primary Colors
| Color | Hex | Usage |
|-------|-----|-------|
| **Lingua Teal** | `#1a5f4a` | Primary buttons, accents, headlines |
| **Teal Hover** | `#2d7a60` | Button hover states, links |
| **Cream** | `#f4e8d8` | Header background text, highlights |

#### Supporting Colors
| Color | Hex | Usage |
|-------|-----|-------|
| Charcoal | `#2d3748` | Body text (main copy) |
| Gray | `#718096` | Secondary text, labels, timestamps |
| Light Gray | `#a0aec0` | Muted text, small print |
| Border Gray | `#e2e8f0` | Dividers, input borders |
| Light Background | `#f7fafc` | Footer background |
| Warning Orange | `#f4a460` | Security warnings |

### Fonts

#### Display Font
- **Name:** Fraunces (serif)
- **Weights:** 500, 600, 700
- **Usage:** Headlines, titles (H1, H2)
- **Source:** Google Fonts
- **Loaded via:** CSS @import in email templates

#### Body Font
- **Name:** Albert Sans (sans-serif)
- **Weights:** 400, 500, 600, 700
- **Usage:** Body text, buttons, labels
- **Source:** Google Fonts
- **Loaded via:** CSS @import in email templates

---

## 📧 Email Template Components

### Header (Always Included)
```html
Background: Linear gradient (Teal #1a5f4a to #2d7a60)
Height: 80px
Logo: 60×60px centered
Text: "Lingua" in Fraunces Bold, color Cream
Bottom border: 4px solid Cream
```

### Body
```html
Background: White
Padding: 40px 30px
Max width: 600px
Font: Albert Sans, size 14px
Line height: 1.6
Text color: Charcoal (#2d3748)
```

### CTA Buttons
```html
Background: Teal (#1a5f4a)
Text: Cream (#f4e8d8)
Padding: 14px 32px
Border radius: 8px
Font weight: 600
Font size: 14px
Transition: Hover to darker teal (#2d7a60)
```

### Footer
```html
Background: Light gray (#f7fafc)
Border top: 1px solid #e2e8f0
Padding: 30px
Font size: 12px
Text color: Gray (#718096)
Links: Teal (#1a5f4a)
```

---

## 🎯 Template-Specific Designs

### Confirmation Email (Sign-Up)
- **Emoji:** 🎉 Welcome celebration
- **Tone:** Friendly, excited, welcoming
- **Primary CTA:** "Confirm Email Address"
- **Key sections:**
  - Welcome message
  - Confirmation link
  - What's next (start learning)

### Password Reset Email
- **Emoji:** 🔐 Security focused
- **Tone:** Professional, reassuring
- **Primary CTA:** "Reset Password"
- **Key sections:**
  - Password reset instruction
  - Security notice (link expires in 1 hour)
  - Warning box: "Didn't request this? You're safe."
  - Contact support link

### Invite Email
- **Emoji:** 👋 Friendly welcome
- **Tone:** Personal, inviting
- **Primary CTA:** "Accept Invitation"
- **Key sections:**
  - "X invited you" card (callout)
  - Benefits list (what they can do)
  - "Already have an account?" instructions
  - "New to Lingua?" sign-up instructions

---

## 📐 Responsive Design Rules

### Mobile Optimization
- Max width: 600px (desktop)
- Full width on mobile (< 600px)
- Font size: 14px (readable on small screens)
- Padding: 20px minimum (tap-friendly)
- Links: Line height 24px minimum (tap targets)

### Email Client Compatibility
- **Desktop:** Gmail, Outlook, Apple Mail, etc.
- **Mobile:** Gmail app, Outlook app, Apple Mail, etc.
- **Web:** Gmail web, Outlook web, Apple iCloud web

**Design approach:** Table-based layout (maximum compatibility)

---

## 🎨 How to Update Branding

### Change Logo
1. Replace `public/icon-192.png` with new logo
2. Update email templates to reference new URL:
   ```html
   <img src="https://lingua.family/icon-192.png" alt="Lingua" />
   ```
3. Ensure new logo is 60×60px (or adjust size in email CSS)

### Change Colors
1. Update color hex values in `supabase/migrations/0004_email_templates.sql`
2. Find & replace in migration:
   - `#1a5f4a` → your primary color
   - `#f4e8d8` → your accent/text color
3. Run migration: `supabase db push`

### Change Fonts
1. Update @import URLs in email templates
2. Change font-family values in CSS
3. Options: Google Fonts, custom fonts (if supported)
4. Test in multiple email clients

### Update Links
Find these URLs in `supabase/migrations/0004_email_templates.sql` and update:
- `https://lingua.family` → your website
- `https://lingua.family/privacy` → your privacy policy
- `https://lingua.family/terms` → your terms
- `https://lingua.family/help` → your help center
- `https://lingua.family/contact` → your contact form

---

## ✅ Quality Checklist

Before deploying email templates, verify:

### Visual Design
- [ ] Logo displays correctly (not stretched)
- [ ] Colors match brand guidelines
- [ ] Fonts render correctly (Fraunces + Albert Sans)
- [ ] Buttons are clearly clickable
- [ ] Text is readable (sufficient contrast)

### Content
- [ ] All links work and point to correct URLs
- [ ] No broken or placeholder text
- [ ] Tone matches brand voice
- [ ] CTAs are clear and compelling

### Technical
- [ ] HTML validates (no syntax errors)
- [ ] Inline CSS (no external stylesheets)
- [ ] Images have alt text
- [ ] Works in Gmail, Outlook, Apple Mail
- [ ] Mobile-optimized (test on phone)

### Branding
- [ ] Logo present on all templates
- [ ] Primary color used consistently
- [ ] Brand voice consistent
- [ ] Legal footer with links

---

## 🚀 Email Client Testing

Test templates in:

1. **Gmail** (web & app)
2. **Outlook** (web & desktop)
3. **Apple Mail** (macOS & iOS)
4. **Yahoo Mail**
5. **Mobile phone** (your device)

**Tools:**
- Litmus (email testing)
- Mail-tester.com
- Your actual inbox on each platform

---

## 📚 File Reference

| File | Purpose |
|------|---------|
| `public/icon-192.png` | Lingua logo asset |
| `email-templates/confirm-email.html` | Sign-up confirmation template |
| `email-templates/password-reset.html` | Password reset template |
| `email-templates/invite-user.html` | Household invite template |
| `supabase/migrations/0004_email_templates.sql` | Applied templates (production) |
| `BRANDING_GUIDE.md` | This file (branding reference) |

---

## 🎨 Future Customization Ideas

1. **Dark Mode Support:** Add `@media (prefers-color-scheme: dark)` 
2. **Animation:** Add subtle animations (fade-in, etc.)
3. **Dynamic Content:** Personalize with user name/household
4. **A/B Testing:** Test different button colors/copy
5. **Multi-Language:** Translate templates for Spanish/other languages

---

**Version:** 1.0
**Last Updated:** 2024-07-14
**Brand Manager:** You! 🚀

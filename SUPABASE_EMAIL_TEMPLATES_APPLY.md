# How to Apply Email Templates in Supabase Dashboard

Since Supabase manages email templates through the dashboard (not SQL), follow these steps to apply the branded templates.

## 📋 Quick Steps

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **Authentication → Email Templates**
4. For each template type, edit and paste the HTML below
5. Save each template

---

## 1️⃣ Confirmation Email (Sign-Up)

**Template Type:** Confirmation

**Subject:** Welcome to Lingua

**HTML Content:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Your Lingua Email</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      background-color: #f5f5f5;
      color: #2d3748;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-collapse: collapse;
    }
    .header {
      background: linear-gradient(135deg, #1a5f4a 0%, #2d7a60 100%);
      padding: 40px 20px;
      text-align: center;
      border-bottom: 4px solid #f4e8d8;
    }
    .logo {
      display: inline-block;
      margin-bottom: 12px;
    }
    .logo img {
      width: 60px;
      height: 60px;
      margin: 0 auto;
      display: block;
    }
    .header-text {
      color: #f4e8d8;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px 30px;
    }
    .content h1 {
      font-size: 24px;
      margin-bottom: 16px;
      color: #1a5f4a;
    }
    .content p {
      margin-bottom: 16px;
      color: #4a5568;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      background-color: #1a5f4a;
      color: #f4e8d8;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      margin: 24px 0;
      border: 2px solid #1a5f4a;
    }
    .footer {
      background-color: #f7fafc;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #718096;
    }
    .footer a {
      color: #1a5f4a;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <table class="container">
    <tr>
      <td class="header">
        <div class="logo">
          <img src="https://lingua.family/icon-192.png" alt="Lingua" />
        </div>
        <div class="header-text">Lingua</div>
      </td>
    </tr>
    <tr>
      <td class="content">
        <h1>Welcome to Lingua! 🎉</h1>
        <p>Hi {{ .Email }},</p>
        <p>Thank you for signing up! We're excited to have you join our learning community. Your account has been created and is ready to use.</p>
        <p>To get started and confirm your email address, please click the button below:</p>
        <a href="{{ .ConfirmationURL }}" class="cta-button">Confirm Email Address</a>
        <p style="color: #a0aec0; font-size: 12px;">Or copy and paste this link in your browser:</p>
        <p style="word-break: break-all; color: #718096; font-size: 12px;">{{ .ConfirmationURL }}</p>
        <p>Once confirmed, you can start exploring Lingua and begin your language learning journey.</p>
      </td>
    </tr>
    <tr>
      <td class="footer">
        <p>© 2024 Lingua Family. All rights reserved.</p>
        <p style="margin-top: 16px;">
          <a href="https://lingua.family">Website</a> •
          <a href="https://lingua.family/privacy">Privacy</a> •
          <a href="https://lingua.family/terms">Terms</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2️⃣ Recovery Email (Password Reset)

**Template Type:** Recovery

**Subject:** Reset Your Lingua Password

**HTML Content:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Lingua Password</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      background-color: #f5f5f5;
      color: #2d3748;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-collapse: collapse;
    }
    .header {
      background: linear-gradient(135deg, #1a5f4a 0%, #2d7a60 100%);
      padding: 40px 20px;
      text-align: center;
      border-bottom: 4px solid #f4e8d8;
    }
    .logo {
      display: inline-block;
      margin-bottom: 12px;
    }
    .logo img {
      width: 60px;
      height: 60px;
      margin: 0 auto;
      display: block;
    }
    .header-text {
      color: #f4e8d8;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px 30px;
    }
    .content h1 {
      font-size: 24px;
      margin-bottom: 16px;
      color: #1a5f4a;
    }
    .content p {
      margin-bottom: 16px;
      color: #4a5568;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      background-color: #1a5f4a;
      color: #f4e8d8;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      margin: 24px 0;
      border: 2px solid #1a5f4a;
    }
    .warning {
      background-color: #fef5e7;
      border-left: 4px solid #f4a460;
      padding: 16px;
      margin: 24px 0;
      border-radius: 4px;
      color: #7d6608;
      font-size: 13px;
    }
    .footer {
      background-color: #f7fafc;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #718096;
    }
    .footer a {
      color: #1a5f4a;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <table class="container">
    <tr>
      <td class="header">
        <div class="logo">
          <img src="https://lingua.family/icon-192.png" alt="Lingua" />
        </div>
        <div class="header-text">Lingua</div>
      </td>
    </tr>
    <tr>
      <td class="content">
        <h1>Reset Your Password</h1>
        <p>Hi {{ .Email }},</p>
        <p>We received a request to reset the password for your Lingua account. Click the button below to set a new password:</p>
        <a href="{{ .RecoveryURL }}" class="cta-button">Reset Password</a>
        <p style="color: #a0aec0; font-size: 12px;">Or copy and paste this link in your browser:</p>
        <p style="word-break: break-all; color: #718096; font-size: 12px;">{{ .RecoveryURL }}</p>
        <div class="warning">
          <strong>⚠️ Security Notice:</strong> This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email and your account will remain secure.
        </div>
        <p>Once you reset your password, you'll be able to sign in to your account with the new credentials.</p>
      </td>
    </tr>
    <tr>
      <td class="footer">
        <p>© 2024 Lingua Family. All rights reserved.</p>
        <p style="margin-top: 16px;">
          <a href="https://lingua.family">Website</a> •
          <a href="https://lingua.family/privacy">Privacy</a> •
          <a href="https://lingua.family/terms">Terms</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3️⃣ Magic Link Email (Invites)

**Template Type:** Magic Link

**Subject:** Join a Lingua Household

**HTML Content:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join a Lingua Household</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      background-color: #f5f5f5;
      color: #2d3748;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-collapse: collapse;
    }
    .header {
      background: linear-gradient(135deg, #1a5f4a 0%, #2d7a60 100%);
      padding: 40px 20px;
      text-align: center;
      border-bottom: 4px solid #f4e8d8;
    }
    .logo {
      display: inline-block;
      margin-bottom: 12px;
    }
    .logo img {
      width: 60px;
      height: 60px;
      margin: 0 auto;
      display: block;
    }
    .header-text {
      color: #f4e8d8;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px 30px;
    }
    .content h1 {
      font-size: 24px;
      margin-bottom: 16px;
      color: #1a5f4a;
    }
    .content p {
      margin-bottom: 16px;
      color: #4a5568;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      background-color: #1a5f4a;
      color: #f4e8d8;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      margin: 24px 0;
      border: 2px solid #1a5f4a;
    }
    .footer {
      background-color: #f7fafc;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #718096;
    }
    .footer a {
      color: #1a5f4a;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <table class="container">
    <tr>
      <td class="header">
        <div class="logo">
          <img src="https://lingua.family/icon-192.png" alt="Lingua" />
        </div>
        <div class="header-text">Lingua</div>
      </td>
    </tr>
    <tr>
      <td class="content">
        <h1>Join a Lingua Household! 👋</h1>
        <p>Hi {{ .Email }},</p>
        <p>You've been invited to join a Lingua household to collaborate on language learning together.</p>
        <a href="{{ .ConfirmationURL }}" class="cta-button">Accept Invitation</a>
        <p style="color: #a0aec0; font-size: 12px;">Or copy and paste this link:</p>
        <p style="word-break: break-all; color: #718096; font-size: 12px;">{{ .ConfirmationURL }}</p>
        <p><strong>Already have a Lingua account?</strong> Just click the link above and your account will be added to the household automatically.</p>
        <p><strong>New to Lingua?</strong> Sign up with this email address when prompted, and you'll join the household right away.</p>
      </td>
    </tr>
    <tr>
      <td class="footer">
        <p>© 2024 Lingua Family. All rights reserved.</p>
        <p style="margin-top: 16px;">
          <a href="https://lingua.family">Website</a> •
          <a href="https://lingua.family/privacy">Privacy</a> •
          <a href="https://lingua.family/terms">Terms</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## ✅ Step-by-Step in Dashboard

1. **Go to Supabase Dashboard**
   - Visit https://app.supabase.com
   - Select your project

2. **Navigate to Email Templates**
   - Left sidebar → Authentication
   - Click "Email Templates"

3. **Update Each Template**
   - You'll see 4 templates: Confirmation, Recovery, Magic Link, Invite Link
   - Click to edit **Confirmation**
   - Paste the HTML above
   - Click Save
   - Repeat for **Recovery** and **Magic Link**

4. **Verify**
   - You should see the Lingua branding in the preview
   - Logo should load
   - Colors should be teal/cream

---

## 📝 Template Variables

These are automatically filled by Supabase:

| Variable | Template | Description |
|----------|----------|-------------|
| `{{ .Email }}` | All | User's email address |
| `{{ .ConfirmationURL }}` | Confirmation, Magic Link | Link to confirm/accept |
| `{{ .RecoveryURL }}` | Recovery | Link to reset password |

---

## 🔗 Update URLs

Before applying, update these domain references if you're not using `lingua.family`:

```html
<!-- Change these to your domain -->
<img src="https://lingua.family/icon-192.png" />
<a href="https://lingua.family">Website</a>
<a href="https://lingua.family/privacy">Privacy</a>
<a href="https://lingua.family/terms">Terms</a>
```

---

## ✨ After Applying

1. Test each email flow:
   - Create new account → should receive branded confirmation email
   - Click "Forgot password?" → should receive branded reset email
   - Send invite → should receive branded invite email

2. Verify in different email clients:
   - Gmail (web & mobile)
   - Outlook (web & desktop)
   - Apple Mail

3. Monitor Supabase logs for any email delivery errors

---

## 🆘 If Templates Don't Show

1. **Clear browser cache** (Supabase caches templates)
2. **Refresh the page** and try again
3. **Check email logs** (Authentication → Logs) for errors
4. **Verify SMTP is configured** (Authentication → Email)

---

**Status:** Ready to apply ✅

Once templates are applied, all auth emails will use Lingua branding!

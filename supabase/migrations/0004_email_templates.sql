-- Email templates with Lingua branding.
-- These update the email templates in the auth schema to use custom HTML.
-- Supabase will use these templates when sending confirmation, recovery, and invite emails.

-- NOTE: These templates use Supabase variables:
-- {{ .ConfirmationURL }} - Email confirmation link
-- {{ .RecoveryURL }} - Password reset link
-- {{ .InvitationURL }} - Invite acceptance link
-- {{ .Email }} - User email
-- {{ .Name }} - User name from metadata

-- Update confirmation email template
update auth.email_templates
set template = $template$<!DOCTYPE html>
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
</html>$template$
where type = 'confirmation';

-- Update recovery (password reset) email template
update auth.email_templates
set template = $template$<!DOCTYPE html>
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
</html>$template$
where type = 'recovery';

-- Update magic link email template (used for invites)
update auth.email_templates
set template = '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join a Lingua Household</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', ''Roboto'', ''Oxygen'', ''Ubuntu'', ''Cantarell'', ''Fira Sans'', ''Droid Sans'', ''Helvetica Neue'', sans-serif;
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
        <p>You''ve been invited to join a Lingua household to collaborate on language learning together.</p>
        <a href="{{ .ConfirmationURL }}" class="cta-button">Accept Invitation</a>
        <p style="color: #a0aec0; font-size: 12px;">Or copy and paste this link:</p>
        <p style="word-break: break-all; color: #718096; font-size: 12px;">{{ .ConfirmationURL }}</p>
        <p><strong>Already have a Lingua account?</strong> Just click the link above and your account will be added to the household automatically.</p>
        <p><strong>New to Lingua?</strong> Sign up with this email address when prompted, and you''ll join the household right away.</p>
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
</html>'
where type = ''magic_link'';

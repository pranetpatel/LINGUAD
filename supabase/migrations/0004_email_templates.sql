-- Email templates with Lingua branding
--
-- NOTE: Supabase Auth email templates are managed via the dashboard or via
-- the Supabase Management API, not via direct SQL. This migration serves as
-- documentation of the templates.
--
-- To apply these templates:
-- 1. Go to Supabase Dashboard → Authentication → Email Templates
-- 2. Edit each template type (confirmation, recovery, magic_link)
-- 3. Replace the template content with the HTML below
-- 4. Save each template
--
-- OR use the Supabase Management API:
-- POST https://api.supabase.com/v1/projects/{PROJECT_ID}/auth/email-templates
--
-- This migration is a no-op but serves to document the template versions
-- in the migration history.

-- Template versions:
-- - Confirmation: v1.0 (Welcome to Lingua! 🎉)
-- - Recovery: v1.0 (Reset Your Password)
-- - Magic Link: v1.0 (Join a Lingua Household)
-- Updated: 2024-07-14

-- No database changes needed - templates are managed via Supabase dashboard
SELECT 'Email templates documented. Apply via Supabase dashboard or API.'::text;

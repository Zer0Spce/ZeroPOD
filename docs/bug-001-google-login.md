# Bug 001 — Google sign-in rejected in automation browser

## Symptom
Google OAuth can reject the Playwright-launched persistent browser with a “This browser or app may not be secure” message.

## Fix strategy
ZeroPOD v1.0.1 uses a Windows compatibility login flow:

1. Launch a normal installed Microsoft Edge process with ZeroPOD's dedicated per-service user-data directory.
2. Do **not** attach Playwright while the user is signing in.
3. The user completes Google/email/password/2FA/CAPTCHA directly in Edge.
4. `Test Session` attaches to that already-open Edge instance over local DevTools/CDP and verifies the service session.
5. Automation then reuses the same local Edge profile/session.

This does not bypass Google security checks, CAPTCHA, or 2FA. It changes the login environment from an automation-launched browser to normal Edge and only attaches automation after sign-in.

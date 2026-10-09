# ZeroPOD v1.0.2

Bugfix release from live v1.0 testing.

## Fixes
- Replace fragile local-CDP browser attachment with a normal-Edge login → saved-profile handoff → Playwright automation flow.
- Preserve the authenticated per-service Edge profile across the handoff.
- Start Queue no longer preflights and opens ChatGPT, Vectorizer.ai, and Redbubble all at once.
- ChatGPT generation now reports live steps: Opening ChatGPT, Waiting for composer, Uploading reference image, Sending generation prompt, Waiting for generated image.
- Harden ChatGPT composer, upload, and send selectors and fail clearly when the service is actually logged out.

No CAPTCHA, Google security, or 2FA bypass is attempted; authentication remains manual in normal Edge.

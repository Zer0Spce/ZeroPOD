# ZeroPOD

ZeroPOD is a Windows-first Print-on-Demand workflow app that organizes reference-driven design generation, human review, POD WINNER metadata, vectorization, high-resolution export, quality control, and Redbubble preparation into one local desktop workspace.

## Current feature set

- Windows-only Electron desktop app
- Local-only Connections for ChatGPT, Vectorizer.ai, and Redbubble
- Persistent browser sessions under ZeroPOD Windows app data
- Reference image + Amazon/source URL workflow
- Permanent POD guideline injection
- Mandatory Pass / Reject / Regenerate image review
- Amazon-driven POD WINNER SEO metadata
- Editable Title + 1 Main Tag + exactly 14 Supporting Tags + Short Description
- Vectorizer.ai handoff and SVG capture
- Transparent 4500×5400 final PNG export
- Final artwork + metadata quality checks
- Redbubble Copy Existing Work workflow using the first existing work as the baseline
- Mandatory final Redbubble review before publish
- Project dashboard, progress tracking, recovery states, and guarded workflow ordering

## Automation List (Beta)

ZeroPOD v0.4 introduces an in-app batch queue so multiple reference images and Amazon/source links can be loaded once instead of submitted individually.

### Ways to fill the queue

- Add Row and edit image/link/notes in the table
- Add Images to select multiple local reference images at once
- Paste tab-separated `image path + Amazon link + optional notes`
- Paste only Amazon URLs to fill existing image rows that have blank links
- Import a CSV file
- Export the current queue to CSV

A starter CSV is included at:

`templates/automation-list-template.csv`

Required input columns are:

```csv
enabled,reference_image,amazon_link,notes
true,C:\ZeroPOD\inputs\design1.png,https://www.amazon.com/example1,optional instruction
```

### Queue behavior

ZeroPOD intentionally keeps human review gates in batch mode:

1. Process one browser automation stage at a time.
2. Generate each queued design with its reference image + Amazon/source link.
3. Stop that design at **Awaiting Review**.
4. Continue working through other runnable rows.
5. After you press **Pass**, that row automatically resumes through POD WINNER metadata, Vectorizer.ai, 4500×5400 export, and final quality checks.
6. Prepare Redbubble using **Copy Existing Work** and the first existing work as the baseline.
7. Stop again at **Final Review** before publish.

Rows can be paused, disabled, removed, retried after recoverable failures, or cleared after completion.

## Permanent POD guidelines

ZeroPOD injects these rules into generation:

- Copy slogan and create a new style.
- Make it clean and Print On Demand friendly.
- Avoid reusing specific colors/elements from the previous output unless requested.
- Use different font styling between designs.
- Add only a few supporting elements and keep the layout uncluttered.
- Make text large and easy to read.
- Do not use cursive unless explicitly requested.
- Do not place decorative elements over text.
- Keep text large and visually uniform.
- Avoid ribbons.
- Require real alpha transparency, never fake transparency.
- Use a 4:5 output aspect ratio.
- Do not use AI brush-style text.

## Local security model

ZeroPOD does not collect or hardcode website passwords. Login opens the selected service in a normal local Microsoft Edge session controlled by Playwright. Browser profiles remain local inside ZeroPOD's user-data directory and are excluded from Git.

Sensitive connection metadata is encrypted with Electron `safeStorage`, which uses operating-system protected storage where available.

## Development

Requirements:

- Windows 10/11
- Node.js + npm
- Microsoft Edge installed

```bash
npm install
npm run check
npm start
```

## Build portable Windows package

```bash
npm run package:win
```

> ZeroPOD should respect the terms and automation policies of every connected service. Authentication challenges, CAPTCHA, and two-factor authentication stay user-controlled. ZeroPOD does not implement stealth, CAPTCHA bypass, or anti-bot evasion.

# ZeroPOD

ZeroPOD is a Windows-first Print-on-Demand workflow app that organizes reference-driven design generation, human review, metadata creation, vectorization, high-resolution export, and marketplace upload into one local desktop workspace.

## Current v0.1 foundation

- Windows-only Electron desktop shell
- Connections panel for ChatGPT, Vectorizer.ai, and Redbubble
- Local browser profile storage under the ZeroPOD Windows app-data directory
- No usernames or passwords stored in the repository
- Windows-backed encrypted connection metadata via Electron `safeStorage`
- Reference-image + source-URL input
- Permanent POD guideline injection
- Mandatory Pass / Reject review gate before later workflow stages
- Placeholder stages for metadata, vectorization, 4500×5400 export, and Redbubble queue

## Permanent POD guidelines

ZeroPOD currently injects these rules into the generation workflow:

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

ZeroPOD does not collect or hardcode website passwords. Clicking Login opens the selected service in a normal local Microsoft Edge session controlled by Playwright. The browser profile is stored locally inside ZeroPOD's user-data directory and is excluded from Git.

Sensitive connection metadata is encrypted with Electron `safeStorage`, which uses the operating system's protected storage where available.

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

## Planned next stages

1. ChatGPT generation controller with reference-image upload and permanent prompt rules.
2. Generated-image capture/download and local project persistence.
3. Mandatory image review with Pass / Reject / Regenerate-with-notes.
4. Title + 1 main tag + 14 supporting tags + short description extraction.
5. Vectorizer.ai workflow handoff.
6. Local SVG/EPS to transparent 4500×5400 PNG export.
7. Redbubble upload queue and listing form population.

> ZeroPOD should respect the terms and automation policies of every connected service. Authentication challenges, CAPTCHA, and two-factor authentication stay user-controlled.

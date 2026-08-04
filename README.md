# Desktop Pet

A small animated pet that floats over your whole desktop — transparent,
frameless, always-on-top — built with Electron + plain HTML/CSS/JS.

**Download page: https://kokoronoka.github.io/desktopPet/**

## Install (for users)

Grab `DesktopPet-Setup-x.y.z.exe` from the
[Releases page](../../releases/latest) and run it. Windows 10/11, 64-bit.

> **Unsigned build warning.** The installer isn't code-signed, so Windows will
> push back:
>
> - **SmartScreen** shows "Windows protected your PC" — click
>   **More info → Run anyway**.
> - **Smart App Control** (on by default on some clean Windows 11 installs)
>   *blocks the app outright* with "An Application Control policy has blocked
>   this file", and offers no override. Affected users must turn Smart App
>   Control off in Windows Security → App & browser control, or run from source.
>
> Code signing is the only real fix — see "Code signing" below.

## Run from source (for developers)

```bash
npm install
npm start
```

On first launch a **setup page** opens in its own normal window where you pick a
pet and give them a name. After that the app remembers both, plus where you left
the pet, and skips straight to the floating pet. The app lives in the system
tray — closing/hiding the pet does not quit it.

Reopen the setup page any time from the tray menu ("Change Pet / Rename…") to
switch pets or rename.

## Two windows

| | Setup page | Pet overlay |
|---|---|---|
| File | `src/setup.html` | `src/index.html` |
| Look | normal framed window, 520×580 | frameless, transparent, always-on-top |
| Job | choose a pet, name it | be the pet |
| Bridge | `preload-setup.js` → `window.setupAPI` | `preload.js` → `window.petAPI` |

The two preloads are separate on purpose: the setup page only needs to read and
write the pet choice, so it doesn't get the overlay's window-moving powers.

## What's here

- `main.js` — Electron main process: both windows, the tray icon and menu,
  saved state, autonomous walking, and the IPC handlers for click-through and
  window dragging.
- `preload.js` / `preload-setup.js` — the two bridges (contextIsolation is on,
  nodeIntegration is off).
- `src/index.html` / `src/style.css` / `src/renderer.js` — the floating pet
  (emoji placeholders for cat/dog/bunny) and its nametag.
- `src/setup.html` / `src/setup.css` / `src/setup.js` — the pet picker page.
- `src/assets/tray-icon.png` — tray icon, swap for your own art.

## How the tricky bits work

- **Click-through:** the whole window is transparent, so `renderer.js` checks
  on every `mousemove` whether the cursor is over the pet/selector or over
  empty space, and toggles `setIgnoreMouseEvents` accordingly — that's what
  lets you click whatever is *behind* the pet everywhere except the pet itself.
  The check is suspended mid-drag so a fast drag can't hand the mouse back to
  the desktop halfway through.
- **Dragging:** frameless windows have no native title bar, so pointer deltas
  on the pet are forwarded over IPC (`move-window`) and the main process
  repositions the real OS window, clamped to the current monitor's work area.
  A press that never moves more than a few pixels counts as a *pet*, not a
  drag, so clicking still triggers the happy bounce.
- **Walking:** the renderer decides *when* to walk (a random 8–20s timer) but
  the main process owns the motion, since only it knows where the screen edges
  are. It picks a direction with room to move, steps the window there, and
  tells the renderer which way to face.
- **State:** the chosen pet, its name, and the last position are written to
  `state.json` in Electron's `userData` folder — plain JSON, no extra
  dependency. A saved position on a monitor that no longer exists is ignored.
- **The nametag** sits *outside* `#pet` in the DOM, because `#pet` gets flipped
  horizontally when the pet walks left and that would mirror the text. It stays
  hidden by default so it doesn't clutter the desktop, fading in on hover and
  for a moment after the pet is clicked or changed.
- **First-run cancel:** closing the setup page without ever choosing a pet
  quits the app rather than leaving an invisible process in the tray.
- **Animation states:** `#pet` carries the facing direction and `.pet-sprite`
  carries the idle / walking / dragging / happy animation, so the two
  transforms never overwrite each other.

## Tray menu

Show/Hide Pet (also on tray double-click), Change Pet / Rename…, and Quit.

## Releasing

`electron-builder` packages the app into an NSIS installer. Build one locally:

```bash
npm run dist
```

The installer lands in `dist/`. (`npm run pack` builds an unpacked folder
instead — faster, handy for checking the packaged app runs.)

To publish one for everyone else, push a version tag:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

`.github/workflows/release.yml` then builds on a Windows runner and attaches
the installer to a GitHub Release automatically. No secrets to configure — it
uses the built-in `GITHUB_TOKEN`. Bump `version` in `package.json` to match the
tag before pushing, since that's what names the installer file.

You can also trigger the workflow manually from the Actions tab ("Run
workflow") to test a build without cutting a release — it uploads the installer
as a build artifact and skips creating a Release.

### Code signing

Unsigned installers trigger a SmartScreen warning. To remove it you need an
Authenticode certificate (an OV cert is a few hundred USD/year; EV clears
SmartScreen immediately). Once you have one, add `WIN_CSC_LINK` (base64 of the
`.pfx`) and `WIN_CSC_KEY_PASSWORD` as repository secrets — electron-builder
picks them up with no config change.

### The download page

`docs/index.html` is the public landing page served by GitHub Pages at
https://kokoronoka.github.io/desktopPet/. Its Download button always points at
`releases/latest`, so it needs no edits when you publish a new version.

For it to be served, Pages must be set to the `/docs` folder:
**Settings → Pages → Source: Deploy from a branch → Branch: `main`, folder:
`/docs`**. (With the source set to `/` root, GitHub renders README.md instead.)

### Icons

`build/icon.ico` is the app/installer icon and `src/assets/tray-icon.png` is the
tray icon. Replace both with your own art; the `.ico` should include a 256×256
entry, which is what electron-builder requires.

## Possible next steps

1. Replace the emoji pets with real sprite sheets or SVG animations.
2. Auto-launch on system startup.
3. Extra idle states — e.g. curling up to sleep after long inactivity.
4. Multiple pets on screen at once.
5. Have the pet respond to its name, or show speech bubbles.
6. Package for distribution with `electron-builder`.

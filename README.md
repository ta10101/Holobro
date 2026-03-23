<p align="center">
  <img src="./public/holobro-mascot.svg" alt="HoloBro mascot logo" width="170" />
</p>
<h1 align="center">HoloBro</h1>
<p align="center"><strong>Street-skater cyberpunk browser shell.</strong></p>

**HoloBro** is a **local-first desktop shell**: **Tauri + React** for the UI, optional **Holochain** for bookmarks, contacts, chat, and WebRTC signaling, plus an embedded **WebView2** / **WebKit** browser, HTTP fetch bridge, LLM assistant hooks, and **network tools** (IP stats, traceroute, rough speed check).

Repository: **[github.com/ta10101/Holobro](https://github.com/ta10101/Holobro)** (GitHub may redirect from `HoloBro`.)

> This project is a **scaffold**. Strong anonymity guarantees, production-grade chat encryption, TURN for WebRTC, and fully hardened web isolation are follow-on work.

---

## Table of contents

- [Install prebuilt binaries](#install-prebuilt-binaries) (Windows · macOS · Linux)  
- [Uninstall](#uninstall) (including uninstallers)  
- [Build from source](#build-from-source)  
- [Holochain live mode](#holochain-live-mode)  
- [Features](#features)  
- [Project layout](#project-layout)  
- [License](#license)

---

## Install prebuilt binaries

When [GitHub Releases](https://github.com/ta10101/Holobro/releases) publishes assets, download the file that matches your OS and CPU.

### Windows (x64)

| File | What it is |
|------|------------|
| **`HoloBro_x.x.x_x64-setup.exe`** | **NSIS** installer — recommended for most users. Includes an embedded **WebView2** bootstrapper when the runtime is missing. |
| **`HoloBro_x.x.x_x64_en-US.msi`** (or similar) | **MSI** package — useful for **Intune**, **GPO**, or silent deployment (`msiexec /i HoloBro....msi /qn`). |

**Steps (setup.exe):**

1. Download the latest `HoloBro_*_x64-setup.exe` from Releases.  
2. Double-click it and follow the wizard.  
3. If prompted, allow **WebView2** installation (Microsoft Edge WebView2 Runtime).  
4. Start **HoloBro** from the Start menu or desktop shortcut.

**Steps (MSI):**

1. Download the `.msi` from Releases.  
2. Double-click the MSI, or run `msiexec /i "path\to\HoloBro....msi"` from an elevated prompt if your policy requires it.  
3. Launch **HoloBro** from the Start menu.

**Requirements:** Windows 10/11 x64. WebView2 is installed by the bundle when needed.

---

### macOS

| File | What it is |
|------|------------|
| **`HoloBro_x.x.x_universal.dmg`** or **`HoloBro_x.x.x_aarch64.dmg` / `x64.dmg`** | Disk image with the `.app` bundle (exact name depends on build targets). |

**Steps:**

1. Open the `.dmg`.  
2. Drag **HoloBro.app** into **Applications**.  
3. If Gatekeeper blocks the app: **System Settings → Privacy & Security** → choose **Open Anyway** for HoloBro (or right-click the app → **Open** the first time).

**Requirements:** macOS supported by your Tauri/WebKit stack (see [Tauri macOS prerequisites](https://v2.tauri.app/start/prerequisites/)).

---

### Linux

| File | What it is |
|------|------------|
| **`holobro_x.x.x_amd64.AppImage`** (name may vary) | Single executable-style image; no root needed to try the app. |
| **`.deb`** | For Debian/Ubuntu and derivatives (`apt` / `dpkg`). |

**AppImage:**

1. Download the `.AppImage`.  
2. `chmod +x HoloBro*.AppImage`  
3. Run `./HoloBro*.AppImage`  
4. Optional: use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) for desktop integration.

**.deb (example):**

```bash
sudo apt install ./holobro_*_amd64.deb
# or
sudo dpkg -i holobro_*_amd64.deb && sudo apt-get install -f
```

**Requirements:** See [Tauri Linux dependencies](https://v2.tauri.app/start/prerequisites/) (WebKitGTK, etc.). Wayland/X11 as supported by your distro.

> **Note:** Release assets appear after maintainers run `npm run build:desktop` (or CI) and upload outputs. If Releases is empty, [build from source](#build-from-source) below.

---

## Uninstall

### Windows

| How you installed | How to remove |
|-------------------|----------------|
| **NSIS `.exe` installer** | **Settings → Apps → Installed apps → HoloBro → Uninstall**, *or* **Start menu → HoloBro → Uninstall HoloBro**. The NSIS installer registers a standard **Windows uninstaller** (ARP entry). |
| **MSI** | **Settings → Apps → HoloBro → Uninstall**, *or* `msiexec /x {PRODUCT-GUID}` / **Apps & features**. MSI installs register with **Windows Installer** for clean removal. |

WebView2 is a **shared Microsoft runtime** used by many apps; uninstalling HoloBro does **not** remove WebView2 by design.

### macOS

- Delete **HoloBro** from **Applications** (drag to Trash, or right-click → **Move to Trash**).  
- If you stored preferences in `~/Library`, you may remove related `holobro` / app-id folders manually if you want a full wipe.

### Linux

| Format | Uninstall |
|--------|-----------|
| **AppImage** | Delete the `.AppImage` file (and any `.desktop` file you added). There is no system-wide uninstaller. |
| **`.deb`** | `sudo apt remove holobro` (package name matches the Debian package produced by the bundle; if different, use `dpkg -l | grep -i holo`). |

---

## Build from source

### Prerequisites

- **Node.js** (LTS recommended)  
- **Rust** (`rustup`)  
- **Tauri prerequisites** for your OS: [Windows](https://v2.tauri.app/start/prerequisites/) · [macOS](https://v2.tauri.app/start/prerequisites/) · [Linux](https://v2.tauri.app/start/prerequisites/)

**Windows installers (maintainers):**

- **NSIS** — usually **downloaded automatically** by the Tauri CLI on first bundle.  
- **MSI (WiX)** — the Tauri CLI often **downloads WiX** automatically (like NSIS). If the MSI step fails, install [WiX Toolset v3.11+](https://wixtoolset.org/docs/wix3/) (e.g. `winget install WiXToolset.WiXToolset`) so `candle` / `light` are on `PATH`.

### Dev (hot reload)

```bash
npm install
npm run tauri dev
```

### Production bundles (what you upload to Releases)

```bash
npm install
npm run build:desktop
```

**Typical output paths** (under `target/release/bundle/`):

| OS | Artifacts |
|----|-----------|
| **Windows** | `nsis/HoloBro_*_x64-setup.exe`, `msi/HoloBro_*_x64_en-US.msi` |
| **macOS** | `dmg/HoloBro_*.dmg` |
| **Linux** | `appimage/holobro_*.AppImage`, `deb/holobro_*_amd64.deb` |

---

## Run web-only (no desktop shell)

```bash
npm install
npm run dev
```

Open the URL Vite prints (default dev port is aligned with Tauri, often **1420**).

---

## Holochain live mode

1. Build zomes and pack DNA / hApp (WSL or Linux with `hc` recommended on Windows):

   ```bash
   npm run build:zomes:wsl
   npm run pack:dna
   npm run pack:happ
   ```

2. Install the `.happ` on your conductor and note the **app WebSocket URL** and **token**.

3. Copy `.env.example` to **`.env.local`** and set `VITE_HC_APP_WS`, `VITE_HC_APP_TOKEN`, and optionally `VITE_HC_ADMIN_WS` for signing.

4. Restart `npm run tauri dev` (or rebuild the desktop app) so Vite embeds the env.

Without those variables, HoloBro uses **demo `localStorage`** for bookmarks/contacts/chat.

---

## Features

| Area | Behavior |
|------|----------|
| **Browser** | Address bar + embedded webview; optional fetch bridge, find, zoom, privacy toggles, SOCKS/Tor for embedded content. |
| **Network** | IP / interface stats, traceroute (`tracert` / `traceroute`), rough HTTP download/upload speed sample. |
| **Bookmarks** | Holochain DNA + demo storage when no conductor. |
| **Contacts** | Trusted contacts with peer keys + optional invite proof. |
| **Chat** | Threaded messages; demo mode offline. |
| **Video** | WebRTC signaling via Holochain zome calls (TURN not included). |
| **Assistant** | Ollama / OpenAI-compatible chat via Tauri backend. |

---

## Project layout

- `src/` — React UI  
- `src-tauri/` — Tauri/Rust: webview, HTTP bridge, LLM, network tools  
- `dnas/anon_browser/` — Holochain integrity + coordinator zomes  
- `workdir/happ.yaml` — hApp manifest (`holobro`, role `anon_browser`)  
- `scripts/` — WSL helpers for WASM zomes and `hc` pack  

---

## License

[MIT](LICENSE)

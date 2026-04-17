# Electron Base App

A clean, cross-platform Electron starter for **Windows** and **macOS**.

---

## Folder Structure

```
electron-app/
├── main/
│   ├── main.js          ← Main process entry + IPC handlers
│   └── preload.js       ← contextBridge: secure renderer ↔ main bridge
├── renderer/
│   ├── index.html       ← App UI shell
│   └── renderer.js      ← UI logic (zero Node/Electron access)
├── services/            ← Business-logic modules (main process only)
├── config/
│   └── app.config.js    ← Shared app configuration
├── data/                ← Runtime data / local storage (git-ignored)
├── package.json
└── .gitignore
```

---

## Install & Run

### Prerequisites
- [Node.js](https://nodejs.org/) **v18 or later**
- npm (bundled with Node.js)

### 1 — Install dependencies
```bash
cd electron-app
npm install
```

### 2 — Start the app
```bash
npm start
```

---

## Security Model

| Setting              | Value           | Effect                               |
|----------------------|-----------------|--------------------------------------|
| `contextIsolation`   | `true`          | Renderer cannot reach Node globals   |
| `nodeIntegration`    | `false`         | No `require()` in the UI             |
| `sandbox`            | `true`          | OS-level process sandboxing          |
| `contextBridge`      | ✅              | Explicit, typed IPC surface only     |
| Content-Security-Policy | `default-src 'self'` | Blocks remote script injection  |

---

## Extending the Project

**Add a new IPC channel**
1. Add `ipcMain.handle('my-channel', handler)` in `main/main.js`.
2. Expose it in `main/preload.js` inside `contextBridge.exposeInMainWorld`.
3. Call it from the renderer: `window.electronAPI.invoke('my-channel')`.

**Add a service**
Create `services/myService.js`, export functions, import in `main/main.js`.

**Add config values**
Add keys to `config/app.config.js` and import in main-process files.

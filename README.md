# KinoSync — Zero-Backend Watch Together (Web + Extension)

Watch movies together from **any third-party movie webpage** (even sites that block `<iframe>` embedding and tokenize `.m3u8`/`.mp4` streams) or play direct `.mp4`, `.m3u8` HLS, and YouTube links inside the web lobby—all synchronized peer-to-peer via WebRTC DataChannels (`PeerJS`) with zero backend servers.

## Repository Structure

- **`/web`** — Standalone static Vite + React web app (Room Lobby, P2P Chat, Sync Status Sidebar & Direct MP4/HLS/YouTube Player), ready for Vercel.
- **`/extension`** — Unpacked Manifest V3 browser extension (`manifest.json`, `popup.html`, `popup.js`, `content.js`, `peerjs.min.js`) for Chrome, Edge, and Brave.

---

## Part 1: Deploy `/web` to GitHub + Vercel

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial KinoSync watch-together release"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. **Import into Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new) and select your GitHub repository.
   - Set **Root Directory** to `web` (or leave as repo root if deploying the root Vite app).
   - Keep **Framework Preset**: `Vite`, **Build Command**: `npm run build`, **Output Directory**: `dist`.
   - Click **Deploy**. `vercel.json` is already configured for SPA routing.

---

## Part 2: Load `/extension` in Chrome, Edge, or Brave

1. Open your browser's extensions page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the **`/extension`** folder from this repository.
4. Pin **KinoSync — Watch Together** to your browser toolbar.

---

## Watch Together Workflow

1. **Host opens the Vercel Web App**: Enter a Display Name + accent color and click **Create Room**.
2. **Share the Invite Link**: Click **Copy Invite Link** (`https://your-app.vercel.app/?room=ROOM_ID`).
3. **Choose Media**:
   - **Third-Party Movie Webpage**: Paste the movie webpage URL (`https://example.com/watch/movie`). Everyone clicks **Open Movie Page** to open it in a new tab, opens the **KinoSync** extension popup, enters their Display Name + Room ID, and clicks **Connect to Room**.
   - **Direct Stream**: Paste a `.mp4`, `.m3u8`, or YouTube URL to watch directly inside the Vercel room without needing the extension.
4. **Fullscreen Mini-Chat**: On any movie tab, press **`Alt + C`** (or click the floating **Chat** button in the top-right corner of the video) to open the translucent chat drawer in fullscreen, or view incoming messages and emoji reactions (`😂`, `😱`, `❤️`, `🔥`, `👏`) as auto-fading toast bubbles.

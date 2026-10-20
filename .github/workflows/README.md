# Building the Android APK via GitHub Actions

This repo includes a cloud build workflow that generates an installable Android
APK — no computer needed. You trigger it from your phone.

The APK is configured to allow cleartext HTTP traffic to `127.0.0.1` so it can
reach a local llama.cpp server running in Termux on the same phone.

## Prerequisites (one-time setup)

1. **Create a free GitHub account** at [github.com](https://github.com) if you
   don't have one.
2. **Push this project to a GitHub repository.** You can do this from Bolt by
   connecting your GitHub account (see Bolt's GitHub integration docs), or by
   creating a new repo and uploading the files.
3. **Add two repository secrets** so the build can inject your Supabase
   credentials at build time (they are NOT stored in the repo):

   - Go to your repo on GitHub → **Settings** → **Secrets and variables** →
     **Actions** → **New repository secret**.
   - Add a secret named `VITE_SUPABASE_URL` with your Supabase project URL
     (found in your `.env` file as the `VITE_SUPABASE_URL` value).
   - Add a secret named `VITE_SUPABASE_ANON_KEY` with your Supabase anon key
     (found in your `.env` file as the `VITE_SUPABASE_ANON_KEY` value).

   These are the same values already in your `.env` file. They are public-safe
   (the anon key is designed to be in the frontend), but putting them in
   GitHub Secrets keeps them out of the committed code.

## Triggering a build

1. Open your repo on GitHub (in your phone browser).
2. Tap **Actions** tab.
3. Tap **Build Android APK** in the left sidebar.
4. Tap **Run workflow** → **Run workflow**.
5. Wait ~5–10 minutes. The build runs on GitHub's servers.

The workflow automatically:
- Builds the web app
- Adds the Capacitor Android platform
- Patches `AndroidManifest.xml` to enable cleartext traffic and add
  `INTERNET` / `ACCESS_NETWORK_STATE` permissions
- Syncs the web build into the Android project
- Builds a debug APK

## Downloading the APK

1. When the build finishes (green checkmark), tap on the completed run.
2. Scroll down to **Artifacts** and tap **rayyan-ai-debug-apk**.
3. The APK downloads to your phone.

## Installing the APK

1. Open the downloaded file. Android may warn about installing from unknown
   sources — allow it in Settings → **Install unknown apps**.
2. Tap **Install**. The Rayyan AI app icon appears in your app drawer.

## Testing the local llama.cpp connection

1. Open Termux on your phone and start the server:
   ```
   llama-server -m qwen2.5-1.5b-q4.gguf --host 127.0.0.1 --port 8080
   termux-wake-lock
   ```
2. Open the **Rayyan AI** app (the APK you installed, not the browser preview).
3. Tap the **Cpu** icon in the chat header.
4. Confirm the endpoint is `http://127.0.0.1:8080` and the model is
   `qwen2.5-1.5b-q4.gguf`.
5. Turn on **লোকাল AI ব্যবহার করুন**.
6. Tap **সংযোগ পরীক্ষা করুন** (Test connection).

In the native APK the WebView origin is `http://localhost`, so calls to
`http://127.0.0.1:8080` are same-scheme and cleartext traffic is allowed —
the connection should succeed where the HTTPS Bolt preview failed.

If the connection still fails, the diagnostic message in the app will show
the exact step that failed and the real browser error.

## Why the Bolt preview fails but the APK works

The Bolt preview is served over **HTTPS** from a public domain. Browsers block
HTTP requests to `127.0.0.1` from HTTPS pages (Mixed Content + Private Network
Access). The APK's WebView is configured with `androidScheme: "http"` and
`cleartext: true`, so there is no mixed-content restriction and cleartext
traffic to localhost is explicitly allowed.

## Notes

- This builds a **debug APK** — fine for personal use and testing. For Play
  Store distribution you'd need a signed release build (requires a keystore).
- All features work in the APK: chat, auth, admin, Bengali, voice, wake-word,
  cloud fallback, and local AI.
- The APK is a thin native wrapper around your web app. It loads the same
  built files and talks to the same Supabase backend.

# GitHub Desktop Build Setup

This project is configured so GitHub Actions builds the Tauri desktop installers. You do not need Rust, Visual Studio, or admin rights on your Windows machine.

## One-Time Secrets

The updater keypair has already been generated locally in `.tauri/`.

Add these repository secrets in GitHub:

1. Open `https://github.com/zgbrenner/filesift/settings/secrets/actions`
2. Click **New repository secret**
3. Add:

```text
Name: TAURI_SIGNING_PRIVATE_KEY
Value: contents of .tauri/filesift.key
```

4. Add:

```text
Name: TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Value: filesift-dev-change-me
```

The `.tauri/` folder is ignored by git. Do not commit the private key.

## Build From GitHub

Push the code:

```bash
git add .
git commit -m "Set up GitHub desktop builds"
git push origin main
```

Create and push a release tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub will run `.github/workflows/release.yml` and publish release installers for Windows, macOS, and Linux.

## Download The App

After the workflow finishes, open:

```text
https://github.com/zgbrenner/filesift/releases
```

Download the Windows installer from the latest release assets.

## In-App Updates

The app checks:

```text
https://github.com/zgbrenner/filesift/releases/latest/download/latest.json
```

When you publish a newer tagged release, installed apps can check for and install that update in-app.

# FileSift

FileSift is a local-first desktop app for reviewing messy document folders and safely renaming files with clearer, standardized filenames.

The app is built as a Tauri desktop product with a React review workspace and a local Python analysis pipeline. The first implementation includes the full import-review-approve-rename workflow, audit logging, rollback support, configurable naming settings, and an in-app update check wired for GitHub Releases.

## Stack

- Tauri v2 desktop shell
- React + TypeScript + Vite frontend
- Rust command layer with SQLite audit/state
- Python analyzer with Docling/GLiClass/Qwen-ready structure and heuristic fallbacks

## Development

Install JavaScript dependencies:

```bash
npm install
```

Run the web UI:

```bash
npm run dev
```

Run the Tauri desktop app:

```bash
npm run tauri:dev
```

The Tauri commands require Rust/Cargo. If Cargo is missing, install Rust from <https://rustup.rs/>.

If you cannot install Rust or Visual Studio Build Tools locally, use the GitHub Actions desktop build path instead:

[GitHub Desktop Build Setup](docs/github-desktop-build.md)

## Python Analyzer

Create a local virtual environment and install the MVP dependencies:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r python/requirements.txt
```

Docling, GLiClass, and local Qwen inference can be added behind the existing analyzer interface without changing the UI contract.

## In-App Updates

Tauri requires signed update artifacts. Generate a signing key before publishing production updates:

```bash
npm run tauri signer generate -- -w ~/.tauri/filesift.key
```

Keep the private key secret. Put the public key in `src-tauri/tauri.conf.json`, and set the updater endpoint to the GitHub Releases `latest.json` URL for your repository.

The app checks GitHub Releases for signed update manifests at:

```text
https://github.com/zgbrenner/filesift/releases/latest/download/latest.json
```

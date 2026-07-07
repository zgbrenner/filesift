# Changelog

## 0.1.3 — 2026-07-07

### Fixed

- Model downloads now run inside FileSift without opening a separate Windows terminal.
- Updated the Hugging Face download integration for the current `snapshot_download` API.
- Added resumable partial-download behavior and verification before a model is marked ready.
- Added structured in-app download errors instead of allowing the helper process to fail silently.
- Bundled and integrated the official GLiClass runtime so downloaded classifier files are actually used during document analysis.

### Added

- Naming Rules workspace for filename structure, confidence thresholds, and document labels.
- Windows CI coverage for the hidden Python helper, redirected process output, model downloader compatibility, and GLiClass runtime packaging.

### Upgrade note

The fixes in this release require a newly built FileSift installer or in-app update. Existing 0.1.2 installations do not contain the corrected Windows helper.

# FileSift Release Checklist

Run this before pushing a `v*` tag.

1. Build and package from a clean Windows runner.
2. Confirm the release workflow builds `filesift-sidecar-x86_64-pc-windows-msvc.exe`.
3. Install the generated app on a machine without Python installed.
4. Launch FileSift and confirm the model setup card appears.
5. Download the GLiClass and Qwen models from the setup card.
6. Import `test-fixtures/`.
7. Confirm the sample invoice, NDA, and board minutes receive plausible suggested names.
8. Approve at least one rename, apply it, then undo the latest batch.
9. Quit and relaunch the app. Confirm downloaded models still show as ready.
10. Only then push the tag, for example `git tag v0.1.2 && git push origin v0.1.2`.

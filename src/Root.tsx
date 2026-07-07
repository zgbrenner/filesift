import { RotateCcw, Save, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App } from "./App";
import { defaultSettings, getSettings, saveSettings } from "./tauri";
import type { NamingSettings } from "./types";
import "./settings.css";

const uniqueLabels = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  );

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function Root() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NamingSettings>(defaultSettings);
  const [labelsText, setLabelsText] = useState(defaultSettings.documentLabels.join("\n"));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let active = true;
    setLoading(true);
    setError(null);

    void getSettings()
      .then((settings) => {
        if (!active) return;
        setDraft(settings);
        setLabelsText(settings.documentLabels.join("\n"));
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load naming settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open]);

  const filenamePreview = useMemo(() => {
    const parts = ["2026-07-07"];
    if (draft.includeEntity) parts.push("Nordic Holdings ApS");
    if (draft.includeDocumentType) parts.push("Shareholder Register");

    const separator = draft.separator === "hyphen" ? " - " : draft.separator === "underscore" ? "_" : " ";
    const filename = `${parts.join(separator)}.pdf`;
    if (filename.length <= draft.maxFilenameLength) return filename;

    const available = Math.max(20, draft.maxFilenameLength - 4);
    return `${filename.slice(0, available).trim()}.pdf`;
  }, [draft.includeDocumentType, draft.includeEntity, draft.maxFilenameLength, draft.separator]);

  async function persistSettings() {
    setError(null);
    const documentLabels = uniqueLabels(labelsText);
    if (documentLabels.length === 0) {
      setError("Add at least one document type before saving.");
      return;
    }

    const normalized: NamingSettings = {
      ...draft,
      missingDateLabel: draft.missingDateLabel.trim() || "Undated",
      maxFilenameLength: clamp(Math.round(draft.maxFilenameLength), 40, 240),
      approveThreshold: clamp(draft.approveThreshold, 0.5, 0.99),
      documentLabels,
    };

    setSaving(true);
    try {
      await saveSettings(normalized);
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save naming settings.");
      setSaving(false);
    }
  }

  function resetDraft() {
    setDraft(defaultSettings);
    setLabelsText(defaultSettings.documentLabels.join("\n"));
    setError(null);
  }

  return (
    <div className="filesift-root">
      <App />

      <button
        className="settings-launcher"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open naming settings"
        title="Naming settings"
      >
        <Settings size={19} />
        <span>Naming rules</span>
      </button>

      {open && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header className="settings-dialog-header">
              <div>
                <span className="settings-eyebrow">FileSift preferences</span>
                <h1 id="settings-title">Naming rules</h1>
                <p>Control how FileSift builds suggestions and decides which files are safe to approve in bulk.</p>
              </div>
              <button className="settings-icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close settings">
                <X size={19} />
              </button>
            </header>

            {loading ? (
              <div className="settings-loading" aria-live="polite">Loading saved rules…</div>
            ) : (
              <div className="settings-dialog-body">
                {error && <div className="settings-error" role="alert">{error}</div>}

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <div>
                      <h2>Filename structure</h2>
                      <p>Suggestions keep the original file extension and begin with a date prefix.</p>
                    </div>
                    <span className="settings-fixed-format">YYYY-MM-DD</span>
                  </div>

                  <div className="settings-field-grid">
                    <label>
                      Separator
                      <select
                        value={draft.separator}
                        onChange={(event) => setDraft((current) => ({ ...current, separator: event.target.value as NamingSettings["separator"] }))}
                      >
                        <option value="space">Spaces</option>
                        <option value="hyphen">Spaced hyphens</option>
                        <option value="underscore">Underscores</option>
                      </select>
                    </label>

                    <label>
                      Missing-date label
                      <input
                        value={draft.missingDateLabel}
                        onChange={(event) => setDraft((current) => ({ ...current, missingDateLabel: event.target.value }))}
                        placeholder="Undated"
                      />
                    </label>

                    <label>
                      Maximum filename length
                      <input
                        type="number"
                        min={40}
                        max={240}
                        value={draft.maxFilenameLength}
                        onChange={(event) => setDraft((current) => ({ ...current, maxFilenameLength: Number(event.target.value) || 40 }))}
                      />
                    </label>
                  </div>

                  <div className="settings-toggle-list">
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.includeEntity}
                        onChange={(event) => setDraft((current) => ({ ...current, includeEntity: event.target.checked }))}
                      />
                      Include the detected company or entity
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.includeDocumentType}
                        onChange={(event) => setDraft((current) => ({ ...current, includeDocumentType: event.target.checked }))}
                      />
                      Include the detected document type
                    </label>
                  </div>

                  <div className="settings-preview">
                    <span>Example suggestion</span>
                    <strong>{filenamePreview}</strong>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <div>
                      <h2>Bulk approval</h2>
                      <p>Only files at or above this confidence score are selected by “Approve high confidence.”</p>
                    </div>
                    <strong className="settings-score">{Math.round(draft.approveThreshold * 100)}%</strong>
                  </div>

                  <label className="settings-range">
                    Confidence threshold
                    <input
                      type="range"
                      min={50}
                      max={99}
                      step={1}
                      value={Math.round(draft.approveThreshold * 100)}
                      onChange={(event) => setDraft((current) => ({ ...current, approveThreshold: Number(event.target.value) / 100 }))}
                    />
                    <span><span>More review</span><span>More automatic</span></span>
                  </label>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <div>
                      <h2>Document types</h2>
                      <p>One label per line. These labels guide local classification and appear in proposed filenames.</p>
                    </div>
                    <span className="settings-count">{uniqueLabels(labelsText).length} labels</span>
                  </div>

                  <textarea
                    className="settings-labels"
                    value={labelsText}
                    onChange={(event) => setLabelsText(event.target.value)}
                    spellCheck={false}
                    aria-label="Document type labels"
                  />
                </section>
              </div>
            )}

            <footer className="settings-dialog-footer">
              <button className="settings-secondary-button" type="button" onClick={resetDraft} disabled={loading || saving}>
                <RotateCcw size={16} /> Reset defaults
              </button>
              <div>
                <button className="settings-secondary-button" type="button" onClick={() => setOpen(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="settings-primary-button" type="button" onClick={() => void persistSettings()} disabled={loading || saving}>
                  <Save size={16} /> {saving ? "Saving…" : "Save and reload"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

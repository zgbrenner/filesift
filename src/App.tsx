import {
  AlertCircle,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileSearch,
  FolderOpen,
  History,
  Info,
  Files,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeBatch,
  applyRenames,
  checkForUpdate,
  createBatch,
  defaultSettings,
  getHistory,
  getSettings,
  installUpdate,
  pickImportFolder,
  pickImportPaths,
  saveSettings,
  saveSuggestion,
  setApproval,
  undoLastBatch,
} from "./tauri";
import type { BatchRecord, FileRecord, NamingSettings, UpdateStatus } from "./types";

type View = "review" | "settings" | "history";

const confidenceLabel = (confidence: number) => {
  if (confidence >= 0.82) return "High";
  if (confidence >= 0.62) return "Review";
  return "Low";
};

const statusTone = (status: FileRecord["status"]) => {
  if (status === "Ready" || status === "Renamed") return "good";
  if (status === "Needs review") return "warn";
  if (status === "Error") return "bad";
  if (status === "Skipped") return "muted";
  return "info";
};

export function App() {
  const [view, setView] = useState<View>("review");
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setNamingSettings] = useState<NamingSettings>(defaultSettings);
  const [history, setHistory] = useState<BatchRecord[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "good" | "warn" | "bad" | "info"; message: string } | null>(null);

  const selectedFile = files.find((file) => file.id === selectedId) ?? files[0] ?? null;

  const filteredFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return files;
    return files.filter((file) =>
      [file.originalName, file.suggestedName, file.documentType, file.detectedEntity ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [files, filter]);

  const approvedCount = files.filter((file) => file.approval === "approved").length;
  const readyCount = files.filter((file) => file.status === "Ready").length;
  const reviewCount = files.filter((file) => file.status === "Needs review").length;
  const renamedCount = files.filter((file) => file.status === "Renamed").length;
  const skippedCount = files.filter((file) => file.status === "Skipped").length;
  const highConfidenceIds = files
    .filter((file) => file.confidence >= settings.approveThreshold && file.status !== "Error")
    .map((file) => file.id);

  useEffect(() => {
    void getSettings().then(setNamingSettings).catch(() => setNamingSettings(defaultSettings));
    void getHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  async function importPaths(paths?: string[]) {
    setNotice(null);
    setBusy(true);
    try {
      const selectedPaths = paths ?? (await pickImportPaths());
      if (selectedPaths.length === 0) return;
      const created = await createBatch(selectedPaths);
      setBatch(created.batch);
      setFiles(created.files);
      setSelectedId(created.files[0]?.id ?? null);
      const analyzed = await analyzeBatch(created.batch.id);
      setFiles(analyzed);
      setSelectedId(analyzed[0]?.id ?? null);
      setNotice({ tone: "good", message: `Analyzed ${analyzed.length} file${analyzed.length === 1 ? "" : "s"}.` });
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Import failed." });
    } finally {
      setBusy(false);
    }
  }

  async function importFolder() {
    const paths = await pickImportFolder();
    await importPaths(paths);
  }

  async function updateFileName(fileId: string, suggestedName: string) {
    setFiles((current) => current.map((file) => (file.id === fileId ? { ...file, suggestedName } : file)));
    try {
      const saved = await saveSuggestion(fileId, suggestedName);
      setFiles((current) => current.map((file) => (file.id === fileId ? saved : file)));
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save filename." });
    }
  }

  async function updateApproval(fileIds: string[], approval: "approved" | "skipped" | "pending") {
    if (fileIds.length === 0) return;
    try {
      const updated = await setApproval(fileIds, approval);
      setFiles(updated);
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update approval." });
    }
  }

  async function renameApproved() {
    if (!batch) return;
    setBusy(true);
    try {
      const updated = await applyRenames(batch.id);
      setFiles(updated);
      setHistory(await getHistory());
      setNotice({ tone: "good", message: "Approved renames were applied and recorded." });
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Rename failed." });
    } finally {
      setBusy(false);
    }
  }

  async function checkUpdates() {
    setUpdateStatus({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      if (!update) {
        setUpdateStatus({ kind: "current" });
        return;
      }
      setUpdateStatus({ kind: "available", version: update.version, notes: update.notes });
    } catch (error) {
      setUpdateStatus({ kind: "error", message: error instanceof Error ? error.message : "Update check failed" });
    }
  }

  async function installAvailableUpdate() {
    setUpdateStatus({ kind: "installing" });
    try {
      await installUpdate();
    } catch (error) {
      setUpdateStatus({ kind: "error", message: error instanceof Error ? error.message : "Install failed" });
    }
  }

  return (
    <main
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => (file as File & { path?: string }).path)
          .filter((path): path is string => Boolean(path));
        void importPaths(paths);
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          <FileSearch size={28} />
          <div>
            <strong>FileSift</strong>
            <span>Local rename review</span>
          </div>
        </div>
        <button className={view === "review" ? "nav active" : "nav"} onClick={() => setView("review")}>
          <Sparkles size={18} /> Review
        </button>
        <button className={view === "settings" ? "nav active" : "nav"} onClick={() => setView("settings")}>
          <Settings size={18} /> Settings
        </button>
        <button className={view === "history" ? "nav active" : "nav"} onClick={() => setView("history")}>
          <History size={18} /> History
        </button>
        <div className="privacy">
          <ShieldCheck size={18} />
          <span>Local-first. No cloud upload by default.</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{view === "review" ? "Review filenames" : view === "settings" ? "Settings" : "Rename history"}</h1>
            <p>{batch ? `${batch.fileCount} files in ${batch.name}` : "Drop files or folders to begin a rename batch."}</p>
          </div>
          <div className="top-actions">
            <button className="secondary" onClick={checkUpdates}>
              <Download size={17} /> Check updates
            </button>
            <button className="primary" onClick={() => void importPaths()} disabled={busy}>
              <Files size={17} /> Add files
            </button>
            <button className="primary" onClick={() => void importFolder()} disabled={busy}>
              <FolderOpen size={17} /> Add folder
            </button>
          </div>
        </header>

        <UpdateBanner status={updateStatus} onInstall={installAvailableUpdate} />
        {notice && (
          <div className={`banner ${notice.tone}`}>
            {notice.tone === "bad" ? <AlertCircle size={17} /> : <Info size={17} />}
            <span>{notice.message}</span>
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}

        {view === "review" && (
          <div className="review-layout">
            <section className="main-panel">
              {files.length === 0 ? (
                <div className="dropzone" onClick={() => void importPaths()}>
                  <Upload size={42} />
                  <h2>Drop documents or folders here</h2>
                  <p>Files appear immediately, then FileSift extracts, classifies, and proposes safe names for review.</p>
                  <div className="drop-actions">
                    <button className="secondary" onClick={(event) => {
                      event.stopPropagation();
                      void importPaths();
                    }}>
                      <Files size={16} /> Choose files
                    </button>
                    <button className="secondary" onClick={(event) => {
                      event.stopPropagation();
                      void importFolder();
                    }}>
                      <FolderOpen size={16} /> Choose folder
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="summary-strip">
                    <div><span>Total</span><strong>{files.length}</strong></div>
                    <div><span>Ready</span><strong>{readyCount}</strong></div>
                    <div><span>Needs review</span><strong>{reviewCount}</strong></div>
                    <div><span>Approved</span><strong>{approvedCount}</strong></div>
                    <div><span>Skipped</span><strong>{skippedCount}</strong></div>
                    <div><span>Renamed</span><strong>{renamedCount}</strong></div>
                  </div>
                  <div className="batch-actions">
                    <div className="search">
                      <Search size={17} />
                      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter files" />
                    </div>
                    <button className="secondary" onClick={() => void updateApproval(highConfidenceIds, "approved")}>
                      <Check size={16} /> Approve high confidence
                    </button>
                    <button className="secondary" onClick={() => void updateApproval(files.map((file) => file.id), "skipped")}>
                      <SkipForward size={16} /> Skip all
                    </button>
                    <button className="primary" onClick={renameApproved} disabled={!approvedCount || busy}>
                      Apply {approvedCount} rename{approvedCount === 1 ? "" : "s"}
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Original filename</th>
                          <th>Suggested filename</th>
                          <th>Type</th>
                          <th>Date</th>
                          <th>Entity</th>
                          <th>Confidence</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFiles.map((file) => (
                          <tr key={file.id} className={selectedId === file.id ? "selected" : ""} onClick={() => setSelectedId(file.id)}>
                            <td>
                              <span className={`pill ${statusTone(file.status)}`}>{file.status}</span>
                            </td>
                            <td className="filename">{file.originalName}</td>
                            <td>
                              <input
                                className="name-input"
                                value={file.suggestedName}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setFiles((current) => current.map((row) => (row.id === file.id ? { ...row, suggestedName: value } : row)));
                                }}
                                onBlur={(event) => void updateFileName(file.id, event.target.value)}
                              />
                            </td>
                            <td>{file.documentType}</td>
                            <td>{file.detectedDate ?? "Undated"}</td>
                            <td>{file.detectedEntity ?? "Unknown"}</td>
                            <td>
                              <span className={`confidence ${confidenceLabel(file.confidence).toLowerCase()}`}>
                                {confidenceLabel(file.confidence)} {Math.round(file.confidence * 100)}%
                              </span>
                            </td>
                            <td>
                              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                                <button title="Approve" onClick={() => void updateApproval([file.id], "approved")}>
                                  <Check size={15} />
                                </button>
                                <button title="Skip" onClick={() => void updateApproval([file.id], "skipped")}>
                                  <SkipForward size={15} />
                                </button>
                                <button title="Details" onClick={() => setSelectedId(file.id)}>
                                  <ChevronRight size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            <DetailPanel file={selectedFile} />
          </div>
        )}

        {view === "settings" && (
          <SettingsPanel
            settings={settings}
            onSave={async (next) => {
              const saved = await saveSettings(next);
              setNamingSettings(saved);
            }}
          />
        )}

        {view === "history" && (
          <HistoryPanel
            history={history}
            onUndo={async () => {
              try {
                await undoLastBatch();
                setHistory(await getHistory());
                setNotice({ tone: "good", message: "Latest rename batch was undone where files were still available." });
              } catch (error) {
                setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Undo failed." });
              }
            }}
          />
        )}
      </section>
    </main>
  );
}

function UpdateBanner({ status, onInstall }: { status: UpdateStatus; onInstall: () => void }) {
  if (status.kind === "idle") return null;
  if (status.kind === "checking") return <div className="banner info"><Clock3 size={17} /> Checking for updates...</div>;
  if (status.kind === "current") return <div className="banner good"><Check size={17} /> FileSift is up to date.</div>;
  if (status.kind === "installing") return <div className="banner info"><Download size={17} /> Installing update...</div>;
  if (status.kind === "error") return <div className="banner bad"><AlertCircle size={17} /> {status.message}</div>;
  return (
    <div className="banner warn">
      <Info size={17} />
      <span>Version {status.version} is available.</span>
      <button onClick={onInstall}>Download and restart</button>
    </div>
  );
}

function DetailPanel({ file }: { file: FileRecord | null }) {
  if (!file) {
    return (
      <aside className="detail empty">
        <Info size={20} />
        Select a file to inspect the proposed name.
      </aside>
    );
  }
  return (
    <aside className="detail">
      <div className="detail-head">
        <span className={`pill ${statusTone(file.status)}`}>{file.status}</span>
        <h2>{file.originalName}</h2>
        <p>{file.path}</p>
      </div>
      <label>
        Suggested filename
        <input value={file.suggestedName} readOnly />
      </label>
      <div className="facts">
        <div><span>Type</span><strong>{file.documentType}</strong></div>
        <div><span>Date</span><strong>{file.detectedDate ?? "Undated"}</strong></div>
        <div><span>Entity</span><strong>{file.detectedEntity ?? "Unknown"}</strong></div>
        <div><span>Language</span><strong>{file.detectedLanguage ?? "Unknown"}</strong></div>
      </div>
      {file.warnings.length > 0 && (
        <section>
          <h3>Warnings</h3>
          {file.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
        </section>
      )}
      <section>
        <h3>Evidence</h3>
        <div className="snippets">
          {file.evidence.length ? file.evidence.map((item) => <span key={item}>{item}</span>) : <em>No evidence snippets found.</em>}
        </div>
      </section>
      <section>
        <h3>Preview</h3>
        <p className="preview">{file.previewText || "No preview text available."}</p>
      </section>
    </aside>
  );
}

function SettingsPanel({ settings, onSave }: { settings: NamingSettings; onSave: (settings: NamingSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);

  return (
    <section className="settings-grid">
      <div className="settings-card">
        <h2>Naming convention</h2>
        <label>
          Date format
          <select value={draft.dateFormat} onChange={(event) => setDraft({ ...draft, dateFormat: event.target.value as NamingSettings["dateFormat"] })}>
            <option>YYYY-MM-DD</option>
            <option>YYYY.MM.DD</option>
            <option>MM-DD-YYYY</option>
          </select>
        </label>
        <label>
          Missing date label
          <input value={draft.missingDateLabel} onChange={(event) => setDraft({ ...draft, missingDateLabel: event.target.value })} />
        </label>
        <label>
          Separator
          <select value={draft.separator} onChange={(event) => setDraft({ ...draft, separator: event.target.value as NamingSettings["separator"] })}>
            <option value="space">Space</option>
            <option value="hyphen">Hyphen</option>
            <option value="underscore">Underscore</option>
          </select>
        </label>
        <label>
          Maximum filename length
          <input
            type="number"
            min={40}
            max={220}
            value={draft.maxFilenameLength}
            onChange={(event) => setDraft({ ...draft, maxFilenameLength: Number(event.target.value) })}
          />
        </label>
        <div className="toggles">
          <label><input type="checkbox" checked={draft.includeEntity} onChange={(event) => setDraft({ ...draft, includeEntity: event.target.checked })} /> Include entity</label>
          <label><input type="checkbox" checked={draft.includeDocumentType} onChange={(event) => setDraft({ ...draft, includeDocumentType: event.target.checked })} /> Include document type</label>
        </div>
      </div>
      <div className="settings-card">
        <h2>Document labels</h2>
        <textarea
          value={draft.documentLabels.join("\n")}
          onChange={(event) => setDraft({ ...draft, documentLabels: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}
        />
      </div>
      <div className="settings-card">
        <h2>Model and privacy</h2>
        <label>
          Analysis mode
          <select value={draft.modelMode} onChange={(event) => setDraft({ ...draft, modelMode: event.target.value as NamingSettings["modelMode"] })}>
            <option value="heuristic">Heuristic MVP</option>
            <option value="local-model">Local model</option>
          </select>
        </label>
        <label>
          Auto-approve threshold
          <input
            type="number"
            min={0.5}
            max={0.99}
            step={0.01}
            value={draft.approveThreshold}
            onChange={(event) => setDraft({ ...draft, approveThreshold: Number(event.target.value) })}
          />
        </label>
        <button className="primary" onClick={() => void onSave(draft)}>Save settings</button>
      </div>
    </section>
  );
}

function HistoryPanel({ history, onUndo }: { history: BatchRecord[]; onUndo: () => Promise<void> }) {
  return (
    <section className="history-panel">
      <div className="batch-actions">
        <button className="secondary" onClick={() => void onUndo()}><RotateCcw size={16} /> Undo latest batch</button>
      </div>
      {history.length === 0 ? (
        <div className="empty-state">No rename history yet.</div>
      ) : (
        history.map((batch) => (
          <article className="history-item" key={batch.id}>
            <div>
              <h2>{batch.name}</h2>
              <p>{new Date(batch.createdAt).toLocaleString()}</p>
            </div>
            <strong>{batch.renamedCount} renamed</strong>
          </article>
        ))
      )}
    </section>
  );
}

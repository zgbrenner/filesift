import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { BatchRecord, FileRecord, ModelStatus, NamingSettings } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

const defaultLabels = [
  "Shareholder Register",
  "Board Minutes",
  "Board Resolution",
  "Shareholder Resolution",
  "Articles of Association",
  "Certificate of Incorporation",
  "Operating Agreement",
  "Vendor Agreement",
  "Master Services Agreement",
  "Statement of Work",
  "Order Form",
  "Data Processing Agreement",
  "NDA",
  "Invoice",
  "Financial Statement",
  "Tax Document",
  "Background Check",
  "Resume",
  "Offer Letter",
  "Legal Correspondence",
  "Unknown",
];

export const defaultSettings: NamingSettings = {
  dateFormat: "YYYY-MM-DD",
  missingDateLabel: "Undated",
  includeEntity: true,
  includeDocumentType: true,
  separator: "space",
  maxFilenameLength: 120,
  approveThreshold: 0.82,
  modelMode: "local-model",
  documentLabels: defaultLabels,
};

const demoFiles: FileRecord[] = [
  {
    id: "demo-1",
    batchId: "demo",
    path: "/Users/example/Documents/scan001.pdf",
    originalName: "scan001.pdf",
    suggestedName: "2024-03-15 Nordic Holdings ApS Shareholder Register.pdf",
    extension: ".pdf",
    status: "Ready",
    approval: "pending",
    documentType: "Shareholder Register",
    detectedDate: "2024-03-15",
    detectedEntity: "Nordic Holdings ApS",
    detectedLanguage: "Danish",
    confidence: 0.91,
    evidence: ["Aktionaerregister", "Antal aktier", "Stemmerettigheder"],
    warnings: [],
    previewText:
      "Aktionaerregister for Nordic Holdings ApS. Dokumentet angiver antal aktier, stemmerettigheder og registreringsdato.",
    error: null,
  },
  {
    id: "demo-2",
    batchId: "demo",
    path: "/Users/example/Documents/document-final-final.pdf",
    originalName: "document-final-final.pdf",
    suggestedName: "2023-11-02 Halberg Systems Inc Vendor Services Agreement.pdf",
    extension: ".pdf",
    status: "Needs review",
    approval: "pending",
    documentType: "Vendor Agreement",
    detectedDate: "2023-11-02",
    detectedEntity: "Halberg Systems Inc",
    detectedLanguage: "English",
    confidence: 0.74,
    evidence: ["services agreement", "vendor", "effective date"],
    warnings: ["Entity appears in several places; review suggested name before approving."],
    previewText:
      "This Vendor Services Agreement is entered into as of November 2, 2023 by and between Halberg Systems Inc and the supplier.",
    error: null,
  },
];

export async function pickImportPaths(): Promise<string[]> {
  if (!isTauri) return [];
  const selected = await open({
    multiple: true,
    directory: false,
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function pickImportFolder(): Promise<string[]> {
  if (!isTauri) return [];
  const selected = await open({
    multiple: false,
    directory: true,
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function createBatch(paths: string[]): Promise<{ batch: BatchRecord; files: FileRecord[] }> {
  if (!isTauri) {
    return {
      batch: {
        id: "demo",
        name: "Demo batch",
        createdAt: new Date().toISOString(),
        fileCount: demoFiles.length,
        renamedCount: 0,
      },
      files: demoFiles,
    };
  }
  return invoke("create_batch", { paths });
}

export async function analyzeBatch(batchId: string): Promise<FileRecord[]> {
  if (!isTauri) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return demoFiles;
  }
  return invoke("analyze_batch", { batchId });
}

export async function saveSuggestion(fileId: string, suggestedName: string): Promise<FileRecord> {
  if (!isTauri) {
    const found = demoFiles.find((file) => file.id === fileId);
    return { ...(found ?? demoFiles[0]), suggestedName };
  }
  return invoke("save_suggestion", { fileId, suggestedName });
}

export async function setApproval(fileIds: string[], approval: "approved" | "skipped" | "pending"): Promise<FileRecord[]> {
  if (!isTauri) return demoFiles.map((file) => (fileIds.includes(file.id) ? { ...file, approval } : file));
  return invoke("set_approval", { fileIds, approval });
}

export async function applyRenames(batchId: string): Promise<FileRecord[]> {
  if (!isTauri) {
    return demoFiles.map((file) => (file.approval === "approved" ? { ...file, status: "Renamed" } : file));
  }
  return invoke("apply_renames", { batchId });
}

export async function undoLastBatch(): Promise<void> {
  if (!isTauri) return;
  await invoke("undo_last_batch");
}

export async function getHistory(): Promise<BatchRecord[]> {
  if (!isTauri) return [];
  return invoke("get_history");
}

export async function getSettings(): Promise<NamingSettings> {
  if (!isTauri) return defaultSettings;
  return invoke("get_settings");
}

export async function saveSettings(settings: NamingSettings): Promise<NamingSettings> {
  if (!isTauri) return settings;
  return invoke("save_settings", { settings });
}

export async function getModelStatus(): Promise<ModelStatus> {
  if (!isTauri) {
    return {
      ready: true,
      modelsDir: "browser-demo",
      models: [
        {
          key: "gliclass",
          name: "GLiClass classifier",
          repo: "knowledgator/gliclass-small-v1.0",
          revision: "21edefaf7951f68c68c505f9139ba536d3b448f7",
          license: "apache-2.0",
          size: "about 1.24 GiB",
          downloaded: true,
          path: "browser-demo/gliclass",
        },
        {
          key: "qwen",
          name: "Qwen small language model",
          repo: "Qwen/Qwen2.5-0.5B-Instruct",
          revision: "7ae557604adf67be50417f59c2c2f167def9a775",
          license: "apache-2.0",
          size: "about 0.93 GiB",
          downloaded: true,
          path: "browser-demo/qwen",
        },
      ],
    };
  }
  return invoke("get_model_status");
}

export async function downloadRequiredModels(): Promise<ModelStatus> {
  if (!isTauri) return getModelStatus();
  return invoke("download_required_models");
}

export async function checkForUpdate(): Promise<{ version: string; notes: string } | null> {
  if (!isTauri) {
    throw new Error("Updater is available only in the desktop app.");
  }
  const update = await check();
  if (!update) return null;
  return { version: update.version, notes: update.body ?? "" };
}

export async function installUpdate(): Promise<void> {
  if (!isTauri) return;
  const update = await check();
  if (!update) return;
  await update.downloadAndInstall();
  await relaunch();
}

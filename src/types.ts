export type FileStatus =
  | "Waiting"
  | "Extracting"
  | "Classifying"
  | "Generating name"
  | "Ready"
  | "Needs review"
  | "Error"
  | "Skipped"
  | "Renamed";

export type ApprovalState = "pending" | "approved" | "skipped";

export type FileRecord = {
  id: string;
  batchId: string;
  path: string;
  originalName: string;
  suggestedName: string;
  extension: string;
  status: FileStatus;
  approval: ApprovalState;
  documentType: string;
  detectedDate: string | null;
  detectedEntity: string | null;
  detectedLanguage: string | null;
  confidence: number;
  evidence: string[];
  warnings: string[];
  previewText: string;
  error: string | null;
};

export type BatchRecord = {
  id: string;
  name: string;
  createdAt: string;
  fileCount: number;
  renamedCount: number;
};

export type NamingSettings = {
  dateFormat: "YYYY-MM-DD" | "YYYY.MM.DD" | "MM-DD-YYYY";
  missingDateLabel: string;
  includeEntity: boolean;
  includeDocumentType: boolean;
  separator: "space" | "hyphen" | "underscore";
  maxFilenameLength: number;
  approveThreshold: number;
  modelMode: "heuristic" | "local-model";
  documentLabels: string[];
};

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "current" }
  | { kind: "installing" }
  | { kind: "error"; message: string };

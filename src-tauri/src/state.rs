use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(thiserror::Error, Debug)]
pub enum FileSiftError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("filesystem error: {0}")]
    Filesystem(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("app path error: {0}")]
    AppPath(#[from] tauri::Error),
    #[error("{0}")]
    Validation(String),
}

pub struct AppState {
    db_path: PathBuf,
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub id: String,
    pub batch_id: String,
    pub path: String,
    pub original_name: String,
    pub suggested_name: String,
    pub extension: String,
    pub status: String,
    pub approval: String,
    pub document_type: String,
    pub detected_date: Option<String>,
    pub detected_entity: Option<String>,
    pub detected_language: Option<String>,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub warnings: Vec<String>,
    pub preview_text: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub file_count: usize,
    pub renamed_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchWithFiles {
    pub batch: BatchRecord,
    pub files: Vec<FileRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingSettings {
    pub date_format: String,
    pub missing_date_label: String,
    pub include_entity: bool,
    pub include_document_type: bool,
    pub separator: String,
    pub max_filename_length: usize,
    pub approve_threshold: f64,
    pub model_mode: String,
    pub document_labels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzerOutput {
    document_type: String,
    detected_date: Option<String>,
    detected_entity: Option<String>,
    detected_language: Option<String>,
    confidence: f64,
    evidence: Vec<String>,
    warnings: Vec<String>,
    preview_text: String,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, FileSiftError> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("filesift.sqlite3");
        let state = Self {
            db_path,
            lock: Mutex::new(()),
        };
        state.init_db()?;
        Ok(state)
    }

    fn connection(&self) -> Result<Connection, FileSiftError> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn init_db(&self) -> Result<(), FileSiftError> {
        let conn = self.connection()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS batches (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS files (
              id TEXT PRIMARY KEY,
              batch_id TEXT NOT NULL,
              path TEXT NOT NULL,
              original_name TEXT NOT NULL,
              suggested_name TEXT NOT NULL,
              extension TEXT NOT NULL,
              status TEXT NOT NULL,
              approval TEXT NOT NULL,
              document_type TEXT NOT NULL,
              detected_date TEXT,
              detected_entity TEXT,
              detected_language TEXT,
              confidence REAL NOT NULL,
              evidence_json TEXT NOT NULL,
              warnings_json TEXT NOT NULL,
              preview_text TEXT NOT NULL,
              error TEXT,
              FOREIGN KEY(batch_id) REFERENCES batches(id)
            );

            CREATE TABLE IF NOT EXISTS rename_audit (
              id TEXT PRIMARY KEY,
              batch_id TEXT NOT NULL,
              original_path TEXT NOT NULL,
              new_path TEXT NOT NULL,
              original_filename TEXT NOT NULL,
              new_filename TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              status TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            "#,
        )?;
        Ok(())
    }
}

fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

pub fn create_batch_impl(app: &AppHandle, paths: Vec<String>) -> Result<BatchWithFiles, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;

    let expanded = expand_paths(paths)?;
    if expanded.is_empty() {
        return Err(FileSiftError::Validation("No supported files were found.".to_string()));
    }

    let batch_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let batch_name = format!("Batch {}", Utc::now().format("%Y-%m-%d %H:%M"));
    conn.execute(
        "INSERT INTO batches (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![batch_id, batch_name, now],
    )?;

    let mut files = Vec::with_capacity(expanded.len());
    for path in expanded {
        let original_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("untitled")
            .to_string();
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!(".{ext}"))
            .unwrap_or_default();
        let record = FileRecord {
            id: Uuid::new_v4().to_string(),
            batch_id: batch_id.clone(),
            path: path.to_string_lossy().to_string(),
            suggested_name: original_name.clone(),
            original_name,
            extension,
            status: "Waiting".to_string(),
            approval: "pending".to_string(),
            document_type: "Unknown".to_string(),
            detected_date: None,
            detected_entity: None,
            detected_language: None,
            confidence: 0.0,
            evidence: vec![],
            warnings: vec![],
            preview_text: String::new(),
            error: None,
        };
        upsert_file(&conn, &record)?;
        files.push(record);
    }

    Ok(BatchWithFiles {
        batch: BatchRecord {
            id: batch_id,
            name: batch_name,
            created_at: now,
            file_count: files.len(),
            renamed_count: 0,
        },
        files,
    })
}

pub fn analyze_batch_impl(app: &AppHandle, batch_id: &str) -> Result<Vec<FileRecord>, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    let settings = get_settings_from_conn(&conn)?;
    let mut files = list_files(&conn, Some(batch_id))?;
    let analyzer = analyzer_script_path(app);

    for file in &mut files {
        file.status = "Extracting".to_string();
        upsert_file(&conn, file)?;
        match run_analyzer(&analyzer, file, &settings) {
            Ok(output) => {
                file.status = if output.confidence >= settings.approve_threshold {
                    "Ready".to_string()
                } else {
                    "Needs review".to_string()
                };
                file.document_type = output.document_type;
                file.detected_date = output.detected_date;
                file.detected_entity = output.detected_entity;
                file.detected_language = output.detected_language;
                file.confidence = output.confidence;
                file.evidence = output.evidence;
                file.warnings = output.warnings;
                file.preview_text = output.preview_text;
                file.error = None;
                file.suggested_name = generate_filename(file, &settings);
            }
            Err(error) => {
                let fallback = fallback_analysis(file);
                file.status = "Needs review".to_string();
                file.document_type = fallback.document_type;
                file.detected_date = fallback.detected_date;
                file.detected_entity = fallback.detected_entity;
                file.detected_language = fallback.detected_language;
                file.confidence = fallback.confidence;
                file.evidence = fallback.evidence;
                file.warnings = vec![format!("Analyzer unavailable; used filename heuristics. {error}")];
                file.preview_text = fallback.preview_text;
                file.error = None;
                file.suggested_name = generate_filename(file, &settings);
            }
        }
        file.suggested_name = sanitize_filename(&file.suggested_name, &file.extension, settings.max_filename_length);
        upsert_file(&conn, file)?;
    }

    Ok(list_files(&conn, Some(batch_id))?)
}

pub fn save_suggestion_impl(app: &AppHandle, file_id: &str, suggested_name: &str) -> Result<FileRecord, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    let mut file = get_file(&conn, file_id)?;
    file.suggested_name = sanitize_filename(suggested_name, &file.extension, 180);
    upsert_file(&conn, &file)?;
    Ok(file)
}

pub fn set_approval_impl(app: &AppHandle, file_ids: Vec<String>, approval: &str) -> Result<Vec<FileRecord>, FileSiftError> {
    if !matches!(approval, "approved" | "skipped" | "pending") {
        return Err(FileSiftError::Validation("Invalid approval state.".to_string()));
    }
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    let mut batch_id = None;
    for file_id in file_ids {
        let mut file = get_file(&conn, &file_id)?;
        batch_id = Some(file.batch_id.clone());
        file.approval = approval.to_string();
        if approval == "skipped" {
            file.status = "Skipped".to_string();
        }
        upsert_file(&conn, &file)?;
    }
    Ok(list_files(&conn, batch_id.as_deref())?)
}

pub fn apply_renames_impl(app: &AppHandle, batch_id: &str) -> Result<Vec<FileRecord>, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    let mut files = list_files(&conn, Some(batch_id))?;
    let approved: Vec<FileRecord> = files
        .iter()
        .filter(|file| file.approval == "approved" && file.status != "Renamed")
        .cloned()
        .collect();
    preflight(&approved)?;

    for file in &mut files {
        if file.approval != "approved" || file.status == "Renamed" {
            continue;
        }
        let old_path = PathBuf::from(&file.path);
        let new_path = old_path.with_file_name(&file.suggested_name);
        fs::rename(&old_path, &new_path)?;
        let timestamp = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rename_audit (id, batch_id, original_path, new_path, original_filename, new_filename, timestamp, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'renamed')",
            params![
                Uuid::new_v4().to_string(),
                file.batch_id,
                file.path,
                new_path.to_string_lossy().to_string(),
                file.original_name,
                file.suggested_name,
                timestamp
            ],
        )?;
        file.path = new_path.to_string_lossy().to_string();
        file.status = "Renamed".to_string();
        upsert_file(&conn, file)?;
    }

    Ok(list_files(&conn, Some(batch_id))?)
}

pub fn undo_last_batch_impl(app: &AppHandle) -> Result<(), FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    let batch_id: Option<String> = conn
        .query_row(
            "SELECT batch_id FROM rename_audit WHERE status = 'renamed' ORDER BY timestamp DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let Some(batch_id) = batch_id else {
        return Ok(());
    };

    let mut stmt = conn.prepare(
        "SELECT id, original_path, new_path, original_filename FROM rename_audit WHERE batch_id = ?1 AND status = 'renamed' ORDER BY timestamp DESC",
    )?;
    let rows = stmt.query_map(params![batch_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    for row in rows {
        let (audit_id, original_path, new_path, original_filename) = row?;
        if Path::new(&new_path).exists() && !Path::new(&original_path).exists() {
            fs::rename(&new_path, &original_path)?;
        }
        conn.execute(
            "UPDATE files SET path = ?1, suggested_name = ?2, status = 'Ready', approval = 'pending'
             WHERE path = ?3",
            params![original_path, original_filename, new_path],
        )?;
        conn.execute("UPDATE rename_audit SET status = 'undone' WHERE id = ?1", params![audit_id])?;
    }
    Ok(())
}

pub fn get_history_impl(app: &AppHandle) -> Result<Vec<BatchRecord>, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    get_history_from_conn(&conn)
}

pub fn get_settings_impl(app: &AppHandle) -> Result<NamingSettings, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    get_settings_from_conn(&conn)
}

pub fn save_settings_impl(app: &AppHandle, settings: NamingSettings) -> Result<NamingSettings, FileSiftError> {
    let app_state = state(app);
    let _guard = app_state.lock.lock().expect("app state lock poisoned");
    let conn = app_state.connection()?;
    let value = serde_json::to_string(&settings)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('naming', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    )?;
    Ok(settings)
}

fn expand_paths(paths: Vec<String>) -> Result<Vec<PathBuf>, FileSiftError> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_file() {
            push_supported(path, &mut seen, &mut files);
        } else if path.is_dir() {
            for entry in WalkDir::new(path).follow_links(false).into_iter().filter_map(Result::ok) {
                if entry.path().is_file() {
                    push_supported(entry.path().to_path_buf(), &mut seen, &mut files);
                }
            }
        }
    }
    Ok(files)
}

fn push_supported(path: PathBuf, seen: &mut HashSet<PathBuf>, files: &mut Vec<PathBuf>) {
    let supported = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "pdf" | "docx" | "doc" | "xlsx" | "xls" | "pptx" | "txt" | "md" | "csv" | "png" | "jpg" | "jpeg" | "tiff" | "bmp" | "webp"
            )
        })
        .unwrap_or(false);
    if supported && seen.insert(path.clone()) {
        files.push(path);
    }
}

fn analyzer_script_path(app: &AppHandle) -> PathBuf {
    let dev_path = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("python")
        .join("analyzer.py");
    if dev_path.exists() {
        return dev_path;
    }
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("python")
        .join("analyzer.py")
}

fn run_analyzer(path: &Path, file: &FileRecord, settings: &NamingSettings) -> Result<AnalyzerOutput, FileSiftError> {
    if !path.exists() {
        return Err(FileSiftError::Validation("Python analyzer script not found.".to_string()));
    }
    let output = Command::new("python3")
        .arg(path)
        .arg("--file")
        .arg(&file.path)
        .arg("--settings")
        .arg(serde_json::to_string(settings)?)
        .output()?;
    if !output.status.success() {
        return Err(FileSiftError::Validation(String::from_utf8_lossy(&output.stderr).to_string()));
    }
    Ok(serde_json::from_slice(&output.stdout)?)
}

fn fallback_analysis(file: &FileRecord) -> AnalyzerOutput {
    let lower = file.original_name.to_ascii_lowercase();
    let mut document_type = "Unknown".to_string();
    let mut confidence = 0.42;
    let mut evidence = vec![file.original_name.clone()];
    for (needle, label) in [
        ("invoice", "Invoice"),
        ("nda", "NDA"),
        ("resume", "Resume"),
        ("cv", "Resume"),
        ("agreement", "Vendor Agreement"),
        ("contract", "Vendor Agreement"),
        ("board", "Board Minutes"),
        ("shareholder", "Shareholder Register"),
        ("background", "Background Check"),
        ("tax", "Tax Document"),
        ("financial", "Financial Statement"),
    ] {
        if lower.contains(needle) {
            document_type = label.to_string();
            confidence = 0.58;
            evidence.push(needle.to_string());
            break;
        }
    }
    AnalyzerOutput {
        document_type,
        detected_date: detect_date(&lower),
        detected_entity: None,
        detected_language: None,
        confidence,
        evidence,
        warnings: vec!["Only filename clues were available.".to_string()],
        preview_text: String::new(),
    }
}

fn detect_date(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    for idx in 0..bytes.len().saturating_sub(10) {
        let slice = &text[idx..idx + 10];
        if slice.as_bytes()[4] == b'-'
            && slice.as_bytes()[7] == b'-'
            && slice.chars().enumerate().all(|(i, ch)| i == 4 || i == 7 || ch.is_ascii_digit())
        {
            return Some(slice.to_string());
        }
    }
    None
}

fn generate_filename(file: &FileRecord, settings: &NamingSettings) -> String {
    let mut parts = Vec::new();
    parts.push(file.detected_date.clone().unwrap_or_else(|| settings.missing_date_label.clone()));
    if settings.include_entity {
        if let Some(entity) = &file.detected_entity {
            if !entity.trim().is_empty() {
                parts.push(entity.clone());
            }
        }
    }
    if settings.include_document_type && file.document_type != "Unknown" {
        parts.push(file.document_type.clone());
    }
    if parts.len() == 1 {
        parts.push(strip_extension(&file.original_name).to_string());
    }
    let sep = match settings.separator.as_str() {
        "hyphen" => " - ",
        "underscore" => "_",
        _ => " ",
    };
    format!("{}{}", parts.join(sep), file.extension)
}

fn strip_extension(name: &str) -> &str {
    Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name)
}

fn sanitize_filename(name: &str, extension: &str, max_len: usize) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*', '\0'];
    let mut cleaned = name
        .chars()
        .map(|ch| if invalid.contains(&ch) { '-' } else { ch })
        .collect::<String>();
    cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if !extension.is_empty() && !cleaned.to_ascii_lowercase().ends_with(&extension.to_ascii_lowercase()) {
        cleaned.push_str(extension);
    }
    if cleaned.len() > max_len {
        let ext_len = extension.len();
        let keep = max_len.saturating_sub(ext_len).max(20);
        let stem = strip_extension(&cleaned);
        cleaned = format!("{}{}", stem.chars().take(keep).collect::<String>().trim(), extension);
    }
    cleaned
}

fn preflight(files: &[FileRecord]) -> Result<(), FileSiftError> {
    let mut targets = HashSet::new();
    for file in files {
        if file.suggested_name.trim().is_empty() {
            return Err(FileSiftError::Validation(format!("{} has an empty suggested filename.", file.original_name)));
        }
        let old_path = PathBuf::from(&file.path);
        let new_path = old_path.with_file_name(&file.suggested_name);
        if new_path.exists() && old_path != new_path {
            return Err(FileSiftError::Validation(format!("Target already exists: {}", new_path.display())));
        }
        if !targets.insert(new_path) {
            return Err(FileSiftError::Validation("Two approved files target the same filename.".to_string()));
        }
    }
    Ok(())
}

fn upsert_file(conn: &Connection, file: &FileRecord) -> Result<(), FileSiftError> {
    conn.execute(
        r#"
        INSERT INTO files (
          id, batch_id, path, original_name, suggested_name, extension, status, approval,
          document_type, detected_date, detected_entity, detected_language, confidence,
          evidence_json, warnings_json, preview_text, error
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path,
          suggested_name = excluded.suggested_name,
          status = excluded.status,
          approval = excluded.approval,
          document_type = excluded.document_type,
          detected_date = excluded.detected_date,
          detected_entity = excluded.detected_entity,
          detected_language = excluded.detected_language,
          confidence = excluded.confidence,
          evidence_json = excluded.evidence_json,
          warnings_json = excluded.warnings_json,
          preview_text = excluded.preview_text,
          error = excluded.error
        "#,
        params![
            file.id,
            file.batch_id,
            file.path,
            file.original_name,
            file.suggested_name,
            file.extension,
            file.status,
            file.approval,
            file.document_type,
            file.detected_date,
            file.detected_entity,
            file.detected_language,
            file.confidence,
            serde_json::to_string(&file.evidence)?,
            serde_json::to_string(&file.warnings)?,
            file.preview_text,
            file.error
        ],
    )?;
    Ok(())
}

fn get_file(conn: &Connection, file_id: &str) -> Result<FileRecord, FileSiftError> {
    conn.query_row("SELECT * FROM files WHERE id = ?1", params![file_id], row_to_file)
        .map_err(FileSiftError::from)
}

fn list_files(conn: &Connection, batch_id: Option<&str>) -> Result<Vec<FileRecord>, FileSiftError> {
    let mut files = Vec::new();
    if let Some(batch_id) = batch_id {
        let mut stmt = conn.prepare("SELECT * FROM files WHERE batch_id = ?1 ORDER BY rowid")?;
        let mapped = stmt.query_map(params![batch_id], row_to_file)?;
        for file in mapped {
            files.push(file?);
        }
    } else {
        let mut stmt = conn.prepare("SELECT * FROM files ORDER BY rowid")?;
        let mapped = stmt.query_map([], row_to_file)?;
        for file in mapped {
            files.push(file?);
        }
    }
    Ok(files)
}

fn row_to_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    let evidence_json: String = row.get(13)?;
    let warnings_json: String = row.get(14)?;
    Ok(FileRecord {
        id: row.get(0)?,
        batch_id: row.get(1)?,
        path: row.get(2)?,
        original_name: row.get(3)?,
        suggested_name: row.get(4)?,
        extension: row.get(5)?,
        status: row.get(6)?,
        approval: row.get(7)?,
        document_type: row.get(8)?,
        detected_date: row.get(9)?,
        detected_entity: row.get(10)?,
        detected_language: row.get(11)?,
        confidence: row.get(12)?,
        evidence: serde_json::from_str(&evidence_json).unwrap_or_default(),
        warnings: serde_json::from_str(&warnings_json).unwrap_or_default(),
        preview_text: row.get(15)?,
        error: row.get(16)?,
    })
}

fn get_settings_from_conn(conn: &Connection) -> Result<NamingSettings, FileSiftError> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'naming'", [], |row| row.get(0))
        .optional()?;
    if let Some(value) = value {
        return Ok(serde_json::from_str(&value)?);
    }
    Ok(NamingSettings {
        date_format: "YYYY-MM-DD".to_string(),
        missing_date_label: "Undated".to_string(),
        include_entity: true,
        include_document_type: true,
        separator: "space".to_string(),
        max_filename_length: 120,
        approve_threshold: 0.82,
        model_mode: "heuristic".to_string(),
        document_labels: vec![
            "Shareholder Register".to_string(),
            "Board Minutes".to_string(),
            "Board Resolution".to_string(),
            "Shareholder Resolution".to_string(),
            "Articles of Association".to_string(),
            "Certificate of Incorporation".to_string(),
            "Operating Agreement".to_string(),
            "Vendor Agreement".to_string(),
            "Master Services Agreement".to_string(),
            "Statement of Work".to_string(),
            "Order Form".to_string(),
            "Data Processing Agreement".to_string(),
            "NDA".to_string(),
            "Invoice".to_string(),
            "Financial Statement".to_string(),
            "Tax Document".to_string(),
            "Background Check".to_string(),
            "Resume".to_string(),
            "Offer Letter".to_string(),
            "Legal Correspondence".to_string(),
            "Unknown".to_string(),
        ],
    })
}

fn get_history_from_conn(conn: &Connection) -> Result<Vec<BatchRecord>, FileSiftError> {
    let mut stmt = conn.prepare(
        r#"
        SELECT b.id, b.name, b.created_at, COUNT(DISTINCT f.id) AS file_count,
          COUNT(DISTINCT CASE WHEN a.status = 'renamed' THEN a.id END) AS renamed_count
        FROM batches b
        LEFT JOIN files f ON f.batch_id = b.id
        LEFT JOIN rename_audit a ON a.batch_id = b.id
        GROUP BY b.id
        ORDER BY b.created_at DESC
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BatchRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            file_count: row.get::<_, i64>(3)? as usize,
            renamed_count: row.get::<_, i64>(4)? as usize,
        })
    })?;
    let mut history = Vec::new();
    for row in rows {
        history.push(row?);
    }
    Ok(history)
}

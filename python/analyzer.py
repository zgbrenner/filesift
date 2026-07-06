from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DATE_PATTERNS = [
    re.compile(r"\b(20\d{2}|19\d{2})[-./](0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])\b"),
    re.compile(
        r"\b(0?[1-9]|[12]\d|3[01])\s+"
        r"(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(20\d{2}|19\d{2})\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2}|19\d{2})\b",
        re.IGNORECASE,
    ),
]

MONTHS = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12",
}

LABEL_RULES = [
    ("Shareholder Register", ["shareholder register", "aktionaerregister", "aktionærregister", "antal aktier", "stemmerettigheder"]),
    ("Board Minutes", ["board minutes", "minutes of the board", "bestyrelsesreferat", "referat"]),
    ("Board Resolution", ["board resolution", "written consent of the board", "bestyrelsesbeslutning"]),
    ("Shareholder Resolution", ["shareholder resolution", "written consent of shareholders"]),
    ("Articles of Association", ["articles of association", "vedtaegter", "vedtægter"]),
    ("Certificate of Incorporation", ["certificate of incorporation", "incorporation certificate"]),
    ("Operating Agreement", ["operating agreement"]),
    ("Master Services Agreement", ["master services agreement", "msa"]),
    ("Statement of Work", ["statement of work", "sow"]),
    ("Data Processing Agreement", ["data processing agreement", "dpa", "processor agreement"]),
    ("Vendor Agreement", ["vendor agreement", "services agreement", "service agreement", "supplier agreement"]),
    ("Order Form", ["order form"]),
    ("NDA", ["non-disclosure agreement", "confidentiality agreement", "nda"]),
    ("Invoice", ["invoice", "amount due", "payment terms", "faktura"]),
    ("Financial Statement", ["financial statement", "balance sheet", "income statement", "annual report"]),
    ("Tax Document", ["tax return", "irs", "vat", "moms", "skat"]),
    ("Background Check", ["background check", "criminal record", "screening report"]),
    ("Resume", ["resume", "curriculum vitae", "work experience", "education"]),
    ("Offer Letter", ["offer letter", "employment offer"]),
    ("Legal Correspondence", ["dear counsel", "law firm", "attorney", "legal correspondence"]),
]


@dataclass
class Analysis:
    document_type: str
    detected_date: str | None
    detected_entity: str | None
    detected_language: str | None
    confidence: float
    evidence: list[str]
    warnings: list[str]
    preview_text: str

    def to_json(self) -> str:
        return json.dumps(
            {
                "documentType": self.document_type,
                "detectedDate": self.detected_date,
                "detectedEntity": self.detected_entity,
                "detectedLanguage": self.detected_language,
                "confidence": self.confidence,
                "evidence": self.evidence,
                "warnings": self.warnings,
                "previewText": self.preview_text,
            },
            ensure_ascii=True,
        )


def extract_text(path: Path) -> tuple[str, list[str]]:
    warnings: list[str] = []
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".csv"}:
        return path.read_text(errors="ignore")[:20000], warnings

    try:
        from docling.document_converter import DocumentConverter  # type: ignore

        converter = DocumentConverter()
        result = converter.convert(str(path))
        return result.document.export_to_markdown()[:20000], warnings
    except Exception as exc:  # noqa: BLE001 - fallback is intentional for local MVP
        warnings.append(f"Docling extraction unavailable or failed: {exc}")

    return path.stem.replace("_", " ").replace("-", " "), warnings


def detect_date(text: str) -> str | None:
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        groups = match.groups()
        if len(groups) == 3 and groups[0].isdigit() and len(groups[0]) == 4:
            year, month, day = groups
            return f"{year}-{int(month):02d}-{int(day):02d}"
        if groups[1].lower() in MONTHS:
            day, month_name, year = groups
            return f"{year}-{MONTHS[month_name.lower()]}-{int(day):02d}"
        month_name, day, year = groups
        return f"{year}-{MONTHS[month_name.lower()]}-{int(day):02d}"
    return None


def detect_language(text: str) -> str | None:
    lower = text.lower()
    danish_hits = sum(token in lower for token in ["aktier", "bestyrelse", "vedtaegter", "vedtægter", "moms", "stemmerettigheder"])
    if danish_hits >= 2:
        return "Danish"
    english_hits = sum(token in lower for token in ["agreement", "invoice", "shareholder", "company", "effective date"])
    if english_hits >= 2:
        return "English"
    return None


def detect_entity(text: str) -> str | None:
    patterns = [
        re.compile(r"\bfor\s+([A-Z][A-Za-z0-9&.,'\- ]{2,80}?\s(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|ApS|A/S|AB|Oy))\b"),
        re.compile(r"\bbetween\s+([A-Z][A-Za-z0-9&.,'\- ]{2,80}?)\s+and\b"),
        re.compile(r"\b([A-Z][A-Za-z0-9&.,'\- ]{2,80}?\s(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|ApS|A/S|AB|Oy))\b"),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            entity = " ".join(match.group(1).split()).strip("., ")
            entity = re.sub(r"^(This|The|A|An)\s+", "", entity)
            entity = re.sub(r"^(Shareholder Register|Invoice|Agreement|Contract)\s+for\s+", "", entity, flags=re.IGNORECASE)
            return entity
    return None


def classify(text: str, labels: list[str]) -> tuple[str, float, list[str]]:
    lower = text.lower()
    best_label = "Unknown"
    best_score = 0
    best_evidence: list[str] = []
    allowed = set(labels) if labels else None

    for label, needles in LABEL_RULES:
        if allowed and label not in allowed:
            continue
        hits = [needle for needle in needles if needle in lower]
        if len(hits) > best_score:
            best_label = label
            best_score = len(hits)
            best_evidence = hits[:5]

    if best_score >= 3:
        return best_label, 0.91, best_evidence
    if best_score == 2:
        return best_label, 0.82, best_evidence
    if best_score == 1:
        return best_label, 0.66, best_evidence
    return "Unknown", 0.35, []


def classify_with_gliclass(text: str, labels: list[str], models_dir: Path, warnings: list[str]) -> tuple[str, float, list[str]] | None:
    if not text.strip() or not labels:
        return None
    model_path = models_dir / "gliclass"
    if not (model_path / ".filesift-model-ready").exists():
        return None
    try:
        from transformers import pipeline  # type: ignore

        classifier = pipeline(
            "zero-shot-classification",
            model=str(model_path),
            tokenizer=str(model_path),
            trust_remote_code=True,
            model_kwargs={"local_files_only": True},
            tokenizer_kwargs={"local_files_only": True},
        )
        result = classifier(text[:6000], candidate_labels=[label for label in labels if label != "Unknown"], multi_label=False)
        scored = list(zip(result.get("labels", []), result.get("scores", []), strict=False))
        if not scored:
            return None
        label, score = scored[0]
        confidence = max(0.35, min(float(score), 0.96))
        return str(label), confidence, [f"GLiClass classified as {label}"]
    except Exception as exc:  # noqa: BLE001 - model fallback is intentional
        warnings.append(f"GLiClass unavailable or failed: {exc}")
        return None


def enrich_with_qwen(text: str, analysis: dict[str, Any], labels: list[str], models_dir: Path, warnings: list[str]) -> dict[str, Any]:
    if not text.strip():
        return analysis
    model_path = models_dir / "qwen"
    if not (model_path / ".filesift-model-ready").exists():
        return analysis
    try:
        import torch  # type: ignore
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

        tokenizer = AutoTokenizer.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            str(model_path),
            local_files_only=True,
            trust_remote_code=True,
            torch_dtype=torch.float32,
        )
        labels_text = ", ".join(label for label in labels if label != "Unknown")
        prompt = (
            "Read this document text and return only compact JSON with keys "
            "documentType, detectedDate, detectedEntity, detectedLanguage. "
            f"Use one documentType from this list when possible: {labels_text}. "
            "Use null when unknown. Text:\n"
            f"{text[:4500]}"
        )
        messages = [
            {"role": "system", "content": "You extract conservative document metadata for local file renaming."},
            {"role": "user", "content": prompt},
        ]
        encoded = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_tensors="pt",
            return_dict=True,
        )
        with torch.no_grad():
            output = model.generate(**encoded, max_new_tokens=120, do_sample=False)
        decoded = tokenizer.decode(output[0][encoded["input_ids"].shape[-1] :], skip_special_tokens=True)
        match = re.search(r"\{.*\}", decoded, re.DOTALL)
        if not match:
            return analysis
        parsed = json.loads(match.group(0))
        for key in ["documentType", "detectedDate", "detectedEntity", "detectedLanguage"]:
            value = parsed.get(key)
            if value and (not analysis.get(key) or analysis.get(key) == "Unknown"):
                analysis[key] = str(value)
        evidence = analysis.setdefault("evidence", [])
        evidence.append("Qwen reviewed extracted text")
        return analysis
    except Exception as exc:  # noqa: BLE001 - model fallback is intentional
        warnings.append(f"Qwen unavailable or failed: {exc}")
        return analysis


def analyze(path: Path, settings: dict[str, Any]) -> Analysis:
    text, warnings = extract_text(path)
    preview = " ".join(text.split())[:1200]
    labels = settings.get("documentLabels") or []
    document_type, confidence, evidence = classify(text, labels)
    if settings.get("modelMode") == "local-model":
        models_dir = Path(os.environ.get("FILESIFT_MODELS_DIR", ""))
        model_classification = classify_with_gliclass(text, labels, models_dir, warnings)
        if model_classification:
            document_type, confidence, evidence = model_classification
    date = detect_date(text)
    entity = detect_entity(text)
    language = detect_language(text)

    model_analysis = {
        "documentType": document_type,
        "detectedDate": date,
        "detectedEntity": entity,
        "detectedLanguage": language,
        "evidence": evidence,
    }
    if settings.get("modelMode") == "local-model":
        model_analysis = enrich_with_qwen(text, model_analysis, labels, Path(os.environ.get("FILESIFT_MODELS_DIR", "")), warnings)
        document_type = model_analysis.get("documentType") or document_type
        date = model_analysis.get("detectedDate") or date
        entity = model_analysis.get("detectedEntity") or entity
        language = model_analysis.get("detectedLanguage") or language
        evidence = model_analysis.get("evidence") or evidence

    if not date:
        warnings.append("No reliable date found.")
        confidence = min(confidence, 0.74)
    if document_type == "Unknown":
        warnings.append("Document type is uncertain.")

    filename_words = path.stem.replace("_", " ").replace("-", " ")
    if filename_words and not evidence:
        evidence.append(filename_words)

    return Analysis(
        document_type=document_type,
        detected_date=date,
        detected_entity=entity,
        detected_language=language,
        confidence=confidence,
        evidence=evidence[:6],
        warnings=warnings[:5],
        preview_text=preview,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--settings", required=True)
    args = parser.parse_args()

    settings = json.loads(args.settings)
    result = analyze(Path(args.file), settings)
    print(result.to_json())


if __name__ == "__main__":
    main()

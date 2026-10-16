"""
Exam Score Predictor - FastAPI backend

Run from the project root:
    uvicorn backend.main:app --reload

Then open http://127.0.0.1:8000
"""
import pickle
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from xgboost import XGBRegressor

BASE_DIR = Path(__file__).resolve().parent
JSON_MODEL_PATH = BASE_DIR / "model" / "optimized_xgb_model.json"
PKL_MODEL_PATH = BASE_DIR / "model" / "optimized_xgb_model.pkl"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# Typical prediction error (mean absolute error) in score points.
# Replace with the MAE from YOUR held-out test set for an honest range.
MODEL_MAE = 7.7

# The model was trained on label-encoded categoricals. LabelEncoder / pandas
# categories sort alphabetically, so the code of a value is its index in these lists.
# (Verified against the original dataset: predictions match exactly.)
CATEGORIES = {
    "course": ["b.com", "b.sc", "b.tech", "ba", "bba", "bca", "diploma"],
    "internet_access": ["no", "yes"],
    "sleep_quality": ["average", "good", "poor"],
    "study_method": ["coaching", "group study", "mixed", "online videos", "self-study"],
    "facility_rating": ["high", "low", "medium"],
}

# Input ranges seen in the training data (the model cannot say much outside them).
RANGES = {
    "age": {"min": 17, "max": 24, "step": 1, "default": 20},
    "study_hours": {"min": 0, "max": 8, "step": 0.1, "default": 4},
    "class_attendance": {"min": 40, "max": 100, "step": 0.5, "default": 70},
    "sleep_hours": {"min": 4, "max": 10, "step": 0.1, "default": 7},
}

def load_model():
    """Prefer the portable JSON model (works across XGBoost versions);
    fall back to the original pickle."""
    if JSON_MODEL_PATH.exists():
        m = XGBRegressor()
        m.load_model(JSON_MODEL_PATH)
        return m
    with open(PKL_MODEL_PATH, "rb") as f:
        return pickle.load(f)


model = load_model()

FEATURES = list(model.feature_names_in_)


class StudentInput(BaseModel):
    age: int = Field(ge=17, le=24)
    course: Literal["b.com", "b.sc", "b.tech", "ba", "bba", "bca", "diploma"]
    study_hours: float = Field(ge=0, le=8)
    class_attendance: float = Field(ge=40, le=100)
    internet_access: Literal["yes", "no"]
    sleep_hours: float = Field(ge=4, le=10)
    sleep_quality: Literal["poor", "average", "good"]
    study_method: Literal["coaching", "group study", "mixed", "online videos", "self-study"]
    facility_rating: Literal["low", "medium", "high"]


def encode(rows: list[dict]) -> pd.DataFrame:
    """Turn raw rows into the numeric frame the model was trained on."""
    df = pd.DataFrame(rows)
    for col, cats in CATEGORIES.items():
        df[col] = df[col].map(cats.index).astype("int64")
    return df[FEATURES]


def predict_many(rows: list[dict]) -> list[float]:
    preds = model.predict(encode(rows))
    return [float(min(100.0, max(0.0, p))) for p in preds]


def band_for(score: float) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Strong"
    if score >= 55:
        return "Solid"
    if score >= 40:
        return "Needs work"
    return "At risk"


def pretty(value: str) -> str:
    return value[:1].upper() + value[1:]


def build_levers(base: dict, base_score: float) -> list[dict]:
    """What-if analysis: change one habit at a time and see how the prediction moves."""
    variants: list[tuple[str, dict]] = []

    if base["study_hours"] <= 7:
        variants.append(("Study 1 more hour a day", {"study_hours": round(base["study_hours"] + 1, 2)}))
    if base["class_attendance"] < 100:
        up = min(100.0, base["class_attendance"] + 10)
        gain = int(up - base["class_attendance"])
        variants.append((f"Attend {gain} percentage points more classes", {"class_attendance": up}))
    if base["sleep_quality"] != "good":
        variants.append(("Improve sleep quality to good", {"sleep_quality": "good"}))
    if abs(base["sleep_hours"] - 7.5) >= 0.5:
        variants.append(("Sleep about 7.5 hours a night", {"sleep_hours": 7.5}))
    for method in CATEGORIES["study_method"]:
        if method != base["study_method"]:
            variants.append((f"Switch study method to {method}", {"study_method": method}))

    scores = predict_many([{**base, **change} for _, change in variants])
    results = [{"label": label, "delta": s - base_score} for (label, _), s in zip(variants, scores)]

    # keep only the best study-method switch so the list isn't crowded
    method_items = [r for r in results if r["label"].startswith("Switch study method")]
    best_method = max(method_items, key=lambda r: r["delta"], default=None)
    results = [r for r in results if not r["label"].startswith("Switch study method")]
    if best_method:
        results.append(best_method)

    results = [r for r in results if r["delta"] >= 0.5]
    results.sort(key=lambda r: r["delta"], reverse=True)
    return [{"label": r["label"], "delta": round(r["delta"], 1)} for r in results[:3]]


app = FastAPI(title="Exam Score Predictor", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this if you deploy the frontend on a separate domain
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "features": FEATURES}


@app.get("/api/options")
def options():
    """Everything the frontend needs to build the form."""
    return {"categories": CATEGORIES, "ranges": RANGES}


@app.post("/api/predict")
def predict(student: StudentInput):
    data = student.model_dump()
    score = predict_many([data])[0]
    return {
        "score": round(score, 1),
        "low": round(max(0.0, score - MODEL_MAE), 1),
        "high": round(min(100.0, score + MODEL_MAE), 1),
        "band": band_for(score),
        "levers": build_levers(data, score),
    }


# Serve the frontend from the same server (must be mounted last).
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

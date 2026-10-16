# Exam Score Predictor

FastAPI backend + HTML/CSS/JS frontend for the optimized XGBoost model.

## Run

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000 (interactive API docs: http://127.0.0.1:8000/docs).

The app loads `backend/model/optimized_xgb_model.json` (portable across XGBoost
versions). If you ever see "input stream corrupted", run `pip install -U xgboost`.
To re-export after retraining: `model.save_model("backend/model/optimized_xgb_model.json")`.

## API

| Method | Path           | Purpose                                      |
|--------|----------------|----------------------------------------------|
| GET    | /api/health    | Server and model feature check               |
| GET    | /api/options   | Allowed categories and slider ranges         |
| POST   | /api/predict   | Predicted score, likely range, what-if tips  |

Example:

```bash
curl -X POST http://127.0.0.1:8000/api/predict -H "Content-Type: application/json" -d '{
  "age": 20, "course": "bca", "study_hours": 5, "class_attendance": 80,
  "internet_access": "yes", "sleep_hours": 7, "sleep_quality": "good",
  "study_method": "coaching", "facility_rating": "high"
}'
```

## Notes

- The model uses 9 features. `student_id`, `gender` and `exam_difficulty` are not model inputs.
- Categoricals are label-encoded alphabetically (see `CATEGORIES` in `backend/main.py`).
- `MODEL_MAE` in `backend/main.py` sets the "likely between" range. Replace it with the MAE from your own test set.

<div align="center">

# 🎓 Exam Score Predictor

**Enter a student's habits and get a predicted exam score out of 100.**

[![Live Demo]()

</div>

## ✨ What it does

A full-stack ML app: an **XGBoost** model trained on 20,000 student records, served by a **FastAPI** backend, with a custom **HTML, CSS and JavaScript** frontend.

- 🎯 Live score prediction with a likely range
- 💡 Tips showing which changes would raise the score most
- 🧑‍🎓 Example students and a Randomize button
- 📊 Save predictions and compare them side by side
- 🌙 Light and dark themes, mobile friendly

## 🧠 Model

XGBoost Regressor on 9 inputs: age, course, study hours, attendance, internet access, sleep hours, sleep quality, study method and facility rating. Study hours matter most (about 56% of feature importance).

## 💻 Run locally

```bash
git clone https://github.com/Vishu18-xyz/exam-score-predictor.git
cd exam-score-predictor
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000. API docs are at `/docs`.

## ☁️ Deploy

One FastAPI service, so it runs on Render, Railway or any Docker host. See [DEPLOYMENT.md](DEPLOYMENT.md).

---

<div align="center">Made by <a href="https://github.com/Vishu18-xyz">Vishu18-xyz</a> · Give it a ⭐ if you like it</div>

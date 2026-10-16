(() => {
  "use strict";

  // Same-origin by default (FastAPI serves this page). If you host the frontend
  // elsewhere, set this to your API address, e.g. "http://127.0.0.1:8000".
  const API_BASE = "";

  const SLIDERS = {
    age: { format: (v) => `${v} years`, short: (v) => `${v} yrs` },
    study_hours: { format: (v) => `${Number(v).toFixed(1)} hours`, short: (v) => `${Number(v).toFixed(1)} h study` },
    class_attendance: { format: (v) => `${Number(v).toFixed(1)}%`, short: (v) => `${Number(v).toFixed(0)}% attendance` },
    sleep_hours: { format: (v) => `${Number(v).toFixed(1)} hours`, short: (v) => `${Number(v).toFixed(1)} h sleep` },
  };

  const CHOICES = ["study_method", "sleep_quality", "facility_rating", "internet_access"];

  const COURSE_LABELS = {
    "b.com": "B.Com", "b.sc": "B.Sc", "b.tech": "B.Tech",
    ba: "BA", bba: "BBA", bca: "BCA", diploma: "Diploma",
  };

  const ORDER = {
    sleep_quality: ["poor", "average", "good"],
    facility_rating: ["low", "medium", "high"],
    internet_access: ["yes", "no"],
  };

  const PRESETS = {
    typical: { age: 20, course: "bca", study_hours: 4, class_attendance: 70, sleep_hours: 7, sleep_quality: "average", study_method: "self-study", facility_rating: "medium", internet_access: "yes" },
    achiever: { age: 21, course: "b.tech", study_hours: 6.5, class_attendance: 92, sleep_hours: 7.5, sleep_quality: "good", study_method: "coaching", facility_rating: "high", internet_access: "yes" },
    struggling: { age: 19, course: "ba", study_hours: 1.2, class_attendance: 50, sleep_hours: 5, sleep_quality: "poor", study_method: "online videos", facility_rating: "low", internet_access: "no" },
    crammer: { age: 22, course: "b.sc", study_hours: 5, class_attendance: 60, sleep_hours: 4.8, sleep_quality: "poor", study_method: "group study", facility_rating: "medium", internet_access: "yes" },
  };

  const MAX_SAVED = 4;
  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const paper = $("paper");
  const els = {
    score: $("score"), band: $("band"), rangeText: $("range-text"),
    rangeBar: $("ruler-range"), pin: $("ruler-pin"), levers: $("levers"),
    error: $("error"), loop: $("loop-path"), stale: $("stale-hint"),
    predict: $("predict"), save: $("save"), copy: $("copy"), live: $("live"),
    minibar: $("minibar"), minibarNum: $("minibar-num"), minibarBtn: $("minibar-predict"),
    saved: $("saved"), savedEmpty: $("compare-empty"), clearSaved: $("clear-saved"),
    toast: $("toast"), theme: $("theme"),
  };

  let ranges = {};
  let categories = {};
  let requestId = 0;
  let debounceTimer = null;
  let shownScore = null;
  let firstResult = true;
  let lastResult = null;   // { payload, score, band, low, high }
  let saved = [];
  let toastTimer = null;

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const label = (field, value) => {
    if (field === "course") return COURSE_LABELS[value] ?? value;
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  /* ---------- safe storage ---------- */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } },
  };

  /* ---------- toast ---------- */
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    els.theme.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    store.set("theme", theme);
  }

  els.theme.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");

  /* ---------- build the form ---------- */
  function updateSliderUI(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--p", `${pct}%`);
    $(`${input.id}-out`).textContent = SLIDERS[input.id].format(input.value);
  }

  function setSlider(name, cfg) {
    const input = $(name);
    input.min = cfg.min;
    input.max = cfg.max;
    input.step = cfg.step;
    input.value = cfg.default;
    updateSliderUI(input);
  }

  function buildChoices(field, values) {
    const wrap = $(field);
    const ordered = ORDER[field] ? ORDER[field].filter((v) => values.includes(v)) : values;
    wrap.innerHTML = "";
    ordered.forEach((value) => {
      const item = document.createElement("label");
      item.className = "choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = field;
      radio.value = value;
      const text = document.createElement("span");
      text.textContent = label(field, value);
      item.append(radio, text);
      wrap.append(item);
    });
  }

  function buildCourse(values) {
    const select = $("course");
    select.innerHTML = "";
    values.forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label("course", value);
      select.append(opt);
    });
  }

  function setForm(values) {
    Object.keys(SLIDERS).forEach((name) => {
      const input = $(name);
      const v = Math.min(Number(input.max), Math.max(Number(input.min), values[name]));
      input.value = v;
      updateSliderUI(input);
    });
    $("course").value = values.course;
    CHOICES.forEach((field) => {
      const radio = form.querySelector(`input[name="${field}"][value="${values[field]}"]`);
      if (radio) radio.checked = true;
    });
  }

  function readPayload() {
    const d = new FormData(form);
    return {
      age: parseInt(d.get("age"), 10),
      course: d.get("course"),
      study_hours: parseFloat(d.get("study_hours")),
      class_attendance: parseFloat(d.get("class_attendance")),
      internet_access: d.get("internet_access"),
      sleep_hours: parseFloat(d.get("sleep_hours")),
      sleep_quality: d.get("sleep_quality"),
      study_method: d.get("study_method"),
      facility_rating: d.get("facility_rating"),
    };
  }

  function summarize(p) {
    return `${SLIDERS.study_hours.short(p.study_hours)}, ${SLIDERS.class_attendance.short(p.class_attendance)}, ${SLIDERS.sleep_hours.short(p.sleep_hours)}`;
  }

  /* ---------- prediction ---------- */
  function setBusy(busy) {
    [els.predict, els.minibarBtn].forEach((b) => {
      b.classList.toggle("is-busy", busy);
      b.setAttribute("aria-busy", String(busy));
    });
    els.predict.textContent = busy ? "Predicting" : "Predict score";
    els.minibarBtn.textContent = busy ? "Predicting" : "Predict score";
  }

  function markStale(stale) {
    paper.classList.toggle("is-stale", stale);
    els.stale.hidden = !stale || !lastResult;
  }

  function schedulePredict() {
    if (els.live.checked) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(predict, 200);
    } else if (lastResult) {
      markStale(true);
    }
  }

  async function predict() {
    clearTimeout(debounceTimer);
    const id = ++requestId;
    const payload = readPayload();
    paper.classList.add("is-loading");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (id !== requestId) return;
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        const first = detail?.detail?.[0];
        throw new Error(first ? `${first.loc.slice(-1)[0]}: ${first.msg}` : "The server rejected these values.");
      }
      const result = await res.json();
      if (id !== requestId) return;
      lastResult = { ...result, payload };
      render(result);
      markStale(false);
      hideError();
    } catch (err) {
      if (id !== requestId) return;
      showError(
        err instanceof TypeError
          ? "Can't reach the prediction server. Check that it's running, then press Predict score again."
          : err.message
      );
    } finally {
      if (id === requestId) {
        paper.classList.remove("is-loading");
        setBusy(false);
      }
    }
  }

  /* ---------- rendering ---------- */
  function animateNumber(to) {
    const from = shownScore ?? to;
    shownScore = to;
    if (reduceMotion || from === to) {
      els.score.textContent = to.toFixed(1);
      els.minibarNum.textContent = to.toFixed(1);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 350);
      const eased = 1 - Math.pow(1 - t, 3);
      const text = (from + (to - from) * eased).toFixed(1);
      els.score.textContent = text;
      els.minibarNum.textContent = text;
      if (t < 1 && shownScore === to) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function render(result) {
    animateNumber(result.score);
    els.band.textContent = result.band;
    els.rangeText.textContent = `Likely between ${result.low.toFixed(0)} and ${result.high.toFixed(0)}`;
    els.rangeBar.style.left = `${result.low}%`;
    els.rangeBar.style.width = `${Math.max(0, result.high - result.low)}%`;
    els.pin.style.left = `${result.score}%`;
    els.save.disabled = false;
    els.copy.disabled = false;
    els.minibar.hidden = false;

    els.levers.innerHTML = "";
    if (result.levers.length === 0) {
      const li = document.createElement("li");
      const msg = document.createElement("span");
      msg.className = "none";
      msg.textContent = "No single change moves the score much from here.";
      li.append(msg);
      els.levers.append(li);
    } else {
      result.levers.forEach((lever) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = lever.label;
        const delta = document.createElement("span");
        delta.className = "delta";
        delta.textContent = `+${lever.delta.toFixed(1)}`;
        li.append(name, delta);
        els.levers.append(li);
      });
    }

    renderSaved();

    if (firstResult) {
      firstResult = false;
      if (!reduceMotion) {
        const len = Math.ceil(els.loop.getTotalLength());
        els.loop.style.setProperty("--len", len);
        els.loop.classList.add("draw");
      }
    }
  }

  function showError(message) { els.error.textContent = message; els.error.hidden = false; }
  function hideError() { els.error.hidden = true; }

  /* ---------- saved comparisons ---------- */
  function persistSaved() { store.set("saved", JSON.stringify(saved)); }

  function renderSaved() {
    els.saved.innerHTML = "";
    els.savedEmpty.hidden = saved.length > 0;
    els.clearSaved.hidden = saved.length === 0;
    const current = lastResult ? lastResult.score : null;

    saved.forEach((item) => {
      const li = document.createElement("li");

      const title = document.createElement("div");
      title.className = "saved-title";
      const name = document.createElement("span");
      name.textContent = `${label("course", item.payload.course)}, ${label("study_method", item.payload.study_method).toLowerCase()}`;
      const diff = document.createElement("span");
      diff.className = "saved-diff";
      if (current !== null) {
        const d = item.score - current;
        diff.textContent = Math.abs(d) < 0.05 ? "Same as current" : d > 0 ? `${d.toFixed(1)} above current` : `${(-d).toFixed(1)} below current`;
      }
      title.append(name, diff);

      const meta = document.createElement("div");
      meta.className = "saved-meta";
      meta.textContent = summarize(item.payload);

      const score = document.createElement("div");
      score.className = "saved-score";
      score.textContent = item.score.toFixed(1);
      score.setAttribute("aria-label", `Score ${item.score.toFixed(1)}`);

      const buttons = document.createElement("div");
      buttons.className = "saved-buttons";
      const load = document.createElement("button");
      load.type = "button";
      load.className = "mini-btn";
      load.textContent = "Load";
      load.addEventListener("click", () => { setForm(item.payload); clearPresetHighlight(); predict(); toast("Loaded saved inputs"); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mini-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        saved = saved.filter((s) => s.id !== item.id);
        persistSaved();
        renderSaved();
      });
      buttons.append(load, remove);

      li.append(score, buttons, title, meta);
      els.saved.append(li);
    });
  }

  function saveCurrent() {
    if (!lastResult) return;
    if (paper.classList.contains("is-stale")) {
      toast("Press Predict score first, then save");
      return;
    }
    saved.unshift({ id: Date.now(), payload: lastResult.payload, score: lastResult.score });
    if (saved.length > MAX_SAVED) saved = saved.slice(0, MAX_SAVED);
    persistSaved();
    renderSaved();
    toast("Saved. Change a value to compare");
  }

  function loadSaved() {
    try {
      const raw = store.get("saved");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) saved = parsed.filter((s) => s && s.payload && typeof s.score === "number").slice(0, MAX_SAVED);
    } catch { saved = []; }
  }

  /* ---------- copy summary ---------- */
  function summaryText() {
    const p = lastResult.payload;
    return [
      `Predicted exam score: ${lastResult.score.toFixed(1)} out of 100 (${lastResult.band}).`,
      `Likely range: ${lastResult.low.toFixed(0)} to ${lastResult.high.toFixed(0)}.`,
      `Student: age ${p.age}, ${label("course", p.course)}, ${p.study_method} study method.`,
      `Habits: ${p.study_hours.toFixed(1)} h study a day, ${p.class_attendance.toFixed(1)}% attendance, ${p.sleep_hours.toFixed(1)} h sleep (${p.sleep_quality} quality).`,
      `Campus: ${p.facility_rating} facility rating, internet access: ${p.internet_access}.`,
    ].join("\n");
  }

  async function copySummary() {
    if (!lastResult) return;
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      area.remove();
      if (!ok) { toast("Couldn't copy. Select the text manually"); return; }
    }
    toast("Summary copied");
  }

  /* ---------- presets, randomize, reset ---------- */
  function clearPresetHighlight() {
    document.querySelectorAll("[data-preset]").forEach((b) => b.classList.remove("is-active"));
  }

  function applyPreset(key) {
    setForm(PRESETS[key]);
    clearPresetHighlight();
    document.querySelector(`[data-preset="${key}"]`).classList.add("is-active");
    predict();
  }

  function randomIn(cfg) {
    const steps = Math.round((cfg.max - cfg.min) / cfg.step);
    const v = cfg.min + Math.floor(Math.random() * (steps + 1)) * cfg.step;
    return Number(v.toFixed(2));
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function randomize() {
    setForm({
      age: randomIn(ranges.age),
      course: pick(categories.course),
      study_hours: randomIn(ranges.study_hours),
      class_attendance: randomIn(ranges.class_attendance),
      sleep_hours: randomIn(ranges.sleep_hours),
      sleep_quality: pick(categories.sleep_quality),
      study_method: pick(categories.study_method),
      facility_rating: pick(categories.facility_rating),
      internet_access: pick(categories.internet_access),
    });
    clearPresetHighlight();
    predict();
  }

  function resetForm() {
    applyPreset("typical");
    clearPresetHighlight();
    toast("Reset to a typical student");
  }

  /* ---------- events ---------- */
  form.addEventListener("input", (event) => {
    if (event.target.id === "live") return;
    if (event.target.type === "range") updateSliderUI(event.target);
    clearPresetHighlight();
    schedulePredict();
  });

  form.addEventListener("submit", (event) => { event.preventDefault(); predict(); });

  els.live.addEventListener("change", () => {
    toast(els.live.checked ? "Live updates on" : "Live updates off. Use Predict score");
    if (els.live.checked && lastResult && paper.classList.contains("is-stale")) predict();
  });

  els.minibarBtn.addEventListener("click", predict);
  els.save.addEventListener("click", saveCurrent);
  els.copy.addEventListener("click", copySummary);
  $("randomize").addEventListener("click", randomize);
  $("reset").addEventListener("click", resetForm);
  els.clearSaved.addEventListener("click", () => { saved = []; persistSaved(); renderSaved(); toast("Cleared saved predictions"); });
  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => applyPreset(b.dataset.preset))
  );

  /* ---------- init ---------- */
  async function init() {
    loadSaved();
    renderSaved();
    try {
      const res = await fetch(`${API_BASE}/api/options`);
      if (!res.ok) throw new Error("options failed");
      const data = await res.json();
      ranges = data.ranges;
      categories = data.categories;
      Object.entries(ranges).forEach(([name, cfg]) => setSlider(name, cfg));
      buildCourse(categories.course);
      CHOICES.forEach((f) => buildChoices(f, categories[f]));
      applyPreset("typical");
    } catch {
      showError("Can't reach the prediction server. Start it with \"uvicorn backend.main:app --reload\" and reload this page.");
    }
  }

  init();
})();

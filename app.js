// app.js
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const screenCode = $("screenCode");
  const screenQuestion = $("screenQuestion");
  const screenDone = $("screenDone");

  const codeInput = $("codeInput");
  const codeError = $("codeError");

  const qHost = $("questionHost");
  const qError = $("qError");

  const btnStart = $("btnStart");
  const btnBack = $("btnBack");
  const btnNext = $("btnNext");
  const btnRestart = $("btnRestart");

  const statusEl = $("status");
  const qMeta = $("qMeta");

  const progressFill = $("progressFill");
  const progressText = $("progressText");

  const CFG = window.APP_CONFIG || {};
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    setStatus("Ошибка: не заполнен config.js (SUPABASE_URL / SUPABASE_ANON_KEY).");
  }

  let questionnaire = null;
  let visibleQuestionIds = [];
  let currentIdx = 0;

  let code = "";
  let answers = {}; // { [questionId]: value }

  // ------------------------
  // Helpers: UI
  // ------------------------
  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }
  function showError(el, msg) {
    el.hidden = !msg;
    el.textContent = msg || "";
  }
  function showScreen(which) {
    screenCode.hidden = which !== "code";
    screenQuestion.hidden = which !== "question";
    screenDone.hidden = which !== "done";
  }

  // ------------------------
  // Load questions.json
  // ------------------------
  async function loadQuestions() {
    const res = await fetch("./questions.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Не удалось загрузить questions.json (${res.status})`);
    const data = await res.json();

    // minimal sanity
    if (!data || !Array.isArray(data.questions)) throw new Error("Некорректный формат questions.json: нет массива questions");
    if (!data.questionnaire_id || !data.version) throw new Error("Некорректный формат questions.json: нет questionnaire_id/version");

    // optional: protect from mismatch
    if (CFG.EXPECTED_QUESTIONNAIRE_ID && data.questionnaire_id !== CFG.EXPECTED_QUESTIONNAIRE_ID) {
      throw new Error(`questionnaire_id не совпадает (ожидали ${CFG.EXPECTED_QUESTIONNAIRE_ID}, получили ${data.questionnaire_id})`);
    }

    // sort by order
    data.questions.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    questionnaire = data;

    qMeta.textContent = `${data.questionnaire_id} · версия ${data.version}`;
  }

  // ------------------------
  // show_if logic
  // ------------------------
  function evalCondition(cond) {
    if (!cond || typeof cond !== "object") return true;
    const left = answers[cond.id];

    // Operators supported: eq, neq, gt, gte, lt, lte, in, nin
    if ("eq" in cond) return left === cond.eq;
    if ("neq" in cond) return left !== cond.neq;
    if ("gt" in cond) return typeof left === "number" && left > cond.gt;
    if ("gte" in cond) return typeof left === "number" && left >= cond.gte;
    if ("lt" in cond) return typeof left === "number" && left < cond.lt;
    if ("lte" in cond) return typeof left === "number" && left <= cond.lte;
    if ("in" in cond) return Array.isArray(cond.in) && cond.in.includes(left);
    if ("nin" in cond) return Array.isArray(cond.nin) && !cond.nin.includes(left);

    return true;
  }

  function isVisible(q) {
    return q.show_if ? evalCondition(q.show_if) : true;
  }

  function isRequired(q) {
    if (q.required_if) return evalCondition(q.required_if);
    return !!q.required;
  }

  function recomputeVisibleList() {
    const ids = [];
    for (const q of questionnaire.questions) {
      if (isVisible(q)) ids.push(q.id);
    }
    visibleQuestionIds = ids;
  }

  // Remove answers that are now hidden (to avoid “мусор”)
  function pruneHiddenAnswers() {
    const visible = new Set(visibleQuestionIds);
    for (const key of Object.keys(answers)) {
      if (!visible.has(key)) delete answers[key];
    }
  }

  // ------------------------
  // Validation
  // ------------------------
  function validateValue(q, value) {
    const req = isRequired(q);

    // empty check
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);

    if (req && isEmpty) return "Это поле обязательно.";

    // if empty and not required -> ok
    if (!req && isEmpty) return null;

    const c = q.constraints || {};

    if (q.type === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) return "Введите число.";
      if (typeof c.min === "number" && value < c.min) return `Минимум: ${c.min}.`;
      if (typeof c.max === "number" && value > c.max) return `Максимум: ${c.max}.`;
      return null;
    }

    if (q.type === "text") {
      const s = String(value);
      if (typeof c.minLength === "number" && s.length < c.minLength) return `Минимум ${c.minLength} символов.`;
      if (typeof c.maxLength === "number" && s.length > c.maxLength) return `Максимум ${c.maxLength} символов.`;
      if (typeof c.pattern === "string") {
        const re = new RegExp(c.pattern);
        if (!re.test(s)) return "Неверный формат.";
      }
      return null;
    }

    if (q.type === "select") {
      const allowed = (q.options || []).map(o => o.value);
      if (!allowed.includes(value)) return "Выберите вариант из списка.";
      return null;
    }

    if (q.type === "multiselect") {
      if (!Array.isArray(value)) return "Выберите варианты.";
      const allowed = new Set((q.options || []).map(o => o.value));
      for (const v of value) {
        if (!allowed.has(v)) return "Выберите варианты из списка.";
      }
      // exclusive options
      if (c.exclusiveOptions && Array.isArray(c.exclusiveOptions)) {
        const exclusive = new Set(c.exclusiveOptions);
        const pickedExclusive = value.filter(v => exclusive.has(v));
        if (pickedExclusive.length > 0 && value.length > 1) return "Этот вариант нельзя сочетать с другими.";
      }
      return null;
    }

    if (q.type === "boolean") {
      if (typeof value !== "boolean") return "Выберите Да/Нет.";
      return null;
    }

    return null;
  }

  // ------------------------
  // Render one question
  // ------------------------
  function getCurrentQuestion() {
    const id = visibleQuestionIds[currentIdx];
    return questionnaire.questions.find(q => q.id === id) || null;
  }

  function renderQuestion() {
    showError(qError, null);

    recomputeVisibleList();
    pruneHiddenAnswers();

    // clamp index
    if (currentIdx < 0) currentIdx = 0;
    if (currentIdx >= visibleQuestionIds.length) currentIdx = visibleQuestionIds.length - 1;

    const q = getCurrentQuestion();
    if (!q) {
      // nothing to show -> submit?
      qHost.innerHTML = `<h2 class="q-title">Нет вопросов для отображения</h2>`;
      btnNext.textContent = "Отправить";
      btnBack.disabled = false;
      updateProgress();
      return;
    }

    btnBack.disabled = currentIdx === 0;
    btnNext.textContent = (currentIdx === visibleQuestionIds.length - 1) ? "Отправить" : "Далее";

    const req = isRequired(q);

    const title = `
      <h2 class="q-title">${escapeHtml(q.label)} ${req ? '<span class="small">(обязательно)</span>' : ''}</h2>
      ${q.help ? `<p class="q-help">${escapeHtml(q.help)}</p>` : ``}
    `;

    const value = answers[q.id];

    let inputHtml = "";

    if (q.type === "number") {
      inputHtml = `
        <label class="label" for="qInput">Ответ</label>
        <input id="qInput" class="input" type="number"
          ${q.constraints?.step != null ? `step="${q.constraints.step}"` : `step="any"`}
          ${q.constraints?.min != null ? `min="${q.constraints.min}"` : ``}
          ${q.constraints?.max != null ? `max="${q.constraints.max}"` : ``}
          value="${(typeof value === "number" && !Number.isNaN(value)) ? value : ""}"
        />
      `;
    } else if (q.type === "text") {
      inputHtml = `
        <label class="label" for="qInput">Ответ</label>
        <input id="qInput" class="input" type="text" value="${value ? escapeHtml(String(value)) : ""}" />
      `;
    } else if (q.type === "select") {
      const opts = (q.options || []).map(o => {
        const selected = value === o.value ? "selected" : "";
        return `<option value="${escapeAttr(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
      }).join("");
      inputHtml = `
        <label class="label" for="qSelect">Выберите вариант</label>
        <select id="qSelect">
          <option value="" ${value == null ? "selected" : ""}>— выберите —</option>
          ${opts}
        </select>
      `;
    } else if (q.type === "multiselect") {
      const arr = Array.isArray(value) ? value : [];
      inputHtml = `
        <div class="choices" id="qMulti">
          ${(q.options || []).map(o => {
            const checked = arr.includes(o.value) ? "checked" : "";
            return `
              <label class="choice">
                <input type="checkbox" value="${escapeAttr(o.value)}" ${checked} />
                <span>${escapeHtml(o.label)}</span>
              </label>
            `;
          }).join("")}
        </div>
        <div class="small">Можно выбрать несколько вариантов.</div>
      `;
    } else if (q.type === "boolean") {
      const tLabel = q.labels?.true ?? "Да";
      const fLabel = q.labels?.false ?? "Нет";
      const v = (typeof value === "boolean") ? value : null;
      inputHtml = `
        <div class="choices" id="qBool">
          <label class="choice">
            <input type="radio" name="qBool" value="true" ${v === true ? "checked" : ""} />
            <span>${escapeHtml(tLabel)}</span>
          </label>
          <label class="choice">
            <input type="radio" name="qBool" value="false" ${v === false ? "checked" : ""} />
            <span>${escapeHtml(fLabel)}</span>
          </label>
        </div>
      `;
    } else {
      inputHtml = `<p class="p muted">Тип вопроса не поддержан: ${escapeHtml(q.type)}</p>`;
    }

    qHost.innerHTML = `${title}${inputHtml}`;

    // attach handlers for exclusive options (multiselect)
    if (q.type === "multiselect") {
      const box = $("qMulti");
      if (box && q.constraints?.exclusiveOptions?.length) {
        box.addEventListener("change", () => enforceExclusiveMulti(q));
      }
    }

    updateProgress();
  }

  function enforceExclusiveMulti(q) {
    const box = $("qMulti");
    if (!box) return;

    const exclusive = new Set(q.constraints.exclusiveOptions || []);
    const checkboxes = Array.from(box.querySelectorAll('input[type="checkbox"]'));
    const picked = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
    const pickedExclusive = picked.filter(v => exclusive.has(v));

    if (pickedExclusive.length > 0 && picked.length > 1) {
      // If exclusive selected, uncheck all non-exclusive.
      for (const cb of checkboxes) {
        if (!exclusive.has(cb.value)) cb.checked = false;
      }
    }
    // If non-exclusive selected while exclusive checked, uncheck exclusive.
    const pickedAfter = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
    const hasExclusive = pickedAfter.some(v => exclusive.has(v));
    if (hasExclusive && pickedAfter.length > 1) {
      for (const cb of checkboxes) {
        if (exclusive.has(cb.value)) cb.checked = false;
      }
    }
  }

  function readCurrentValue(q) {
    if (!q) return undefined;

    if (q.type === "number") {
      const el = $("qInput");
      if (!el) return undefined;
      const raw = el.value;
      if (raw === "") return undefined;
      const n = Number(raw);
      return Number.isNaN(n) ? undefined : n;
    }

    if (q.type === "text") {
      const el = $("qInput");
      if (!el) return undefined;
      const s = el.value;
      return s;
    }

    if (q.type === "select") {
      const el = $("qSelect");
      if (!el) return undefined;
      const v = el.value;
      return v === "" ? undefined : v;
    }

    if (q.type === "multiselect") {
      const box = $("qMulti");
      if (!box) return undefined;
      const checked = Array.from(box.querySelectorAll('input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      return checked;
    }

    if (q.type === "boolean") {
      const box = $("qBool");
      if (!box) return undefined;
      const checked = box.querySelector('input[type="radio"]:checked');
      if (!checked) return undefined;
      return checked.value === "true";
    }

    return undefined;
  }

  function updateProgress() {
    const total = Math.max(visibleQuestionIds.length, 1);
    const step = Math.min(currentIdx + 1, total);
    const pct = Math.round((step / total) * 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `Вопрос ${step} из ${total}`;
  }

  // ------------------------
  // Supabase insert via REST
  // ------------------------
  async function submitToSupabase(payload) {
    const url = `${CFG.SUPABASE_URL}/rest/v1/${CFG.TABLE_NAME}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CFG.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${CFG.SUPABASE_ANON_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      // Supabase often returns JSON; but keep it simple.
      throw new Error(`Supabase error ${res.status}: ${text}`);
    }

    // return inserted row(s)
    try {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data[0] : data;
    } catch {
      return null;
    }
  }

  // ------------------------
  // Actions
  // ------------------------
  function startQuestionnaire() {
    const c = (codeInput.value || "").trim();
    if (!c) {
      showError(codeError, "Введите шифр.");
      return;
    }
    if (c.length > 50) {
      showError(codeError, "Шифр слишком длинный (макс. 50 символов).");
      return;
    }
    showError(codeError, null);

    code = c;
    answers = {};
    currentIdx = 0;

    recomputeVisibleList();
    pruneHiddenAnswers();

    showScreen("question");
    renderQuestion();
    setStatus("");
  }

  async function nextOrSubmit() {
    const q = getCurrentQuestion();
    if (!q) return;

    // read + validate current
    const v = readCurrentValue(q);
    const err = validateValue(q, v);

    if (err) {
      showError(qError, err);
      return;
    }

    // Save
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)) {
      // if empty and not required: remove key
      delete answers[q.id];
    } else {
      answers[q.id] = v;
    }

    // After saving, recompute visibility and prune hidden answers
    recomputeVisibleList();
    pruneHiddenAnswers();

    // If last -> submit
    if (currentIdx >= visibleQuestionIds.length - 1) {
      await submitAll();
      return;
    }

    // move next
    currentIdx += 1;

    // if recompute shortened list and idx is out, clamp
    if (currentIdx >= visibleQuestionIds.length) currentIdx = visibleQuestionIds.length - 1;

    renderQuestion();
  }

  function back() {
    showError(qError, null);
    currentIdx = Math.max(0, currentIdx - 1);
    renderQuestion();
  }

  async function submitAll() {
    showError(qError, null);
    btnNext.disabled = true;
    btnBack.disabled = true;
    setStatus("Отправка…");

    // Final prune
    recomputeVisibleList();
    pruneHiddenAnswers();

    const payload = {
      code,
      questionnaire_id: questionnaire.questionnaire_id,
      questionnaire_version: questionnaire.version,
      answers,
      meta: {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        ua: navigator.userAgent || null
      },
      is_complete: true
    };

    try {
      const inserted = await submitToSupabase(payload);
      setStatus("");
      showScreen("done");
      // Optional: show id in console
      if (inserted?.id) console.log("Inserted response id:", inserted.id);
    } catch (e) {
      console.error(e);
      setStatus("");
      showError(qError, String(e.message || e));
      btnNext.disabled = false;
      btnBack.disabled = false;
    }
  }

  function restart() {
    code = "";
    answers = {};
    currentIdx = 0;
    codeInput.value = "";
    showError(codeError, null);
    showError(qError, null);
    showScreen("code");
    setStatus("");
  }

  // ------------------------
  // Escaping
  // ------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[ch]));
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, "&#96;");
  }

  // ------------------------
  // Boot
  // ------------------------
  async function boot() {
    try {
      setStatus("Загрузка анкеты…");
      await loadQuestions();
      setStatus("");
      showScreen("code");

      btnStart.addEventListener("click", startQuestionnaire);
      codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") startQuestionnaire();
      });

      btnBack.addEventListener("click", back);
      btnNext.addEventListener("click", () => nextOrSubmit());
      btnRestart.addEventListener("click", restart);

      // keyboard shortcuts
      document.addEventListener("keydown", (e) => {
        if (screenQuestion.hidden) return;
        if (e.key === "Enter") {
          // avoid triggering while focused on textarea (not used now)
          nextOrSubmit();
        }
      });

      // initial compute for header
      qMeta.textContent = `${questionnaire.questionnaire_id} · версия ${questionnaire.version}`;
    } catch (e) {
      console.error(e);
      setStatus(`Ошибка: ${String(e.message || e)}`);
    }
  }

  boot();
})();

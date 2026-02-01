// admin-app.js
// ПЕРЕПИСАННЫЙ - БЕЗ СЕКРЕТОВ!
// Все секреты на backend, фронтенд работает через API

// Конфигурация (БЕЗ КЛЮЧЕЙ И ПАРОЛЕЙ!)
const BACKEND_URL = 'https://medtest-z2ze.onrender.com'; // Адрес backend сервера

// Состояние админ-панели
const adminState = {
    isLoggedIn: false,
    jwtToken: null,  // JWT токен от backend
    allData: [],
    filteredData: [],
    fromDate: null,
    toDate: null,
};

// Спецификация анкеты (questions.json) для динамического экспорта
let QUESTIONS_SPEC = null;
let QUESTION_INDEX = null; // { [id]: { label, type, optionsMap, order } }

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-apply-filters').addEventListener('click', handleApplyFilters);
    document.getElementById('btn-export-excel').addEventListener('click', handleExportExcel);
    document.getElementById('btn-export-csv').addEventListener('click', handleExportCSV);
    document.getElementById('btn-export-json').addEventListener('click', handleExportJSON);

    // Подтягиваем questions.json (нужно для "полного" экспорта)
    const questionsPromise = bootstrapQuestions().catch(err => {
        console.error(err);
        // Экспорт без questions.json будет невозможен, но логин/просмотр может работать
        showStatus(`⚠️ Не удалось загрузить questions.json: ${err.message}`, 'error');
    });

    // Проверить, есть ли сохранённый JWT токен
    const savedToken = localStorage.getItem('admin_jwt_token');
    const tokenExpiry = parseInt(localStorage.getItem('admin_token_expiry')) || 0;

    if (savedToken && tokenExpiry > Date.now()) {
        adminState.jwtToken = savedToken;
        adminState.isLoggedIn = true;

        // Данные грузим после попытки загрузки questions.json
        Promise.resolve(questionsPromise)
          
            .catch(err => {
                console.error(err);
                showStatus(`❌ Ошибка загрузки данных: ${err.message}`, 'error');
            });

        showScreen('admin');
    }
});

// ------------------------
// questions.json helpers
// ------------------------
async function bootstrapQuestions() {
    // admin лежит в /admin/, questions.json лежит в корне репо
    const res = await fetch('questions.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Не удалось загрузить questions.json (${res.status})`);
    QUESTIONS_SPEC = await res.json();
    QUESTION_INDEX = buildQuestionIndex(QUESTIONS_SPEC);
}

function buildQuestionIndex(spec) {
    const idx = {};
    const questions = (spec && spec.questions) ? spec.questions : [];

    for (const q of questions) {
        const optionsMap = {};
        if (Array.isArray(q.options)) {
            for (const opt of q.options) {
                optionsMap[String(opt.value)] = opt.label;
            }
        }
        idx[q.id] = {
            id: q.id,
            label: q.label || q.id,
            type: q.type || 'text',
            order: (typeof q.order === 'number') ? q.order : 99999,
            optionsMap,
        };
    }
    return idx;
}

function valueToDisplay(qMeta, rawVal) {
    if (rawVal === null || rawVal === undefined || rawVal === '') return '';

    // boolean
    if (qMeta && qMeta.type === 'boolean') {
        if (rawVal === true || rawVal === 'true') return 'Да';
        if (rawVal === false || rawVal === 'false') return 'Нет';
    }

    // multiselect array
    if (Array.isArray(rawVal)) {
        return rawVal.map(v => valueToDisplay(qMeta, v)).filter(Boolean).join('; ');
    }

    // select options mapping
    const s = String(rawVal);
    if (qMeta && qMeta.optionsMap && qMeta.optionsMap[s]) return qMeta.optionsMap[s];

    return s;
}

function flattenRowToExportObject(row) {
    const answers = row.answers || {};
    const computed = row.computed || {};
    const meta = row.meta || {};

    const out = {
        'Шифр': row.code || '',
        'Дата': row.created_at ? new Date(row.created_at).toLocaleString('ru-RU') : '',
        'questionnaire_id': row.questionnaire_id || '',
        'questionnaire_version': row.questionnaire_version || '',
    };

    const questions = (QUESTIONS_SPEC && QUESTIONS_SPEC.questions) ? QUESTIONS_SPEC.questions : [];
    const sorted = [...questions].sort((a, b) => (a.order ?? 99999) - (b.order ?? 99999));

    for (const q of sorted) {
        const qMeta = (QUESTION_INDEX && QUESTION_INDEX[q.id]) ? QUESTION_INDEX[q.id] : { label: q.label || q.id, type: q.type };
        const label = qMeta.label || q.id;
        out[label] = valueToDisplay(qMeta, answers[q.id]);
    }

    // computed.*
    for (const [k, v] of Object.entries(computed)) {
        out[`computed.${k}`] = (v === null || v === undefined) ? '' : String(v);
    }

    // meta.*
    for (const [k, v] of Object.entries(meta)) {
        out[`meta.${k}`] = (v === null || v === undefined) ? '' : String(v);
    }

    // consent (если колонка реально есть)
    if (row.consent !== undefined) out['Согласие'] = row.consent ? 'Да' : 'Нет';

    return out;
}

function sanitizeSheetName(name) {
    return String(name).slice(0, 31).replace(/[:\\/?*\[\]]/g, '_');
}

// ====================
// API ВЗАИМОДЕЙСТВИЕ С BACKEND
// ====================

// Отправить запрос к backend с JWT токеном
async function apiRequest(endpoint, options = {}) {
    const url = `${BACKEND_URL}${endpoint}`;

    const headers = options.headers || {};
    headers['Content-Type'] = 'application/json';

    if (adminState.jwtToken) {
        headers['Authorization'] = `Bearer ${adminState.jwtToken}`;
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error ${response.status}: ${errorText}`);
    }

    return response.json();
}

// ====================
// АВТОРИЗАЦИЯ
// ====================

async function handleLogin(e) {
  e.preventDefault();

  const passwordInput = document.getElementById('password');
  const password = passwordInput.value;
  const errorDiv = document.getElementById('login-error');

  if (!password) {
    errorDiv.textContent = 'Введите пароль';
    return;
  }

  try {
    showStatus('Проверка пароля...', 'loading');

    const response = await fetch(`${BACKEND_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Неверный пароль');
    }

    const data = await response.json();
    const jwtToken = data.token;

    adminState.jwtToken = jwtToken;
    adminState.isLoggedIn = true;

    localStorage.setItem('admin_jwt_token', jwtToken);
    const expiryTime = Date.now() + (60 * 60 * 1000);
    localStorage.setItem('admin_token_expiry', String(expiryTime));

    errorDiv.textContent = '';
    passwordInput.value = '';

    await loadData();
    showScreen('admin');
    showStatus('✓ Вход выполнен', 'success');

  } catch (error) {
    console.error('Login error:', error);
    errorDiv.textContent = error.message || 'Ошибка входа';
    passwordInput.select();
    showStatus(`❌ ${error.message}`, 'error');
  }
}

function handleLogout() {
    adminState.jwtToken = null;
    adminState.isLoggedIn = false;
    adminState.allData = [];
    adminState.filteredData = [];

    localStorage.removeItem('admin_jwt_token');
    localStorage.removeItem('admin_token_expiry');

    showScreen('login');
    showStatus('Выход выполнен');
}

// ====================
// ЗАГРУЗКА ДАННЫХ
// ====================

async function loadData() {
    try {
        showStatus('Загрузка данных...', 'loading');

       const result = await apiRequest('/admin/responses');

// backend может вернуть либо массив, либо { data: массив }
const rows = Array.isArray(result) ? result : (result?.data || []);

adminState.allData = rows;
adminState.filteredData = [...rows];

updateStats();
updateTable(); // или renderTable — что у тебя используется


        showStatus(`✓ Загружено записей: ${adminState.allData.length}`);

    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        showStatus(`❌ Ошибка загрузки: ${error.message}`, 'error');

        // Если токен истёк - разлогинить
        if (error.message.includes('401') || error.message.includes('403')) {
            handleLogout();
        }
    }
}

// ====================
// UI ФУНКЦИИ
// ====================

function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById(`screen-${screenName}`).classList.add('active');
}


function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('export-status');
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';

    if (type !== 'loading') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}

function updateStats() {
  // Всего записей
  const total = adminState.allData.length;

  const elTotal = document.getElementById('stat-total');
  if (elTotal) elTotal.textContent = String(total);

  // Последняя дата (если данные отсортированы по убыванию created_at)
  const elLatest = document.getElementById('stat-latest');
  if (elLatest) {
    const latest = adminState.allData[0]?.created_at
      ? new Date(adminState.allData[0].created_at).toLocaleString('ru-RU')
      : '-';
    elLatest.textContent = latest;
  }
}

function updateTable() {
  const container = document.getElementById('table-container');
  if (!container) return;

  const rows = adminState.filteredData || [];

  if (!rows.length) {
    container.innerHTML = '<p class="loading">Нет данных для отображения</p>';
    return;
  }

  const preview = rows.slice(0, 50);

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Шифр</th>
          <th>Ответы</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of preview) {
    const date = r.created_at
      ? new Date(r.created_at).toLocaleString('ru-RU')
      : '';

    html += `
      <tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(r.code || '')}</td>
        <td><pre>${escapeHtml(JSON.stringify(r.answers, null, 2))}</pre></td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
    <p class="table-note">Показано ${preview.length} из ${rows.length} записей</p>
  `;

  container.innerHTML = html;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function handleApplyFilters() {
    const fromInput = document.getElementById('filter-from-date').value;
    const toInput = document.getElementById('filter-to-date').value;

    adminState.fromDate = fromInput ? new Date(fromInput) : null;
    adminState.toDate = toInput ? new Date(toInput) : null;

    // Фильтрация
    adminState.filteredData = adminState.allData.filter(row => {
        if (!row.created_at) return true;

        const rowDate = new Date(row.created_at);

        if (adminState.fromDate && rowDate < adminState.fromDate) return false;
        if (adminState.toDate && rowDate > adminState.toDate) return false;

        return true;
    });

    updateStats();
    updateTable();

    showStatus(`✓ Применены фильтры. Показано: ${adminState.filteredData.length}`);
}

// ====================
// ЭКСПОРТ ДАННЫХ
// ====================

function downloadFile(content, filename, mimeType) {
    const isCsv = (mimeType || '').toLowerCase().includes('text/csv');
    const bom = isCsv ? '\uFEFF' : ''; // BOM только для CSV
    const blob = new Blob([bom + content], { type: mimeType || 'application/octet-stream' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function handleExportExcel() {
    try {
        showStatus('Создание Excel файла...');

        const data = adminState.filteredData;
        if (!data || data.length === 0) {
            showStatus('❌ Нет данных для выгрузки');
            return;
        }
        if (!QUESTIONS_SPEC) {
            showStatus('❌ Не загружен questions.json (нужен для полного экспорта)');
            return;
        }

        const excelRows = data.map(flattenRowToExportObject);

        const ws = XLSX.utils.json_to_sheet(excelRows);
        const wb = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName('Ответы'));

        const filename = `responses_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, filename);

        showStatus(`✓ Excel выгружен: ${data.length} записей`);

    } catch (error) {
        console.error('Ошибка при экспорте в Excel:', error);
        showStatus(`❌ Ошибка: ${error.message}`);
    }
}

function handleExportCSV() {
    try {
        showStatus('Создание CSV файла...');

        const data = adminState.filteredData;
        if (!data || data.length === 0) {
            showStatus('❌ Нет данных для выгрузки');
            return;
        }
        if (!QUESTIONS_SPEC) {
            showStatus('❌ Не загружен questions.json (нужен для полного экспорта)');
            return;
        }

        const rows = data.map(flattenRowToExportObject);
        const headers = Object.keys(rows[0] || {});

        const escapeCsv = (val) => {
            const s = (val === null || val === undefined) ? '' : String(val);
            return `"${s.replace(/"/g, '""')}"`;
        };

        let csv = headers.map(escapeCsv).join(',') + '\n';
        for (const r of rows) {
            csv += headers.map(h => escapeCsv(r[h])).join(',') + '\n';
        }

        downloadFile(csv, `responses_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv;charset=utf-8');
        showStatus(`✓ CSV выгружен: ${data.length} записей`);

    } catch (error) {
        console.error('Ошибка при экспорте в CSV:', error);
        showStatus(`❌ Ошибка: ${error.message}`);
    }
}

function handleExportJSON() {
    try {
        showStatus('Создание JSON файла...');

        const data = adminState.filteredData;
        if (!data || data.length === 0) {
            showStatus('❌ Нет данных для выгрузки');
            return;
        }

        // Полный "сырой" JSON как в базе
        const json = JSON.stringify(data, null, 2);
        downloadFile(json, `responses_raw_${new Date().toISOString().split('T')[0]}.json`, 'application/json;charset=utf-8');

        showStatus(`✓ JSON выгружен: ${data.length} записей`);

    } catch (error) {
        console.error('Ошибка при экспорте в JSON:', error);
        showStatus(`❌ Ошибка: ${error.message}`);
    }
}

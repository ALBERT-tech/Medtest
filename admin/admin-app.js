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
let QUESTIONS_SPEC = null;
let QUESTION_INDEX = null; // { [id]: { label, type, optionsMap } }

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-apply-filters').addEventListener('click', handleApplyFilters);
    document.getElementById('btn-export-excel').addEventListener('click', handleExportExcel);
    document.getElementById('btn-export-csv').addEventListener('click', handleExportCSV);
    document.getElementById('btn-export-json').addEventListener('click', handleExportJSON);

    // Проверить, есть ли сохранённый JWT токен
    const savedToken = localStorage.getItem('admin_jwt_token');
    const tokenExpiry = parseInt(localStorage.getItem('admin_token_expiry')) || 0;

    if (savedToken && tokenExpiry > Date.now()) {
        adminState.jwtToken = savedToken;
        adminState.isLoggedIn = true;
        loadData();
        showScreen('admin');
    }
});

/**
 * Отправить пароль на backend
 * Backend сравнит с bcrypt хешем и вернёт JWT токен
 */
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

        // Отправить пароль на backend
        const response = await fetch(`${BACKEND_URL}/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Неверный пароль');
        }

        const data = await response.json();
        const jwtToken = data.token;

        // Сохранить JWT токен (действует 1 час)
        adminState.jwtToken = jwtToken;
        adminState.isLoggedIn = true;

        // Сохранить в localStorage
        localStorage.setItem('admin_jwt_token', jwtToken);
        const expiryTime = Date.now() + (60 * 60 * 1000); // +1 час
        localStorage.setItem('admin_token_expiry', expiryTime);

        errorDiv.textContent = '';
        passwordInput.value = '';

        loadData();
        showScreen('admin');
        showStatus('✓ Вход выполнен', 'success');

    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = error.message || 'Ошибка входа';
        passwordInput.select();
        showStatus(`❌ ${error.message}`, 'error');
    }
}

/**
 * Выход: удалить JWT токен
 */
function handleLogout() {
    localStorage.removeItem('admin_jwt_token');
    localStorage.removeItem('admin_token_expiry');
    adminState.jwtToken = null;
    adminState.isLoggedIn = false;
    adminState.allData = [];
    adminState.filteredData = [];

    document.getElementById('password').value = '';
    document.getElementById('login-error').textContent = '';

    showScreen('login');
    showStatus('✓ Вы вышли из системы', 'success');
}

/**
 * Показать экран
 */
function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(`screen-${screenName}`).classList.add('active');
}

/**
 * Загрузить данные с backend
 * Используется JWT токен (НЕ Service Key!)
 */
async function loadData() {
    try {
        showStatus('Загрузка данных...', 'loading');

        // Запрос к backend с JWT токеном
        const response = await fetch(`${BACKEND_URL}/admin/responses`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminState.jwtToken}` // JWT токен в заголовке
            }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                handleLogout();
                throw new Error('Сессия истекла. Пожалуйста, войдите снова.');
            }
            throw new Error(`Ошибка загрузки: ${response.status}`);
        }

        adminState.allData = await response.json();
        adminState.filteredData = [...adminState.allData];

        // Загрузить статистику
        await loadStats();

        renderTable();
        showStatus('✓ Данные загружены');

    } catch (error) {
        console.error('Ошибка:', error);
        showStatus(`❌ Ошибка: ${error.message}`, 'error');
    }
}

/**
 * Загрузить статистику
 */
async function loadStats() {
    try {
        const response = await fetch(`${BACKEND_URL}/admin/responses/stats`, {
            headers: {
                'Authorization': `Bearer ${adminState.jwtToken}`
            }
        });

        if (!response.ok) throw new Error('Failed to load stats');

        const stats = await response.json();
        document.getElementById('stat-total').textContent = stats.total;
        document.getElementById('stat-avg-bmi').textContent = stats.avg_bmi;
        document.getElementById('stat-latest').textContent = stats.latest_response
            ? new Date(stats.latest_response).toLocaleString('ru-RU')
            : '-';

    } catch (error) {
        console.error('Stats error:', error);
        // Статистика не критична, можем посчитать на фронтенде
        updateStats();
    }
}

/**
 * Обновить статистику (фронтенд расчёт)
 */
function updateStats() {
    const data = adminState.filteredData;

    document.getElementById('stat-total').textContent = data.length;

    if (data.length > 0) {
        const latestDate = new Date(data[0].created_at);
        document.getElementById('stat-latest').textContent = latestDate.toLocaleString('ru-RU');
    }

    if (data.length > 0) {
        const bmiValues = data
            .map(row => parseFloat(row.computed?.bmi || 0))
            .filter(bmi => bmi > 0);

        if (bmiValues.length > 0) {
            const avgBmi = (bmiValues.reduce((a, b) => a + b, 0) / bmiValues.length).toFixed(1);
            document.getElementById('stat-avg-bmi').textContent = avgBmi;
        }
    }
}

/**
 * Применить фильтры по датам
 */
function handleApplyFilters() {
    const fromDate = document.getElementById('filter-from-date').value;
    const toDate = document.getElementById('filter-to-date').value;

    adminState.filteredData = adminState.allData.filter(row => {
        const rowDate = new Date(row.created_at);

        if (fromDate && new Date(fromDate) > rowDate) return false;
        if (toDate && new Date(toDate) < rowDate) return false;

        return true;
    });

    updateStats();
    renderTable();
    showStatus(`✓ Фильтры применены (${adminState.filteredData.length} записей)`);
}

/**
 * Отобразить таблицу
 */
function renderTable() {
    const data = adminState.filteredData;
    const container = document.getElementById('table-container');

    if (data.length === 0) {
        container.innerHTML = '<p class="loading">Нет данных для отображения</p>';
        return;
    }

    const previewData = data.slice(0, 10);

    let html = '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>Шифр</th>';
    html += '<th>Дата</th>';
    html += '<th>Возраст</th>';
    html += '<th>Вес (кг)</th>';
    html += '<th>Рост (см)</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    previewData.forEach(row => {
        const answers = row.answers || {};
        const computed = row.computed || {};
        const date = new Date(row.created_at).toLocaleString('ru-RU');

        html += '<tr>';
        html += `<td>${row.code}</td>`;
        html += `<td>${date}</td>`;
        html += `<td>${answers.age || '-'}</td>`;
        html += `<td>${answers.weight_kg || '-'}</td>`;
        html += `<td>${answers.height_cm || '-'}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';

    if (data.length > 10) {
        html += `<p class="table-note">Показано 10 из ${data.length} записей. Нажми "Скачать Excel" для выгрузки всех.</p>`;
    }

    container.innerHTML = html;
}

/**
 * Экспортировать в Excel
 */
function handleExportExcel() {
    try {
        showStatus('Создание Excel файла...');

        const data = adminState.filteredData;
        if (data.length === 0) {
            showStatus('❌ Нет данных для выгрузки');
            return;
        }

        const excelData = data.map(row => {
            const answers = row.answers || {};
            const computed = row.computed || {};

            return {
                'Шифр': row.code,
                'Дата': new Date(row.created_at).toLocaleString('ru-RU'),
                'Возраст (лет)': answers.age || '',
                'Роды (раз)': answers.births || '',
                'Вес (кг)': answers.weight_kg || '',
                'Рост (см)': answers.height_cm || '',
                'Окружность талии (см)': answers.waist_circumference || '',
                'Дневные микции': answers.daytime_micturitions || '',
                'Ночные микции': answers.nighttime_micturitions || '',
                'Жидкость (мл)': answers.fluid_intake_ml || '',
                'Моча (мл)': answers.urine_output_ml || '',
                'Позывы': answers.urgent_urges || '',
                'Недержание (раз/сут)': answers.incontinence_episodes || '',
                'Прокладки': answers.pads_per_day || '',
                'Энурез (лет)': answers.childhood_enuresis || '',
                'ИМТ': computed.bmi || '',
                'Согласие': row.consent ? 'Да' : 'Нет'
            };
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ответы');

        const wscols = [
            { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 },
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }
        ];
        ws['!cols'] = wscols;

        const filename = `responses_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, filename);

        showStatus(`✓ Excel выгружен: ${data.length} записей`);

    } catch (error) {
        console.error('Ошибка при экспорте в Excel:', error);
        showStatus(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Экспортировать в CSV
 */
function handleExportCSV() {
    try {
        showStatus('Создание CSV файла...');

        const data = adminState.filteredData;
        if (data.length === 0) {
            showStatus('❌ Нет данных для выгрузки');
            return;
        }

        const headers = [
            'Шифр', 'Дата', 'Возраст', 'Роды', 'Вес', 'Рост', 'Окружность',
            'Дневные микции', 'Ночные микции', 'Жидкость', 'Моча', 'Позывы',
            'Недержание', 'Прокладки', 'Энурез', 'ИМТ', 'Согласие'
        ];

        let csv = headers.join(',') + '\n';

        data.forEach(row => {
            const answers = row.answers || {};
            const computed = row.computed || {};

            const values = [
                `"${row.code}"`,
                `"${new Date(row.created_at).toLocaleString('ru-RU')}"`,
                answers.age || '',
                answers.births || '',
                answers.weight_kg || '',
                answers.height_cm || '',
                answers.waist_circumference || '',
                answers.daytime_micturitions || '',
                answers.nighttime_micturitions || '',
                answers.fluid_intake_ml || '',
                answers.urine_output_ml || '',
                answers.urgent_urges || '',
                answers.incontinence_episodes || '',
                answers.pads_per_day || '',
                answers.childhood_enuresis || '',
                computed.bmi || '',
                row.consent ? 'Да' : 'Нет'
            ];

            csv += values.join(',') + '\n';
        });

        downloadFile(csv, `responses_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
        showStatus(`✓ CSV выгружен: ${data.length} записей`);

    } catch (error) {
        console.error('Ошибка при экспорте в CSV:', error);
        showStatus(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Экспортировать в JSON
 */
function handleExportJSON() {
    try {
        showStatus('Создание JSON файла...');

        const data = adminState.filteredData;
        if (data.length === 0) {
            showStatus('❌ Нет данных для выгрузки');
            return;
        }

        const json = JSON.stringify(data, null, 2);
        downloadFile(json, `responses_${new Date().toISOString().split('T')[0]}.json`, 'application/json');

        showStatus(`✓ JSON выгружен: ${data.length} записей`);

    } catch (error) {
        console.error('Ошибка при экспорте в JSON:', error);
        showStatus(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Утилита для скачивания файла
 */
function downloadFile(content, filename, mimeType) {
   const bom = '\uFEFF'; // BOM для UTF-8
const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Показать статус
 */
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

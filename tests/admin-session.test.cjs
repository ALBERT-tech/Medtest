const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin-app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');

async function openAdmin({ saved = true, expired = false, questionsFail = false } = {}) {
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
        const classes = new Set(id === 'screen-login' ? ['screen', 'active'] : ['screen']);
        return [id, {
            textContent: id === 'stat-total' ? '0' : '',
            innerHTML: '', style: {}, value: '',
            addEventListener() {},
            classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
        }];
    }));
    const stored = new Map(saved ? [
        ['admin_jwt_token', 'test-session-token'],
        ['admin_token_expiry', String(Date.now() + (expired ? -60000 : 60000))],
    ] : []);
    const requests = [];
    let ready;
    const context = vm.createContext({
        document: {
            getElementById: id => elements.get(id),
            querySelectorAll: () => [elements.get('screen-login'), elements.get('screen-admin')],
            addEventListener: (event, callback) => { if (event === 'DOMContentLoaded') ready = callback; },
        },
        localStorage: {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: key => stored.delete(key),
        },
        fetch: async (url, options = {}) => {
            requests.push({ url, options });
            if (url === 'questions.json') {
                return { ok: !questionsFail, status: questionsFail ? 503 : 200, json: async () => ({ questions: [] }) };
            }
            assert.equal(url, 'https://medtest-z2ze.onrender.com/admin/responses');
            assert.equal(options.headers.Authorization, 'Bearer test-session-token');
            return { ok: true, json: async () => Array.from({ length: 399 }, (_, i) => ({ code: `TEST-${i}` })) };
        },
        console: { error() {} },
        setTimeout() {},
    });
    vm.runInContext(source, context);
    ready();
    await new Promise(resolve => setImmediate(resolve));
    return { elements, requests };
}

test('reopening a valid session loads and displays all returned responses', async () => {
    const { elements, requests } = await openAdmin();
    assert.equal(requests.filter(r => r.url.endsWith('/admin/responses')).length, 1);
    assert.equal(elements.get('stat-total').textContent, '399');
    assert.match(elements.get('table-container').innerHTML, /TEST-0/);
    assert.match(elements.get('table-container').innerHTML, /100 из 399/);
    assert.equal(elements.get('screen-admin').classList.contains('active'), true);
});

test('a questionnaire failure does not prevent loading the response list', async () => {
    const { elements } = await openAdmin({ questionsFail: true });
    assert.equal(elements.get('stat-total').textContent, '399');
});

for (const [name, options] of [['absent', { saved: false }], ['expired', { expired: true }]]) {
    test(`${name} sessions stay on the login screen without requesting responses`, async () => {
        const { elements, requests } = await openAdmin(options);
        assert.equal(requests.some(r => r.url.endsWith('/admin/responses')), false);
        assert.equal(elements.get('screen-login').classList.contains('active'), true);
    });
}

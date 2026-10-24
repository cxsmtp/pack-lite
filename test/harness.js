// Simulates Google Apps Script services + Pocket API to exercise PocketLifeOS.gs end to end.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const SCRIPT_PATH = path.join(__dirname, '..', 'PocketLifeOS.js');   // fixed: the harness only ever loads this repo's script
const code = fs.readFileSync(SCRIPT_PATH, 'utf8');
const log = [];
let idc = 0; const nid = (p) => p + (++idc);

function chain(target) {
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; if (typeof p === 'symbol') return undefined; return () => chain(t); } });
}
// ---------- Properties ----------
const store = {};
const Props = { getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: k => { delete store[k]; } };
// ---------- Drive ----------
const items = {};
function mkFolder(name, parent) {
  const f = chain({ kind: 'folder', id: nid('fold'), name, parent, trashed: false,
    getId() { return this.id; }, getName() { return this.name; }, setName(n) { this.name = n; return this; }, isTrashed() { return false; },
    getUrl() { return 'https://drive/' + this.id; }, setDescription() { return this; },
    getFoldersByName(n) { const l = Object.values(items).filter(x => x.kind === 'folder' && x.parent === this.id && x.name === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    createFolder(n) { return mkFolder(n, this.id); },
    getFiles() { const l = Object.values(items).filter(x => x.kind === 'file' && x.parent === this.id); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    createFile(blob, content) { if (typeof blob === 'string') { const f2 = mkFile(blob, this.id); f2.text = content; f2.created = new Date(Date.now() + (++idc) * 1000); return f2; } const fl = mkFile(blob.name, this.id); fl.size = blob.bytes; fl.type = blob.type; return fl; } });
  items[f.id] = f; return f;
}
function mkFile(name, parent, id) {
  const f = chain({ kind: 'file', id: id || nid('file'), name, parent, created: null, text: '', mime: '', size: 0, desc: '', trashed: false,
    getId() { return this.id; }, getName() { return this.name; }, setName(n) { this.name = n; return this; }, isTrashed() { return false; },
    getUrl() { return 'https://drive/file/' + this.id; },
    getMimeType() { return this.mime || 'application/octet-stream'; }, getSize() { return this.size || 10; }, getDateCreated() { return this.created || new Date('2026-10-01T10:00:00Z'); },
    setDescription(d) { this.desc = d; return this; }, getBlob() { const t = this.text || ''; return { getBytes: () => [1, 2, 3], getDataAsString: () => t }; }, setTrashed(v) { this.trashed = v; return this; },
    moveTo(folder) { this.parent = folder.getId(); return this; },
    getParents() { const p = items[this.parent]; let d = false; return { hasNext: () => !d && !!p, next: () => { d = true; return p; } }; } });
  items[f.id] = f; return f;
}
const root = mkFolder('My Drive', null);
const DriveApp = { getRootFolder: () => root, getFolderById: id => { if (!items[id]) throw new Error('no'); return items[id]; }, getFileById: id => { if (!items[id]) throw new Error('no file ' + id); return items[id]; } };
// ---------- Docs ----------
const docs = {};
function mkEl(type, text) {
  return chain({ type, text: text || '', heading: '', getType() { return type === 'li' ? 'LIST_ITEM' : type === 'p' ? 'PARAGRAPH' : 'TABLE'; },
    setHeading(h) { this.heading = h; return chain(this); }, getHeading() { return this.heading; }, copy() { return mkEl(type, this.text); },
    asListItem() { return chain(this); }, asTable() { return chain(this); }, setText(t) { this.text = t; return chain(this); }, getText() { return this.text; }, editAsText() { return chain({ getText: () => this.text }); },
    asParagraph() { return chain(this); } });
}
const DocumentApp = {
  ElementType: { PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', TABLE: 'TABLE' },
  ParagraphHeading: { TITLE: 'T', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3' }, GlyphType: { BULLET: 'b', HOLLOW_BULLET: 'hb', NUMBER: 'n' },
  create(name) {
    const id = nid('doc'); mkFile(name, root.getId(), id);
    const body = chain({ children: [mkEl('p')],
      clear() { this.children = [mkEl('p')]; return chain(this); }, getChild(i) { return this.children[i]; }, getNumChildren() { return this.children.length; },
      getText() { return this.children.map(c => c.text || '').join('\n'); },
      insertParagraph(i, el) { this.children.splice(i, 0, el); return el; }, insertListItem(i, el) { this.children.splice(i, 0, el); return el; }, insertTable(i, el) { this.children.splice(i, 0, el); return el; },
      appendParagraph(t) { const e = mkEl('p', t); this.children.push(e); return e; }, appendListItem(t) { const e = mkEl('li', t); this.children.push(e); return e; },
      appendTable(rows) { const cells = rows.map(r => r.map(c => mkEl('cell', c))); const tb = chain({ rows, getNumRows: () => rows.length, getCell: (r, c) => cells[r][c] }); this.children.push(tb); return tb; } });
    const d = { id, body, getId: () => id, getName: () => items[id].name, setName: n => { items[id].name = n; }, getBody: () => body, saveAndClose() { docs[id].saves++; } };
    docs[id] = { d, saves: 0 };
    return d;
  },
  openById(id) { if (!docs[id]) throw new Error('no doc'); return docs[id].d; }
};
// ---------- Sheets ----------
function mkSheet(name) {
  const sh = { name, data: [], maxRows: 1000, frozen: 0,
    getName() { return this.name; }, setName(n) { this.name = n; return this; }, getLastRow() { return this.data.length; }, getLastColumn() { return (this.data[0] || []).length; }, getMaxRows() { return this.maxRows; },
    setFrozenRows() {}, insertRowsAfter(a, n) { this.maxRows += n; },
    appendRow(r) { this.data.push(r.slice()); },
    insertRowAfter(i) { this.data.splice(i, 0, []); },
    deleteRows(s, n) { this.data.splice(s - 1, n); },
    getRange(r, c, nr, nc) {
      const self = this; nr = nr || 1; nc = nc || 1;
      return chain({ setValues(v) { v.forEach((row, i) => { const t = self.data[r - 1 + i] = self.data[r - 1 + i] || []; row.forEach((x, j) => { t[c - 1 + j] = x; }); }); return chain(this); },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = self.data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; } });
    } };
  return sh;
}
const sheets = {};
const SpreadsheetApp = {
  create(name) { const id = nid('ss'); mkFile(name, root.getId(), id); const ss = { id, sheets: [mkSheet('Sheet1')], getId: () => id, getUrl: () => 'https://sheet/' + id,
    getSheets() { return this.sheets; }, getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }, insertSheet(n) { const s = mkSheet(n); this.sheets.push(s); return s; } };
    sheets[id] = ss; return ss; },
  openById(id) { return sheets[id]; }
};
// ---------- Pocket fake ----------
const now = Date.now();
function iso(minAgo) { return new Date(now - minAgo * 60000).toISOString(); }
const recordings = [
  { id: 'r1', title: 'Standup', state: 'completed', duration: 1320, recording_at: iso(60 * 30), created_at: iso(60 * 30 - 30), updated_at: iso(60 * 29), folder_id: 'fw', tags: [],
    speakers: { SPEAKER_00: { name: 'Priya Raman', speakerId: 's1' }, SPEAKER_01: { name: 'Me', speakerId: 's2' } },
    transcript: { segments: [{ start: 0, end: 3, speaker: 'SPEAKER_00', speakerName: 'Priya Raman', text: 'Morning.' }, { start: 3, end: 6, speaker: 'SPEAKER_00', text: '=SUM(1) formula attempt' }, { start: 7, end: 9, speaker: 'SPEAKER_01', speakerName: 'Me', text: 'Hi.' }] },
    summarizations: { s1: { processingStatus: 'completed', updatedAt: iso(60 * 29), v2: { summary: { title: 'Standup', emoji: '🧭', markdown: '# Overview\n- **Beta** on 4 Nov\n- QA starts *Thursday*\n  - nested point\n1. numbered\n> quote\n- [ ] checkbox item', bulletPoints: ['Beta on track'] },
      actionItems: { actionItems: [{ id: 'a1', globalActionItemId: 'gai_1', title: 'Escalate sandbox outage', dueDate: null, isCompleted: false }] } } } } },
  { id: 'r2', title: 'Call with Mom', state: 'completed', duration: 900, recording_at: iso(60 * 5), created_at: iso(60 * 5 - 20), updated_at: iso(60 * 4), folder_id: null, tags: [{ id: 't', name: 'Family', color: 'x' }],
    speakers: { Mom: { name: 'Mom', speakerId: 's3' } }, transcript: { segments: [{ start: 0, end: 5, speaker: 'Mom', speakerName: 'Mom', text: 'Book tickets.' }] },
    summarizations: { s2: { processingStatus: 'completed', v2: { summary: { markdown: 'Diwali plans.' }, actionItems: { actions: [{ id: 'x1', label: 'Book train tickets', dueDate: '2026-10-30', isCompleted: false, priority: 'high' }, { id: 'x2', label: 'Done thing', isCompleted: true }] } } } } },
  { id: 'r3', title: 'Coffee with Sana', state: 'completed', duration: 600, recording_at: iso(60 * 3), created_at: iso(60 * 3 - 10), updated_at: iso(60 * 3), folder_id: null, tags: [],
    speakers: { SPEAKER_00: { name: 'Sana', speakerId: 's4' } }, transcript: { segments: [] }, summarizations: null },
  { id: 'r4', title: 'Just recorded', state: 'processing', duration: 60, recording_at: iso(3), created_at: iso(2), updated_at: iso(2), tags: [], speakers: {}, summarizations: null },
  { id: 'r5', title: 'Big audio', state: 'completed', duration: 7200, recording_at: iso(60 * 50), created_at: iso(60 * 49), updated_at: iso(60 * 49), tags: [], speakers: {}, transcript: { segments: [] },
    summarizations: { s: { v2: { summary: { markdown: 'Long talk about the roadmap, client invoice and sprint' } } } } }
];
const scriptCalls = [];
const gh = { head: { sha: 'a'.repeat(40), commit: { message: 'New feature\nbody', verification: { verified: false }, committer: { date: '2026-10-24' } } }, file: '', v: 3, puts: [], versionManifests: {},
  files: [{ name: 'Code', type: 'SERVER_JS', source: 'old' }, { name: 'appsscript', type: 'JSON', source: '{"timeZone":"Asia/Kolkata","runtimeVersion":"V8"}' }],
  deployments: [
    { deploymentId: 'HEADDEP', deploymentConfig: {}, entryPoints: [] },
    { deploymentId: 'DASH', deploymentConfig: { versionNumber: 1, description: 'Dashboard' }, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { entryPointConfig: { access: 'MYSELF', executeAs: 'USER_DEPLOYING' } } }] },
    { deploymentId: 'PHONE', deploymentConfig: { versionNumber: 2, description: 'Phone' }, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { entryPointConfig: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' } } }] }
  ] };
const mcpCalls = []; const aiCalls = []; const uploads = []; const uploadReqs = [];
let calls = { list: 0, detail: 0, audio: 0, s3: 0, upload: 0 };
function resp(code, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { getResponseCode: () => code, getContentText: () => text, getAllHeaders: () => headers || {},
    getBlob: () => ({ name: '', bytes: 0, type: '', setName(n) { this.name = n; return this; }, setContentType(t) { this.type = t; return this; } }), getContent: () => [1, 2, 3] };
}
const UrlFetchApp = {
  fetch(url, p) {
    p = p || {};
    const u = new URL(url);
    if (u.host === 'public.heypocketai.com' && u.pathname === '/mcp') {
      const b = JSON.parse(p.payload);
      if (b.method === 'initialize') return resp(200, { jsonrpc: '2.0', id: 1, result: {} }, { 'Mcp-Session-Id': 'sess1' });
      if (b.method === 'notifications/initialized') return resp(202, '');
      if (b.method === 'tools/list') return resp(200, 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search_pocket_actionitems', inputSchema: { properties: { query: {} } } }] } }) + '\n\n');
      mcpCalls.push(b.params);
      const n = b.params.name;
      let out = {};
      if (n === 'get_account_info') out = { success: true, data: { email: 'me@x.com', displayName: 'Me Person', plan: 'pro' } };
      if (n === 'search_pocket_actionitems') out = { success: true, data: { actionItems: [{ actionItemId: 'mcp_ai_9', label: 'Book train tickets' }] } };
      if (n === 'update_pocket_actionitem') out = { success: true, data: { actionItemId: b.params.arguments.actionItemId, status: 'COMPLETED' } };
      if (n === 'query_pocket_meetings') out = { success: true, data: { answer: 'You discussed X', sourceRecordings: [{ recordingId: 'r1' }] } };
      return resp(200, 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } }) + '\n\n', { 'Content-Type': 'text/event-stream' });
    }
    if (u.host === 'public.heypocketai.com') {
      if (!/Bearer pk_/.test(p.headers.Authorization)) return resp(401, { success: false, error: 'bad key' });
      const path = u.pathname.replace('/api/v1', '');
      const H = { 'X-RateLimit-Remaining': '40', 'X-RateLimit-Reset': String(Math.floor(now / 1000) + 30) };
      if (path === '/public/recordings') {
        calls.list++;
        const page = Number(u.searchParams.get('page')), limit = Number(u.searchParams.get('limit'));
        const sd = u.searchParams.get('start_date');
        let l = recordings.filter(r => !sd || r.recording_at.slice(0, 10) >= sd).map(r => Object.assign({}, r, { transcript: null }));
        const slice = l.slice((page - 1) * limit, page * limit);
        return resp(200, { success: true, data: slice, pagination: { page, limit, total: l.length, total_pages: Math.ceil(l.length / limit), has_more: page * limit < l.length } }, H);
      }
      let m;
      if ((m = path.match(/^\/public\/recordings\/(\w+)\/audio-url$/))) { calls.audio++; return resp(200, { success: true, data: { signed_url: 'https://s3.example.com/' + m[1] + '.m4a?sig=1', expires_in: 3600 } }, H); }
      if ((m = path.match(/^\/public\/recordings\/(\w+)$/))) { calls.detail++; return resp(200, { success: true, data: recordings.find(r => r.id === m[1]) }, H); }
      if (path === '/public/folders') return resp(200, { success: true, data: [{ id: 'fw', name: 'Work', kind: 'space', children: [{ id: 'fc', name: 'Clients', kind: 'folder', children: [] }] }] });
      if (path === '/public/recordings/upload-url') { const b = JSON.parse(p.payload); uploadReqs.push(b); return resp(200, { success: true, data: { upload_url: 'https://upload.s3.example.com/x?sig=1', recording_id: 'rup1' } }); }
      if (path === '/public/search') return resp(200, { success: true, data: [{ recording_id: 'r1', text: 'beta on 4 nov', score: 0.9 }] });
      return resp(404, { success: false, error: 'not found' });
    }
    if (u.host === 's3.example.com') {
      calls.s3++;
      const big = u.pathname.indexOf('r5') >= 0 || u.pathname.indexOf('r9') >= 0;
      const total = u.pathname.indexOf('r9') >= 0 ? 500 * 1024 * 1024 : big ? 60 * 1024 * 1024 : 1000;
      return resp(206, '', { 'Content-Range': 'bytes 0-0/' + total, 'Content-Type': 'audio/mp4' });
    }
    if (u.host === 'api.anthropic.com') {
      const b = JSON.parse(p.payload); aiCalls.push({ body: b, headers: p.headers });
      if (ctxGlobals.__aiFail) return resp(500, { type: 'error', error: { message: 'overloaded' } });
      let text;
      if (b.output_config && b.output_config.format) text = JSON.stringify({ category: 'Office', categoryReason: 'Product standup with a colleague', sections: [{ title: 'Decisions', bullets: ['**Beta** stays on 4 Nov'] }, { title: 'Risks and open questions', bullets: [] }],
        decisions: ['QA starts Thursday'], myCommitments: [{ task: 'Send QA plan', toWhom: 'Priya Raman', due: '2026-10-27' }], peopleMentioned: ['Priya Raman'] });
      else text = b.system.indexOf('weekly') >= 0 ? '## Highlights\n- Busy week\n## Decisions\n- **Beta** on 4 Nov' : 'You talked with Priya on the standup.';
      return resp(200, { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } });
    }
    if (u.host === 'api.github.com') {
      if (/\/commits\/main$/.test(u.pathname)) return resp(200, gh.head);
      const cm = u.pathname.match(/\/contents\/([^/]+)$/);
      if (cm && u.searchParams.get('ref') === gh.head.sha) {
        const name = decodeURIComponent(cm[1]);
        const body = name === 'release.json' ? (gh.release !== undefined ? gh.release : JSON.stringify({ file: 'PocketLifeOS.js', sha256: crypto.createHash('sha256').update(gh.file, 'utf8').digest('hex') }))
          : name === 'PocketLifeOS.js' ? (gh.served !== undefined ? gh.served : gh.file) : null;
        if (body === null) return resp(404, {});
        return resp(200, { encoding: 'base64', content: Buffer.from(body, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') });
      }
      return resp(404, {});
    }
    if (u.host === 'script.googleapis.com') {
      const path = u.pathname.replace(/^\/v1\/projects\/[^/]+/, '');
      const m = (p.method || 'get').toLowerCase();
      scriptCalls.push(m + ' ' + path);
      if (gh.apiOff) return resp(403, { error: { message: 'User has not enabled the Apps Script API.' } });
      if (path === '/content' && m === 'get') return resp(200, { files: JSON.parse(JSON.stringify(gh.files)) });
      if (path === '/content' && m === 'put') { gh.files = JSON.parse(p.payload).files; gh.puts.push(JSON.parse(JSON.stringify(gh.files))); return resp(200, {}); }
      if (path === '/versions') { gh.v++; gh.versionManifests[gh.v] = gh.files.find(f => f.name === 'appsscript').source; return resp(200, { versionNumber: gh.v }); }
      if (path === '/deployments' && m === 'get') return resp(200, { deployments: gh.deployments });
      const dm = path.match(/^\/deployments\/(\w+)$/);
      if (dm) { const d = gh.deployments.find(x => x.deploymentId === dm[1]); d.deploymentConfig.versionNumber = JSON.parse(p.payload).deploymentConfig.versionNumber; return resp(200, d); }
      return resp(404, {});
    }
    if (u.host === 'upload.s3.example.com') { uploads.push({ url, ct: p.contentType, method: p.method }); return resp(200, ''); }
    if (u.host === 'www.googleapis.com') { calls.upload++; return resp(200, '', { Location: 'https://upload.example.com/session1' }); }
    if (u.host === 'upload.example.com') {
      if (ctxGlobals.__slowUpload) clockOffset += 40000;
      const range = p.headers['Content-Range']; const [, e, t] = range.match(/(\d+)\/(\d+)/) ? range.match(/-(\d+)\/(\d+)/) : [];
      if (Number(e) + 1 < Number(t)) return resp(308, '');
      const f = mkFile('uploaded', root.getId()); return resp(200, { id: f.getId() });
    }
    throw new Error('unexpected fetch ' + url);
  }
};
// ---------- Tasks ----------
const taskStore = { lists: [], tasks: {} };
const Tasks = {
  Tasklists: { list: () => ({ items: taskStore.lists }), insert: (l) => { const x = { id: nid('tl'), title: l.title }; taskStore.lists.push(x); return x; }, get: (id) => { const x = taskStore.lists.find(l => l.id === id); if (!x) throw new Error('nf'); return x; } },
  Tasks: { insert: (t, l) => { const x = Object.assign({ id: nid('task'), status: 'needsAction', list: l }, t); taskStore.tasks[x.id] = x; return x; },
    list: (l) => ({ items: Object.values(taskStore.tasks).filter(t => t.list === l) }), patch: (p, l, id) => Object.assign(taskStore.tasks[id], p) }
};
// ---------- misc ----------
const triggers = [];
function trig(fn) { return chain({ fn, timeBased() { return chain(this); }, create() { triggers.push(fn); return this; } }); }
let clockOffset = 0;
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + clockOffset); } static now() { return Date.now() + clockOffset; } }
const ctxGlobals = {
  advance: (ms) => { clockOffset += ms; },
  console, JSON, Date: FakeDate, Math, Object, Array, String, Number, RegExp, Error, encodeURIComponent, parseInt,
  PropertiesService: { getUserProperties: () => Props },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata', getActiveUser: () => ({ getEmail: () => 'me@gmail.com' }), getEffectiveUser: () => ({ getEmail: () => 'me@gmail.com' }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    parseDate: (str, tz, fmt) => { const off = tz === 'Etc/UTC' ? 'Z' : '+05:30'; return new Date(str + off); }, sleep: (ms) => { log.push('sleep ' + ms); },
    computeDigest: (a, s) => { if (a !== 'sha256') throw new Error('only SHA-256 is used'); return Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b); },
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')), newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    formatDate(d, tz, pat) {
      const f = (o) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, o)).format(d);
      return pat.replace(/yyyy|MMMM|MM|dd|d|HH|mm|EEEE|EEE/g, t => ({ yyyy: f({ year: 'numeric' }), MMMM: f({ month: 'long' }), MM: f({ month: '2-digit' }), dd: f({ day: '2-digit' }), d: f({ day: 'numeric' }),
        HH: f({ hour: '2-digit', hourCycle: 'h23' }), mm: f({ minute: '2-digit' }).padStart(2, '0'), EEEE: f({ weekday: 'long' }), EEE: f({ weekday: 'short' }) })[t]);
    }
  },
  LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => triggers.map(fn => ({ getHandlerFunction: () => fn })), deleteTrigger: (t) => { const i = triggers.indexOf(t.getHandlerFunction()); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: trig, getScriptId: () => 'SCRIPT1', WeekDay: { SUNDAY: 'SUN', MONDAY: 'MON' }, getOAuthToken: () => 'tok', getService: () => ({ getUrl: () => 'https://script/exec' }) },
  DriveApp, DocumentApp, SpreadsheetApp, UrlFetchApp, Tasks,
  CalendarApp: { getCalendarsByName: () => [], createCalendar: () => chain({ createAllDayEvent: () => chain({ getId: () => 'ev1' }) }), Color: { ORANGE: 'o' } },
  MimeType: { PLAIN_TEXT: 'text/plain' },
  MailApp: { sendEmail: (o) => { log.push('MAIL ' + o.subject); ctxGlobals.__mail = o; } },
  HtmlService: { createHtmlOutput: (h) => chain({ html: h }) }, ContentService: { createTextOutput: (t) => t },
  Logger: { log: (m) => log.push(m) }
};
vm.createContext(ctxGlobals);
vm.runInContext(code + '\n;this.__api = { setup, syncNow, api, doPost, dailyDigest, normalize_, parseRpc_, UI_HTML_ };', ctxGlobals);
module.exports = { SCRIPT_PATH, gh, scriptCalls, mkFile, aiCalls, uploads, uploadReqs, G: ctxGlobals, items, docs, sheets, taskStore, mcpCalls, calls, triggers, log, store, recordings };

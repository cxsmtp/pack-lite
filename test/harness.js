// Simulates Google Apps Script services + Pocket API to exercise PocketLifeOS.gs end to end.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SCRIPT_PATH = path.join(__dirname, '..', 'PocketLifeOS.js');   // fixed: the harness only ever loads this repo's script
const log = [];
let idc = 0; const nid = (p) => p + (++idc);

function chain(target) {
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; if (typeof p === 'symbol') return undefined; return () => chain(t); } });
}
// ---------- Properties ----------
const store = {};
const Props = { getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: k => { delete store[k]; } };
// ---------- Google Drive + Sheets REST (the script may only use these: drive.file) ----------
const FOLDER = 'application/vnd.google-apps.folder', GDOC = 'application/vnd.google-apps.document', GSHEET = 'application/vnd.google-apps.spreadsheet';
const items = {};   // id -> record { id, kind, name, parent, mime, size, text, created, trashed, desc }
function mkRecord(kind, name, parent, extra) {
  const r = Object.assign({ id: nid(kind === 'folder' ? 'fold' : 'file'), kind, name, parent, mime: kind === 'folder' ? FOLDER : '', size: 0, text: '', created: new Date(Date.now() + (++idc) * 1000), trashed: false, desc: '' }, extra || {});
  items[r.id] = r;
  return r;
}
function mkFolder(name, parent) { return mkRecord('folder', name, parent); }
function mkFile(name, parent, id) { return mkRecord('file', name, parent, id ? { id } : {}); }
const root = mkRecord('folder', 'My Drive', null, { id: 'root' });
function apiFile(r) {
  return { id: r.id, name: r.name, mimeType: r.kind === 'folder' ? FOLDER : (r.mime || 'application/octet-stream'), size: String(r.size || (r.text || '').length || 10),
    createdTime: r.created.toISOString(), parents: r.parent ? [r.parent] : [], trashed: !!r.trashed };
}
function bytesToString(p) { return Array.isArray(p) ? Buffer.from(p.map(b => b & 255)).toString('utf8') : String(p || ''); }
function parseMultipart(payload, contentType) {
  const boundary = contentType.split('boundary=')[1];
  const parts = bytesToString(payload).split('--' + boundary).filter(x => x.trim() && x.trim() !== '--');
  const body = (part) => part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  return { meta: JSON.parse(body(parts[0])), media: body(parts[1]), mediaType: (parts[1].match(/Content-Type: ([^\r\n]+)/) || [])[1] };
}
function matchesQ(r, q) {
  return q.split(' and ').every(c => {
    c = c.trim(); let m;
    const un = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if ((m = c.match(/^name = '((?:[^'\\]|\\.)*)'$/))) return r.name === un(m[1]);
    if ((m = c.match(/^'((?:[^'\\]|\\.)*)' in parents$/))) return r.parent === un(m[1]);
    if ((m = c.match(/^mimeType = '(.*)'$/))) return (r.kind === 'folder' ? FOLDER : r.mime) === m[1];
    if ((m = c.match(/^mimeType != '(.*)'$/))) return (r.kind === 'folder' ? FOLDER : r.mime) !== m[1];
    if (c === 'trashed = false') return !r.trashed;
    throw new Error('fake Drive: unsupported query clause ' + c);
  });
}
const sheets = {};  // ssid -> { getSheetByName(name) -> { sheetId, data: [[...]] } }
function mkSpreadsheet(title, names) {
  const id = nid('ss');
  const ss = { id, title, tabs: {}, getSheetByName(n) { return this.tabs[n] || null; } };
  (names || ['Sheet1']).forEach((n, i) => { ss.tabs[n] = { sheetId: i, data: [] }; });
  sheets[id] = ss;
  mkRecord('file', title, 'root', { id, mime: GSHEET });
  return ss;
}
function parseRange(enc) {
  const r = decodeURIComponent(enc);
  const m = r.match(/^'((?:[^']|'')*)'!A(\d+)?/);
  return { name: m[1].replace(/''/g, "'"), row: m[2] ? Number(m[2]) : 1 };
}
function fakeGoogle(u, p) {
  const method = (p.method || 'get').toLowerCase();
  if (!/^Bearer /.test((p.headers || {}).Authorization || '')) return resp(401, { error: { message: 'no token' } });
  // ----- Drive -----
  if (u.host === 'www.googleapis.com' && u.pathname === '/upload/drive/v3/files' && u.searchParams.get('uploadType') === 'resumable') {
    calls.upload++; const meta = JSON.parse(p.payload); pendingUpload = meta; return resp(200, '', { Location: 'https://upload.example.com/session1' });
  }
  if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/upload/drive/v3/files')) {
    const mp = parseMultipart(p.payload, p.contentType);
    const id = u.pathname.split('/')[5];
    if (id) { const r = items[id]; if (!r) return resp(404, {}); r.text = mp.media; if (mp.meta.name) r.name = mp.meta.name; r.uploads = (r.uploads || 0) + 1; return resp(200, { id }); }
    const isDoc = mp.meta.mimeType === GDOC;
    const r = mkRecord('file', mp.meta.name, (mp.meta.parents || ['root'])[0], { mime: isDoc ? GDOC : (mp.mediaType || 'application/octet-stream'), text: mp.media, size: mp.media.length });
    return resp(200, apiFile(r));
  }
  if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/drive/v3/files')) {
    const seg = u.pathname.split('/');
    const id = seg[4] ? decodeURIComponent(seg[4]) : '';
    if (!id && method === 'get') {
      const q = u.searchParams.get('q');
      return resp(200, { files: Object.values(items).filter(r => r.id !== 'root' && matchesQ(r, q)).map(apiFile) });
    }
    if (!id && method === 'post') {
      const meta = JSON.parse(p.payload);
      const r = mkRecord(meta.mimeType === FOLDER ? 'folder' : 'file', meta.name, (meta.parents || ['root'])[0], { desc: meta.description || '' });
      return resp(200, apiFile(r));
    }
    const r = items[id];
    if (!r) return resp(404, { error: { message: 'File not found' } });
    if (seg[5] === 'export') { const mime = u.searchParams.get('mimeType'); return resp(200, mime === 'text/plain' ? r.text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') : r.text); }
    if (method === 'get' && u.searchParams.get('alt') === 'media') return resp(200, r.text || '');
    if (method === 'get') return resp(200, apiFile(r));
    if (method === 'patch') {
      const meta = JSON.parse(p.payload || '{}');
      if (meta.name) r.name = meta.name;
      if (meta.description !== undefined) r.desc = meta.description;
      if (meta.trashed !== undefined) r.trashed = meta.trashed;
      if (u.searchParams.get('addParents')) r.parent = u.searchParams.get('addParents');
      return resp(200, { id: r.id });
    }
  }
  // ----- Sheets -----
  if (u.host === 'sheets.googleapis.com') {
    const path = decodeURIComponent(u.pathname);
    if (path === '/v4/spreadsheets' && method === 'post') {
      const b = JSON.parse(p.payload);
      const ss = mkSpreadsheet(b.properties.title, (b.sheets || []).map(x => x.properties.title));
      return resp(200, { spreadsheetId: ss.id, sheets: Object.keys(ss.tabs).map(n => ({ properties: { title: n, sheetId: ss.tabs[n].sheetId } })) });
    }
    const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    const ss = sheets[m[1]];
    if (!ss) return resp(404, { error: { message: 'no spreadsheet' } });
    const rest = m[2];
    if (rest === '' && method === 'get') return resp(200, { sheets: Object.keys(ss.tabs).map(n => ({ properties: { title: n, sheetId: ss.tabs[n].sheetId } })) });
    if (rest === ':batchUpdate') {
      const replies = JSON.parse(p.payload).requests.map(rq => {
        if (rq.addSheet) { const n = rq.addSheet.properties.title; ss.tabs[n] = { sheetId: Object.keys(ss.tabs).length + 100, data: [] }; return { addSheet: { properties: { title: n, sheetId: ss.tabs[n].sheetId } } }; }
        if (rq.deleteDimension) { const t = Object.values(ss.tabs).find(x => x.sheetId === rq.deleteDimension.range.sheetId); t.data.splice(rq.deleteDimension.range.startIndex, rq.deleteDimension.range.endIndex - rq.deleteDimension.range.startIndex); return {}; }
        return {};
      });
      return resp(200, { replies });
    }
    if (rest === '/values:batchGet') {
      const ranges = u.search.slice(1).split('&').filter(x => x.startsWith('ranges=')).map(x => parseRange(x.slice(7)));
      return resp(200, { valueRanges: ranges.map(r => ({ values: (ss.tabs[r.name] || { data: [] }).data.map(x => x.slice()) })) });
    }
    if (rest === '/values:batchUpdate') {
      JSON.parse(p.payload).data.forEach(d => { const r = parseRange(encodeURIComponent(d.range)); ss.tabs[r.name].data[r.row - 1] = d.values[0].slice(); });
      return resp(200, {});
    }
    const vm2 = rest.match(/^\/values\/([^:]+)(:append)?$/);
    if (vm2) {
      if (u.searchParams.get('valueInputOption') !== 'RAW') throw new Error('values must be written RAW');
      const r = parseRange(encodeURIComponent(decodeURIComponent(vm2[1])));
      const tab = ss.tabs[r.name];
      const row = JSON.parse(p.payload).values[0].slice();
      if (vm2[2]) { tab.data.push(row); const n = tab.data.length; return resp(200, { updates: { updatedRange: "'" + r.name + "'!A" + n + ':Z' + n } }); }
      tab.data[r.row - 1] = row;
      return resp(200, {});
    }
  }
  return null;
}
let pendingUpload = null;
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
    getBlob: () => ({ name: '', type: '', setName(n) { this.name = n; return this; }, setContentType(t) { this.type = t; return this; }, getName() { return this.name; }, getContentType() { return this.type; }, getBytes: () => Array.from(Buffer.from('AUDIO')) }),
    getContent: () => (typeof body === 'string' ? Array.from(Buffer.from(body)) : [1, 2, 3]) };
}
const UrlFetchApp = {
  fetch(url, p) {
    p = p || {};
    const u = new URL(url);
    if (u.host === 'www.googleapis.com' || u.host === 'sheets.googleapis.com') { const g = fakeGoogle(u, p); if (g) return g; throw new Error('fake Google: unhandled ' + (p.method || 'get') + ' ' + url); }
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
      if ((m = path.match(/^\/public\/recordings\/(\w+)\/audio-url$/))) { calls.audio++; return resp(200, { success: true, data: { signed_url: 'https://pocket-audio.s3.amazonaws.com/' + m[1] + '.m4a?sig=1', expires_in: 3600 } }, H); }
      if ((m = path.match(/^\/public\/recordings\/(\w+)$/))) { calls.detail++; return resp(200, { success: true, data: recordings.find(r => r.id === m[1]) }, H); }
      if (path === '/public/folders') return resp(200, { success: true, data: [{ id: 'fw', name: 'Work', kind: 'space', children: [{ id: 'fc', name: 'Clients', kind: 'folder', children: [] }] }] });
      if (path === '/public/recordings/upload-url') { const b = JSON.parse(p.payload); uploadReqs.push(b); return resp(200, { success: true, data: { upload_url: 'https://pocket-upload.s3.us-east-1.amazonaws.com/x?sig=1', recording_id: 'rup1' } }); }
      if (path === '/public/search') return resp(200, { success: true, data: [{ recording_id: 'r1', text: 'beta on 4 nov', score: 0.9 }] });
      return resp(404, { success: false, error: 'not found' });
    }
    if (u.host === 'pocket-audio.s3.amazonaws.com') {
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
      const auth = (p.headers || {}).Authorization || '';
      gh.lastAuth = auth;
      if (gh.validToken && auth && auth !== 'Bearer ' + gh.validToken) return resp(401, { message: 'Bad credentials' });
      if (gh.rateLimited && !auth) return resp(403, { message: 'API rate limit exceeded' }, { 'X-RateLimit-Reset': '1793300000' });
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
      if (gh.apiOff === 'project') return resp(403, { error: { message: 'Apps Script API has not been used in project 259618256529 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/script.googleapis.com/overview?project=259618256529 then retry.', status: 'PERMISSION_DENIED' } });
      if (gh.apiOff) return resp(403, { error: { message: 'User has not enabled the Apps Script API.' } });
      if (path === '/content' && m === 'get') return resp(200, { files: JSON.parse(JSON.stringify(gh.files)) });
      if (path === '/content' && m === 'put') { gh.files = JSON.parse(p.payload).files; gh.puts.push(JSON.parse(JSON.stringify(gh.files))); return resp(200, {}); }
      if (path === '/versions') { gh.v++; gh.versionManifests[gh.v] = gh.files.find(f => f.name === 'appsscript').source; return resp(200, { versionNumber: gh.v }); }
      if (path === '/deployments' && m === 'get') return resp(200, { deployments: gh.deployments });
      const dm = path.match(/^\/deployments\/(\w+)$/);
      if (dm) { const d = gh.deployments.find(x => x.deploymentId === dm[1]); d.deploymentConfig.versionNumber = JSON.parse(p.payload).deploymentConfig.versionNumber; return resp(200, d); }
      return resp(404, {});
    }
    if (u.host === 'pocket-upload.s3.us-east-1.amazonaws.com') { uploads.push({ url, ct: p.contentType, method: p.method }); return resp(200, ''); }
    if (u.host === 'upload.example.com') {
      if (ctxGlobals.__slowUpload) clockOffset += 40000;
      const range = p.headers['Content-Range']; const [, e, t] = range.match(/(\d+)\/(\d+)/) ? range.match(/-(\d+)\/(\d+)/) : [];
      if (Number(e) + 1 < Number(t)) return resp(308, '');
      const f = mkRecord('file', pendingUpload.name, pendingUpload.parents[0], { mime: 'audio/mp4' }); return resp(200, { id: f.id });
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
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + clockOffset); } static now() { return RealDate.now() + clockOffset; } }
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
    base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')),
    newBlob: (x) => ({ bytes: typeof x === 'string' ? Array.from(Buffer.from(x, 'utf8')) : (x || []), setDataFromString(str) { this.bytes = Array.from(Buffer.from(str, 'utf8')); return this; },
      getBytes() { return this.bytes; }, getDataAsString() { return Buffer.from(this.bytes.map(b => b & 255)).toString('utf8'); } }),
    formatDate(d, tz, pat) {
      const f = (o) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, o)).format(d);
      return pat.replace(/yyyy|MMMM|MM|dd|d|HH|mm|EEEE|EEE/g, t => ({ yyyy: f({ year: 'numeric' }), MMMM: f({ month: 'long' }), MM: f({ month: '2-digit' }), dd: f({ day: '2-digit' }), d: f({ day: 'numeric' }),
        HH: f({ hour: '2-digit', hourCycle: 'h23' }), mm: f({ minute: '2-digit' }).padStart(2, '0'), EEEE: f({ weekday: 'long' }), EEE: f({ weekday: 'short' }) })[t]);
    }
  },
  LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => triggers.map(fn => ({ getHandlerFunction: () => fn })), deleteTrigger: (t) => { const i = triggers.indexOf(t.getHandlerFunction()); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: trig, getScriptId: () => 'SCRIPT1', WeekDay: { SUNDAY: 'SUN', MONDAY: 'MON' }, getOAuthToken: () => 'tok', getService: () => ({ getUrl: () => 'https://script/exec' }) },
  UrlFetchApp, Tasks,   // no DriveApp/DocumentApp/SpreadsheetApp/CalendarApp: the script must not use them
  MailApp: { sendEmail: (o) => { log.push('MAIL ' + o.subject); ctxGlobals.__mail = o; } },
  HtmlService: { createHtmlOutput: (h) => chain({ html: h }) }, ContentService: { createTextOutput: (t) => t },
  Logger: { log: (m) => log.push(m) }
};
// Expose the fake Google services as globals, then load the script as an ordinary module (no eval / vm).
['PropertiesService', 'Session', 'Utilities', 'LockService', 'ScriptApp', 'UrlFetchApp', 'Tasks', 'MailApp', 'HtmlService', 'ContentService', 'Logger']
  .forEach(k => { global[k] = ctxGlobals[k]; });
global.Date = FakeDate;
ctxGlobals.__api = require(SCRIPT_PATH);
module.exports = { SCRIPT_PATH, gh, scriptCalls, mkFile, aiCalls, uploads, uploadReqs, G: ctxGlobals, items, sheets, GDOC, taskStore, mcpCalls, calls, triggers, log, store, recordings };

const assert = require('assert');
const H = require('./harness.js');
const A = H.G.__api;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); };

console.log('setup');
const msg = A.setup();
ok(/set up/.test(msg), 'setup returns message');
ok(H.triggers.includes('scheduledSync') && H.triggers.includes('dailyDigest'), 'triggers installed');

console.log('state before key');
let st = A.api('state');
ok(st.configured === false, 'not configured');

console.log('save key + test');
st = A.api('saveSettings', { apiKey: 'pk_user_test', cfg: { myNames: 'Me' } });
ok(st.configured, 'configured after save');
const t = A.api('testConnection', {});
ok(t.rest && t.mcp && t.account.plan === 'pro', 'test connection REST + MCP');

console.log('preview');
const pv = A.api('preview');
ok(pv.length === 5, 'preview lists 5');
ok(pv.find(r => r.id === 'r2').category === 'Personal', 'tag Family → Personal');

console.log('sync #1');
const r = A.api('sync');
console.log('   ', JSON.stringify(r));
ok(r.ok, 'sync ok');
ok(r.created === 4, '4 created (r4 too fresh)');
ok(H.calls.upload === 1, 'big audio used resumable upload');
const ss = Object.values(H.sheets)[0];
const conv = ss.getSheetByName('Conversations').data;
ok(conv.length === 5, 'header + 4 rows');
const r1 = conv.find(x => x[0] === 'r1');
ok(r1[9] === 'Priya Raman', 'self excluded from people: ' + r1[9]);
ok(r1[7] === 'Unsorted', 'r1 unsorted (no folder map yet)');
const r5 = conv.find(x => x[0] === 'r5');
ok(r5[7] === 'Office' && r5[8] === 'keywords', 'r5 office by keywords');
const r3 = conv.find(x => x[0] === 'r3');
ok(r3[21] === 'partial', 'r3 partial (no summary)');
const todos = ss.getSheetByName('To-dos').data;
console.log('    todos:', todos.slice(1).map(x => x[1] + '|' + x[2] + '|' + x[3] + '|task=' + x[11]).join(' ; '));
ok(todos.length === 4, '3 todos');
ok(Object.keys(H.taskStore.tasks).length === 2, '2 Google Tasks created (done one skipped)');
const docNames = Object.values(H.items).filter(i => i.kind === 'file').map(i => i.name);
ok(docNames.some(n => /— Standup — with Priya Raman$/.test(n)), 'doc named with people');
ok(docNames.some(n => /Standup — with Priya Raman\.m4a$/.test(n)), 'audio named .m4a');
const mem = Object.values(H.items).filter(i => i.kind === 'folder' && i.name === '_Claude Memory')[0];
ok(mem && Object.values(H.items).filter(i => i.parent === mem.id).length >= 4, 'memory docs written');
// formula escape
const docTextAll = () => Object.values(H.items).filter(i => i.mime === H.GDOC).map(i => i.text.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&')).join('\n');
const docText = docTextAll();
ok(/Priya Raman: Morning. =SUM/.test(docText), 'transcript rendered');

console.log('sync #2 idempotent');
const r2 = A.api('sync');
ok(r2.processed === 0, 'nothing reprocessed: ' + r2.message);

console.log('review & classify');
let rv = A.api('review');
ok(rv.people.length === 3, 'unknown people: ' + rv.people.map(p => p.name).join(','));
const cp = A.api('classifyPerson', { key: 'priya raman', name: 'Priya Raman', category: 'Office' });
ok(cp.alsoFiled === 1, 'r1 auto-filed to Office');
const r1row = ss.getSheetByName('Conversations').data.find(x => x[0] === 'r1');
ok(r1row[7] === 'Office', 'r1 now Office');
const cc = A.api('classifyConversation', { id: 'r3', category: 'Personal', rememberPeople: true, addPeople: 'Sana K' });
ok(cc.ok, 'classify conversation');
rv = A.api('review');
ok(!rv.people.find(p => p.name === 'Sana'), 'Sana learned');

console.log('todos complete two-way');
const list = A.api('todos', { status: 'open' });
const tk = list.find(x => x.title === 'Book train tickets');
const done = A.api('completeTodo', { key: tk.key });
ok(done.pocket === 'yes', 'pushed completion to Pocket');
ok(H.mcpCalls.some(c => c.name === 'update_pocket_actionitem' && c.arguments.actionItemId === 'mcp_ai_9'), 'MCP update called with found id');
// tick in Google Tasks → next sync closes
const other = Object.values(H.taskStore.tasks).find(x => x.title === 'Escalate sandbox outage');
other.status = 'completed';
H.recordings[0].updated_at = new Date().toISOString(); // also force r1 refresh
const r3s = A.api('sync');
ok(r3s.updated === 1, 'updated r1 after updated_at change');
const tds = A.api('todos', { status: 'all' });
ok(tds.find(x => x.title === 'Escalate sandbox outage').status === 'done', 'Google Tasks completion pulled back');
ok(ss.getSheetByName('Conversations').data.find(x => x[0] === 'r1')[7] === 'Office', 'r1 stays Office on update');

console.log('search / ask / discover / conversations');
const s = A.api('search', { query: 'standup' });
ok(s.local.length >= 1 && s.pocket.length === 1 && s.pocket[0].docUrl, 'search local + pocket joined');
const ask = A.api('ask', { question: 'what?' });
ok(ask.answer === 'You discussed X' && ask.sources[0].title === 'Standup', 'ask works');
const disc = A.api('discover');
ok(disc.mcp.length === 1 && disc.rest.length === 13, 'discover');
const cv = A.api('conversations', { category: 'Office' });
ok(cv.total === 2, 'filter office');
const st2 = A.api('state');
ok(st2.stats.conversations === 4 && st2.recent.length === 4, 'state stats');

console.log('webhook + digest');
const wh = A.doPost({ parameter: { token: JSON.parse(H.store.cfg).webhookToken }, postData: { contents: JSON.stringify({ event: 'summary.completed', recording: { id: 'r4' } }) } });
ok(wh === 'ok' && H.triggers.includes('webhookSync'), 'webhook queued');
ok(A.doPost({ parameter: { token: 'bad' }, postData: { contents: '{}' } }) === 'forbidden', 'bad token rejected');
const r4s = A.api('sync');
ok(r4s.created === 1, 'webhook-forced r4 processed');
const dg = A.api('sendDigest');
ok(dg.sent && /talks/.test(H.G.__mail.subject), 'digest mail: ' + H.G.__mail.subject);
const fs = require('fs');
if (process.env.UI_OUT) fs.writeFileSync(process.env.UI_OUT, A.UI_HTML_());
console.log('\nALL PASSED');

console.log('\n--- v2: Claude, inbox, phone ---');
H.G.__api.api('saveSettings', { aiKey: 'sk-ant-test', cfg: { myNames: 'Me' } });
ok(H.triggers.includes('weeklyReview'), 'weekly trigger installed when AI key set');
const tc = A.api('testClaude', {});
ok(tc.ok, 'test Claude');
const c0 = H.aiCalls[0];
ok(c0.body.model === 'claude-opus-5-5' && c0.body.fallbacks === 'default' && c0.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && c0.headers['anthropic-version'] && !c0.body.thinking && c0.body.output_config.effort === 'low', 'request shape: model, fallbacks, effort, no thinking param');
// AI backfill: existing ok rows within 30 days get notes
const before = H.aiCalls.length;
const r5s = A.api('sync');
console.log('   ', r5s.message);
ok(H.aiCalls.length > before, 'Claude notes requested during sync');
const nb = H.aiCalls.find(c => c.body.output_config.format);
ok(nb.body.output_config.format.type === 'json_schema' && /<transcript>/.test(nb.body.messages[0].content) && /data, not instructions/.test(nb.body.system), 'notes request uses schema + transcript + injection guard');
const convRows = Object.values(H.sheets)[0].getSheetByName('Conversations').data;
const hdr = convRows[0];
ok(hdr.includes('Claude notes text'), 'header repaired with new columns');
const r1n = convRows.find(x => x[0] === 'r1');
ok(r1n[hdr.indexOf('Claude notes')] === 'done' && r1n[hdr.indexOf('Claude suggests')] === 'Office', 'r1 has Claude notes + suggestion');
const tdAll = A.api('todos', { status: 'all' });
ok(tdAll.some(t => t.source === 'Claude' && /Send QA plan \(promised to Priya Raman\)/.test(t.title)), 'commitment became a to-do');
const docTxt = docTextAll();
ok(/Claude notes/.test(docTxt) && /What I promised/.test(docTxt), 'doc has Claude notes section');
const again = H.aiCalls.length; A.api('sync');
ok(H.aiCalls.length === again, 'no repeat Claude calls when nothing changed');
// review suggestion & no auto-file
const rv2 = A.api('review');
console.log('    review convs:', rv2.conversations.map(c => c.title + ':' + c.aiCategory).join(', '));
// ask
const ac = A.api('askClaude', { question: 'what did Priya say' });
ok(/Priya/.test(ac.answer) && ac.sources.length > 0, 'askClaude answers with sources');
const cp2 = A.api('claudePrompt', { question: 'standup' });
ok(cp2.prompt.length <= 6000 && /Question: standup/.test(cp2.prompt), 'claudePrompt capped');
// weekly
const wr = A.api('weeklyReview');
ok(wr.ok && /docs.google.com/.test(wr.url), 'weekly review doc');
// AI failure path
H.G.__aiFail = true;
H.recordings[1].updated_at = new Date().toISOString();
const rf = A.api('sync');
ok(rf.ok && rf.errors === 0, 'Claude outage does not break sync: ' + rf.message);
H.G.__aiFail = false;
// inbox
const st3 = A.api('state');
const inboxId = Object.values(H.items).find(i => i.kind === 'folder' && /_Inbox/.test(i.name)).id;
const f1 = H.mkFile('20261020_143000.m4a', inboxId); f1.mime = 'audio/x-m4a'; f1.size = 5e6;
const f2 = H.mkFile('huge zoom.mp4', inboxId); f2.mime = 'video/mp4'; f2.size = 300e6;
const f3 = H.mkFile('notes.pdf', inboxId); f3.mime = 'application/pdf';
const ri = A.api('sync');
console.log('   ', ri.message);
ok(H.uploadReqs.length === 1 && H.uploadReqs[0].recording_at === '2026-10-20T09:00:00.000Z' && H.uploadReqs[0].content_type === 'audio/mp4', 'upload-url called with parsed date + content type');
ok(H.uploads.length === 1 && H.uploads[0].method === 'put', 'audio PUT to signed URL');
ok(H.items[H.items[f1.id].parent].name === 'Sent to Pocket', 'moved to Sent');
ok(/Too large/.test(H.items[H.items[f2.id].parent].name), 'large file set aside');
ok(H.items[H.items[f3.id].parent].name === 'Not audio', 'non-audio set aside');
// phone
const tok = JSON.parse(H.store.cfg).webhookToken;
const ph = (q) => A.doPost({ parameter: Object.assign({ token: tok }, q), postData: { contents: '{}' } });
ok(/^Added: Call the bank/.test(ph({ action: 'todo', text: 'Call the bank' })), 'phone todo');
ok(/conversations today/.test(ph({ action: 'status' })), 'phone status: ' + ph({ action: 'status' }));
ok(/Priya/.test(A.doPost({ parameter: { token: tok }, postData: { contents: JSON.stringify({ action: 'ask', q: 'standup?' }) } })), 'phone ask via JSON body');
ok(/Sync starts/.test(ph({ action: 'sync' })), 'phone sync');
ok(A.doPost({ parameter: { token: 'nope', action: 'ask' }, postData: { contents: '{}' } }) === 'forbidden', 'phone bad token');
console.log('\nALL V2 PASSED');

console.log('\n--- v3: send-to, offline import, long recordings ---');
// transcript gap flag
H.recordings.push({ id: 'r9', title: 'All-day workshop', state: 'completed', duration: 4 * 3600, recording_at: new Date(Date.now() - 864e5).toISOString(), created_at: new Date(Date.now() - 864e5).toISOString(), updated_at: new Date(Date.now() - 86e6).toISOString(), tags: [], speakers: {},
  transcript: { segments: [{ start: 0, end: 7200, speaker: 'SPEAKER_00', speakerName: 'Priya Raman', text: 'Long day.' }] }, summarizations: { s: { v2: { summary: { markdown: 'Workshop' } } } } });
H.G.__slowUpload = true;
const l1 = A.api('sync');
console.log('   ', l1.message);
const up1 = JSON.parse(H.store['st_upload_r9'] || 'null');
ok(up1 && up1.next > 0 && up1.next < up1.total, 'long audio partially uploaded and progress saved: ' + (up1 && Math.round(100 * up1.next / up1.total)) + '%');
const rowR9 = () => Object.values(H.sheets)[0].getSheetByName('Conversations').data.find(x => x[0] === 'r9');
const hdr9 = Object.values(H.sheets)[0].getSheetByName('Conversations').data[0];
ok(rowR9()[hdr9.indexOf('Audio tries')] === '0' || rowR9()[hdr9.indexOf('Audio tries')] === 0, 'resume does not count as a failed try');
let guard = 0;
while (H.store['st_upload_r9'] && H.store['st_upload_r9'] !== 'null' && guard++ < 20) { H.G.advance(16 * 60000); A.api('sync'); }
ok(rowR9()[hdr9.indexOf('Audio ID')], 'long audio finished across ' + (guard + 1) + ' runs');
H.G.__slowUpload = false;
const c9 = A.api('conversations', { q: 'workshop' }).rows[0];
ok(c9.transcriptEnd === 7200 && c9.durationMin === 240, 'transcript gap exposed to UI');
// send-to prompt
const pf = A.api('promptFor', { id: 'r1', kind: 'notes' });
ok(/<conversation>/.test(pf.prompt) && /Priya Raman: Morning/.test(pf.prompt) && /Decisions/.test(pf.prompt) && pf.shortPrompt, 'notes prompt includes template + transcript');
ok(/Answer this question about the conversation: who\?/.test(A.api('promptFor', { id: 'r1', kind: 'ask', question: 'who?' }).prompt), 'ask prompt');
ok(/weekly review/.test(A.api('promptFor', { kind: 'week' }).prompt), 'week prompt');
// paste back
const sr = A.api('saveResult', { id: 'r1', kind: 'notes', app: 'chatgpt', text: '## Decisions\n- **Ship** beta', rating: 3 });
ok(sr.ok && sr.ratings.chatgpt.count === 1, 'saved + rated');
const r1doc = Object.values(H.items).find(i => i.mime === H.GDOC && /Standup/.test(i.name));
const iNotes = r1doc.text.indexOf('Notes — from ChatGPT'), iTr = r1doc.text.indexOf('>Transcript<');
ok(iNotes > 0 && iNotes < iTr, 'pasted notes inserted before transcript');
ok(A.api('conversation', { id: 'r1' }).conv.hasExtNotes, 'ext notes stored');
ok(/Ship/.test(A.api('claudePrompt', { question: 'ship beta' }).prompt), 'Ask includes pasted notes');
A.api('saveResult', { kind: 'week', app: 'gemini', text: '## Highlights\n- x', rating: 2 });
ok(A.api('state').appRatings.gemini.count === 1, 'week result saved and rated');
// offline import
const inbox2 = Object.values(H.items).find(i => i.kind === 'folder' && /_Inbox/.test(i.name)).id;
const srt = H.mkFile('2026-10-22 0915 Dentist.srt', inbox2); srt.text = '1\n00:00:01,000 --> 00:00:04,000\nDr. Mehta: Open wide please.\n\n2\n00:00:05,000 --> 00:12:00,500\nMe: Sure.\n';
const srtAudio = H.mkFile('2026-10-22 0915 Dentist.m4a', inbox2); srtAudio.mime = 'audio/mp4';
const vtt = H.mkFile('call.vtt', inbox2); vtt.text = 'WEBVTT\n\n00:00.000 --> 00:03.000\n<v Anita>Hello there</v>\n';
const txt = H.mkFile('20261023_200000 dinner.txt', inbox2); txt.text = '[00:00:05] Arjun: Flight lands at 6.\nMom: Great.\nplain line';
const beforeUp = H.uploadReqs.length;
const ri2 = A.api('sync');
console.log('   ', ri2.message);
ok(H.uploadReqs.length === beforeUp, 'paired audio not sent to Pocket');
const imp = A.api('conversations', { q: 'Dentist' }).rows[0];
ok(imp && imp.source === 'imported' && imp.date === '2026-10-22' && imp.time === '09:15' && imp.people === 'Dr. Mehta' && imp.durationMin === 12 && imp.audioUrl, 'SRT imported with date, speaker, duration, audio: ' + JSON.stringify(imp && [imp.date, imp.time, imp.people, imp.durationMin]));
const v = A.api('conversations', { q: 'call' }).rows.find(r => r.source === 'imported');
ok(v && v.people === 'Anita', 'VTT speaker parsed');
const t3 = A.api('conversations', { q: 'dinner' }).rows[0];
ok(t3 && /Arjun/.test(t3.people) && t3.date === '2026-10-23', 'TXT parsed: ' + (t3 && t3.people));
// keep mode
A.api('saveSettings', { cfg: { inboxAudio: 'keep' } });
const memo = H.mkFile('Voice memo 2026-10-24 08.30.m4a', inbox2); memo.mime = 'audio/x-m4a';
A.api('sync');
ok(H.uploadReqs.length === beforeUp && A.api('conversations', { q: 'Voice memo' }).total === 1, 'keep mode archives audio without Pocket');
console.log('\nALL V3 PASSED');

console.log('\n--- v4: auto-update with integrity checks, token hardening ---');
const src = fs.readFileSync(H.SCRIPT_PATH, 'utf8');
const gh = H.gh;
const SHA = (c) => c.repeat(40);
gh.files[0].source = src.replace("const APP_VERSION = '2.0.0';", "const APP_VERSION = '0.9.0';");
gh.file = src;
const chk = A.api('checkUpdate', {});
ok(chk.latest === SHA('a') && !chk.upToDate && !chk.applied, 'check only: update available, nothing installed');
ok(H.triggers.includes('autoUpdate'), 'autoUpdate trigger installed');
const blk0 = A.api('checkUpdate', { install: true });
ok(blk0.blocked && gh.files[0].source !== src, 'unsigned commit blocked by default');
gh.head.commit.verification.verified = true;
const ins = A.api('checkUpdate', { install: true });
console.log('   ', ins.message);
ok(ins.applied && gh.files[0].source === src, 'verified commit with matching SHA-256 installed');
ok(gh.deployments.find(d => d.deploymentId === 'DASH').deploymentConfig.versionNumber === 4 && gh.deployments.find(d => d.deploymentId === 'PHONE').deploymentConfig.versionNumber === 5, 'each deployment moved to its own new version');
ok(/"access": "MYSELF"/.test(gh.versionManifests[4]) && /"access": "ANYONE_ANONYMOUS"/.test(gh.versionManifests[5]) && /Asia\/Kolkata/.test(gh.versionManifests[4]), 'access settings + time zone preserved per deployment');
ok(gh.deployments.find(d => d.deploymentId === 'HEADDEP').deploymentConfig.versionNumber === undefined, 'HEAD deployment untouched');
const bk = Object.values(H.items).find(i => i.kind === 'folder' && i.name === 'Code backups');
ok(bk && Object.values(H.items).some(i => i.parent === bk.id && i.text && /0\.9\.0/.test(i.text)), 'previous code backed up to Drive');
ok(A.api('checkUpdate', {}).upToDate, 'up to date after install');
let threw = '';
// tampered download: served file differs from the one release.json describes
gh.head.sha = SHA('b'); gh.file = src.replace("'2.0.0'", "'2.0.1'"); gh.served = gh.file.replace('function setup()', 'function setup() { stealEverything(); ');
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/Integrity check failed/.test(threw) && gh.files[0].source === src, 'tampered code refused (SHA-256 mismatch)');
delete gh.served;
gh.release = 'not json';
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/No valid release.json/.test(threw), 'missing/invalid release.json refused');
gh.release = JSON.stringify({ file: 'other.js', sha256: 'x' });
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/malformed/.test(threw), 'malformed release.json refused');
delete gh.release;
gh.file = '<html>404</html>';
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/does not look like Pocket Life OS/.test(threw) && gh.files[0].source === src, 'non-script file refused even with matching hash');
gh.file = src.slice(0, src.length - 500);
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/truncated/.test(threw), 'truncated download refused');
gh.head.sha = 'not-a-sha';
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/Unexpected commit id/.test(threw), 'malformed commit id refused');
gh.head.sha = SHA('c'); gh.file = src.replace("'2.0.0'", "'2.0.1'");
ok(A.api('checkUpdate', { install: true }).applied, 'next verified update installs');
// rollback
const rb = A.api('rollback');
ok(rb.applied && gh.files[0].source === src, 'rollback restores the previous code');
// API switched off
gh.apiOff = true; gh.head.sha = SHA('d'); gh.file = src.replace("'2.0.0'", "'2.0.2'");
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/script.google.com\/home\/usersettings/.test(threw), 'clear instructions when Apps Script API is off');
gh.apiOff = false;
// Cloud project with the Apps Script API off (Google's hidden default project)
gh.apiOff = 'project';
threw = ''; try { A.api('checkUpdate', { install: true }); } catch (e) { threw = e.message; }
ok(/standard Cloud project/.test(threw) && !/console\.developers/.test(threw), 'clear instructions when the Cloud project has the API off: ' + threw);
gh.apiOff = false;
// GitHub rate limit for anonymous calls, then a read-only token
gh.rateLimited = true;
threw = ''; try { A.api('checkUpdate', {}); } catch (e) { threw = e.message; }
ok(/read-only GitHub token/.test(threw) && /Try again after \d\d:\d\d/.test(threw), 'rate limit explained: ' + threw);
threw = ''; try { A.api('saveSettings', { githubToken: 'not a token' }); } catch (e) { threw = e.message; }
ok(/does not look like a GitHub token/.test(threw) && !H.store.githubToken, 'malformed token refused');
gh.validToken = 'github_pat_' + 'A1'.repeat(20);
ok(A.api('saveSettings', { githubToken: gh.validToken }).update.hasToken, 'token saved');
ok(A.api('checkUpdate', {}).latest && gh.lastAuth === 'Bearer ' + gh.validToken, 'token sent and rate limit avoided');
ok(!/github_pat_/.test(JSON.stringify(A.api('state'))), 'token never sent back to the dashboard');
gh.validToken = 'github_pat_' + 'B2'.repeat(20);
threw = ''; try { A.api('checkUpdate', {}); } catch (e) { threw = e.message; }
ok(/did not accept the saved GitHub token/.test(threw), 'rejected token explained');
ok(!A.api('saveSettings', { clearGithubToken: true }).update.hasToken, 'token removed');
gh.rateLimited = false; delete gh.validToken;
// token in body + constant-time compare
const tk2 = JSON.parse(H.store.cfg).webhookToken;
ok(/conversations today/.test(A.doPost({ parameter: {}, postData: { contents: JSON.stringify({ token: tk2, action: 'status' }) } })), 'token accepted in JSON body');
ok(A.doPost({ parameter: {}, postData: { contents: JSON.stringify({ token: tk2.slice(0, -1) + 'x', action: 'status' }) } }) === 'forbidden', 'near-miss token rejected');
ok(A.doPost({ parameter: {}, postData: { contents: '{}' } }) === 'forbidden', 'missing token rejected');
console.log('\nALL V4 PASSED');

console.log('\n--- v5: input validation on the phone/webhook endpoint ---');
const tk5 = JSON.parse(H.store.cfg).webhookToken;
const post5 = (b) => A.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ token: tk5 }, b)) } });
ok(/Unknown action/.test(post5({ action: 'deleteEverything' })), 'unknown action rejected');
const r5a = post5({ action: 'todo', text: 'Pay rent\u0007\u0000', due: '2026-02-31', category: '=HYPERLINK("x")' });
const t5 = A.api('todos', { status: 'all' }).find(t => /^Pay rent/.test(t.title));
ok(t5 && t5.title === 'Pay rent' && t5.category === 'Unsorted' && t5.due !== '2026-02-31', 'control chars stripped, bad category/date replaced: ' + JSON.stringify(t5 && [t5.title, t5.category, t5.due]));
post5({ action: 'todo', text: 'x'.repeat(5000), due: '2026-11-02', category: 'Office' });
const t5b = A.api('todos', { status: 'all' }).find(t => /^xxx/.test(t.title));
ok(t5b.title.length === 500 && t5b.due === '2026-11-02' && t5b.category === 'Office', 'long text capped, valid date/category kept');
ok(/Say what/.test(post5({ action: 'todo', text: { evil: 1 } })), 'non-string text rejected');
const qBefore = JSON.stringify(H.store.st_webhookQueue || '[]');
post5({ event: 'summary.completed', recording: { id: '../../etc' } });
post5({ event: 'not.an.event', recording: { id: 'r1' } });
ok(JSON.stringify(H.store.st_webhookQueue || '[]') === qBefore, 'bad recording id / unknown event ignored');
post5({ event: 'summary.completed', recording: { id: 'r2' } });
ok(/r2/.test(H.store.st_webhookQueue), 'valid webhook queued');
console.log('\nALL V5 PASSED');

console.log('\n--- v6: SSRF guard on media URLs ---');
const amu = (u) => { try { return vm6(u); } catch (e) { return 'ERR ' + e.message; } };
const vm6 = (u) => A.assertMediaUrl_(u);
ok(amu('https://bucket.s3.amazonaws.com/a.m4a?X-Amz-Signature=1') === 'https://bucket.s3.amazonaws.com/a.m4a?X-Amz-Signature=1', 'S3 signed URL allowed');
ok(amu('https://d1.cloudfront.net/a.m4a') === 'https://d1.cloudfront.net/a.m4a', 'CloudFront allowed');
ok(/^ERR/.test(amu('http://bucket.s3.amazonaws.com/a')), 'plain http refused');
ok(/^ERR/.test(amu('https://169.254.169.254/latest/meta-data')), 'metadata IP refused');
ok(/^ERR/.test(amu('https://evil.com/amazonaws.com/a')), 'look-alike path refused');
ok(/^ERR/.test(amu('https://amazonaws.com.evil.com/a')), 'look-alike host refused');
ok(/^ERR/.test(amu('https://user@evil.com/a')), 'userinfo trick refused');
ok(/^ERR/.test(amu('https://evilamazonaws.com/a')), 'suffix without dot refused');
console.log('\nALL V6 PASSED');


console.log('\n--- v7: drive.file only, dashboard upload ---');
const scriptSrc = fs.readFileSync(H.SCRIPT_PATH, 'utf8').split('function UI_HTML_')[0];
ok(!/\b(DriveApp|DocumentApp|SpreadsheetApp|CalendarApp)\./.test(scriptSrc), 'script never uses DriveApp/DocumentApp/SpreadsheetApp/CalendarApp');
const manifest = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'appsscript.json'), 'utf8'));
ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.file') &&
   !manifest.oauthScopes.some(x => /auth\/(drive|documents|spreadsheets|calendar)$/.test(x)), 'manifest asks for drive.file only (no full Drive/Docs/Sheets/Calendar)');
// a file the user put in Drive themselves is invisible to the script
const foreign = H.mkFile('My private tax return.pdf', 'root'); foreign.mime = 'application/pdf';
const upBefore = H.uploadReqs.length;
const up = A.api('uploadToInbox', { name: 'Voice memo 2026-10-25 09.10.m4a', data: Buffer.from('AUDIO').toString('base64') });
ok(up.ok && up.size === 5, 'dashboard upload stored in the inbox');
let upErr = ''; try { A.api('uploadToInbox', { name: 'evil.exe', data: 'QUJD' }); } catch (e) { upErr = e.message; }
ok(/Choose an audio file/.test(upErr), 'non-audio upload refused');
upErr = ''; try { A.api('uploadToInbox', { name: 'a.m4a', data: 'not base64!' }); } catch (e) { upErr = e.message; }
ok(/could not be read/.test(upErr), 'malformed upload refused');
A.api('saveSettings', { cfg: { inboxAudio: 'pocket' } });
A.api('sync');
ok(H.uploadReqs.length === upBefore + 1 && /Voice memo 2026-10-25/.test(H.uploadReqs[H.uploadReqs.length - 1].file_name), 'uploaded memo sent to Pocket on next sync');
ok(foreign.parent === 'root' && !foreign.trashed && foreign.name === 'My private tax return.pdf', 'files outside Life OS untouched');
const convSheet = Object.values(H.sheets)[0].getSheetByName('Conversations').data;
ok(convSheet.every(r => r.every(c => typeof c === 'string')), 'index sheet written RAW (strings only)');
console.log('\nALL V7 PASSED');

console.log('\n--- v8: optional PIN lock, enforced on the server ---');
ok(A.api('pinStatus').enabled === false, 'no PIN by default');
ok(A.api('state').configured !== undefined, 'dashboard works without a PIN');
threw = ''; try { A.api('pinSet', { pin: '12a4' }); } catch (e) { threw = e.message; }
ok(/4 to 8 digits/.test(threw), 'PIN must be 4-8 digits');
const set8 = A.api('pinSet', { pin: '2468' });
ok(set8.ok && /^[0-9a-f]{64}$/.test(set8.token) && set8.status.enabled && set8.status.length === 4, 'PIN set, session token issued');
ok(!JSON.stringify(H.store).includes('"2468"') && !Object.values(H.store).includes('2468'), 'PIN itself never stored');
threw = ''; try { A.api('state'); } catch (e) { threw = e.message; }
ok(threw === 'LOCKED', 'actions refused without a session');
threw = ''; try { A.api('state', { _pin: 'f'.repeat(64) }); } catch (e) { threw = e.message; }
ok(threw === 'LOCKED', 'made-up token refused');
ok(A.api('state', { _pin: set8.token }).cfg, 'valid session works');
ok(A.api('pinStatus').enabled, 'status readable while locked');
threw = ''; try { A.api('pinUnlock', { pin: '1111' }); } catch (e) { threw = e.message; }
ok(threw === 'Wrong PIN', 'wrong PIN refused');
const un8 = A.api('pinUnlock', { pin: '2468' });
ok(/^[0-9a-f]{64}$/.test(un8.token) && A.api('todos', { status: 'open', _pin: un8.token }), 'right PIN unlocks');
for (let i = 0; i < 5; i++) { try { A.api('pinUnlock', { pin: '0000' }); } catch (e) { threw = e.message; } }
ok(/Locked for 5 min/.test(threw) && /wrong PIN/.test((H.G.__mail || {}).subject || ''), 'five wrong tries lock it and e-mail you: ' + threw);
threw = ''; try { A.api('pinUnlock', { pin: '2468' }); } catch (e) { threw = e.message; }
ok(/Try again in/.test(threw), 'even the right PIN waits out the lockout');
ok(A.api('pinStatus').lockedForSec > 0, 'status shows the lockout');
const lockState = JSON.parse(H.store.st_pinLock); lockState.until = 0; H.store.st_pinLock = JSON.stringify(lockState);
const un9 = A.api('pinUnlock', { pin: '2468' });
A.api('saveSettings', { cfg: { pinIdleMinutes: 15 }, _pin: un9.token });
ok(A.api('pinStatus').idleMinutes === 15, 'idle time saved');
A.api('saveSettings', { cfg: { pinIdleMinutes: 999 }, _pin: un9.token });
ok(A.api('pinStatus').idleMinutes === 5, 'odd idle time falls back to 5');
const sess = JSON.parse(H.store.st_pinSessions); sess.forEach(x => { x.exp = Date.now() - 1; }); H.store.st_pinSessions = JSON.stringify(sess);
threw = ''; try { A.api('state', { _pin: un9.token }); } catch (e) { threw = e.message; }
ok(threw === 'LOCKED', 'idle session expires');
const un10 = A.api('pinUnlock', { pin: '2468' });
A.api('pinLock', { _pin: un10.token });
threw = ''; try { A.api('state', { _pin: un10.token }); } catch (e) { threw = e.message; }
ok(threw === 'LOCKED', 'Lock now ends every session');
const un11 = A.api('pinUnlock', { pin: '2468' });
threw = ''; try { A.api('pinSet', { pin: '13579', current: '9999', _pin: un11.token }); } catch (e) { threw = e.message; }
ok(threw === 'Wrong PIN', 'changing the PIN needs the current one');
const ch = A.api('pinSet', { pin: '13579', current: '2468', _pin: un11.token });
ok(ch.status.length === 5, 'PIN changed');
A.resetPin();
ok(!A.api('pinStatus').enabled && A.api('state').cfg, 'resetPin from the editor removes it');
ok(H.log.some(l => /Life OS PIN removed/.test(l)), 'reset logged');
console.log('\nALL V8 PASSED');

# Pocket Life OS

One file — [`PocketLifeOS.js`](PocketLifeOS.js) — that runs inside your own Google account (Google Apps Script, free, no hosting) and turns your Pocket recorder into a personal archive:

- Every recording, summary, transcript, audio file and to-do → Google Drive, filed as
  `Life OS — Conversations/<Office|Personal|Unsorted>/YYYY/MM — Month/YYYY-MM-DD HH.MM — Title — with People`
- To-dos → Google Tasks (shows in Gmail and Calendar). Ticking one off there closes it in Pocket too.
- Learns who is Office and who is Personal. It asks you about new people until it knows them.
- `_Claude Memory` folder (Timeline, People directory, monthly Memory docs) so a Claude Project can answer "what did I discuss with whom, and when".
- Private dashboard for phone and laptop: Review, Conversations, To-dos, Ask, People, Settings, Playbook.
- Runs every 15 minutes in Google's cloud, so your laptop and phone can be off.
- **Least privilege**: Google gives the script `drive.file` access only. It can see and change the files and folders it creates, and nothing else in your Drive. There's no access to your other Docs, Sheets or Calendar.
- **Upload button**: any audio file (Zoom export, voice memo, USB copy from the device, up to 30 MB) or transcript can be uploaded from the dashboard. Audio is sent to Pocket for transcription and comes back filed.
- **Optional Claude API key** (replaces Pocket Pro): Claude notes from your own Office/Personal templates, a choice of Opus/Sonnet/Haiku, Ask across your whole archive, a weekly review, and the promises you made turned into to-dos.
- **No API keys needed**: every conversation has *Send to Claude / ChatGPT / Gemini / Gemini in Docs*. It copies the transcript and your template, then opens the app you already pay for. Paste the answer back, rate it, and pick your favourite.
- **Long recordings**: audio of any length is saved to Drive, resuming across runs. Conversations where Pocket's transcript stops early are flagged, with a *Transcribe the rest* action.
- **Offline import**: copy recordings off the device over USB-C (USB Mode), transcribe on-device with a Whisper app, and drop the `.srt`/`.vtt`/`.txt` (plus the audio, with the same name) into the inbox. It is filed without Pocket.
- **Phone shortcuts** (iPhone Shortcuts, Android HTTP Shortcuts): *Ask my memory*, *Add to-do*, *Status*, *Sync now*.

The dashboard's **Playbook** tab has a Pocket Pro comparison, the Claude Project setup and step-by-step phone shortcut recipes.

## Install (about 5 minutes, no command line)

1. Go to https://script.google.com → **New project**. Paste the whole of `PocketLifeOS.js` into the code file and save.
2. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace its contents with this repo's [`appsscript.json`](appsscript.json). Keep your own `timeZone` line. The manifest lists the only permissions the script gets:
   - `drive.file`: only the files it creates
   - Google Tasks
   - send mail to you
   - run on a schedule
   - call Pocket, GitHub and Claude
   - update itself (auto-update)
3. Turn on **Google Apps Script API** at https://script.google.com/home/usersettings. Auto-update needs it.
4. Choose `setup` → **Run**, then allow the permissions. Google warns because the script is yours and unpublished; that is expected.
5. **Deploy** → **New deployment** → **Web app**. Set Execute as: **Me** and Who has access: **Only myself**. Open the URL it gives you.
6. In the dashboard, open **Settings**, paste your Pocket API key (Pocket app → Settings → Developer), then run **Test** → **Preview** → **Sync now**.

## Updates

The script checks this repo's `main` branch every 6 hours and installs new commits on its own. Before installing, it checks four things. The commit must be signed and verified by GitHub (merges made on github.com are). The code is downloaded through GitHub's API at that exact commit. Its SHA-256 must match the commit's `release.json`, which CI checks on every change. And the file must be complete and recognisably Pocket Life OS. It backs up the old code to Drive (`_Life OS system/Code backups`), keeps every web-app URL and its access setting, and e-mails you. **Settings → Updates** has Check now, Install latest, Roll back, "ask me first" mode, and an option to install only signed, verified commits.

## Security

- **Where it runs:** the script runs as you, inside your Google account. The dashboard opens only for your Google login.
- **Drive access:** `drive.file` only. Drive, Docs and Sheets are used through their REST APIs so the script never needs access to all your files.
- **Secrets:** API keys live in the script's private user properties, never in Drive or this repo.
- **Phone shortcuts and webhooks:** they use a random 32-character token, compared in constant time. It can be sent in the request body instead of the URL. Pocket webhook bodies are never trusted; every recording is re-fetched from Pocket's API.
- **Untrusted content:** transcript text is treated as data. It is escaped in HTML and e-mail, kept from being read as a formula in Sheets, and marked as data, not instructions, in every AI prompt.
- **Tests:** `test/` runs the whole script against simulated Google, Pocket, Claude, GitHub and Apps Script APIs. The **Tests** workflow runs them on every push and pull request to `main`.

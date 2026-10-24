# Pocket Life OS

One file — [`PocketLifeOS.gs`](PocketLifeOS.gs) — that runs inside your own Google account (Google Apps Script, free, no hosting) and turns your Pocket recorder into a personal archive:

- Every recording, summary, transcript, audio file and to-do → Google Drive, filed as
  `Life OS — Conversations/<Office|Personal|Unsorted>/YYYY/MM — Month/YYYY-MM-DD HH.MM — Title — with People`
- To-dos → Google Tasks (shows in Gmail and Calendar). Ticking one off there closes it in Pocket too.
- Learns who is Office and who is Personal. It asks you about new people until it knows them.
- `_Claude Memory` folder (Timeline, People directory, monthly Memory docs) so a Claude Project can answer "what did I discuss with whom, and when".
- Private dashboard for phone and laptop: Review, Conversations, To-dos, Ask, People, Settings, Playbook.
- Runs every 15 minutes in Google's cloud, so your laptop and phone can be off.
- **Drive inbox**: drop any audio file (Zoom export, voice memo, USB copy from the device, up to 48 MB) into `_Inbox — drop audio here`. It is sent to Pocket for transcription and comes back filed.
- **Optional Claude API key** (replaces Pocket Pro): Claude notes from your own Office/Personal templates, a choice of Opus/Sonnet/Haiku, Ask across your whole archive, a weekly review, and the promises you made turned into to-dos.
- **No API keys needed**: every conversation has *Send to Claude / ChatGPT / Gemini / Gemini in Docs*. It copies the transcript and your template, then opens the app you already pay for. Paste the answer back, rate it, and pick your favourite.
- **Long recordings**: audio of any length is saved to Drive, resuming across runs. Conversations where Pocket's transcript stops early are flagged, with a *Transcribe the rest* action.
- **Offline import**: copy recordings off the device over USB-C (USB Mode), transcribe on-device with a Whisper app, and drop the `.srt`/`.vtt`/`.txt` (plus the audio, with the same name) into the inbox. It is filed without Pocket.
- **Phone shortcuts** (iPhone Shortcuts, Android HTTP Shortcuts): *Ask my memory*, *Add to-do*, *Status*, *Sync now*.

The dashboard's **Playbook** tab has a Pocket Pro comparison, the Claude Project setup and step-by-step phone shortcut recipes.

## Install (about 5 minutes)

The same steps are at the top of `PocketLifeOS.gs`.

1. Go to https://script.google.com → **New project**. Paste the whole file and save.
2. **Services (+)** → **Google Tasks API** → **Add**.
3. Choose `setup` → **Run**, then allow the permissions. Google warns because the script is yours and unpublished; that is expected.
4. **Deploy** → **New deployment** → **Web app**. Set Execute as: **Me** and Who has access: **Only myself**. Open the URL it gives you.
5. In the dashboard, open **Settings**, paste your Pocket API key (Pocket app → Settings → Developer), then run **Test** → **Preview** → **Sync now**.

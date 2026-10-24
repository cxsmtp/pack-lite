# Pocket Life OS

One file — [`PocketLifeOS.gs`](PocketLifeOS.gs) — that runs inside your own Google account (Google Apps Script, free, no hosting) and turns your Pocket recorder into a personal archive:

- Every recording, summary, transcript, audio file and to-do → Google Drive, filed as
  `Life OS — Conversations/<Office|Personal|Unsorted>/YYYY/MM — Month/YYYY-MM-DD HH.MM — Title — with People`
- To-dos → Google Tasks (shows in Gmail and Calendar). Ticking one off there closes it in Pocket too.
- Learns who is Office and who is Personal. It asks you about new people until it knows them.
- `_Claude Memory` folder (Timeline, People directory, monthly Memory docs) so a Claude Project can answer "what did I discuss with whom, and when".
- Private dashboard for phone and laptop: Review, Conversations, To-dos, Ask, People, Settings, Playbook.
- Runs every 15 minutes in Google's cloud, so your laptop and phone can be off.

## Install (about 5 minutes)

The same steps are at the top of `PocketLifeOS.gs`.

1. Go to https://script.google.com → **New project**. Paste the whole file and save.
2. **Services (+)** → **Google Tasks API** → **Add**.
3. Choose `setup` → **Run**, then allow the permissions. Google warns because the script is yours and unpublished; that is expected.
4. **Deploy** → **New deployment** → **Web app**. Set Execute as: **Me** and Who has access: **Only myself**. Open the URL it gives you.
5. In the dashboard, open **Settings**, paste your Pocket API key (Pocket app → Settings → Developer), then run **Test** → **Preview** → **Sync now**.

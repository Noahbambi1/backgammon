# Backgammon

A complete backgammon app: full rules, doubling cube, match play, a three-level bot, two-player on one
device, online play with room codes, and a no-internet "Nearby" mode for planes. Mobile-first, works on
desktop, installable as a PWA. Plain HTML/CSS/JS — no build step, no server-side code.

## Run it

**Locally (Windows):** double-click `start-server.bat` (needs Python 3), or run `npx serve .` in this
folder, then open http://localhost:8123/.

**On your phone:** host the folder on any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages —
drag-and-drop the folder). Open the URL on the phone and choose *Add to Home Screen*: the service worker
caches everything so the installed app works offline. HTTPS matters: the camera (QR scanning) and
WebRTC only work on HTTPS or localhost. Over plain `http://<your-LAN-ip>` the app runs, but the QR
scanner is unavailable — use the "Paste code manually" fallback in Nearby mode.

## Online play needs a TURN relay (one-time setup)

Two phones on mobile data sit behind carrier NATs and usually cannot connect directly; a TURN server
relays the encrypted traffic. The free relay that PeerJS used to bundle is gone, so **configure your
own in `js/config.js`** — the easiest is Metered's free Open Relay (20 GB/month; a whole match is a
few KB): sign up at https://dashboard.metered.ca/signup, copy the TURN "credentials" URL from the
dashboard (`https://<app>.metered.live/api/v1/turn/credentials?apiKey=…`) and paste it as
`turnCredentialsUrl`. Until then the waiting screen shows a warning and phones on the same Wi-Fi /
home networks will still connect; two phones both on mobile data probably won't.

## Modes

| Mode | How it works |
|---|---|
| **Play vs Bot** | Easy (random legal play), Medium (positional heuristics, 1-ply), Hard (2-ply expectimax over all 21 opponent rolls, equity-based cube decisions). Pick your colour, match length, cube on/off. |
| **Two Players · Same Device** | Enter both names; the game announces whose turn it is, keeps the match score, and can rotate the board for the player on move. |
| **Play Online · Room Code** | One player taps *Create Room* and shares the 6-letter code (or link/QR). The other taps *Join*. Peer-to-peer WebRTC via PeerJS's free public signalling server; no game data touches a server after connecting. |
| **Nearby · No Internet** | For flights: one phone turns on Personal Hotspot, the other joins that Wi-Fi. Host shows a code (QR + a short text code), guest enters it, guest shows a reply code, host enters it — a direct WebRTC link on the local network, zero internet. Codes are ~70–90 characters of typo-tolerant base32 (no I/L/O/U, case-insensitive, dashes optional, checksum), so they can be scanned, copied, shared via Quick Share/AirDrop/Bluetooth, or simply read aloud and typed. |

### Why Nearby uses hotspot + QR instead of Bluetooth

Web browsers only expose Bluetooth in the *central* role (Web Bluetooth); a web page cannot advertise as
a peripheral, so two phones running a web app can't discover each other over Bluetooth. The Nearby mode
gives the same result — two phones in airplane mode playing each other — using the hotspot radio
instead. A native wrapper (Capacitor + a BLE peripheral plugin) could add a true Bluetooth transport:
the networking layer (`js/net.js`) is a tiny interface (`send`, `onmessage`, `onopen`, `onclose`), so a
Bluetooth transport would plug into `js/app.js` unchanged.

## Rules implemented

Opening roll — each player taps to roll one die, higher starts and plays both dice, ties re-roll · must play both dice when possible, otherwise the higher
die · doubles play four times · hitting and entering from the bar · bearing off (exact die, or a higher
die when no checker is farther back) · doubling cube with ownership, take/pass, redoubles to 64 ·
Crawford rule in match play · gammon ×2, backgammon ×3 · match to 1/3/5/7 or unlimited (money game) ·
undo within a turn · resign (single/gammon/backgammon) · pip counts · optional legal-move highlighting (off by default, Settings) ·
auto-finish when no moves remain · resume an interrupted bot/local game.

## Controls

Tap a checker (or the bar) to see its legal destinations, then tap one — or drag the checker. Tap a
highlighted destination directly when only one checker can reach it. Dashed highlights are multi-step
destinations: tap or drag there and the checker plays the whole roll (both dice, or several of a
double) in one go, hopping visibly through each point. Tap the selected checker again to
play its only move. Roll / Double / Undo / Done buttons sit under the board. Keyboard on desktop:
`R`/space roll or done, `U` undo, `D` double.

## Releasing a new version

Run `node bump.js` before committing: it increments `version.json`, the `?v=N` on every asset in
`index.html` and the service-worker cache name. Installed apps poll `version.json` and reload
themselves on the menu (or show a one-tap "update" toast mid-game), so everyone gets the new build.

## Project layout

```
index.html            screens & markup
css/style.css         mobile-first styling
js/engine.js          rules engine (pure, JSON-serialisable state; also runs in Node)
js/ai.js              bot (three levels)
js/ui.js              board rendering, tap/drag input, animations, dice
js/config.js          deployment config: STUN/TURN servers
js/net.js             PeerTransport (online), LocalRTC (nearby), QRScanner
bump.js               version bump for cache busting
js/app.js             screens, game loop, bot orchestration, host-authoritative sync
sw.js, manifest.webmanifest, icons/   PWA
vendor/               peerjs, qrcodejs, jsQR (vendored so the app works offline)
test/                 node test/engine.test.js · node test/ai.test.js
```

## Networking model

The host is authoritative. The guest sends actions (`roll`, `move`, `undo`, `end`, `double`, `take`,
`pass`, `resign`, `newgame`); the host validates them against the rules engine, applies them, and
broadcasts the full game + match state after every change. Dice are rolled only on the host. If the
connection drops, both sides are told and can return to the menu.

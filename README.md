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

## Modes

| Mode | How it works |
|---|---|
| **Play vs Bot** | Easy (random legal play), Medium (positional heuristics, 1-ply), Hard (2-ply expectimax over all 21 opponent rolls, equity-based cube decisions). Pick your colour, match length, cube on/off. |
| **Two Players · Same Device** | Enter both names; the game announces whose turn it is, keeps the match score, and can rotate the board for the player on move. |
| **Play Online · Room Code** | One player taps *Create Room* and shares the 6-letter code (or link/QR). The other taps *Join*. Peer-to-peer WebRTC via PeerJS's free public signalling server; no game data touches a server after connecting. |
| **Nearby · No Internet** | For flights: one phone turns on Personal Hotspot, the other joins that Wi-Fi. Host shows a QR, guest scans it, guest shows a reply QR, host scans it — a direct WebRTC link on the local network, zero internet. Paste-the-code fallback if a camera isn't available. |

### Why Nearby uses hotspot + QR instead of Bluetooth

Web browsers only expose Bluetooth in the *central* role (Web Bluetooth); a web page cannot advertise as
a peripheral, so two phones running a web app can't discover each other over Bluetooth. The Nearby mode
gives the same result — two phones in airplane mode playing each other — using the hotspot radio
instead. A native wrapper (Capacitor + a BLE peripheral plugin) could add a true Bluetooth transport:
the networking layer (`js/net.js`) is a tiny interface (`send`, `onmessage`, `onopen`, `onclose`), so a
Bluetooth transport would plug into `js/app.js` unchanged.

## Rules implemented

Opening roll (higher die starts, ties re-roll) · must play both dice when possible, otherwise the higher
die · doubles play four times · hitting and entering from the bar · bearing off (exact die, or a higher
die when no checker is farther back) · doubling cube with ownership, take/pass, redoubles to 64 ·
Crawford rule in match play · gammon ×2, backgammon ×3 · match to 1/3/5/7 or unlimited (money game) ·
undo within a turn · resign (single/gammon/backgammon) · pip counts · legal-move highlighting ·
auto-finish when no moves remain · resume an interrupted bot/local game.

## Controls

Tap a checker (or the bar) to see its legal destinations, then tap one — or drag the checker. Tap a
highlighted destination directly when only one checker can reach it. Tap the selected checker again to
play its only move. Roll / Double / Undo / Done buttons sit under the board. Keyboard on desktop:
`R`/space roll or done, `U` undo, `D` double.

## Project layout

```
index.html            screens & markup
css/style.css         mobile-first styling
js/engine.js          rules engine (pure, JSON-serialisable state; also runs in Node)
js/ai.js              bot (three levels)
js/ui.js              board rendering, tap/drag input, animations, dice
js/net.js             PeerTransport (online), LocalRTC (nearby), QRScanner
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

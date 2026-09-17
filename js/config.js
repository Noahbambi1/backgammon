/* Deployment configuration — edit this file, no build step needed.
 *
 * ONLINE PLAY NEEDS A TURN RELAY. Two phones on mobile data almost always sit behind carrier NATs
 * that block direct peer-to-peer connections; a TURN server relays the (encrypted) traffic. STUN alone
 * only works when at least one side has a "friendly" NAT (typical home Wi-Fi).
 *
 * Easiest free option: Metered.ca Open Relay (20 GB/month free — a backgammon match is a few KB).
 *   1. Sign up at https://dashboard.metered.ca/signup  (free)
 *   2. Dashboard → TURN Server → copy the "credentials" URL, it looks like
 *      https://<your-app>.metered.live/api/v1/turn/credentials?apiKey=XXXXXXXX
 *   3. Paste it as turnCredentialsUrl below and redeploy.
 * The app fetches short-lived TURN credentials from that URL each time a room is created/joined.
 *
 * Alternatively hard-code servers in iceServers (e.g. your own coturn):
 *   iceServers: [{ urls: 'stun:stun.l.google.com:19302' },
 *                { urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:443?transport=tcp'], username: 'u', credential: 'p' }]
 */
window.BG_CONFIG = {
  turnCredentialsUrl: '',
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

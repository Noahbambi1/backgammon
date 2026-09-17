/* Deployment configuration — edit this file, no build step needed.
 *
 * ONLINE PLAY goes through public MQTT brokers over WebSocket (free, no account). Both phones connect to
 * every broker in the list, publish each (AES-GCM encrypted) message to all of them and de-duplicate on
 * receipt, so a single broker being down or flaky does not matter. Add your own broker here if you like
 * (e.g. a Mosquitto you run), or remove ones you don't trust.
 *
 * iceServers / turnCredentialsUrl are only used by the legacy WebRTC transport (PeerTransport in
 * js/net.js), which is no longer wired to the UI.
 */
window.BG_CONFIG = {
  // public address of the web version (used for invite links from the native apps)
  webUrl: 'https://noahbambi1.github.io/backgammon/',
  brokers: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ],
  turnCredentialsUrl: '',
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

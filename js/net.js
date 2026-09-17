/* Networking: two transports with the same tiny interface.
 *   PeerTransport  – online play via PeerJS (WebRTC + free public signaling), room codes.
 *   LocalRTC       – offline "nearby" play: raw WebRTC data channel on a local network/hotspot,
 *                    signaled by hand through QR codes (no internet needed).
 * Interface: t.onopen, t.onmessage(obj), t.onclose(reason), t.send(obj), t.close()
 */
(function (root) {
  'use strict';

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function makeCode(n) { let s = ''; const r = crypto.getRandomValues(new Uint8Array(n || 6)); for (const b of r) s += ALPHABET[b % ALPHABET.length]; return s; }

  // ---------------- ICE servers (STUN/TURN) ----------------
  // Phones on mobile data sit behind carrier NATs that usually need a TURN relay. PeerJS's bundled
  // relay hosts no longer resolve, so we bring our own list (js/config.js) and can fetch fresh
  // credentials from a provider URL (Metered's free tier) at connect time.
  const CFG = root.BG_CONFIG || {};
  const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  let iceCache = null, iceCacheAt = 0;
  async function getIceServers() {
    const staticList = Array.isArray(CFG.iceServers) && CFG.iceServers.length ? CFG.iceServers : FALLBACK_ICE;
    if (!CFG.turnCredentialsUrl) return staticList;
    if (iceCache && Date.now() - iceCacheAt < 10 * 60 * 1000) return iceCache;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(CFG.turnCredentialsUrl, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
      const list = await res.json();
      if (Array.isArray(list) && list.length) { iceCache = list; iceCacheAt = Date.now(); return list; }
    } catch (e) { console.warn('TURN credentials fetch failed, using static list', e); }
    return staticList;
  }
  function hasTurn(list) { return list.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u))); }

  // ---------------- PeerJS (online) ----------------
  class PeerTransport {
    constructor() { this.peer = null; this.conn = null; this.onopen = null; this.onmessage = null; this.onclose = null; this.onstatus = null; this.closed = false; }
    _status(s) { if (this.onstatus) this.onstatus(s); }
    _wire(conn) {
      this.conn = conn;
      conn.on('open', () => { this._status('connected'); if (this.onopen) this.onopen(); });
      conn.on('data', d => { try { const m = typeof d === 'string' ? JSON.parse(d) : d; if (this.onmessage) this.onmessage(m); } catch (e) { console.warn('bad msg', e); } });
      conn.on('close', () => { if (!this.closed && this.onclose) this.onclose('Connection closed'); });
      conn.on('error', e => { if (!this.closed && this.onclose) this.onclose('Connection error: ' + (e && e.message || e)); });
    }
    _peerErrors(peer, reject) {
      peer.on('error', e => {
        const type = e && e.type;
        let msg = 'Network error';
        if (type === 'peer-unavailable') msg = 'Room not found. Check the code.';
        else if (type === 'unavailable-id') msg = 'Room code already in use, try again.';
        else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') msg = 'Cannot reach the matchmaking server. Check your internet connection.';
        else if (type === 'browser-incompatible') msg = 'This browser does not support WebRTC.';
        else if (e && e.message) msg = e.message;
        if (reject) reject(new Error(msg)); else if (this.onclose && !this.closed) this.onclose(msg);
      });
      peer.on('disconnected', () => { if (!this.closed) { this._status('reconnecting'); try { peer.reconnect(); } catch (_) {} } });
    }
    host(code) {
      return new Promise(async (resolve, reject) => {
        if (typeof Peer === 'undefined') return reject(new Error('Online library not loaded (are you offline?).'));
        code = code || makeCode(6);
        this.code = code;
        this._status('connecting');
        const ice = await getIceServers(); this.hasTurn = hasTurn(ice);
        this.peer = new Peer('bgmm-' + code, { debug: 0, config: { iceServers: ice, sdpSemantics: 'unified-plan' } });
        this._peerErrors(this.peer, reject);
        this.peer.on('open', () => { this._status('waiting'); resolve(code); });
        this.peer.on('connection', conn => {
          if (this.conn && this.conn.open) { conn.close(); return; } // one opponent only
          this._wire(conn);
        });
      });
    }
    join(code) {
      return new Promise(async (resolve, reject) => {
        if (typeof Peer === 'undefined') return reject(new Error('Online library not loaded (are you offline?).'));
        this.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
        this._status('connecting');
        const ice = await getIceServers(); this.hasTurn = hasTurn(ice);
        this.peer = new Peer({ debug: 0, config: { iceServers: ice, sdpSemantics: 'unified-plan' } });
        this._peerErrors(this.peer, reject);
        const serverTimer = setTimeout(() => reject(new Error('Cannot reach the matchmaking server. Check your internet connection.')), 15000);
        this.peer.on('open', () => {
          clearTimeout(serverTimer);
          this._status('negotiating');
          const conn = this.peer.connect('bgmm-' + this.code, { reliable: true, serialization: 'json' });
          const timer = setTimeout(() => {
            const why = this.hasTurn
              ? 'Found the room but the two phones could not connect to each other. Make sure the host still has the room open, then try again.'
              : 'Found the room but the two phones could not connect directly — this usually means both are on mobile data and a relay (TURN) server is not configured. Try putting one phone on Wi-Fi, or use the Nearby mode.';
            reject(new Error(why));
          }, 30000);
          conn.on('error', e => { clearTimeout(timer); reject(new Error('Connection failed: ' + (e && e.message || e))); });
          this._wire(conn);
          conn.on('open', () => { clearTimeout(timer); resolve(); });
          // surface ICE progress for the waiting screen
          const watch = () => { const pc = conn.peerConnection; if (!pc) return setTimeout(watch, 300); pc.addEventListener('iceconnectionstatechange', () => this._status('ice:' + pc.iceConnectionState)); };
          watch();
        });
      });
    }
    send(obj) { if (this.conn && this.conn.open) { this.conn.send(obj); return true; } return false; }
    get connected() { return !!(this.conn && this.conn.open); }
    close() { this.closed = true; try { this.conn && this.conn.close(); } catch (_) {} try { this.peer && this.peer.destroy(); } catch (_) {} }
  }

  // ---------------- Manual WebRTC (nearby / no internet) ----------------
  // Pairing codes are compact binary, Crockford-base32 encoded (no I/L/O/U, case-insensitive), grouped
  // in blocks of 4 so they can be read aloud or typed. Layout:
  //   [0] flags: bit0 type (0 offer / 1 answer), bits1-2 setup (0 actpass,1 active,2 passive), bit3 pwd included
  //   [1..3] ice-ufrag (4 base64 chars packed into 3 bytes)
  //   [4..35] DTLS fingerprint sha-256 (32 bytes)
  //   [36..] pwd (24 bytes) only if bit3 set (fallback when the browser refused our derived password)
  //   then candidates: kind byte (0 ipv4, 1 mDNS uuid, 2 ipv6) + address (4/16/16 bytes) + port (2 bytes)
  //   last byte: checksum (sum of all previous bytes mod 256)
  // The ICE password is derived from ufrag+fingerprint on both sides, so it need not be sent.
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function b32enc(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }
  function b32dec(str) {
    const s = str.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
    const out = []; let bits = 0, val = 0;
    for (const ch of s) { const v = B32.indexOf(ch); if (v < 0) throw new Error('Invalid character in code'); val = (val << 5) | v; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
    return new Uint8Array(out);
  }
  function groupCode(s) { return s.replace(/(.{4})(?=.)/g, '$1-'); }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function packUfrag(u) { const v = [...u.slice(0, 4).padEnd(4, 'A')].map(c => Math.max(0, B64.indexOf(c))); return [(v[0] << 2) | (v[1] >> 4), ((v[1] & 15) << 4) | (v[2] >> 2), ((v[2] & 3) << 6) | v[3]]; }
  function unpackUfrag(b) { return B64[b[0] >> 2] + B64[((b[0] & 3) << 4) | (b[1] >> 4)] + B64[((b[1] & 15) << 2) | (b[2] >> 6)] + B64[b[2] & 63]; }
  function hexToBytes(h) { return h.replace(/[^0-9a-f]/gi, '').match(/../g).map(x => parseInt(x, 16)); }
  function bytesToFp(b) { return Array.from(b, x => x.toString(16).padStart(2, '0').toUpperCase()).join(':'); }
  async function derivePwd(ufrag, fp) {
    const data = new TextEncoder().encode('bg-nearby|' + ufrag + '|' + fp);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    let s = ''; for (let i = 0; i < 24; i++) s += B64[h[i] & 63];
    return s;
  }
  function parseSDP(sdp) {
    const get = re => { const m = sdp.match(re); return m ? m[1] : ''; };
    const cands = [];
    for (const line of sdp.split(/\r?\n/)) {
      const m = line.match(/^a=candidate:(\S+) 1 (udp|UDP) (\d+) (\S+) (\d+) typ (host|srflx|prflx)/);
      if (m) cands.push({ addr: m[4], port: +m[5], prio: +m[3] });
    }
    return { ufrag: get(/a=ice-ufrag:(\S+)/), pwd: get(/a=ice-pwd:(\S+)/), fp: get(/a=fingerprint:sha-256 (\S+)/), setup: get(/a=setup:(\S+)/), cands };
  }
  function pickCandidates(cands) {
    const v4 = cands.filter(c => /^\d+\.\d+\.\d+\.\d+$/.test(c.addr) && !c.addr.startsWith('169.254.') && c.addr !== '127.0.0.1');
    const mdns = cands.filter(c => /\.local$/.test(c.addr));
    const v6 = cands.filter(c => c.addr.includes(':') && !/^fe80/i.test(c.addr));
    // keep the code short: real IPv4 addresses if we have them, otherwise mDNS names, otherwise IPv6
    const list = v4.length ? v4 : mdns.length ? mdns : v6;
    const out = []; const seen = new Set();
    for (const c of list) { const k = c.addr + ':' + c.port; if (!seen.has(k)) { seen.add(k); out.push(c); } }
    return out.slice(0, 2);
  }
  function compactSDP(desc, opts) {
    const p = parseSDP(desc.sdp); opts = opts || {};
    const bytes = [];
    const setup = { actpass: 0, active: 1, passive: 2 }[p.setup] || 0;
    const includePwd = !!opts.includePwd;
    bytes.push((desc.type === 'offer' ? 0 : 1) | (setup << 1) | (includePwd ? 8 : 0));
    bytes.push(...packUfrag(p.ufrag));
    bytes.push(...hexToBytes(p.fp));
    if (includePwd) { const pw = p.pwd.slice(0, 24).padEnd(24, 'A'); for (const ch of pw) bytes.push(ch.charCodeAt(0)); }
    for (const c of pickCandidates(p.cands)) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(c.addr)) { bytes.push(0, ...c.addr.split('.').map(Number)); }
      else if (/\.local$/.test(c.addr)) { const hex = c.addr.replace(/\.local$/, '').replace(/-/g, ''); if (!/^[0-9a-f]{32}$/i.test(hex)) continue; bytes.push(1, ...hexToBytes(hex)); }
      else { const b = parseIPv6(c.addr); if (!b) continue; bytes.push(2, ...b); }
      bytes.push(c.port >> 8, c.port & 255);
    }
    bytes.push(bytes.reduce((a, b) => a + b, 0) & 255);
    return groupCode(b32enc(bytes));
  }
  function parseIPv6(a) {
    try {
      const [head, tail] = a.split('::'); const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
      const parts = h.concat(new Array(8 - h.length - t.length).fill('0'), t);
      if (parts.length !== 8) return null;
      const out = []; for (const x of parts) { const v = parseInt(x || '0', 16); out.push(v >> 8, v & 255); } return out;
    } catch (_) { return null; }
  }
  function fmtIPv6(b) { const parts = []; for (let i = 0; i < 16; i += 2) parts.push(((b[i] << 8) | b[i + 1]).toString(16)); return parts.join(':'); }
  async function expandSDP(str) {
    str = String(str).trim();
    if (str[0] === '{') return expandSDPLegacy(str);
    const b = b32dec(str);
    if (b.length < 40) throw new Error('Code is too short — check that you copied all of it.');
    const sum = Array.from(b.slice(0, b.length - 1)).reduce((a, x) => a + x, 0) & 255;
    if (sum !== b[b.length - 1]) throw new Error('Code has a typo (checksum mismatch). Please check it and try again.');
    const flags = b[0];
    const type = flags & 1 ? 'answer' : 'offer';
    const setup = ['actpass', 'active', 'passive'][(flags >> 1) & 3] || 'actpass';
    const ufrag = unpackUfrag(b.slice(1, 4));
    const fp = bytesToFp(b.slice(4, 36));
    let i = 36, pwd;
    if (flags & 8) { pwd = String.fromCharCode(...b.slice(36, 60)); i = 60; } else pwd = await derivePwd(ufrag, fp);
    const cands = [];
    while (i < b.length - 1) {
      const kind = b[i++];
      let addr;
      if (kind === 0) { addr = Array.from(b.slice(i, i + 4)).join('.'); i += 4; }
      else if (kind === 1) { const hx = Array.from(b.slice(i, i + 16), x => x.toString(16).padStart(2, '0')).join(''); addr = hx.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') + '.local'; i += 16; }
      else if (kind === 2) { addr = fmtIPv6(b.slice(i, i + 16)); i += 16; }
      else throw new Error('Unknown address type in code');
      const port = (b[i] << 8) | b[i + 1]; i += 2;
      cands.push([addr, port, 2130706431 - cands.length * 256]);
    }
    return buildSDP({ t: type === 'offer' ? 'o' : 'a', u: ufrag, p: pwd, f: fp, s: setup, c: cands });
  }
  function buildSDP(o) {
    const lines = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
      'a=ice-ufrag:' + o.u, 'a=ice-pwd:' + o.p, 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + o.f, 'a=setup:' + o.s];
    o.c.forEach((c, i) => lines.push(`a=candidate:${i + 1} 1 udp ${c[2]} ${c[0]} ${c[1]} typ host generation 0`));
    lines.push('a=end-of-candidates');
    return { type: o.t === 'o' ? 'offer' : 'answer', sdp: lines.join('\r\n') + '\r\n' };
  }
  // Rewrite the local SDP's ice-pwd to the derived value (so it can be omitted from the code).
  // Returns true if the browser accepted it; false means we must include the pwd in the code.
  async function setLocalMunged(pc, desc) {
    const p = parseSDP(desc.sdp);
    try {
      const pwd = await derivePwd(p.ufrag, p.fp);
      const sdp = desc.sdp.replace(/a=ice-pwd:\S+/g, 'a=ice-pwd:' + pwd);
      await pc.setLocalDescription({ type: desc.type, sdp });
      return true;
    } catch (e) {
      console.warn('ice-pwd munging rejected, sending pwd in code', e);
      await pc.setLocalDescription(desc);
      return false;
    }
  }

  function compactSDPLegacy(desc) {
    const sdp = desc.sdp;
    const get = re => { const m = sdp.match(re); return m ? m[1] : ''; };
    const cands = [];
    for (const line of sdp.split(/\r?\n/)) {
      const m = line.match(/^a=candidate:(\S+) 1 (udp|UDP) (\d+) (\S+) (\d+) typ (host|srflx|prflx)/);
      if (m) cands.push([m[4], +m[5], +m[3]]);
    }
    return JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', u: get(/a=ice-ufrag:(\S+)/), p: get(/a=ice-pwd:(\S+)/), f: get(/a=fingerprint:sha-256 (\S+)/), s: get(/a=setup:(\S+)/), c: cands });
  }
  function expandSDPLegacy(str) { return buildSDP(JSON.parse(str)); }
  function waitIce(pc, ms) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = () => { pc.removeEventListener('icegatheringstatechange', h); resolve(); };
      const h = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.addEventListener('icegatheringstatechange', h);
      setTimeout(done, ms || 2500);
    });
  }

  class LocalRTC {
    constructor() { this.pc = null; this.dc = null; this.onopen = null; this.onmessage = null; this.onclose = null; this.closed = false; }
    _wireDC(dc) {
      this.dc = dc;
      dc.onopen = () => { if (this.onopen) this.onopen(); };
      dc.onmessage = e => { try { if (this.onmessage) this.onmessage(JSON.parse(e.data)); } catch (err) { console.warn(err); } };
      dc.onclose = () => { if (!this.closed && this.onclose) this.onclose('Connection closed'); };
      dc.onerror = () => { if (!this.closed && this.onclose) this.onclose('Connection error'); };
    }
    _newPC() {
      this.pc = new RTCPeerConnection({ iceServers: [] });
      this.pc.onconnectionstatechange = () => {
        const s = this.pc.connectionState;
        if ((s === 'failed' || s === 'disconnected' || s === 'closed') && !this.closed && this.onclose) this.onclose('Connection ' + s);
      };
    }
    async createOffer() {
      this._newPC();
      this._wireDC(this.pc.createDataChannel('bg', { ordered: true }));
      const munged = await setLocalMunged(this.pc, await this.pc.createOffer());
      await waitIce(this.pc, 3000);
      return compactSDP(this.pc.localDescription, { includePwd: !munged });
    }
    async acceptAnswer(str) {
      const d = await expandSDP(str);
      if (d.type !== 'answer') throw new Error('That is a host code, not a reply code. Ask the other phone to enter YOUR code first — the reply code it shows is the one you need.');
      await this.pc.setRemoteDescription(d);
    }
    async createAnswer(offerStr) {
      const d = await expandSDP(offerStr);
      if (d.type !== 'offer') throw new Error('That is a reply code, not a host code. Enter the host\'s code.');
      this._newPC();
      this.pc.ondatachannel = e => this._wireDC(e.channel);
      await this.pc.setRemoteDescription(d);
      const munged = await setLocalMunged(this.pc, await this.pc.createAnswer());
      await waitIce(this.pc, 3000);
      return compactSDP(this.pc.localDescription, { includePwd: !munged });
    }
    send(obj) { if (this.dc && this.dc.readyState === 'open') { this.dc.send(JSON.stringify(obj)); return true; } return false; }
    get connected() { return !!(this.dc && this.dc.readyState === 'open'); }
    close() { this.closed = true; try { this.dc && this.dc.close(); } catch (_) {} try { this.pc && this.pc.close(); } catch (_) {} }
  }

  // ---------------- QR scanning helper ----------------
  class QRScanner {
    constructor(video, canvas) { this.video = video; this.canvas = canvas; this.stream = null; this.running = false; }
    async start(onResult) {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      this.video.srcObject = this.stream; await this.video.play();
      this.running = true;
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (!this.running) return;
        if (this.video.readyState >= 2 && typeof jsQR !== 'undefined') {
          const w = this.video.videoWidth, h = this.video.videoHeight;
          if (w && h) {
            const scale = Math.min(1, 640 / w);
            this.canvas.width = w * scale; this.canvas.height = h * scale;
            ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            const img = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) { this.stop(); onResult(code.data); return; }
          }
        }
        setTimeout(tick, 120);
      };
      tick();
    }
    stop() { this.running = false; if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } this.video.srcObject = null; }
  }

  root.BGNet = { PeerTransport, LocalRTC, QRScanner, makeCode, compactSDP, expandSDP, groupCode, b32enc, b32dec, getIceServers, hasTurn };
})(window);

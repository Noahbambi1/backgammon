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
      return new Promise((resolve, reject) => {
        if (typeof Peer === 'undefined') return reject(new Error('Online library not loaded (are you offline?).'));
        code = code || makeCode(6);
        this.code = code;
        this._status('connecting');
        this.peer = new Peer('bgmm-' + code, { debug: 0 });
        this._peerErrors(this.peer, reject);
        this.peer.on('open', () => { this._status('waiting'); resolve(code); });
        this.peer.on('connection', conn => {
          if (this.conn && this.conn.open) { conn.close(); return; } // one opponent only
          this._wire(conn);
        });
      });
    }
    join(code) {
      return new Promise((resolve, reject) => {
        if (typeof Peer === 'undefined') return reject(new Error('Online library not loaded (are you offline?).'));
        this.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
        this._status('connecting');
        this.peer = new Peer({ debug: 0 });
        this._peerErrors(this.peer, reject);
        this.peer.on('open', () => {
          const conn = this.peer.connect('bgmm-' + this.code, { reliable: true, serialization: 'json' });
          const timer = setTimeout(() => reject(new Error('Could not connect to the room. Is the host still waiting?')), 15000);
          this._wire(conn);
          conn.on('open', () => { clearTimeout(timer); resolve(); });
        });
      });
    }
    send(obj) { if (this.conn && this.conn.open) { this.conn.send(obj); return true; } return false; }
    get connected() { return !!(this.conn && this.conn.open); }
    close() { this.closed = true; try { this.conn && this.conn.close(); } catch (_) {} try { this.peer && this.peer.destroy(); } catch (_) {} }
  }

  // ---------------- Manual WebRTC (nearby / no internet) ----------------
  function compactSDP(desc) {
    const sdp = desc.sdp;
    const get = re => { const m = sdp.match(re); return m ? m[1] : ''; };
    const cands = [];
    for (const line of sdp.split(/\r?\n/)) {
      const m = line.match(/^a=candidate:(\S+) 1 (udp|UDP) (\d+) (\S+) (\d+) typ (host|srflx|prflx)/);
      if (m) cands.push([m[4], +m[5], +m[3]]);
    }
    return JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', u: get(/a=ice-ufrag:(\S+)/), p: get(/a=ice-pwd:(\S+)/), f: get(/a=fingerprint:sha-256 (\S+)/), s: get(/a=setup:(\S+)/), c: cands });
  }
  function expandSDP(str) {
    const o = JSON.parse(str);
    const lines = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
      'a=ice-ufrag:' + o.u, 'a=ice-pwd:' + o.p, 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + o.f, 'a=setup:' + o.s];
    o.c.forEach((c, i) => lines.push(`a=candidate:${i + 1} 1 udp ${c[2]} ${c[0]} ${c[1]} typ host generation 0`));
    lines.push('a=end-of-candidates');
    return { type: o.t === 'o' ? 'offer' : 'answer', sdp: lines.join('\r\n') + '\r\n' };
  }
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
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await waitIce(this.pc, 3000);
      return compactSDP(this.pc.localDescription);
    }
    async acceptAnswer(str) {
      const d = expandSDP(str);
      if (d.type !== 'answer') throw new Error('That is not an answer code. Ask the other phone to scan your code first.');
      await this.pc.setRemoteDescription(d);
    }
    async createAnswer(offerStr) {
      const d = expandSDP(offerStr);
      if (d.type !== 'offer') throw new Error('That is not a host code.');
      this._newPC();
      this.pc.ondatachannel = e => this._wireDC(e.channel);
      await this.pc.setRemoteDescription(d);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await waitIce(this.pc, 3000);
      return compactSDP(this.pc.localDescription);
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

  root.BGNet = { PeerTransport, LocalRTC, QRScanner, makeCode, compactSDP, expandSDP };
})(window);

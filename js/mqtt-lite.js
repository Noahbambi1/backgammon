/* Minimal MQTT 3.1.1 client over WebSocket (QoS 0 only) — ~120 lines, no dependencies.
 * Used to relay game messages through free public brokers so two phones behind carrier NATs can play.
 *   const c = new MqttLite(url); c.onmessage = (topic, bytes) => {}; c.onopen/onclose
 *   await c.connect(); c.subscribe(topic); c.publish(topic, bytes); c.close();
 */
(function (root) {
  'use strict';
  const te = new TextEncoder(), td = new TextDecoder();
  function str(s) { const b = te.encode(s); const out = new Uint8Array(2 + b.length); out[0] = b.length >> 8; out[1] = b.length & 255; out.set(b, 2); return out; }
  function remLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return Uint8Array.from(out); }
  function cat(...parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  function packet(type, body) { return cat(Uint8Array.of(type), remLen(body.length), body); }

  class MqttLite {
    constructor(url, opts) {
      this.url = url; this.opts = opts || {};
      this.ws = null; this.connected = false; this.closed = false; this.mid = 1;
      this.onmessage = null; this.onopen = null; this.onclose = null;
      this._buf = new Uint8Array(0); this._ping = null; this._subs = new Set();
    }
    connect() {
      return new Promise((resolve, reject) => {
        let ws; try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { return reject(e); }
        this.ws = ws; ws.binaryType = 'arraybuffer';
        const keepalive = this.opts.keepalive || 30;
        const timer = setTimeout(() => { if (!this.connected) { try { ws.close(); } catch (_) {} reject(new Error('timeout')); } }, this.opts.timeout || 8000);
        ws.onopen = () => {
          const id = (this.opts.clientId || 'bg') + Math.random().toString(36).slice(2, 12);
          // protocol name, level 4, flags: clean session, keepalive
          ws.send(packet(0x10, cat(str('MQTT'), Uint8Array.of(4, 2, keepalive >> 8, keepalive & 255), str(id))));
        };
        ws.onerror = () => { if (!this.connected) { clearTimeout(timer); reject(new Error('websocket error')); } };
        ws.onclose = () => { clearInterval(this._ping); const was = this.connected; this.connected = false; if (!was) { clearTimeout(timer); reject(new Error('closed')); } if (this.onclose && !this.closed) this.onclose(); };
        ws.onmessage = ev => {
          this._buf = cat(this._buf, new Uint8Array(ev.data));
          for (;;) {
            const p = this._parse(); if (!p) break;
            const type = p.type >> 4;
            if (type === 2) { // CONNACK
              if (p.body[1] !== 0) { clearTimeout(timer); reject(new Error('broker refused connection (rc=' + p.body[1] + ')')); try { ws.close(); } catch (_) {} return; }
              this.connected = true; clearTimeout(timer);
              this._ping = setInterval(() => { if (ws.readyState === 1) ws.send(Uint8Array.of(0xC0, 0)); }, Math.max(5, keepalive - 10) * 1000);
              for (const t of this._subs) this._sub(t);
              if (this.onopen) this.onopen(); resolve(this);
            } else if (type === 3) { // PUBLISH
              const tl = (p.body[0] << 8) | p.body[1]; const topic = td.decode(p.body.subarray(2, 2 + tl));
              let off = 2 + tl; if ((p.type & 6) !== 0) off += 2; // packet id for QoS>0
              if (this.onmessage) this.onmessage(topic, p.body.subarray(off));
            }
            // SUBACK(9) / PINGRESP(13): nothing to do
          }
        };
      });
    }
    _parse() {
      const b = this._buf; if (b.length < 2) return null;
      let mult = 1, len = 0, i = 1;
      for (;;) { if (i >= b.length) return null; const d = b[i++]; len += (d & 127) * mult; if (!(d & 128)) break; mult *= 128; if (mult > 2097152) throw new Error('bad length'); }
      if (b.length < i + len) return null;
      const pkt = { type: b[0], body: b.subarray(i, i + len) };
      this._buf = b.subarray(i + len);
      return pkt;
    }
    _sub(topic) { const mid = (this.mid++ % 65535) || 1; this.ws.send(packet(0x82, cat(Uint8Array.of(mid >> 8, mid & 255), str(topic), Uint8Array.of(0)))); }
    subscribe(topic) { this._subs.add(topic); if (this.connected) this._sub(topic); }
    publish(topic, bytes) { if (!this.connected || this.ws.readyState !== 1) return false; if (typeof bytes === 'string') bytes = te.encode(bytes); this.ws.send(packet(0x30, cat(str(topic), bytes))); return true; }
    close() { this.closed = true; clearInterval(this._ping); try { if (this.ws && this.ws.readyState === 1) this.ws.send(Uint8Array.of(0xE0, 0)); } catch (_) {} try { this.ws && this.ws.close(); } catch (_) {} }
  }
  root.MqttLite = MqttLite;
})(window);

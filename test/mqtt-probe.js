// Probe public MQTT brokers over WebSocket: CONNECT -> CONNACK -> SUBSCRIBE -> PUBLISH -> receive own message.
// node test/mqtt-probe.js   (Node 22+, uses the global WebSocket)
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://mqtt.eclipseprojects.io:443/mqtt'];
const enc = s => Buffer.from(s, 'utf8');
const str = s => { const b = enc(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
const rem = n => { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return Buffer.from(out); };
const pkt = (type, body) => Buffer.concat([Buffer.from([type]), rem(body.length), body]);
function connect(id) { const body = Buffer.concat([str('MQTT'), Buffer.from([4, 2, 0, 60]), str(id)]); return pkt(0x10, body); }
function subscribe(topic, mid) { return pkt(0x82, Buffer.concat([Buffer.from([mid >> 8, mid & 255]), str(topic), Buffer.from([0])])); }
function publish(topic, payload) { return pkt(0x30, Buffer.concat([str(topic), enc(payload)])); }

async function probe(url) {
  const t0 = Date.now();
  return new Promise(resolve => {
    const done = (r) => { clearTimeout(tm); try { ws.close(); } catch (_) {} resolve(`${url}  ->  ${r}  (${Date.now() - t0} ms)`); };
    const tm = setTimeout(() => done('TIMEOUT'), 8000);
    let ws; try { ws = new WebSocket(url, 'mqtt'); } catch (e) { return done('ERR ' + e.message); }
    ws.binaryType = 'arraybuffer';
    const topic = 'bgmm-probe/' + Math.random().toString(36).slice(2);
    let stage = 'connack';
    ws.onopen = () => ws.send(connect('bgprobe' + Math.random().toString(36).slice(2, 10)));
    ws.onerror = e => done('WS ERROR');
    ws.onclose = e => { if (stage !== 'done') done('CLOSED code=' + e.code + ' at ' + stage); };
    ws.onmessage = ev => {
      const b = Buffer.from(ev.data); const type = b[0] >> 4;
      if (type === 2) { if (b[3] !== 0) return done('CONNACK refused rc=' + b[3]); stage = 'suback'; ws.send(subscribe(topic, 1)); }
      else if (type === 9) { stage = 'echo'; ws.send(publish(topic, 'ping')); }
      else if (type === 3) { stage = 'done'; done('OK — connected, subscribed, message echoed'); }
    };
  });
}
(async () => { for (const u of BROKERS) console.log(await probe(u)); })();

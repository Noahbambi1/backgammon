// Probe a TURN server: STUN binding, then an authenticated TURN Allocate (long-term credentials).
// Usage: node test/turn-probe.js host port [username credential | --secret SECRET]
const dgram = require('dgram'), crypto = require('crypto'), dns = require('dns');
const [host, portArg, a1, a2] = process.argv.slice(2);
const port = +portArg || 3478;
let username, credential;
if (a1 === '--secret') { username = String(Math.floor(Date.now() / 1000) + 3600); credential = crypto.createHmac('sha1', a2).update(username).digest('base64'); }
else { username = a1; credential = a2; }

const MAGIC = 0x2112A442;
function attr(type, val) { const pad = (4 - (val.length % 4)) % 4; const h = Buffer.alloc(4); h.writeUInt16BE(type, 0); h.writeUInt16BE(val.length, 2); return Buffer.concat([h, val, Buffer.alloc(pad)]); }
function msg(type, attrs, integrityKey) {
  const tid = crypto.randomBytes(12);
  let body = Buffer.concat(attrs);
  const hdr = len => { const h = Buffer.alloc(20); h.writeUInt16BE(type, 0); h.writeUInt16BE(len, 2); h.writeUInt32BE(MAGIC, 4); tid.copy(h, 8); return h; };
  if (integrityKey) {
    const pre = Buffer.concat([hdr(body.length + 24), body]);
    const mac = crypto.createHmac('sha1', integrityKey).update(pre).digest();
    body = Buffer.concat([body, attr(0x0008, mac)]);
  }
  return { buf: Buffer.concat([hdr(body.length), body]), tid };
}
function parse(buf) {
  const type = buf.readUInt16BE(0), len = buf.readUInt16BE(2); const attrs = {}; let i = 20;
  while (i + 4 <= 20 + len) { const t = buf.readUInt16BE(i), l = buf.readUInt16BE(i + 2); attrs[t] = buf.slice(i + 4, i + 4 + l); i += 4 + l + ((4 - l % 4) % 4); }
  return { type, attrs };
}
function xorAddr(v) { const fam = v[1]; const p = v.readUInt16BE(2) ^ (MAGIC >>> 16); if (fam === 1) { const ip = []; for (let k = 0; k < 4; k++) ip.push(v[4 + k] ^ ((MAGIC >>> (24 - 8 * k)) & 255)); return ip.join('.') + ':' + p; } return 'ipv6:' + p; }

dns.lookup(host, (err, ip) => {
  if (err) { console.log('DNS FAIL', err.message); process.exit(1); }
  console.log('resolved', host, '->', ip);
  const sock = dgram.createSocket('udp4'); let stage = 'bind'; let realm, nonce;
  const send = m => sock.send(m.buf, port, ip);
  sock.on('message', b => {
    const r = parse(b);
    if (stage === 'bind') {
      console.log('STUN binding:', r.type === 0x0101 ? 'OK, mapped ' + (r.attrs[0x0020] ? xorAddr(r.attrs[0x0020]) : '?') : 'type 0x' + r.type.toString(16));
      stage = 'alloc1'; send(msg(0x0003, [attr(0x0019, Buffer.from([17, 0, 0, 0]))]));
    } else if (stage === 'alloc1') {
      if (r.type === 0x0113 && r.attrs[0x0009]) {
        const ec = r.attrs[0x0009]; const code = ec[2] * 100 + ec[3]; realm = r.attrs[0x0014] && r.attrs[0x0014].toString(); nonce = r.attrs[0x0015];
        console.log('Allocate (no auth) -> error', code, 'realm=', realm);
        if (!username) { console.log('no credentials given; stopping'); process.exit(0); }
        const key = crypto.createHash('md5').update(username + ':' + realm + ':' + credential).digest();
        stage = 'alloc2';
        send(msg(0x0003, [attr(0x0019, Buffer.from([17, 0, 0, 0])), attr(0x0006, Buffer.from(username)), attr(0x0014, Buffer.from(realm)), attr(0x0015, nonce)], key));
      } else { console.log('Allocate unexpected type 0x' + r.type.toString(16)); process.exit(0); }
    } else {
      if (r.type === 0x0103) console.log('TURN Allocate: SUCCESS — relayed address', r.attrs[0x0016] ? xorAddr(r.attrs[0x0016]) : '?');
      else { const ec = r.attrs[0x0009]; console.log('TURN Allocate: FAILED', ec ? ec[2] * 100 + ec[3] + ' ' + ec.slice(4).toString() : 'type 0x' + r.type.toString(16)); }
      process.exit(0);
    }
  });
  send(msg(0x0001, []));
  setTimeout(() => { console.log('TIMEOUT at stage', stage); process.exit(2); }, 6000);
});

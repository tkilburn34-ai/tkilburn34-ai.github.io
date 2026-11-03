// Run: node tests/detector.test.js
// Synthesises audio (pen clicks, release echoes, speech, table knocks, room
// noise), runs it through the real detector + decoder, and checks the text.
const assert = require("assert");
const { ClickDetector } = require("../click-worklet.js");
const { MorseDecoder, clickSchedule } = require("../decoder.js");

const SR = 48000;
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

function scene(totalMs) { return new Float32Array(Math.ceil((totalMs / 1000) * SR)); }
function addNoise(buf, amp) { for (let i = 0; i < buf.length; i++) buf[i] += rand() * amp + 0.01 * Math.sin((2 * Math.PI * 60 * i) / SR); }
function addClick(buf, ms, amp = 0.3) {
  // Sharp broadband burst with a ~2.5 ms decay, like a pen mechanism.
  const s = Math.floor((ms / 1000) * SR); let prev = 0;
  for (let i = 0; i < SR * 0.02 && s + i < buf.length; i++) {
    const n = rand(); const hf = n - prev; prev = n;           // tilt toward highs
    buf[s + i] += amp * hf * Math.exp(-i / (SR * 0.0025)) + 0.3 * amp * Math.sin(2 * Math.PI * 3500 * i / SR) * Math.exp(-i / (SR * 0.002));
  }
}
function addKnock(buf, ms, amp = 0.5) {
  const s = Math.floor((ms / 1000) * SR);
  for (let i = 0; i < SR * 0.12 && s + i < buf.length; i++) {
    buf[s + i] += amp * Math.sin(2 * Math.PI * 140 * i / SR) * Math.exp(-i / (SR * 0.018)) + 0.03 * rand() * Math.exp(-i / (SR * 0.001));
  }
}
function addSpeech(buf, ms, durMs) {
  const s = Math.floor((ms / 1000) * SR), n = Math.floor((durMs / 1000) * SR);
  for (let i = 0; i < n && s + i < buf.length; i++) {
    const env = Math.min(1, i / (SR * 0.03), (n - i) / (SR * 0.03));
    let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 140 * h * i / SR) / h;
    const sib = i > n * 0.6 && i < n * 0.85 ? rand() * 0.06 : 0;           // an "s" sound
    buf[s + i] += env * (0.08 * v + sib);
  }
}

function run(buf, opts = {}, decOpts = {}) {
  const det = new ClickDetector(SR, opts);
  const dec = new MorseDecoder(decOpts);
  const clicks = [], rejects = [];
  const chunk = 128;
  for (let i = 0; i < buf.length; i += chunk) {
    const startMs = (i / SR) * 1000;
    for (const ev of det.process(buf.subarray(i, i + chunk), startMs)) {
      if (ev.type === "click") { clicks.push(ev); dec.click(ev.t); } else rejects.push(ev);
    }
    dec.tick(startMs);
  }
  dec.tick(buf.length / SR * 1000 + 10000);
  return { text: dec.text.trim(), clicks, rejects };
}

// Write a Morse message as clicks. Dot = 1 click, dash = 2 clicks 160 ms apart.
function writeMorse(buf, startMs, code, { echo = false, amp = 0.3 } = {}) {
  let t = startMs;
  const click = (ms) => { addClick(buf, ms, amp); if (echo) addClick(buf, ms + 110, amp * 0.45); };
  for (const ch of code) {
    if (ch === ".") { click(t); t += 450; }
    else if (ch === "-") { click(t); click(t + 160); t += 600; }
    else if (ch === " ") t += 900;          // letter gap (plus the 450 above)
    else if (ch === "/") t += 2600;          // word gap
  }
  return t;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("single clicks are detected once each", () => {
  const b = scene(4000); addNoise(b, 0.002);
  [500, 1200, 1900, 2600].forEach((t) => addClick(b, t));
  const r = run(b);
  assert.strictEqual(r.clicks.length, 4, `got ${r.clicks.length}`);
  r.clicks.forEach((c, i) => assert(Math.abs(c.t - [500, 1200, 1900, 2600][i]) < 5, "timing off"));
});

test("decodes SOS from clicks in room noise", () => {
  const b = scene(9000); addNoise(b, 0.003);
  writeMorse(b, 300, "... --- ...");
  assert.strictEqual(run(b).text, "SOS");
});

test("decodes two words with a space", () => {
  const b = scene(18000); addNoise(b, 0.002);
  writeMorse(b, 300, ".... .. / -.-- --- ..-");
  assert.strictEqual(run(b).text, "HI YOU");
});

test("release echo is ignored with a longer refractory period", () => {
  const b = scene(9000); addNoise(b, 0.002);
  writeMorse(b, 300, "... --- ...", { echo: true });
  // Dash clicks are 160 ms apart; echoes come 110 ms after each press.
  assert.strictEqual(run(b, { refractoryMs: 130 }).text, "SOS");
});

test("speech does not create clicks", () => {
  const b = scene(4000); addNoise(b, 0.002);
  addSpeech(b, 300, 700); addSpeech(b, 1400, 900); addSpeech(b, 2600, 500);
  const r = run(b);
  assert.strictEqual(r.clicks.length, 0, `false clicks: ${r.clicks.length}`);
});

test("table knocks are rejected", () => {
  const b = scene(3000); addNoise(b, 0.002);
  [400, 1200, 2000].forEach((t) => addKnock(b, t));
  const r = run(b);
  assert.strictEqual(r.clicks.length, 0, `false clicks: ${r.clicks.length}`);
  assert(r.rejects.some((x) => x.reason === "knock"), "expected knock rejections");
});

test("clicks still decode while someone is talking nearby", () => {
  const b = scene(9000); addNoise(b, 0.002);
  addSpeech(b, 1000, 1500); addSpeech(b, 4500, 1200);
  writeMorse(b, 300, "... --- ...");
  assert.strictEqual(run(b).text, "SOS");
});

test("quiet clicks are found in a quiet room", () => {
  const b = scene(9000); addNoise(b, 0.0007);
  writeMorse(b, 300, "... --- ...", { amp: 0.03 });
  assert.strictEqual(run(b).text, "SOS");
});

test("six dots erases the previous letter", () => {
  const d = new MorseDecoder({ dashWin: 300, letterGap: 1000, wordGap: 2800 });
  let t = 0;
  const send = (code) => {
    for (const s of code) {
      if (s === ".") { d.click(t); t += 450; d.tick(t); }
      else { d.click(t); d.click(t + 150); t += 600; d.tick(t); }
    }
    t += 1200; d.tick(t);
  };
  send("..."); send("--"); send("......"); send("---");
  assert.strictEqual(d.text, "SO");
});

test("unknown patterns are reported, not typed", () => {
  const d = new MorseDecoder();
  d.click(0); d.click(100); d.click(700); d.click(800); d.click(1400); d.click(1500);
  d.click(2100); d.click(2200); d.click(2800); d.click(2900);        // -----  is 0
  d.click(3500); d.click(3600);                                       // ------ unknown
  const evs = d.tick(6000);
  assert(evs.some((e) => e.type === "unknown"));
  assert.strictEqual(d.text, "");
});

// ---- Send mode: a phone playing clicks, another phone decoding them --------
// The sender always uses SEND_TIMING; receivers may be tuned differently.
const SEND_TIMING = { dashWin: 300, letterGap: 1250, wordGap: 2800, refractoryMs: 90 };
function playTo(msg, receiver, { echoAmp = 0 } = {}) {
  const sch = clickSchedule(msg, SEND_TIMING);
  const b = scene(sch.duration + 4000); addNoise(b, 0.002);
  for (const c of sch.clicks) { addClick(b, 300 + c.t, 0.25); if (echoAmp) addClick(b, 300 + c.t + 12, echoAmp); }
  return run(b, { refractoryMs: receiver.refractoryMs }, receiver).text;
}
const RECEIVERS = {
  "default settings": { dashWin: 300, letterGap: 1000, wordGap: 2800, refractoryMs: 90 },
  "fast double-clicker with a long echo filter": { dashWin: 210, letterGap: 1000, wordGap: 2800, refractoryMs: 145 },
  "slow double-clicker": { dashWin: 420, letterGap: 1450, wordGap: 3200, refractoryMs: 120 },
};
for (const [name, rx] of Object.entries(RECEIVERS)) {
  test(`send mode: decodes on a receiver with ${name}`, () => {
    assert.strictEqual(playTo("SOS HELP 73", rx), "SOS HELP 73");
  });
}

test("send mode: room echo from the speaker is ignored", () => {
  assert.strictEqual(playTo("PEN", RECEIVERS["default settings"], { echoAmp: 0.1 }), "PEN");
});

test("send mode: unsupported characters are skipped and reported", () => {
  const sch = clickSchedule("hi ✓ #1", SEND_TIMING);
  assert.deepStrictEqual(sch.letters.map((l) => l.ch).join(""), "HI1");
  assert.deepStrictEqual(sch.skipped, ["✓", "#"]);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("  pass  " + name); }
  catch (e) { failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);

/* Pen Click Morse — app */
"use strict";

// ---------------------------------------------------------------------------
// Publishing settings. Fill in PLAY_URL once your Google Play listing is live.
// The free website then stops after WEB_LETTER_LIMIT letters per visit and
// points people to the paid app. Inside the Android app there is no limit.
// ---------------------------------------------------------------------------
const CONFIG = {
  PLAY_URL: "",
  WEB_LETTER_LIMIT: 30,
};

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("pcm:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pcm:" + k, JSON.stringify(v)); } catch {} },
};
const pretty = (s) => s.replace(/\./g, "·").replace(/-/g, "–");
// Draw a code as real dots and dashes (the text glyphs are too small to read at a glance).
const marksHTML = (s) => [...s].map((c) => `<i class="${c === "." ? "m-dot" : "m-dash"}"></i>`).join("");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const db = (x) => 10 * Math.log10(Math.max(x, 1e-12));

// The Android app (a Trusted Web Activity) opens the site with an
// android-app:// referrer. Remember it so the flag survives navigation.
const IS_APP = (() => {
  try { if (document.referrer.startsWith("android-app://")) store.set("isApp", true); } catch {}
  return store.get("isApp", false);
})();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const DEFAULTS = {
  snrDb: 14, refractoryMs: 90, knockRatio: 0.25, rejectKnocks: true,
  dashWin: 300, letterGap: 1000, wordGap: 2800, vibrate: true, calibrated: false,
};
let S = Object.assign({}, DEFAULTS, store.get("settings", {}));

const decoder = new MorseDecoder();
let trainingParams = null; // detector settings while teaching the pen

function detectorParams() {
  return trainingParams || { snrDb: S.snrDb, refractoryMs: S.refractoryMs, knockRatio: S.knockRatio, rejectKnocks: S.rejectKnocks };
}
function applySettings() {
  decoder.set({ dashWin: S.dashWin, letterGap: S.letterGap, wordGap: S.wordGap });
  if (node) node.port.postMessage({ type: "set", params: detectorParams() });
}
function saveSettings() { store.set("settings", S); applySettings(); syncSettingsUI(); }

const sliders = [
  ["sSnr", "snrDb", "oSnr", (v) => `${v} dB`],
  ["sEcho", "refractoryMs", "oEcho", (v) => `${v} ms`],
  ["sDash", "dashWin", "oDash", (v) => `${v} ms`],
  ["sLetter", "letterGap", "oLetter", (v) => `${(v / 1000).toFixed(2)} s`],
  ["sWord", "wordGap", "oWord", (v) => `${(v / 1000).toFixed(1)} s`],
];
function syncSettingsUI() {
  for (const [id, key, out, fmt] of sliders) { $(id).value = S[key]; $(out).textContent = fmt(S[key]); }
  $("sKnock").checked = S.rejectKnocks;
  $("sVibrate").checked = S.vibrate;
}
for (const [id, key] of sliders) $(id).addEventListener("input", () => { S[key] = +$(id).value; saveSettings(); });
$("sKnock").addEventListener("change", () => { S.rejectKnocks = $("sKnock").checked; saveSettings(); });
$("sVibrate").addEventListener("change", () => { S.vibrate = $("sVibrate").checked; saveSettings(); });
$("btnReset").addEventListener("click", () => { S = Object.assign({}, DEFAULTS); saveSettings(); flashStatus("Settings reset"); });

// ---------------------------------------------------------------------------
// Microphone
// ---------------------------------------------------------------------------
let ac = null, node = null, stream = null, listening = false, wakeLock = null;

async function startMic() {
  if (listening) return true;
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    setStatus("This browser can't listen for clicks. Use the tap pad, or open the app in Chrome.", "err");
    return false;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    ac = new AudioContext();
    await ac.audioWorklet.addModule("click-worklet.js");
    node = new AudioWorkletNode(ac, "click-processor");
    node.port.onmessage = onAudioMessage;
    node.port.postMessage({ type: "set", params: detectorParams() });
    const mute = ac.createGain(); mute.gain.value = 0;
    ac.createMediaStreamSource(stream).connect(node).connect(mute).connect(ac.destination);
    await ac.resume();
    listening = true;
    keepAwake();
    updateMicUI();
    return true;
  } catch (err) {
    stopMic();
    setStatus(err && err.name === "NotAllowedError"
      ? "Microphone access is off. Allow it in your phone's settings for this app, or use the tap pad."
      : "Couldn't start the microphone. Use the tap pad, or try again.", "err");
    return false;
  }
}
function stopMic() {
  stream?.getTracks().forEach((t) => t.stop());
  ac?.close().catch(() => {});
  ac = node = stream = null;
  listening = false;
  wakeLock?.release().catch(() => {}); wakeLock = null;
  updateMicUI();
}
async function keepAwake() {
  try { if (listening && "wakeLock" in navigator && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

function updateMicUI() {
  $("mic").setAttribute("aria-pressed", String(listening));
  $("micLabel").textContent = listening ? "Stop" : "Listen";
  if (listening) setStatus("Listening for clicks", "live"); else setStatus("Microphone off");
  render();
}
$("mic").addEventListener("click", () => (listening ? stopMic() : startMic()));

// Audio clock → page clock
const toPageTime = (audioMs) => performance.now() - (ac.currentTime * 1000 - audioMs);

const levels = [];   // recent levels for the tape
let lastFloor = null;
function onAudioMessage({ data: d }) {
  if (d.type === "level") {
    levels.push({ t: performance.now(), e: d.e, thr: d.thr });
    lastFloor = d.floor;
    return;
  }
  const t = toPageTime(d.t);
  if (setup.active) { setup.onEvent(d, t); return; }
  if (performance.now() < ignoreMicUntil) return; // don't decode our own Send playback
  if (d.type === "click") registerClick(t);
  else {
    marks.push({ t, kind: "reject" });
    flashStatus(d.reason === "knock" ? "Ignored a knock" : "Ignored a long sound");
  }
}

// ---------------------------------------------------------------------------
// Clicks → letters
// ---------------------------------------------------------------------------
const marks = [];
let lettersThisVisit = 0;
const limited = () => !IS_APP && CONFIG.PLAY_URL && lettersThisVisit >= CONFIG.WEB_LETTER_LIMIT;

function registerClick(t) {
  if (limited()) { showLimit(); return; }
  const r = decoder.click(t);
  marks.push({ t, kind: r.type });
  if (S.vibrate && navigator.vibrate) navigator.vibrate(r.type === "dash" ? 25 : 12);
  render();
}

function tick() {
  const evs = decoder.tick(performance.now());
  for (const ev of evs) {
    if (ev.type === "letter") {
      lettersThisVisit++;
      if (mode === "practice") checkPractice(ev);
    } else if (ev.type === "unknown") {
      flashStatus(`${pretty(ev.code)} isn't a letter`);
      if (mode === "practice") checkPractice(ev);
    } else if (ev.type === "erase") {
      flashStatus("Erased the last letter");
    }
  }
  if (evs.length) render();
  drawTape();
  requestAnimationFrame(tick);
}

function render() {
  $("text").textContent = mode === "practice" ? "" : decoder.text;
  const p = decoder.preview();
  $("sym").innerHTML = p ? marksHTML(p.symbols) : "";
  $("sym").setAttribute("aria-label", p ? pretty(p.symbols) : "");
  $("guess").textContent = !p
    ? (listening ? "Listening for clicks" : "Tap below or start listening")
    : p.erase ? "erases the last letter"
    : p.exact ? `→ ${p.exact}${p.more ? "  or keep going" : ""}`
    : p.more ? "keep going…" : "not a letter";
}

// Manual input
function padClick() {
  $("pad").classList.add("flash");
  setTimeout(() => $("pad").classList.remove("flash"), 90);
  registerClick(performance.now());
}
$("pad").addEventListener("pointerdown", (e) => { e.preventDefault(); padClick(); });
$("pad").addEventListener("click", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || document.querySelector("dialog[open]")) return;
  if (["INPUT", "TEXTAREA", "BUTTON", "A"].includes(document.activeElement?.tagName) && document.activeElement !== $("pad")) return;
  e.preventDefault(); padClick();
});

// Message tools
$("btnSpace").addEventListener("click", () => { decoder.symbols && decoder.finishLetter(); if (decoder.text && !decoder.text.endsWith(" ")) decoder.text += " "; decoder.spaced = true; render(); });
$("btnBack").addEventListener("click", () => { if (decoder.symbols) decoder.symbols = decoder.symbols.slice(0, -1); else decoder.text = decoder.text.slice(0, -1); render(); });
$("btnClear").addEventListener("click", () => { decoder.reset(); render(); });
$("btnCopy").addEventListener("click", async () => {
  const txt = decoder.text.trim(); if (!txt) return;
  try { await navigator.clipboard.writeText(txt); flashStatus("Copied"); }
  catch { const r = document.createRange(); r.selectNodeContents($("text")); getSelection().removeAllRanges(); getSelection().addRange(r); flashStatus("Selected. Copy it from the menu."); }
});
if (navigator.share) {
  $("btnShare").hidden = false;
  $("btnShare").addEventListener("click", () => { const txt = decoder.text.trim(); if (txt) navigator.share({ text: txt }).catch(() => {}); });
}

// Status line
let statusTimer = null;
function setStatus(msg, cls = "") { $("status").className = "status " + cls; $("statusText").textContent = msg; }
function flashStatus(msg) {
  const keep = { msg: $("statusText").textContent, cls: $("status").className.replace("status", "").trim() };
  if (statusTimer) clearTimeout(statusTimer); else statusTimer = null;
  $("statusText").textContent = msg;
  statusTimer = setTimeout(() => { statusTimer = null; listening ? setStatus("Listening for clicks", "live") : setStatus(keep.msg, keep.cls); }, 1600);
}

function showLimit() {
  $("playLink").href = CONFIG.PLAY_URL;
  $("limitBanner").hidden = false;
}

// ---------------------------------------------------------------------------
// Tape: live level, threshold, and every click as it happens
// ---------------------------------------------------------------------------
const tape = $("tape"), tctx = tape.getContext("2d");
const TAPE_MS = 6000;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let colors = {};
const readColors = () => { colors = { accent: css("--accent"), dash: css("--dash"), muted: css("--muted"), line: css("--line") }; };
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

function drawTape() {
  const dpr = devicePixelRatio || 1, w = tape.clientWidth, h = tape.clientHeight;
  if (!w) return;
  if (tape.width !== Math.round(w * dpr) || tape.height !== Math.round(h * dpr)) { tape.width = Math.round(w * dpr); tape.height = Math.round(h * dpr); }
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.clearRect(0, 0, w, h);
  const now = performance.now();
  const x = (t) => w - ((now - t) / TAPE_MS) * w;
  const y = (e) => h - 6 - clamp((db(e) + 85) / 75, 0, 1) * (h - 14);   // −85 dB … −10 dB

  while (levels.length && now - levels[0].t > TAPE_MS) levels.shift();
  while (marks.length && now - marks[0].t > TAPE_MS) marks.shift();

  if (levels.length > 1) {
    tctx.beginPath(); tctx.moveTo(x(levels[0].t), h);
    for (const l of levels) tctx.lineTo(x(l.t), y(l.e));
    tctx.lineTo(x(levels[levels.length - 1].t), h); tctx.closePath();
    tctx.globalAlpha = 0.28; tctx.fillStyle = colors.accent; tctx.fill(); tctx.globalAlpha = 1;
    tctx.beginPath();
    levels.forEach((l, i) => (i ? tctx.lineTo(x(l.t), y(l.thr)) : tctx.moveTo(x(l.t), y(l.thr))));
    tctx.setLineDash([4, 4]); tctx.strokeStyle = colors.dash; tctx.lineWidth = 1; tctx.stroke(); tctx.setLineDash([]);
  }
  for (const m of marks) {
    const mx = x(m.t);
    if (m.kind === "reject") {
      tctx.strokeStyle = colors.muted; tctx.lineWidth = 1.5;
      tctx.beginPath(); tctx.moveTo(mx - 4, 10); tctx.lineTo(mx + 4, 18); tctx.moveTo(mx + 4, 10); tctx.lineTo(mx - 4, 18); tctx.stroke();
    } else {
      tctx.fillStyle = m.kind === "dash" ? colors.dash : colors.accent;
      tctx.fillRect(mx - 1.5, 8, 3, h - 16);
    }
  }
  tctx.fillStyle = colors.muted; tctx.font = `11px ${css("--mono")}`;
  tctx.fillText("now", w - 28, h - 8);
}

// ---------------------------------------------------------------------------
// Practice mode
// ---------------------------------------------------------------------------
let mode = "decode", target = "K", streak = 0, showCode = store.get("showCode", true), savedText = "";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function setMode(m) {
  if (m === mode) return;
  if (mode === "practice") decoder.text = savedText;
  if (mode === "send" && sending) stopSending();
  if (m === "practice") { savedText = decoder.text; decoder.text = ""; nextTarget(); }
  mode = m;
  for (const v of ["decode", "send", "practice"]) {
    $("tab-" + v).setAttribute("aria-selected", String(m === v));
    $("view-" + v).hidden = m !== v;
  }
  render();
}
for (const v of ["decode", "send", "practice"]) $("tab-" + v).addEventListener("click", () => setMode(v));

function nextTarget() {
  let n; do { n = LETTERS[Math.floor(Math.random() * LETTERS.length)]; } while (n === target);
  target = n;
  $("target").textContent = target;
  $("targetCode").innerHTML = marksHTML(ENCODE[target]);
  $("targetCode").setAttribute("aria-label", pretty(ENCODE[target]));
  $("targetCode").classList.toggle("hidden-code", !showCode);
  $("practiceResult").className = "practice-result";
  $("practiceResult").textContent = showCode ? "One click is a dot, a double click is a dash." : "Send it from memory.";
}
function checkPractice(ev) {
  decoder.text = "";
  const res = $("practiceResult");
  if (ev.type === "letter" && ev.ch === target) {
    streak++; res.className = "practice-result good"; res.textContent = "Correct";
    if (S.vibrate && navigator.vibrate) navigator.vibrate([20, 60, 20]);
    setTimeout(nextTarget, 700);
  } else {
    streak = 0; res.className = "practice-result bad";
    res.textContent = ev.type === "letter" ? `You sent ${ev.ch} (${pretty(ev.code)}). Try again.` : `${pretty(ev.code)} isn't a letter. Try again.`;
  }
  $("streak").textContent = streak;
}
$("btnHint").addEventListener("click", () => {
  showCode = !showCode; store.set("showCode", showCode);
  $("btnHint").textContent = showCode ? "Hide pattern" : "Show pattern";
  $("targetCode").classList.toggle("hidden-code", !showCode);
});
$("btnSkip").addEventListener("click", () => { streak = 0; $("streak").textContent = 0; nextTarget(); });
$("btnHint").textContent = showCode ? "Hide pattern" : "Show pattern";

// ---------------------------------------------------------------------------
// Send mode: play a typed message as pen clicks for another phone to decode
// ---------------------------------------------------------------------------
// One standard timing that sits inside what any normally tuned receiver accepts
// (tested against fast, default and slow receivers in tests/detector.test.js).
const SEND_TIMING = { dashWin: 300, letterGap: 1250, wordGap: 2800, refractoryMs: 90 };
let sending = false, sendCtx = null, sendTimers = [], ignoreMicUntil = 0, clickBuffer = null;
const sendOpts = Object.assign({ sound: true, vibrate: false, flash: false }, store.get("sendOpts", {}));
$("optSound").checked = sendOpts.sound;
$("optVibrate").checked = sendOpts.vibrate;
$("optFlash").checked = sendOpts.flash;
for (const [id, key] of [["optSound", "sound"], ["optVibrate", "vibrate"], ["optFlash", "flash"]]) {
  $(id).addEventListener("change", () => { sendOpts[key] = $(id).checked; store.set("sendOpts", sendOpts); });
}
if (!navigator.vibrate) $("optVibrate").closest(".chip").hidden = true;

function renderSendCode() {
  const sch = clickSchedule($("sendText").value, SEND_TIMING);
  const words = $("sendText").value.toUpperCase().trim().split(/\s+/).filter(Boolean);
  let html = "", i = 0;
  words.forEach((w, wi) => {
    if (wi > 0 && i > 0) html += `<span class="sc-word"></span>`;
    for (const ch of w) {
      if (!ENCODE[ch]) continue;
      html += `<span class="sc-letter" data-i="${i++}"><b>${ch}</b>${marksHTML(ENCODE[ch])}</span>`;
    }
  });
  $("sendCode").innerHTML = html;
  const secs = Math.ceil(sch.duration / 1000);
  $("sendHint").textContent = sch.skipped.length
    ? `Can't send ${sch.skipped.join(" ")}. Use letters, numbers and . , ? ! / @ = + - ' :`
    : sch.clicks.length
      ? `About ${secs} seconds. Hold this phone next to the other phone, with your volume up. The other phone should be on Decode and listening.`
      : "Hold this phone next to the other phone, with your volume up. The other phone should be on Decode and listening.";
}
$("sendText").addEventListener("input", () => { store.set("sendDraft", $("sendText").value); renderSendCode(); });
$("sendText").value = store.get("sendDraft", "");
renderSendCode();

// A short, bright, broadband snap: the same kind of sound as a pen click.
function makeClickBuffer(ctx) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.025);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.random() * 2 - 1, hf = r - prev; prev = r;
    d[i] = clamp(0.55 * hf * Math.exp(-i / (sr * 0.0025)) + 0.35 * Math.sin((2 * Math.PI * 3500 * i) / sr) * Math.exp(-i / (sr * 0.002)), -1, 1);
  }
  return buf;
}

function flashScreen() {
  $("flashOverlay").hidden = false;
  setTimeout(() => ($("flashOverlay").hidden = true), 70);
}

async function playMessage() {
  const sch = clickSchedule($("sendText").value, SEND_TIMING);
  if (!sch.clicks.length) { flashStatus("Type a message first"); $("sendText").focus(); return; }
  if (!sendOpts.sound && !sendOpts.vibrate && !sendOpts.flash) { flashStatus("Choose Clicks, Vibrate or Flash"); return; }
  $("sendText").blur();
  sending = true;
  $("btnPlay").textContent = "Stop";
  $("btnPlay").classList.add("playing");
  const lead = 300;
  const t0 = performance.now() + lead;
  ignoreMicUntil = t0 + sch.duration;
  if (sendOpts.sound) {
    try {
      sendCtx = new AudioContext();
      await sendCtx.resume();
      clickBuffer = clickBuffer && clickBuffer.sampleRate === sendCtx.sampleRate ? clickBuffer : makeClickBuffer(sendCtx);
      const gain = sendCtx.createGain(); gain.gain.value = 0.9; gain.connect(sendCtx.destination);
      const a0 = sendCtx.currentTime + lead / 1000;
      for (const c of sch.clicks) {
        const src = sendCtx.createBufferSource(); src.buffer = clickBuffer; src.connect(gain); src.start(a0 + c.t / 1000);
      }
    } catch { flashStatus("Couldn't play sound on this phone"); }
  }
  const at = (ms, fn) => sendTimers.push(setTimeout(fn, Math.max(0, t0 + ms - performance.now())));
  for (const c of sch.clicks) {
    at(c.t, () => {
      marks.push({ t: performance.now(), kind: c.kind });
      if (sendOpts.vibrate && navigator.vibrate) navigator.vibrate(35);
      if (sendOpts.flash) flashScreen();
    });
  }
  const els = [...document.querySelectorAll("#sendCode .sc-letter")];
  sch.letters.forEach((l, i) => at(l.start, () => {
    els.forEach((e, j) => { e.classList.toggle("on", j === i); e.classList.toggle("done", j < i); });
  }));
  at(sch.clicks[sch.clicks.length - 1].t + 400, () => { stopSending(); flashStatus("Message sent"); });
}

function stopSending() {
  sendTimers.forEach(clearTimeout); sendTimers = [];
  sendCtx?.close().catch(() => {}); sendCtx = null;
  navigator.vibrate?.(0);
  $("flashOverlay").hidden = true;
  sending = false;
  ignoreMicUntil = performance.now() + 300;
  $("btnPlay").textContent = "Play message";
  $("btnPlay").classList.remove("playing");
  document.querySelectorAll("#sendCode .sc-letter").forEach((e) => e.classList.remove("on", "done"));
}
$("btnPlay").addEventListener("click", () => (sending ? stopSending() : playMessage()));

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
});
$("openSettings").addEventListener("click", () => { syncSettingsUI(); $("settings").showModal(); });
$("btnChart").addEventListener("click", () => { $("settings").close(); $("chartDlg").showModal(); });
$("chart").innerHTML = Object.entries(MORSE)
  .map(([code, ch]) => `<div><b>${ch}</b><span>${pretty(code)}</span></div>`).join("");

// ---------------------------------------------------------------------------
// Teach it your pen — learns loudness, release echo and double-click speed
// ---------------------------------------------------------------------------
const setup = {
  active: false, step: null, events: [], floors: [], result: {}, timer: null, lastHeard: 0,

  open() {
    store.set("setupSeen", true);
    this.show("welcome");
    $("settings").close();
    $("setup").showModal();
  },
  close() {
    this.active = false; trainingParams = null; clearInterval(this.timer); applySettings();
  },
  params(p) { trainingParams = Object.assign({ snrDb: 8, refractoryMs: 35, rejectKnocks: false, knockRatio: 0 }, p); applySettings(); },

  show(step) {
    this.step = step; this.events = []; clearInterval(this.timer);
    const b = $("setupBody");
    if (step === "welcome") {
      this.active = false;
      b.innerHTML = `
        <p class="step-big">Every pen sounds different. Click yours a few times and the app will tune itself to it.</p>
        <p>Takes about 30 seconds. Hold the pen 10–30 cm from your phone's microphone, usually at the bottom edge.</p>
        <div class="row"><button class="btn primary wide" id="stGo">Start</button></div>
        <div class="row"><button class="btn" id="stSkip">Skip, I'll tap instead</button></div>`;
      $("stGo").onclick = async () => { if (await startMic()) this.show("quiet"); else b.insertAdjacentHTML("beforeend", `<p class="warn">The microphone didn't start. Allow microphone access and try again.</p>`); };
      $("stSkip").onclick = () => $("setup").close();
    }
    if (step === "quiet") {
      this.active = true; this.params({ snrDb: 40 }); this.floors = [];
      node.port.postMessage({ type: "resetFloor" });
      b.innerHTML = `<p class="step-label">Step 1 of 3</p><p class="step-big">Stay quiet for a moment…</p>
        <p>Measuring the background noise in the room.</p><div class="bar"><i id="stBar"></i></div>`;
      const t0 = performance.now();
      this.timer = setInterval(() => {
        const p = (performance.now() - t0) / 2000;
        $("stBar").style.width = Math.min(100, p * 100) + "%";
        if (p > 0.5 && lastFloor) this.floors.push(lastFloor);
        if (p >= 1) { this.result.floor = this.floors.sort((a, c) => a - c)[Math.floor(this.floors.length / 2)] || lastFloor || 1e-8; this.show("single"); }
      }, 50);
    }
    if (step === "single") {
      this.params({});
      this.presses = []; this.echoGaps = [];
      b.innerHTML = `<p class="step-label">Step 2 of 3</p><p class="step-big">Click your pen 6 times, about once a second.</p>
        <div class="pips" id="stPips">${"<span class='pip'></span>".repeat(6)}</div><p class="hint" id="stHint"></p>`;
      this.watchSilence();
    }
    if (step === "double") {
      this.params({ refractoryMs: this.result.refractoryMs });
      this.first = null; this.gaps = []; this.singles = 0;
      b.innerHTML = `<p class="step-label">Step 3 of 3</p><p class="step-big">Now double-click 4 times, like you would for a dash.</p>
        <div class="pips" id="stPips">${"<span class='pip pair'></span>".repeat(4)}</div><p class="hint" id="stHint">Leave about a second between each double click.</p>`;
      this.watchSilence();
    }
    if (step === "done") {
      this.close();
      const r = this.result;
      const quality = r.marginDb >= 25 ? "Excellent" : r.marginDb >= 15 ? "Good" : "Noisy room";
      b.innerHTML = `<p class="step-big">All set. Your pen is tuned in.</p>
        <dl class="summary">
          <div><dt>Click vs. room noise</dt><dd>${quality} (${Math.round(r.marginDb)} dB)</dd></div>
          <div><dt>Click threshold</dt><dd>${S.snrDb} dB</dd></div>
          <div><dt>Release echo</dt><dd>${r.echo ? `filtered (${S.refractoryMs} ms)` : "none heard"}</dd></div>
          <div><dt>Double-click window</dt><dd>${S.dashWin} ms</dd></div>
        </dl>
        ${r.marginDb < 15 ? `<p class="warn">Your clicks are close to the room's noise. Hold the pen nearer the microphone for better results.</p>` : ""}
        <div class="row"><button class="btn primary wide" id="stDone">Start sending</button></div>
        <div class="row"><button class="btn" id="stRedo">Do it again</button></div>`;
      $("stDone").onclick = () => $("setup").close();
      $("stRedo").onclick = () => this.show("quiet");
    }
  },

  watchSilence() {
    this.lastHeard = performance.now();
    this.timer = setInterval(() => {
      if (performance.now() - this.lastHeard > 8000 && $("stHint")) {
        $("stHint").textContent = "Not hearing it yet. Move the pen closer to the microphone and click firmly.";
        if (trainingParams.snrDb > 5) this.params({ ...trainingParams, snrDb: trainingParams.snrDb - 2 });
        this.lastHeard = performance.now();
      }
    }, 500);
  },

  onEvent(d, t) {
    if (d.type !== "click" || !this.step) return;
    this.lastHeard = performance.now();
    if (navigator.vibrate && S.vibrate) navigator.vibrate(12);
    if (this.step === "single") {
      const last = this.presses[this.presses.length - 1];
      if (last && t - last.t < 250) { this.echoGaps.push(t - last.t); return; }
      if (this.presses.length >= 6) return;
      this.presses.push({ t, peak: d.peak, ratio: d.ratio });
      document.querySelectorAll("#stPips .pip")[this.presses.length - 1]?.classList.add("on");
      if (this.presses.length === 6) setTimeout(() => this.learnSingle(), 600);
    }
    if (this.step === "double") {
      if (this.first && t - this.first < 700) {
        this.gaps.push(t - this.first); this.first = null; this.singles = 0;
        const pip = document.querySelectorAll("#stPips .pip")[this.gaps.length - 1];
        if (pip) { pip.classList.add("on"); pip.textContent = "– "; }
        if (this.gaps.length === 4) this.learnDouble();
      } else {
        this.first = t;
        if (++this.singles >= 4 && this.result.echo) {
          // The echo filter is swallowing the second click; relax it.
          this.result.refractoryMs = 60; this.result.echo = false; this.singles = 0;
          this.params({ refractoryMs: 60 });
          $("stHint").textContent = "Only hearing single clicks. Try double-clicking a little slower.";
        }
      }
    }
  },

  learnSingle() {
    const r = this.result, peaks = this.presses.map((p) => p.peak).sort((a, c) => a - c);
    r.echo = this.echoGaps.length >= 3;
    r.refractoryMs = r.echo ? clamp(Math.round(Math.max(...this.echoGaps) + 40), 90, 260) : 90;
    const weak = peaks[1] ?? peaks[0];                 // tolerate one feeble click
    const median = peaks[Math.floor(peaks.length / 2)];
    r.marginDb = db(median) - db(r.floor);
    r.snrDb = clamp(Math.round(db(weak) - db(r.floor) - 8), 8, 30);
    const minRatio = Math.min(...this.presses.map((p) => p.ratio));
    r.knockRatio = clamp(minRatio / 4, 0.02, 0.25);
    this.show("double");
  },

  learnDouble() {
    const r = this.result;
    r.dashWin = clamp(Math.round(Math.max(...this.gaps) * 1.4 + 40), 180, 650);
    if (r.echo && r.refractoryMs >= Math.min(...this.gaps) * 0.85) r.refractoryMs = Math.round(Math.min(...this.gaps) * 0.7);
    Object.assign(S, {
      snrDb: r.snrDb, refractoryMs: r.refractoryMs, knockRatio: r.knockRatio, dashWin: r.dashWin,
      letterGap: Math.max(S.letterGap, r.dashWin + 500), calibrated: true,
    });
    store.set("settings", S);
    setTimeout(() => this.show("done"), 400);
  },
};
$("btnTeach").addEventListener("click", () => setup.open());
$("setup").addEventListener("close", () => { setup.close(); setup.step = null; });

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
syncSettingsUI();
applySettings();
render();
requestAnimationFrame(tick);
if (!store.get("setupSeen", false)) setup.open();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

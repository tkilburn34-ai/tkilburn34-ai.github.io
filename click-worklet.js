/*
 * Pen Click Morse — click detector
 *
 * Runs inside an AudioWorklet, so every audio sample is examined (no missed
 * clicks from a slow animation frame). The same ClickDetector class is loaded
 * by the Node tests in /tests.
 *
 * How a click is recognised, per ~1.3 ms block of audio:
 *   1. Split the signal into a high band (> 2 kHz, where a pen click lives)
 *      and a low band (< 400 Hz, where table knocks and voices live).
 *   2. Track the room's background level ("noise floor") in the high band.
 *   3. A click starts when the high band jumps well above the floor AND well
 *      above the last ~10 ms (a sharp onset, not a slow swell).
 *   4. A click must die away fast (within maxClickMs). Anything that keeps
 *      ringing is speech, music or rustling, and is ignored.
 *   5. Optionally, reject sounds whose energy is mostly low frequency
 *      (knocking on the table, bumping the phone).
 *   6. Ignore anything within refractoryMs of the last click, so the softer
 *      "release" click of a pen isn't counted twice.
 */

function makeBiquad(type, freq, sampleRate, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0, b1, b2;
  if (type === "highpass") {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
  } else {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
  }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const dbToPow = (db) => Math.pow(10, db / 10);

const DEFAULTS = {
  snrDb: 14,          // how far above the room noise a click must be
  riseDb: 8,          // how sharp the onset must be vs. the previous ~10 ms
  decayDb: 14,        // a click has ended once it falls this far below its peak
  maxClickMs: 70,     // longer than this = not a click
  refractoryMs: 90,   // ignore echoes / release clicks for this long
  rejectKnocks: true,
  knockRatio: 0.25,   // min high-band / low-band energy for a click
  minEnergy: 1e-9,    // absolute floor so digital silence can't trigger
};

class ClickDetector {
  constructor(sampleRate, opts = {}) {
    this.sampleRate = sampleRate;
    this.blockSize = 64;
    this.blockMs = (this.blockSize / sampleRate) * 1000;
    this.hp1 = makeBiquad("highpass", 2000, sampleRate);
    this.hp2 = makeBiquad("highpass", 2000, sampleRate); // 4th order total
    this.lp = makeBiquad("lowpass", 400, sampleRate);
    this.p = Object.assign({}, DEFAULTS);
    this.set(opts);
    this.floor = null;
    this.hist = new Float64Array(8);
    this.histI = 0;
    this.ev = null;          // click currently being measured
    this.sustain = false;    // inside a rejected long sound
    this.lastOnset = -1e9;   // ms
    this.acc = 0; this.accLo = 0; this.accN = 0;
    this.clock = 0;          // ms since start, advanced per sample
  }

  set(o) {
    Object.assign(this.p, o);
    this.snrLin = dbToPow(this.p.snrDb);
    this.riseLin = dbToPow(this.p.riseDb);
    this.decayLin = dbToPow(-this.p.decayDb);
  }

  threshold() {
    return Math.max((this.floor ?? 0) * this.snrLin, this.p.minEnergy);
  }

  /** Feed raw samples. startMs = time of samples[0]. Returns events. */
  process(samples, startMs) {
    const out = [];
    const msPerSample = 1000 / this.sampleRate;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const h = this.hp2(this.hp1(x));
      const l = this.lp(x);
      this.acc += h * h; this.accLo += l * l; this.accN++;
      if (this.accN === this.blockSize) {
        const t = startMs + (i + 1) * msPerSample - this.blockMs;
        const ev = this.block(this.acc / this.blockSize, this.accLo / this.blockSize, t);
        if (ev) out.push(ev);
        this.acc = 0; this.accLo = 0; this.accN = 0;
      }
    }
    return out;
  }

  block(e, lo, t) {
    let result = null;
    const prev = this.hist.reduce((a, b) => a + b, 0) / this.hist.length;
    if (this.floor === null) this.floor = Math.max(e, this.p.minEnergy);

    if (this.sustain) {
      // Wait for a long sound (speech, music) to fade before listening again.
      if (e < this.threshold()) { this.sustain = false; this.lastOnset = t; }
      this.updateFloor(e, true);
    } else if (this.ev) {
      const ev = this.ev;
      ev.n++; ev.hi += e; ev.lo += lo;
      if (e > ev.peak) ev.peak = e;
      const dur = ev.n * this.blockMs;
      if (e < ev.peak * this.decayLin || e < this.floor * 2) {
        this.ev = null;
        const ratio = ev.hi / Math.max(ev.lo, 1e-15);
        if (this.p.rejectKnocks && ratio < this.p.knockRatio) {
          result = { type: "reject", reason: "knock", t: ev.t, peak: ev.peak, ratio, dur };
        } else {
          result = { type: "click", t: ev.t, peak: ev.peak, ratio, dur, floor: this.floor };
        }
      } else if (dur > this.p.maxClickMs) {
        this.ev = null;
        this.sustain = true;
        result = { type: "reject", reason: "long", t: ev.t, peak: ev.peak, dur };
      }
    } else {
      const thr = this.threshold();
      if (e > thr && e > prev * this.riseLin && t - this.lastOnset > this.p.refractoryMs) {
        this.ev = { t, peak: e, hi: e, lo, n: 1 };
        this.lastOnset = t;
      } else {
        this.updateFloor(e, false);
      }
    }
    this.hist[this.histI] = e;
    this.histI = (this.histI + 1) % this.hist.length;
    return result;
  }

  updateFloor(e, slow) {
    // Falls quickly to quiet, rises slowly with noise, so clicks don't lift it.
    const k = e < this.floor ? 0.05 : (slow ? 0.0005 : 0.002);
    this.floor = Math.max(this.floor + (e - this.floor) * k, this.p.minEnergy);
  }
}

if (typeof registerProcessor === "function") {
  class ClickProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.det = new ClickDetector(sampleRate);
      this.levelEvery = Math.round(sampleRate / 40 / 128); // ~40 level updates/s
      this.n = 0; this.peak = 0;
      this.port.onmessage = (m) => {
        if (m.data.type === "set") this.det.set(m.data.params);
        if (m.data.type === "resetFloor") this.det.floor = null;
      };
    }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (!ch) return true;
      const startMs = currentTime * 1000;
      for (const ev of this.det.process(ch, startMs)) this.port.postMessage(ev);
      for (let i = 0; i < this.det.hist.length; i++) if (this.det.hist[i] > this.peak) this.peak = this.det.hist[i];
      if (++this.n >= this.levelEvery) {
        this.port.postMessage({ type: "level", e: this.peak, floor: this.det.floor, thr: this.det.threshold() });
        this.n = 0; this.peak = 0;
      }
      return true;
    }
  }
  registerProcessor("click-processor", ClickProcessor);
}

if (typeof module !== "undefined") module.exports = { ClickDetector, DEFAULTS };

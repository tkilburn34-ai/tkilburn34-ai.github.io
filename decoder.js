/*
 * Pen Click Morse — timing decoder
 *
 * Turns click times into Morse symbols and letters. Pure and clock-driven:
 * call click(t) for every click and tick(now) regularly, both in milliseconds
 * on the same clock. No timers inside, so it is easy to test.
 *
 *   one click                      → dot
 *   two clicks within dashWin      → dash
 *   silence of letterGap           → end of letter
 *   silence of wordGap             → space
 *   six or more dots               → erase the last letter (Morse "error")
 */
(function (root) {
  const MORSE = {
    ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F", "--.": "G", "....": "H",
    "..": "I", ".---": "J", "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O", ".--.": "P",
    "--.-": "Q", ".-.": "R", "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X",
    "-.--": "Y", "--..": "Z",
    "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5",
    "-....": "6", "--...": "7", "---..": "8", "----.": "9",
    ".-.-.-": ".", "--..--": ",", "..--..": "?", "-.-.--": "!", "-..-.": "/", ".--.-.": "@",
    "-...-": "=", ".-.-.": "+", "-....-": "-", ".----.": "'", "---...": ":",
  };
  const ENCODE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

  class MorseDecoder {
    constructor(opts = {}) {
      this.o = { dashWin: 300, letterGap: 1000, wordGap: 2800 };
      this.set(opts);
      this.reset();
    }
    set(opts) {
      Object.assign(this.o, opts);
      // Keep the gaps in a sensible order whatever the sliders say.
      this.o.letterGap = Math.max(this.o.letterGap, this.o.dashWin + 250);
      this.o.wordGap = Math.max(this.o.wordGap, this.o.letterGap + 500);
    }
    reset() {
      this.text = "";
      this.symbols = "";
      this.pending = null;   // time of a click that may become a dash
      this.lastAct = null;   // time of the last symbol-producing click
      this.spaced = true;
    }
    click(t) {
      if (this.pending !== null && t - this.pending <= this.o.dashWin) {
        this.pending = null;
        this.symbols += "-";
        this.lastAct = t;
        return { type: "dash" };
      }
      if (this.pending !== null) this.symbols += "."; // tick() was late
      this.pending = t;
      this.lastAct = t;
      return { type: "click" };
    }
    tick(now) {
      const out = [];
      if (this.pending !== null && now - this.pending > this.o.dashWin) {
        this.symbols += ".";
        this.lastAct = this.pending;
        this.pending = null;
        out.push({ type: "dot" });
      }
      if (this.pending === null && this.symbols && now - this.lastAct > this.o.letterGap) {
        out.push(this.finishLetter());
      }
      if (!this.spaced && this.pending === null && !this.symbols && this.lastAct !== null &&
          now - this.lastAct > this.o.wordGap) {
        this.text += " ";
        this.spaced = true;
        out.push({ type: "space" });
      }
      return out;
    }
    finishLetter() {
      const code = this.symbols;
      this.symbols = "";
      if (/^\.{6,}$/.test(code)) {
        this.text = this.text.replace(/\s*\S$/, "");
        this.spaced = true;
        return { type: "erase", code };
      }
      const ch = MORSE[code];
      if (!ch) return { type: "unknown", code };
      this.text += ch;
      this.spaced = false;
      return { type: "letter", ch, code };
    }
    /** What the symbols so far could still become. */
    preview() {
      if (!this.symbols && this.pending === null) return null;
      const s = this.symbols + (this.pending !== null ? "." : "");
      const exact = MORSE[s] || null;
      const more = Object.keys(MORSE).some((k) => k.length > s.length && k.startsWith(s));
      return { symbols: s, exact, more, erase: /^\.{6,}$/.test(s) };
    }
  }

  /**
   * Plan a message as pen clicks, timed so a phone listening with settings `o`
   * decodes it. Returns click times (ms from start) and the letters they spell.
   *   o = { dashWin, letterGap, wordGap, refractoryMs }
   */
  function clickSchedule(text, o) {
    const dashWin = o.dashWin, letterGap = Math.max(o.letterGap, dashWin + 250);
    const wordGap = Math.max(o.wordGap, letterGap + 500), refr = o.refractoryMs || 90;
    // Second click of a dash: after the echo filter, well inside the double-click window.
    const lo = refr + 40, hi = dashWin - 50;
    const pairGap = Math.round(lo <= hi ? (lo + hi) / 2 : (refr + dashWin) / 2);
    const symGap = Math.round(Math.min(dashWin + 220, letterGap - 150));            // next symbol
    const letterPause = Math.round(Math.min(letterGap + 350, (letterGap + wordGap) / 2)); // next letter
    const wordPause = Math.round(wordGap + 600);                                     // next word

    const clicks = [], letters = [], skipped = [];
    let t = 0, last = null; // time of the previous click
    const words = String(text).toUpperCase().trim().split(/\s+/).filter(Boolean);
    words.forEach((word, wi) => {
      let first = true;
      for (const ch of word) {
        const code = ENCODE[ch];
        if (!code) { if (!skipped.includes(ch)) skipped.push(ch); continue; }
        if (last !== null) t = last + (first && wi > 0 && letters.length ? wordPause : letterPause);
        first = false;
        const li = letters.length;
        letters.push({ ch, code, start: t });
        [...code].forEach((s, si) => {
          if (si > 0) t = last + symGap;
          clicks.push({ t, letter: li, kind: "click" });
          last = t;
          if (s === "-") { t += pairGap; clicks.push({ t, letter: li, kind: "dash" }); last = t; }
        });
      }
    });
    const duration = last === null ? 0 : last + letterGap + 200;
    return { clicks, letters, skipped, duration, timing: { pairGap, symGap, letterPause, wordPause } };
  }

  /**
   * Messages shared as links carry the text in the link's #msg= part, so it
   * never passes through a server. Only Morse-able characters are kept.
   */
  function cleanMessage(text) {
    return String(text).toUpperCase().split(/\s+/)
      .map((w) => [...w].filter((c) => ENCODE[c]).join("")).filter(Boolean).join(" ").slice(0, 80);
  }
  function encodeShare(text) {
    const bytes = new TextEncoder().encode(cleanMessage(text));
    let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeShare(token) {
    try {
      const b64 = String(token).replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
      const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      return cleanMessage(text) || null;
    } catch { return null; }
  }

  const api = { MorseDecoder, MORSE, ENCODE, clickSchedule, cleanMessage, encodeShare, decodeShare };
  if (typeof module !== "undefined") module.exports = api;
  else Object.assign(root, api);
})(this);

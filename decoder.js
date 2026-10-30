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

  const api = { MorseDecoder, MORSE, ENCODE };
  if (typeof module !== "undefined") module.exports = api;
  else Object.assign(root, api);
})(this);

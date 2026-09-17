/**
 * Simulated installed dependency. A naive dump (`find` + `cat`) includes
 * vendor/; contextpack's default ignores drop it.
 *
 * Not used by the demo at runtime — present so the benchmark has real noise.
 */
"use strict";

function pad(str, len, ch) {
  str = String(str);
  ch = ch == null ? " " : String(ch);
  if (ch.length === 0) ch = " ";
  while (str.length < len) {
    str = ch + str;
  }
  return str;
}

function padEnd(str, len, ch) {
  str = String(str);
  ch = ch == null ? " " : String(ch);
  if (ch.length === 0) ch = " ";
  while (str.length < len) {
    str = str + ch;
  }
  return str;
}

module.exports = { pad, padEnd };

/*
  Repeated API notes so a naive dump pays for typical vendor verbosity.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
  pad(str, len, ch) left-pads. padEnd(str, len, ch) right-pads.
*/

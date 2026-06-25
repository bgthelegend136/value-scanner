import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

test("boost reports a strong verdict for a single-market boost", async () => {
  let out = "";
  const code = await runCli(["boost", "--base=2.25", "--boost=2.75", "--market=1x2"], {
    out: (text) => { out += text; },
    err: () => {},
  });
  assert.equal(code, 0);
  assert.match(out, /Boost multiplier: ×1\.222/);
  assert.match(out, /STRONG_VALUE/);
});

test("boost flips to negative once the same boost rides a soft prop", async () => {
  let out = "";
  const code = await runCli(["boost", "--base=2.5", "--boost=2.7", "--market=saves"], {
    out: (text) => { out += text; },
    err: () => {},
  });
  assert.equal(code, 0);
  assert.match(out, /NEGATIVE/);
});

test("boost lists reference margins when no market is given", async () => {
  let out = "";
  const code = await runCli(["boost", "--base=2.25", "--boost=2.75"], {
    out: (text) => { out += text; },
    err: () => {},
  });
  assert.equal(code, 0);
  assert.doesNotMatch(out, /EV:/);
  assert.match(out, /typical TOTAL margins/);
});

test("boost rejects missing odds with a usage hint", async () => {
  let err = "";
  const code = await runCli(["boost", "--base=2.25"], {
    out: () => {},
    err: (text) => { err += text; },
  });
  assert.equal(code, 1);
  assert.match(err, /usage: boost/);
});

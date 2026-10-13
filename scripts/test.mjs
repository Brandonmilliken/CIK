/* scripts/test.mjs — run every suite, and say so out loud when one did not run.
 *
 * THE REASON THIS EXISTS. The suites were being run by hand, a few at a time.
 * extract.test.mjs — 23 assertions about the exact Sisu envelope — had been
 * throwing on import for an unknown number of versions, because lib/db.js
 * demands a DATABASE_URL at module load and there was none in the build
 * container. It exited 1 with a stack trace and no summary, which in a manual
 * run looks like "that one's broken, skip it" and in no run at all looks like
 * nothing. Twenty-three assertions, green when last seen, running never.
 *
 * So: one command, every file matching *.test.mjs discovered from disk rather
 * than a list somebody has to remember to add to, a placeholder DATABASE_URL so
 * importing a module is not the same thing as connecting to a database, and a
 * non-zero exit if ANY suite fails to print a summary — a suite that crashes
 * must be as loud as a suite that fails.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

/* Well-formed and unreachable. lib/db.js builds a client at import time and
   validates the shape; nothing here ever opens a connection, and a suite that
   tried would fail rather than quietly reach something real. */
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";

const suites = fs.readdirSync(".").filter(n => n.endsWith(".test.mjs")).sort();
const extra = ["tests-render.mjs", "constcheck.mjs", "testguard.mjs"].filter(n => fs.existsSync(n));

let totalPass = 0, totalFail = 0, broken = [];

for (const file of [...suites, ...extra]) {
  const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  /* Two summary dialects in this repo: "N passed, M failed" and the render
     harness's "N of M render checks passed". Both must count, and neither may
     be silently missed — a suite whose summary this cannot read is reported as
     not run, not as zero. */
  const m = [...out.matchAll(/(\d+)\s+passed,\s+(\d+)\s+failed/g)].pop()
    || (() => { const r = /(\d+) of (\d+) render checks passed/.exec(out);
                return r ? [r[0], r[1], String(Number(r[2]) - Number(r[1]))] : null; })();

  if (!m) {
    broken.push(file);
    console.log(`✗ ${file} — NO SUMMARY (exit ${r.status}). It did not run.`);
    console.log(out.trim().split("\n").slice(0, 4).map(l => "    " + l).join("\n"));
    continue;
  }
  const pass = Number(m[1]), fail = Number(m[2]);
  totalPass += pass; totalFail += fail;
  console.log(`${fail ? "✗" : "✓"} ${file.padEnd(24)} ${pass} passed, ${fail} failed`);
  if (fail) out.split("\n").filter(l => l.includes("FAIL")).forEach(l => console.log("    " + l.trim()));
}

console.log(`\nTOTAL: ${totalPass} passed, ${totalFail} failed, ` +
            `${broken.length} suite(s) that did not run` +
            (broken.length ? `: ${broken.join(", ")}` : ""));
process.exit(totalFail || broken.length ? 1 : 0);

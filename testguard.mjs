/* A guard against the harness bug I have now caused three times.
 *
 * Every suite here ends with a summary line and sometimes a process.exit. Twice
 * I appended new assertions BELOW the summary, so they ran but their results
 * were never counted; once I appended below a process.exit, so they never ran
 * at all. Each time the suite reported all-green while silently covering less
 * than it claimed — which is the worst failure mode a test suite has, because
 * green is exactly when nobody looks.
 *
 * So: the summary and the exit must be the last executable lines in the file.
 */
import fs from "node:fs";

/* Discovered from disk, not typed here. A hand-maintained list is how
   extract.test.mjs stayed outside the guard while it threw on import for an
   unknown number of versions — 23 assertions that read as coverage and ran
   never. Anything named *.test.mjs is now in scope by existing. */
const SUITES = fs.readdirSync(".").filter(n => n.endsWith(".test.mjs"))
                 .map(n => n.replace(/\.test\.mjs$/, "")).sort();
let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

for (const name of SUITES) {
  const file = `${name}.test.mjs`;
  if (!fs.existsSync(file)) { ok(false, `${file} is missing`); continue; }
  const src = fs.readFileSync(file, "utf8");

  const lines = src.split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));

  /* The LAST summary, not the first. extract.test.mjs prints a running tally
     between groups ("(with real-shape cases) 18 passed, 0 failed") and then a
     final one; anchoring to the first made every group after it look like
     uncounted dead code. The check that matters is what comes after the tally
     that is actually reported. */
  const summaryIdx = lines.findLastIndex(l => /console\.log\(.*passed.*failed/.test(l));
  ok(summaryIdx >= 0, `${file} prints a summary`);
  if (summaryIdx < 0) continue;

  const after = lines.slice(summaryIdx + 1);
  const stray = after.filter(l => !/^(if \(f\) )?process\.exit/.test(l) && !/^[})\];]+;?$/.test(l));
  ok(stray.length === 0,
     `${file} has ${stray.length} executable line(s) AFTER its summary — they run uncounted: ${stray.slice(0,2).join(" | ")}`);

  /* process.exit ANYWHERE on the line, not just at its start. Four suites put
     it after the summary on the same line (`console.log(...); process.exit(...)`),
     which the old anchored pattern did not match at all — so the "does it exit
     before printing?" check was silently skipped for them. */
  const exitIdx = lines.findIndex(l => /process\.exit/.test(l));
  if (exitIdx >= 0) {
    /* >=, not >: a suite may print and exit on ONE line. The strict form
       reported those four as broken while they were fine, and a guard that
       cries wolf is a guard somebody deletes. */
    ok(exitIdx >= summaryIdx,
       `${file} exits BEFORE printing its summary — everything below never runs`);
    const afterExit = lines.slice(exitIdx + 1).filter(l => !/^[})\];]+;?$/.test(l));
    ok(afterExit.length === 0,
       `${file} has ${afterExit.length} line(s) after process.exit — dead code that looks like coverage`);
  }
}

console.log(`\ntest-harness guard: ${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);

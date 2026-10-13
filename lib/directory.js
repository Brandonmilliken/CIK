/* The team directory, read from the team contact sheet.
 *
 * MRE Office's Directory room was filled by a "directory sync" from a Google
 * Sheet published as CSV. Jarvis reads the same sheet. This file is the part
 * that turns the sheet into people. It is pure, with no network and no database,
 * so every rule below is tested on its own (directory.test.mjs).
 *
 * THE SHEET'S SHAPE (checked 2026-09-24): 31 columns, no header row at the top.
 * People are in blocks, and a block starts with a label row:
 *     (top of sheet)        -> Leadership
 *     "Support Staff"       -> Support Staff
 *     "Team Agents"         -> Team Agent
 *     "Flex Team Agents"    -> Team Agent
 *     "Independent Agents"  -> Independent Agent
 * Inside a block, some rows are column headers ("Team Member", "Email Address",
 * "Licensed State"...). Those are skipped. MRE Office's own sync did NOT skip
 * two of them, which is why its Directory showed two cards for a person called
 * "Team Member". The columns used:
 *     A (0) name   E (4) job title, or the licensed state for agents
 *     G (6) email, sometimes several separated by "/"   H (7) phone
 * Nothing else in the sheet is read into Jarvis. The sheet holds far more
 * (license and NRDS numbers among them) and none of it is stored.
 *
 * Checked against MRE Office's Directory on 2026-09-24: all 80 real people come
 * out with the same name, title, email, phone and group. Two people's licensed
 * states differ between the sheet and MRE Office. The sheet wins (see
 * mergeDirectory).
 */

export const GROUPS = ["Leadership", "Support Staff", "Team Agent", "Independent Agent"];
export const STATE_CHOICES = ["OR", "WA", "OR & WA"];

const SECTION_LABELS = {
  "support staff": "Support Staff",
  "team agents": "Team Agent",
  "flex team agents": "Team Agent",
  "independent agents": "Independent Agent",
};

/* Rows that are in the sheet but are not people in the directory. MRE Office
   left these out too. "Front Desk" is a shared office line, and it is in the
   phone contacts file (mre_contacts.vcf) instead. */
const NOT_PEOPLE = new Set(["front desk", "manufactured home license"]);
const HEADER_NAME = /^team member( names?)?$/i;

const STATE_FROM_TEXT = {
  "oregon": "OR", "washington": "WA",
  "oregon/ washington": "OR & WA", "oregon/washington": "OR & WA", "oregon / washington": "OR & WA",
  "or": "OR", "wa": "WA", "or & wa": "OR & WA", "or/wa": "OR & WA",
};

/** The licensed state an agent's column E names, or null when it is a job title. */
export function stateFromTitle(title) {
  return STATE_FROM_TEXT[String(title || "").trim().toLowerCase()] || null;
}

const EMAIL = /[^\s@\/,;<>()]+@[^\s@\/,;<>()]+\.[A-Za-z]{2,}/g;

/** Every address in an email cell, in order. "a@x.com / b@y.com" gives both. */
export function emailsIn(cell) {
  return String(cell || "").match(EMAIL) || [];
}

/** A person's first email, lower-cased. Not unique on its own: a shared inbox
    can come first in two people's cells (it does in the real sheet: one leader
    and one support staff member), so a person is known by name AND first email. */
export function firstEmail(p) {
  const e = emailsIn(p?.email)[0];
  return e ? e.toLowerCase() : "";
}

/** The key a person is matched on, from one sync to the next. */
export function personKey(p) {
  return `${String(p?.name || "").trim().toLowerCase()}|${firstEmail(p)}`;
}

/* One cell, as MRE Office stored it: control characters out, runs of
   whitespace collapsed to one space, trimmed. That is the same cleaning
   lib/office-fields.js applies to a one-line field, so a parsed person passes
   validation unchanged. */
/* v181 (scan): the same invisible characters as the list's own check
   (zero-width spaces, word joiner, byte-order mark, tag characters), so a
   name pasted with one in it matches searches. */
const tidy = v => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\u{E0000}-\u{E007F}]/gu, " ")
  .replace(/\s+/g, " ").trim();
/* v181 (scan): the list's own length limits, by whole characters. */
const capChars = (v, n) => Array.from(String(v ?? "")).slice(0, n).join("");

/** RFC 4180 CSV, as Google Sheets writes it: quotes, doubled quotes, commas and line breaks inside quotes, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * The people in the sheet.
 * Returns { people, sectionsSeen }. Each person is
 * { name, title, email, phone, group, sheetState }, where sheetState is the
 * licensed state column E names, or null.
 */
export function parseDirectory(csvText) {
  let group = "Leadership";
  const sectionsSeen = new Set();
  const people = [];
  for (const r of parseCsv(csvText)) {
    const cell = j => tidy(r[j]);
    const name = cell(0);
    if (!name) continue;
    const email = cell(6);
    const hasEmail = emailsIn(email).length > 0;

    const section = SECTION_LABELS[name.toLowerCase()];
    if (section && !hasEmail) { group = section; sectionsSeen.add(name.toLowerCase()); continue; }
    if (HEADER_NAME.test(name)) continue;
    if (NOT_PEOPLE.has(name.toLowerCase())) continue;
    /* The directory is for reaching people, and MRE Office listed only rows
       with an email. A row with just a number (a shared line, a note) is not
       a person here. */
    if (!hasEmail) continue;

    const title = cell(4);
    people.push({ name, title, email, phone: cell(7), group, sheetState: stateFromTitle(title) });
  }
  return { people, sectionsSeen: [...sectionsSeen] };
}

/* Refuse a sheet that does not look like the team sheet, rather than let a
   bad day empty the directory. Same idea as the roster sync's "refuse to drop
   more than a tenth of the board". */
export function checkParsed(parsed, existingCount, { allowShrink = false } = {}) {
  const problems = [];
  const n = parsed.people.length;
  if (n < 10) problems.push(`only ${n} people found; the sheet may have moved or changed shape`);
  for (const label of ["support staff", "team agents"]) {
    if (!parsed.sectionsSeen.includes(label)) problems.push(`the "${label}" section label is missing`);
  }
  for (const g of ["Leadership", "Support Staff", "Team Agent"]) {
    if (!parsed.people.some(p => p.group === g)) problems.push(`nobody in ${g}`);
  }
  /* v180 (scan): a real clean-up can be let through (Admin, ?force=yes). */
  if (!allowShrink && existingCount >= 20 && n < existingCount * 0.8) {
    problems.push(`${n} people found where there were ${existingCount}; that would drop more than a fifth of the directory`);
  }
  const keys = parsed.people.map(personKey);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) problems.push("the same person (same name and first email) is in the sheet twice");
  return problems;
}

/**
 * What a sync would change, as a plan. Nothing is written here.
 *
 * existing: [{ id, fields }] as stored. parsed: parseDirectory(...).people.
 *   - a person in both is updated: name, title, email, phone and group from the
 *     sheet. Their licensed state comes from the sheet when column E names one,
 *     and is kept as it was when it does not (Leadership and Support Staff
 *     rows carry a job title there, not a state)
 *   - a person only in the sheet is added
 *   - a person no longer in the sheet is removed
 * Matched in three passes, most certain first:
 *   1. same name and same first email
 *   2. same first email, when exactly one unmatched person has it (a new name
 *      on the same address: a name corrected, or a nickname)
 *   3. same name, when exactly one unmatched person has it (a new address)
 * A shared inbox that heads two people's cells never merges them, because
 * pass 2 needs the address to be unique among the unmatched.
 */
export function mergeDirectory(existing, parsed) {
  const used = new Set();
  const match = new Map();                 // parsed index -> existing item
  const nameOf = x => String(x?.name || "").trim().toLowerCase();

  const passes = [
    (p, it) => personKey(p) === personKey(it.fields),
    (p, it) => firstEmail(p) && firstEmail(p) === firstEmail(it.fields),
    (p, it) => nameOf(p) && nameOf(p) === nameOf(it.fields),
  ];
  passes.forEach((isMatch, pass) => {
    parsed.forEach((p, i) => {
      if (match.has(i)) return;
      const candidates = existing.filter(it => !used.has(it.id) && isMatch(p, it));
      /* Pass 1 is exact, so the first is right. Passes 2 and 3 only count when
         there is no doubt about which person is meant. */
      const pick = pass === 0 ? candidates[0] : (candidates.length === 1 ? candidates[0] : null);
      if (!pick) return;
      /* ...and in passes 2 and 3, only when no other parsed person could claim
         the same one, which would make it a guess. */
      if (pass > 0 && parsed.some((q, j) => j !== i && !match.has(j) && isMatch(q, pick))) return;
      match.set(i, pick);
      used.add(pick.id);
    });
  });

  const add = [], update = [], same = [], stateChanges = [];
  parsed.forEach((p, i) => {
    const hit = match.get(i) || null;

    const before = hit?.fields || {};
    const states = p.sheetState ?? (STATE_CHOICES.includes(before.states) ? before.states : "");
    const fields = { name: capChars(p.name, 120), title: capChars(p.title, 200), email: capChars(p.email, 300), phone: capChars(p.phone, 80), states, group: p.group };

    if (!hit) { add.push({ originId: [...`sheet:${personKey(p)}`].slice(0, 200).join(""), fields }); return; }   // v180: cut by character
    if (p.sheetState && before.states !== p.sheetState) {
      stateChanges.push({ id: hit.id, from: before.states || "", to: p.sheetState });
    }
    const changed = Object.keys(fields).some(k => (before[k] ?? "") !== fields[k]);
    (changed ? update : same).push({ id: hit.id, before, fields });
  });
  const remove = existing.filter(it => !used.has(it.id)).map(it => ({ id: it.id, before: it.fields }));
  return { add, update, same, remove, stateChanges };
}

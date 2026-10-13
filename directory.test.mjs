/* The Directory, as CIK Office has it.
 *
 * Jarvis filled its Directory from the team contact sheet (a nightly sync).
 * CIK Office's 13 people were typed in by hand, so here the Directory is an
 * ordinary list admins keep up to date, filled once by the import. The sheet
 * reader and its sync did not come over; what is left of lib/directory.js is
 * the pair of helpers the room page still uses to show a person's addresses
 * and to hide a "title" that is really a licensed state.
 */
import { stateFromTitle, emailsIn, personKey, firstEmail } from "./lib/directory.js";
import { validateFields } from "./lib/office-fields.js";
import { roomBySlug, canEditRoom, canImportRoom } from "./lib/office-rooms.js";
let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

/* ---- small helpers ---------------------------------------------------------- */
{
  ok(stateFromTitle("Oregon") === "OR" && stateFromTitle(" washington ") === "WA" && stateFromTitle("Oregon / Washington") === "OR & WA", "state names");
  ok(stateFromTitle("Sales Manager") === null && stateFromTitle("") === null && stateFromTitle(null) === null, "not a state");
  ok(JSON.stringify(emailsIn("a@x.com / b@y.org, c@z.io")) === JSON.stringify(["a@x.com", "b@y.org", "c@z.io"]), "every address in a cell");
  ok(emailsIn("Email Address").length === 0 && emailsIn("").length === 0, "a header or an empty cell has none");
  ok(firstEmail({ email: "Ben@Example.com / other@x.com" }) === "ben@example.com", "a person's first address, lower-cased");
  ok(personKey({ name: " Ben Boss ", email: "Ben@Example.com / other@x.com" }) === "ben boss|ben@example.com",
     "a person is known by name AND first address, since a shared inbox can head two people's cells");
}

/* ---- the room ------------------------------------------------------------------ */
{
  const D = roomBySlug("directory");
  const GROUPS = ["Leadership", "Acquisitions", "Outside Sales", "Support Staff", "Administrative Staff"];
  ok(D.where === "jarvis" && D.list && !D.list.readOnly && !D.list.managedBy, "the Directory has moved and is an ordinary list (no sheet keeps it)");
  ok(canEditRoom(D, "admin") && canEditRoom(D, "leadership") && !canEditRoom(D, "broker") && !canEditRoom(D, "agent"),
     "admins and leadership keep it up to date; nobody else can change it");
  ok(canImportRoom(D, "admin") && canImportRoom(D, "leadership") && !canImportRoom(D, "broker") && !canImportRoom(D, "agent"),
     "admins and leadership can run its one-time copy; nobody else can");
  ok(D.list.seed && D.list.seed.from === "cikoffice" && D.list.seed.collection === "directory", "filled once from CIK Office's directory");
  ok(D.list.groupBy === "group" && D.list.fields.find(f => f.key === "group").options.join() === GROUPS.join(),
     "it is grouped into CIK Office's groups, in its order");
  ok(D.list.fields.map(f => f.key).join() === "name,title,email,phone,secondaryPhone,group", "CIK Office's fields, in its order");
  ok(!D.minRole, "every signed-in person can see it, as in CIK Office");

  const person = { name: "Ben Boss", title: "Acquisitions Manager", email: "ben@example.com / ben.b@example.com", phone: "(503) 555-0102", secondaryPhone: "", group: "Acquisitions" };
  const v = validateFields(D.list.fields, person);
  ok(v.ok && v.fields.name === "Ben Boss" && v.fields.group === "Acquisitions" && v.fields.email === person.email, "a typical person passes the room's validation unchanged");
  ok(!validateFields(D.list.fields, { ...person, name: "" }).ok, "a person needs a name");
  ok(!validateFields(D.list.fields, { ...person, group: "" }).ok, "and a group");
}

console.log(`\ndirectory: ${p} passed, ${f} failed`);
if (f) process.exit(1);

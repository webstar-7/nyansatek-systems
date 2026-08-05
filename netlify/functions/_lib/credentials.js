/* ============================================================
   Credential generation — first-login username & temp password.
   ============================================================ */

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Adds a short random suffix so two businesses with the same
// name don't collide (e.g. "mensah-stores-4f2a").
function generateBusinessSlug(businessName) {
  const base = slugify(businessName) || "business";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

// Human-typeable temp password: word-number-word style,
// easier to read over SMS than a random hex string.
const WORDS = ["kente", "asante", "adom", "nkosuo", "sanko", "nyame", "obaa", "kwame", "amma", "yaa"];

function generateTempPassword() {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${w1}-${w2}-${num}`;
}

module.exports = { slugify, generateBusinessSlug, generateTempPassword };

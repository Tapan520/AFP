// ─────────────────────────────────────────────────────────────────────────────
// util/breedRules.js
//
// Shared breed → (species bucket, size category) classifier used across:
//   • routes/geo.js       — fee-rule endpoints
//   • routes/pets.js      — fee preview
//   • Payment.cshtml.cs  (C# mirror lives at Pages/Payment.cshtml.cs)
//
// Design decisions (locked with the product owner):
//   Q1  species buckets       = 'dog' | 'cat' | 'other'
//   Q2  which have size tiers = only 'dog' (large_aggressive vs small)
//                               cat / other are always 'single'
//   Q3  large-breed list       = system-defined curated list below
//   Q4  applies to             = registration + renewal + transfer
//   Q5  existing pets          = new rates apply at next renewal
//
// Adding a breed later? Just push to LARGE_AGGRESSIVE_BREEDS. The list is
// case-insensitive and matched with substring semantics so common variants
// (e.g. "German Shepherd Dog" / "German Shepherd Mix") all resolve correctly.
// ─────────────────────────────────────────────────────────────────────────────

const LARGE_AGGRESSIVE_BREEDS = [
  // ── Classic large / powerful / typically-restricted breeds ─────────────────
  "rottweiler", "pitbull", "pit bull", "american pit bull terrier",
  "american bully", "american bulldog", "bull terrier", "staffordshire",
  "doberman", "german shepherd", "belgian malinois", "mastiff", "bullmastiff",
  "cane corso", "presa canario", "dogo argentino", "fila brasileiro",
  "boerboel", "tosa inu", "akita", "chow chow", "wolf hybrid", "wolfdog",
  // ── Working / guarding breeds commonly categorised as large ────────────────
  "great dane", "saint bernard", "st. bernard", "saint-bernard",
  "newfoundland", "leonberger", "kuvasz", "great pyrenees",
  "anatolian shepherd", "caucasian shepherd", "central asian shepherd",
  "tibetan mastiff", "irish wolfhound", "scottish deerhound",
  // ── Retrievers / large sporting dogs (categorised as large by weight) ──────
  "labrador", "golden retriever", "chesapeake bay retriever",
  "german shorthaired pointer", "weimaraner", "rhodesian ridgeback",
  "boxer", "dalmatian", "siberian husky", "alaskan malamute", "samoyed",
  "bernese mountain dog", "greater swiss mountain dog",
  // ── Indian native large breeds ─────────────────────────────────────────────
  "rajapalayam", "kombai", "chippiparai", "bakharwal", "gaddi", "himalayan sheepdog",
];

const SPECIES_BUCKETS = new Set(["dog", "cat", "other"]);

/**
 * Normalise a species string to one of the three fee buckets.
 * dog → 'dog', cat → 'cat', anything else (rabbit/bird/other) → 'other'.
 */
function speciesBucket(species) {
  const s = String(species || "").trim().toLowerCase();
  if (s === "dog") return "dog";
  if (s === "cat") return "cat";
  return "other";
}

/**
 * Classify a (species, breed) tuple into fee bucket and size category.
 *
 * Returns `{ species, sizeCategory }` where:
 *   • species       ∈ {'dog','cat','other'}
 *   • sizeCategory  = 'large_aggressive' | 'small' | 'single'
 *
 * For dogs we look up `breed` (case-insensitive, substring match) against
 * the curated list. Everything not in the list is treated as 'small'.
 * Cats & other always resolve to 'single'.
 */
function classifyBreed(species, breed) {
  const sp = speciesBucket(species);
  if (sp !== "dog") return { species: sp, sizeCategory: "single" };
  const b = String(breed || "").trim().toLowerCase();
  if (!b) return { species: "dog", sizeCategory: "small" };
  const isLarge = LARGE_AGGRESSIVE_BREEDS.some((needle) => b.includes(needle));
  return { species: "dog", sizeCategory: isLarge ? "large_aggressive" : "small" };
}

/** Every (species, sizeCategory) tuple that the fee matrix can hold. */
const ALL_BUCKETS = [
  { species: "dog",   sizeCategory: "large_aggressive" },
  { species: "dog",   sizeCategory: "small" },
  { species: "cat",   sizeCategory: "single" },
  { species: "other", sizeCategory: "single" },
];

/** Human-friendly label — used by the admin Fees UI. */
function bucketLabel(species, sizeCategory) {
  if (species === "dog" && sizeCategory === "large_aggressive") return "Dog — Large / Aggressive";
  if (species === "dog" && sizeCategory === "small")            return "Dog — Small";
  if (species === "cat")                                        return "Cat";
  return "Other (Rabbit / Bird / …)";
}

module.exports = {
  LARGE_AGGRESSIVE_BREEDS,
  SPECIES_BUCKETS,
  ALL_BUCKETS,
  speciesBucket,
  classifyBreed,
  bucketLabel,
};

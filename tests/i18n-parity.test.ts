// i18n key-parity test — pure logic, no database.
//
// Why this exists: `messages/fr.json`, `messages/ar.json` and `messages/en.json`
// are hand-edited independently (see Task 6R étape 1, which added
// `dayCarouselLabel` / `prevDay` / `nextDay` to all three). Nothing enforced
// that the three files stay in lock-step: a typo'd key name, a key added to
// only one locale, or a key nested one level deeper than its siblings would
// silently render as a raw key string (e.g. "dayCarouselLabel") in production
// for whichever locale was missed, and next-intl does not fail the build for
// it. This test is the guard that was missing (CLAUDE.md/relay: no prior test
// compares the three locale files).
//
// The failure message always names the exact dotted key path AND the file(s)
// it is missing from, because "objects differ" is useless output to debug at
// 3am against a live trilingual site.
import { describe, it, expect } from "vitest";
import fr from "../messages/fr.json";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

type MessageTree = { [key: string]: MessageTree | string };

/**
 * Recursively collect every key path in a message tree, both intermediate
 * namespace keys (e.g. "Home.Features.gentle") and leaf string keys (e.g.
 * "Home.Features.gentle.title"). Recording intermediate paths too — not just
 * leaves — means a key that changes shape (e.g. a namespace demoted to a
 * plain string in one locale) is caught as a structural mismatch, not
 * silently ignored.
 */
function collectKeyPaths(node: unknown, prefix = ""): Set<string> {
  const paths = new Set<string>();
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return paths;
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.add(path);
    for (const child of collectKeyPaths(
      (node as Record<string, unknown>)[key],
      path,
    )) {
      paths.add(child);
    }
  }
  return paths;
}

/**
 * Compare N named locale trees and return one human-readable line per
 * discrepancy: which key, missing from which file(s), present in which.
 * Returns an empty array when every file has exactly the same key set.
 */
function diffLocaleKeys(
  locales: { name: string; keys: Set<string> }[],
): string[] {
  const allKeys = new Set<string>();
  for (const locale of locales) {
    for (const key of locale.keys) allKeys.add(key);
  }

  const problems: string[] = [];
  for (const key of allKeys) {
    const present = locales.filter((l) => l.keys.has(key)).map((l) => l.name);
    const missing = locales.filter((l) => !l.keys.has(key)).map((l) => l.name);
    if (missing.length > 0) {
      problems.push(
        `Key "${key}" is missing from ${missing.join(", ")} ` +
          `(present in ${present.join(", ")})`,
      );
    }
  }
  return problems.sort();
}

describe("i18n locale parity (fr / ar / en)", () => {
  it("the three real message files declare exactly the same set of keys", () => {
    const locales = [
      { name: "fr.json", keys: collectKeyPaths(fr) },
      { name: "ar.json", keys: collectKeyPaths(ar) },
      { name: "en.json", keys: collectKeyPaths(en) },
    ];

    const problems = diffLocaleKeys(locales);

    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("sanity: the real files are not trivially empty (a bug that would make the parity check vacuous)", () => {
    // Guards against `collectKeyPaths` silently returning an empty set for
    // all three files (e.g. a broken import) and the test above passing for
    // the wrong reason.
    const keys = collectKeyPaths(fr);
    expect(keys.size).toBeGreaterThan(50);
    expect(keys.has("Booking.dayCarouselLabel")).toBe(true);
    expect(keys.has("Home.Features.gentle.title")).toBe(true);
  });

  it("is discriminant: flags a leaf key deleted from one in-memory locale, naming the key and the file", () => {
    // Built entirely in memory from the real `fr` tree — never touches a file
    // on disk. Deletes a real, deeply-nested leaf key
    // ("Home.Features.gentle.title", depth 4) to prove the recursion reaches
    // every nesting level, not just the top-level namespaces.
    const brokenEn = structuredClone(en) as MessageTree;
    const features = (brokenEn as Record<string, MessageTree>).Home
      .Features as Record<string, MessageTree>;
    delete (features.gentle as Record<string, unknown>).title;

    const locales = [
      { name: "fr.json", keys: collectKeyPaths(fr) },
      { name: "ar.json", keys: collectKeyPaths(ar) },
      { name: "en.json (broken copy)", keys: collectKeyPaths(brokenEn) },
    ];

    const problems = diffLocaleKeys(locales);

    expect(problems).toContain(
      'Key "Home.Features.gentle.title" is missing from en.json (broken copy) ' +
        "(present in fr.json, ar.json)",
    );
  });

  it("is discriminant: flags a key added to only one in-memory locale, naming the key and the file", () => {
    // Mirror case of the test above: a key present ONLY in one locale (e.g.
    // a translator adds a new string to ar.json but forgets fr/en) must be
    // caught too, not just deletions.
    const brokenAr = structuredClone(ar) as MessageTree;
    (brokenAr as Record<string, MessageTree>).Booking = {
      ...(brokenAr as Record<string, MessageTree>).Booking,
      onlyInArabic: "قيمة إضافية",
    };

    const locales = [
      { name: "fr.json", keys: collectKeyPaths(fr) },
      { name: "ar.json (broken copy)", keys: collectKeyPaths(brokenAr) },
      { name: "en.json", keys: collectKeyPaths(en) },
    ];

    const problems = diffLocaleKeys(locales);

    expect(problems).toContain(
      'Key "Booking.onlyInArabic" is missing from fr.json, en.json ' +
        "(present in ar.json (broken copy))",
    );
  });

  it("is discriminant: flags a namespace whose entire shape changed (object collapsed to a string) in one in-memory locale", () => {
    // A namespace demoted from an object to a plain string (e.g. a bad merge)
    // must disappear all of its descendant leaf paths from that locale's key
    // set — proving collectKeyPaths does not silently treat mismatched shapes
    // as equal.
    const brokenFr = structuredClone(fr) as MessageTree;
    (brokenFr as Record<string, unknown>).Booking = "oops, flattened";

    const locales = [
      { name: "fr.json (broken copy)", keys: collectKeyPaths(brokenFr) },
      { name: "ar.json", keys: collectKeyPaths(ar) },
      { name: "en.json", keys: collectKeyPaths(en) },
    ];

    const problems = diffLocaleKeys(locales);

    expect(
      problems.some((p) =>
        p.startsWith(
          'Key "Booking.dayCarouselLabel" is missing from fr.json (broken copy)',
        ),
      ),
    ).toBe(true);
  });

  it("returns no problems when all three locales are identical (negative control)", () => {
    const locales = [
      { name: "a", keys: collectKeyPaths(fr) },
      { name: "b", keys: collectKeyPaths(structuredClone(fr)) },
      { name: "c", keys: collectKeyPaths(structuredClone(fr)) },
    ];

    expect(diffLocaleKeys(locales)).toEqual([]);
  });
});

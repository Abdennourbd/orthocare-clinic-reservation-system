import { describe, expect, it } from "vitest";
import {
  buildDirectionsUrl,
  buildMapEmbedSrc,
  buildPlaceUrl,
  buildReviewsEmbedSrc,
} from "./embed";

const locales = ["fr", "ar", "en"] as const;

describe("buildReviewsEmbedSrc", () => {
  it("targets the google maps embed endpoint", () => {
    for (const locale of locales) {
      expect(buildReviewsEmbedSrc(locale)).toMatch(
        /^https:\/\/www\.google\.com\/maps\/embed\?pb=/,
      );
    }
  });

  it("embeds the clinic place id and coordinates", () => {
    const src = buildReviewsEmbedSrc("fr");
    expect(src).toContain("0x128e5b9de26cb8dd%3A0xb0b176111c5df02c");
    expect(src).toContain("!2d3.2836918");
    expect(src).toContain("!3d36.7351871");
  });

  it("encodes the apostrophe in the place name as %27", () => {
    expect(buildReviewsEmbedSrc("fr")).toContain("!2sOrtho%27Care%20Clinic");
  });

  it("is locale-aware (lang + Algeria region)", () => {
    expect(buildReviewsEmbedSrc("fr")).toContain("!1sfr!2sdz");
    expect(buildReviewsEmbedSrc("ar")).toContain("!1sar!2sdz");
    expect(buildReviewsEmbedSrc("en")).toContain("!1sen!2sdz");
  });
});

describe("buildMapEmbedSrc", () => {
  it("centres the map on the clinic and is locale-aware", () => {
    expect(buildMapEmbedSrc("fr")).toBe(
      "https://www.google.com/maps?q=36.7351871,3.2836918&z=16&hl=fr&output=embed",
    );
    expect(buildMapEmbedSrc("ar")).toContain("&hl=ar&output=embed");
    expect(buildMapEmbedSrc("en")).toContain("&hl=en&output=embed");
  });
});

describe("buildDirectionsUrl", () => {
  it("opens one-click directions to the clinic coordinates", () => {
    expect(buildDirectionsUrl()).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=36.7351871,3.2836918",
    );
  });
});

describe("buildPlaceUrl", () => {
  it("deep-links to the clinic place id", () => {
    expect(buildPlaceUrl()).toBe(
      "https://www.google.com/maps/search/?api=1&query=Ortho%27Care%20Clinic&query_place_id=0x128e5b9de26cb8dd%3A0xb0b176111c5df02c",
    );
  });
});
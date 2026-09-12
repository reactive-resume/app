import { describe, expect, it } from "vitest";
import { defaultLocale, isLocale, isRTL } from "./locale";

describe("defaultLocale", () => {
	it("is en-US", () => {
		expect(defaultLocale).toBe("en-US");
	});
});

describe("isLocale", () => {
	it("returns true for non-empty string", () => {
		expect(isLocale("en-US")).toBe(true);
	});

	it("returns true for Kurdish Sorani ckb-IQ", () => {
		expect(isLocale("ckb-IQ")).toBe(true);
	});

	it("returns false for unsupported locale string", () => {
		expect(isLocale("xyz")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isLocale("")).toBe(false);
	});

	it("returns false for number", () => {
		expect(isLocale(42)).toBe(false);
	});

	it("returns false for null", () => {
		expect(isLocale(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isLocale(undefined)).toBe(false);
	});

	it("returns false for object", () => {
		expect(isLocale({})).toBe(false);
	});

	it("returns false for array", () => {
		expect(isLocale([])).toBe(false);
	});
});

describe("isRTL", () => {
	it.each([
		["ar-SA", true],
		["he-IL", true],
		["fa-IR", true],
		["ur-PK", true],
		["en-US", false],
		["en-GB", false],
		["fr-FR", false],
		["de-DE", false],
		["zh-CN", false],
		["xyz-XX", false],
		["AR-SA", true],
		["ar", true],
		["en", false],
	])("returns %s → %s", (locale, expected) => {
		expect(isRTL(locale)).toBe(expected);
	});
});

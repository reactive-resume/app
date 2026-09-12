// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import Cookies from "js-cookie";
import { changeLocale, formatRelativeTime, isLocale, resolveLocale } from "./locale";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	Cookies.remove("locale");
});

describe("isLocale", () => {
	it("returns true for known locale en-US", () => {
		expect(isLocale("en-US")).toBe(true);
	});

	it("returns true for Kurdish Sorani ckb-IQ", () => {
		expect(isLocale("ckb-IQ")).toBe(true);
	});

	it("returns true for de-DE", () => {
		expect(isLocale("de-DE")).toBe(true);
	});

	it("returns true for zh-CN", () => {
		expect(isLocale("zh-CN")).toBe(true);
	});

	it("returns false for unknown locale", () => {
		expect(isLocale("xx-YY")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isLocale("")).toBe(false);
	});

	it("returns false for malformed locale", () => {
		expect(isLocale("not a locale")).toBe(false);
	});

	it("is case-sensitive", () => {
		expect(isLocale("en-us")).toBe(false);
	});
});

describe("resolveLocale", () => {
	it("returns the locale unchanged when valid", () => {
		expect(resolveLocale("fr-FR")).toBe("fr-FR");
	});

	it("returns en-US default for invalid locale", () => {
		expect(resolveLocale("xx-YY")).toBe("en-US");
	});

	it("returns en-US default for empty string", () => {
		expect(resolveLocale("")).toBe("en-US");
	});
});

describe("formatRelativeTime", () => {
	it("selects the largest matching unit", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
		const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

		expect(formatRelativeTime("2026-01-02T10:00:00Z", formatter)).toBe("2 hours ago");
		expect(formatRelativeTime("2026-01-02T11:59:45Z", formatter)).toBe("now");
	});

	it("uses the requested fallback for an invalid date", () => {
		const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

		expect(formatRelativeTime("invalid", formatter, "")).toBe("");
	});
});

describe("changeLocale", () => {
	it("persists a valid locale and reloads", () => {
		const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);

		changeLocale("de-DE");

		expect(Cookies.get("locale")).toBe("de-DE");
		expect(reload).toHaveBeenCalledOnce();
	});
});

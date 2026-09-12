import z from "zod";

// ponytail: z.enum([...]) over 56 z.literal calls; same parse behavior, same inferred union type
export const localeSchema = z.enum([
	"af-ZA",
	"am-ET",
	"ar-SA",
	"az-AZ",
	"bg-BG",
	"bn-BD",
	"ca-ES",
	"cs-CZ",
	"da-DK",
	"de-DE",
	"el-GR",
	"en-US",
	"en-GB",
	"es-ES",
	"ckb-IQ",
	"fa-IR",
	"fi-FI",
	"fr-FR",
	"he-IL",
	"hi-IN",
	"hu-HU",
	"id-ID",
	"it-IT",
	"ja-JP",
	"km-KH",
	"kn-IN",
	"ko-KR",
	"lt-LT",
	"lv-LV",
	"ml-IN",
	"mr-IN",
	"ms-MY",
	"ne-NP",
	"nl-NL",
	"no-NO",
	"or-IN",
	"pl-PL",
	"pt-BR",
	"pt-PT",
	"ro-RO",
	"ru-RU",
	"sk-SK",
	"sl-SI",
	"sq-AL",
	"sr-SP",
	"sv-SE",
	"ta-IN",
	"te-IN",
	"th-TH",
	"tr-TR",
	"uk-UA",
	"uz-UZ",
	"vi-VN",
	"zh-CN",
	"zh-TW",
	"zu-ZA",
]);

export type Locale = z.infer<typeof localeSchema>;

export const defaultLocale: Locale = "en-US";

export function isLocale(value: unknown): value is Locale {
	return localeSchema.safeParse(value).success;
}

export function isCJKLocale(locale: Locale): boolean {
	return locale === "zh-CN" || locale === "zh-TW" || locale === "ja-JP" || locale === "ko-KR";
}

// A writing system that needs a dedicated fallback font in the PDF renderer,
// because react-pdf (unlike a browser) has no automatic system-font fallback:
// a glyph only renders if a registered font contains it. We pick the matching
// Noto font per script so e.g. Hangul → Noto KR, Arabic → Noto Arabic, instead
// of falling back to a Latin/Han-only font and producing tofu. "emoji" is
// content-detected only (never locale-derived) and resolves to Noto Emoji so
// pictographs and regional indicators render instead of mojibake (#3321).
export type Script = "hangul" | "kana" | "han-traditional" | "han-simplified" | "arabic" | "hebrew" | "thai" | "emoji";

// The CJK subset of `Script`. CJK needs extra per-character line breaking that
// must NOT be applied to Arabic (cursive, joined letters) or Thai (combining
// marks), so callers gate line-breaking on this rather than on `Script`.
const cjkScripts: readonly Script[] = ["hangul", "kana", "han-traditional", "han-simplified"];

export function isCjkScript(script: Script): boolean {
	return cjkScripts.includes(script);
}

// The script a locale primarily uses, used to order the fallback stack so the
// dominant language renders with its native font. Persian (fa-IR) uses the
// Arabic script.
export function getLocaleScript(locale?: Locale): Script | null {
	switch (locale) {
		case "ko-KR":
			return "hangul";
		case "ja-JP":
			return "kana";
		case "zh-TW":
			return "han-traditional";
		case "zh-CN":
			return "han-simplified";
		case "ar-SA":
		case "ckb-IQ":
		case "fa-IR":
			return "arabic";
		case "he-IL":
			return "hebrew";
		case "th-TH":
			return "thai";
		default:
			return null;
	}
}

const RTL_LANGUAGES = new Set([
	"ar", // Arabic
	"ckb", // Kurdish (Sorani)
	"dv", // Dhivehi
	"fa", // Persian
	"he", // Hebrew
	"ps", // Pashto
	"sd", // Sindhi
	"ug", // Uyghur
	"ur", // Urdu
	"yi", // Yiddish
]);

export function isRTL(locale: string): boolean {
	const language = locale.split("-")[0]?.toLowerCase() ?? "";
	return RTL_LANGUAGES.has(language);
}

import type { AIProvider } from "@reactive-resume/ai/types";
import { ORPCError } from "@orpc/client";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { aiProviderSchema } from "@reactive-resume/ai/types";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import {
	assertCredentialEncryptionConfigured,
	decryptCredential,
	encryptCredential,
	redactEncryptedCredential,
} from "../ai/credentials";
import { testConnection } from "../ai/service";
import { resolveAiBaseUrl } from "../ai/url-policy";

type AiProviderRecord = typeof schema.aiProvider.$inferSelect;

export type AiProviderResponse = {
	id: string;
	label: string;
	provider: AIProvider;
	model: string;
	baseURL: string | null;
	enabled: boolean;
	testStatus: string;
	testError: string | null;
	apiKeyPreview: string;
	apiKeyFingerprint: string;
	lastTestedAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type CreateAiProviderInput = {
	userId: string;
	label: string;
	provider: AIProvider;
	model: string;
	baseURL?: string | null;
	apiKey: string;
};

type UpdateAiProviderInput = {
	id: string;
	userId: string;
	label?: string;
	provider?: AIProvider;
	model?: string;
	baseURL?: string | null;
	apiKey?: string;
	enabled?: boolean;
};

function toResponse(row: AiProviderRecord): AiProviderResponse {
	const provider = aiProviderSchema.parse(row.provider);
	const { apiKeyFingerprint, apiKeyPreview } = redactEncryptedCredential({
		encryptedApiKey: row.encryptedApiKey,
		apiKeySalt: row.apiKeySalt,
		apiKeyHash: row.apiKeyHash,
		apiKeyPreview: row.apiKeyPreview,
	});

	return {
		id: row.id,
		label: row.label,
		provider,
		model: row.model,
		baseURL: row.baseUrl,
		enabled: row.enabled,
		testStatus: row.testStatus,
		testError: row.testError,
		apiKeyPreview,
		apiKeyFingerprint,
		lastTestedAt: row.lastTestedAt,
		lastUsedAt: row.lastUsedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function normalizeBaseUrl(input: { provider: AIProvider; baseURL?: string | null }) {
	const trimmed = input.baseURL?.trim() ?? "";
	if (!trimmed) return null;

	return resolveAiBaseUrl({ provider: input.provider, baseURL: trimmed });
}

// ponytail: Postgres reports a missing relation as error code 42P01; Drizzle wraps the driver
// error in a DrizzleQueryError's `cause`. Self-hosted deployments that never ran `pnpm db:migrate`
// hit this on every ai_providers query, so map it to PRECONDITION_FAILED and let clients show the
// schema-not-migrated banner instead of a generic failure.
function isMissingRelationError(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth++) {
		if ((current as { code?: unknown }).code === "42P01") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

async function mapMissingRelationError<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (isMissingRelationError(error)) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message:
					"AI providers are unavailable because the database schema has not been migrated. Run pnpm db:migrate before starting the server.",
				cause: error,
			});
		}
		throw error;
	}
}

function withAiProvidersSchema<Input, Output>(run: (input: Input) => Promise<Output>) {
	return (input: Input) => mapMissingRelationError(() => run(input));
}

async function getOwnedProvider(input: { id: string; userId: string }) {
	const [provider] = await db
		.select()
		.from(schema.aiProvider)
		.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
		.limit(1);

	if (!provider) throw new ORPCError("NOT_FOUND");

	return provider;
}

export const aiProvidersService = {
	list: withAiProvidersSchema(async (input: { userId: string }) => {
		assertCredentialEncryptionConfigured();

		const providers = await db
			.select()
			.from(schema.aiProvider)
			.where(eq(schema.aiProvider.userId, input.userId))
			.orderBy(
				desc(sql<Date>`coalesce(${schema.aiProvider.lastUsedAt}, '1970-01-01T00:00:00.000Z'::timestamptz)`),
				asc(schema.aiProvider.createdAt),
			);

		return providers.map(toResponse);
	}),

	getRunnableById: withAiProvidersSchema(async (input: { id: string; userId: string }) => {
		assertCredentialEncryptionConfigured();

		const provider = await getOwnedProvider(input);
		if (!provider.enabled || provider.testStatus !== "success") {
			throw new ORPCError("BAD_REQUEST", { message: "AI provider must be tested and enabled before use." });
		}

		return {
			...toResponse(provider),
			apiKey: decryptCredential(provider.encryptedApiKey),
			baseURL: provider.baseUrl ?? "",
		};
	}),

	getDefaultRunnable: withAiProvidersSchema(async (input: { userId: string }) => {
		assertCredentialEncryptionConfigured();

		const [provider] = await db
			.select()
			.from(schema.aiProvider)
			.where(
				and(
					eq(schema.aiProvider.userId, input.userId),
					eq(schema.aiProvider.enabled, true),
					eq(schema.aiProvider.testStatus, "success"),
				),
			)
			.orderBy(asc(schema.aiProvider.createdAt))
			.limit(1);

		return provider
			? {
					...toResponse(provider),
					apiKey: decryptCredential(provider.encryptedApiKey),
					baseURL: provider.baseUrl ?? "",
				}
			: null;
	}),

	create: withAiProvidersSchema(async (input: CreateAiProviderInput) => {
		assertCredentialEncryptionConfigured();

		const encrypted = encryptCredential(input.apiKey.trim());
		const [provider] = await db
			.insert(schema.aiProvider)
			.values({
				userId: input.userId,
				label: input.label.trim(),
				provider: input.provider,
				model: input.model.trim(),
				baseUrl: normalizeBaseUrl(input),
				...encrypted,
			})
			.returning();

		if (!provider) throw new Error("AI_PROVIDER_CREATE_FAILED");

		return toResponse(provider);
	}),

	update: withAiProvidersSchema(async (input: UpdateAiProviderInput) => {
		assertCredentialEncryptionConfigured();

		const existing = await getOwnedProvider(input);
		const provider = input.provider ?? aiProviderSchema.parse(existing.provider);
		const nextApiKey = input.apiKey?.trim();
		const encrypted = nextApiKey ? encryptCredential(nextApiKey) : {};
		const credentialChanged = !!nextApiKey;
		const nextBaseUrl =
			input.baseURL !== undefined ? normalizeBaseUrl({ provider, baseURL: input.baseURL }) : existing.baseUrl;
		const providerChanged = input.provider !== undefined && input.provider !== existing.provider;
		const modelChanged = input.model !== undefined && input.model.trim() !== existing.model;
		const baseUrlChanged = input.baseURL !== undefined && nextBaseUrl !== existing.baseUrl;
		const runtimeChanged = credentialChanged || providerChanged || modelChanged || baseUrlChanged;

		if (input.enabled === true && existing.testStatus !== "success" && !runtimeChanged) {
			throw new ORPCError("BAD_REQUEST", { message: "AI provider must be tested successfully before enabling." });
		}

		const [updated] = await db
			.update(schema.aiProvider)
			.set({
				...(input.label !== undefined ? { label: input.label.trim() } : {}),
				...(input.provider !== undefined ? { provider: input.provider } : {}),
				...(input.model !== undefined ? { model: input.model.trim() } : {}),
				...(input.baseURL !== undefined ? { baseUrl: nextBaseUrl } : {}),
				...(input.enabled !== undefined && !runtimeChanged ? { enabled: input.enabled } : {}),
				...(runtimeChanged ? { enabled: false, testStatus: "untested", lastTestedAt: null, testError: null } : {}),
				...encrypted,
			})
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return toResponse(updated);
	}),

	delete: withAiProvidersSchema(async (input: { id: string; userId: string }) => {
		assertCredentialEncryptionConfigured();

		await db
			.delete(schema.aiProvider)
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
	}),

	test: withAiProvidersSchema(async (input: { id: string; userId: string }) => {
		assertCredentialEncryptionConfigured();

		const provider = await getOwnedProvider(input);
		const parsedProvider = aiProviderSchema.parse(provider.provider);
		const apiKey = decryptCredential(provider.encryptedApiKey);

		try {
			const result = await testConnection({
				provider: parsedProvider,
				model: provider.model,
				apiKey,
				baseURL: provider.baseUrl ?? "",
			});

			// A provider that answers "no" is a completed test, not a failed request: it comes back as
			// data so the client can show why, instead of a generic transport error.
			const [updated] = await db
				.update(schema.aiProvider)
				.set({
					enabled: result.ok,
					testStatus: result.ok ? "success" : "failure",
					testError: result.ok ? null : result.message,
					lastTestedAt: new Date(),
				})
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			return toResponse(updated);
		} catch (error) {
			// Only unexpected failures reach here now: provider-side outcomes come back as data above.
			await db
				.update(schema.aiProvider)
				.set({
					enabled: false,
					testStatus: "failure",
					testError: error instanceof Error ? error.message : "Failed to test provider.",
					lastTestedAt: new Date(),
				})
				.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));

			throw error;
		}
	}),

	markUsed: withAiProvidersSchema(async (input: { id: string; userId: string }) => {
		await db
			.update(schema.aiProvider)
			.set({ lastUsedAt: new Date() })
			.where(and(eq(schema.aiProvider.id, input.id), eq(schema.aiProvider.userId, input.userId)));
	}),
};

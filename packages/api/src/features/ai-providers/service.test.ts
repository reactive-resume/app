import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, deleteMock, queryMock, queryState } = vi.hoisted(() => {
	const state = {
		rows: [] as unknown[],
		whereArg: undefined as unknown,
		orderByArgs: [] as unknown[],
	};
	const query = {
		from: vi.fn(() => query),
		where: vi.fn((arg: unknown) => {
			state.whereArg = arg;
			return query;
		}),
		orderBy: vi.fn((...args: unknown[]) => {
			state.orderByArgs = args;
			return query;
		}),
		limit: vi.fn(async () => state.rows),
	};
	const deleteQuery = { where: vi.fn(async () => undefined) };

	return {
		dbMock: { select: vi.fn(() => query), delete: vi.fn(() => deleteQuery) },
		deleteMock: deleteQuery,
		queryMock: query,
		queryState: state,
	};
});

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	aiProvider: {
		id: "ai_provider.id",
		userId: "ai_provider.user_id",
		label: "ai_provider.label",
		provider: "ai_provider.provider",
		model: "ai_provider.model",
		baseUrl: "ai_provider.base_url",
		encryptedApiKey: "ai_provider.encrypted_api_key",
		apiKeySalt: "ai_provider.api_key_salt",
		apiKeyHash: "ai_provider.api_key_hash",
		apiKeyPreview: "ai_provider.api_key_preview",
		testStatus: "ai_provider.test_status",
		testError: "ai_provider.test_error",
		lastTestedAt: "ai_provider.last_tested_at",
		lastUsedAt: "ai_provider.last_used_at",
		enabled: "ai_provider.enabled",
		createdAt: "ai_provider.created_at",
		updatedAt: "ai_provider.updated_at",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	asc: (value: unknown) => ({ type: "asc", value }),
	desc: (value: unknown) => ({ type: "desc", value }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings: [...strings], values }),
}));
vi.mock("../ai/credentials", () => ({
	assertCredentialEncryptionConfigured: vi.fn(),
	decryptCredential: vi.fn(() => "decrypted-key"),
	encryptCredential: vi.fn(),
	redactEncryptedCredential: vi.fn(() => ({
		apiKeyFingerprint: "fingerprint",
		apiKeyPreview: "sk-...test",
	})),
}));
vi.mock("../ai/service", () => ({ testConnection: vi.fn() }));
vi.mock("../ai/url-policy", () => ({ resolveAiBaseUrl: vi.fn() }));

const { aiProvidersService } = await import("./service");

function providerRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "provider-1",
		userId: "user-1",
		label: "OpenAI",
		provider: "openai",
		model: "gpt-5-mini",
		baseUrl: null,
		encryptedApiKey: "encrypted-key",
		apiKeySalt: "salt",
		apiKeyHash: "hash",
		apiKeyPreview: "preview",
		testStatus: "success",
		testError: null,
		lastTestedAt: new Date("2026-07-01T00:00:00Z"),
		lastUsedAt: new Date("2026-07-07T00:00:00Z"),
		enabled: true,
		createdAt: new Date("2026-07-01T00:00:00Z"),
		updatedAt: new Date("2026-07-01T00:00:00Z"),
		...overrides,
	};
}

describe("aiProvidersService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryState.rows = [];
		queryState.whereArg = undefined;
		queryState.orderByArgs = [];
	});

	it("gets the first enabled and tested provider by creation order", async () => {
		queryState.rows = [providerRow({ id: "first-created" })];

		await expect(aiProvidersService.getDefaultRunnable({ userId: "user-1" })).resolves.toMatchObject({
			id: "first-created",
			apiKey: "decrypted-key",
		});

		expect(queryState.whereArg).toEqual({
			type: "and",
			conditions: [
				{ type: "eq", left: "ai_provider.user_id", right: "user-1" },
				{ type: "eq", left: "ai_provider.enabled", right: true },
				{ type: "eq", left: "ai_provider.test_status", right: "success" },
			],
		});
		expect(queryState.orderByArgs).toEqual([{ type: "asc", value: "ai_provider.created_at" }]);
		expect(queryMock.limit).toHaveBeenCalledWith(1);
	});

	describe("missing ai_providers table (Postgres 42P01)", () => {
		// What pg throws for a missing relation, wrapped by Drizzle: DrizzleQueryError.cause is the
		// driver error carrying `code: "42P01"`.
		function missingTableError() {
			const error = new Error('Failed query: select "id" from "ai_providers"');
			error.name = "DrizzleQueryError";
			(error as Error & { cause: unknown }).cause = {
				code: "42P01",
				message: 'relation "ai_providers" does not exist',
			};
			return error;
		}

		it("maps a missing-table failure on list to PRECONDITION_FAILED", async () => {
			queryMock.orderBy.mockImplementationOnce(() => {
				throw missingTableError();
			});

			await expect(aiProvidersService.list({ userId: "user-1" })).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: expect.stringContaining("db:migrate"),
			});
		});

		it("maps a missing-table failure on a write path to PRECONDITION_FAILED", async () => {
			deleteMock.where.mockRejectedValueOnce(missingTableError());

			await expect(aiProvidersService.delete({ id: "provider-1", userId: "user-1" })).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
			});
		});

		it("still maps when the Postgres error sits deeper in the cause chain", async () => {
			const wrapped = new Error("query wrapper");
			(wrapped as Error & { cause: unknown }).cause = missingTableError();
			queryMock.limit.mockRejectedValueOnce(wrapped);

			await expect(aiProvidersService.getDefaultRunnable({ userId: "user-1" })).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
			});
		});

		it("rethrows database errors that are not missing-relation failures", async () => {
			const connectionError = new Error("connection terminated unexpectedly");
			queryMock.limit.mockRejectedValueOnce(connectionError);

			await expect(aiProvidersService.getDefaultRunnable({ userId: "user-1" })).rejects.toBe(connectionError);
		});
	});
});

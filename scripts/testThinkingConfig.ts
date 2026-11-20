import {
  getThinkingConfig,
  isThinkingError,
  isRateLimitOrUnavailable,
  isNotFoundError,
  normalizeMrCostCacheKey,
  getCachedFirstAnswer,
  setCachedFirstAnswer,
  clearMrCostCacheForTest,
  getMrCostCacheSizeForTest,
  FIRST_QUESTION_CACHE_MAX_ENTRIES,
} from "../server.ts";
import { ThinkingLevel } from "@google/genai";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${msg}`);
}

console.log("=== TESTING getThinkingConfig ===");

// 1. Gemini 3 models (Flash, Flash-Lite or Pro): { thinkingLevel: "low" }
const g3Flash = getThinkingConfig("gemini-3.8-flash");
assert(JSON.stringify(g3Flash) === JSON.stringify({ thinkingLevel: ThinkingLevel.LOW }), "gemini-3.8-flash returns { thinkingLevel: 'low' }");

const g3Lite = getThinkingConfig("gemini-3.1-flash-lite");
assert(JSON.stringify(g3Lite) === JSON.stringify({ thinkingLevel: ThinkingLevel.LOW }), "gemini-3.1-flash-lite returns { thinkingLevel: 'low' }");

const g3Pro = getThinkingConfig("gemini-3-pro-image");
assert(JSON.stringify(g3Pro) === JSON.stringify({ thinkingLevel: ThinkingLevel.LOW }), "gemini-3-pro-image returns { thinkingLevel: 'low' }");

// 2. Gemini 2.5 Flash atau Flash-Lite: { thinkingBudget: 0 }
const g25Flash = getThinkingConfig("gemini-2.5-flash");
assert(JSON.stringify(g25Flash) === JSON.stringify({ thinkingBudget: 0 }), "gemini-2.5-flash returns { thinkingBudget: 0 }");

const g25Lite = getThinkingConfig("gemini-2.5-flash-lite");
assert(JSON.stringify(g25Lite) === JSON.stringify({ thinkingBudget: 0 }), "gemini-2.5-flash-lite returns { thinkingBudget: 0 }");

// 3. Gemini 2.5 Pro: tiada thinkingConfig (undefined)
const g25Pro = getThinkingConfig("gemini-2.5-pro");
assert(g25Pro === undefined, "gemini-2.5-pro returns undefined (tiada thinkingConfig)");

// 4. Alias seperti "gemini-flash-latest", "gemini-flash-lite-latest": { thinkingLevel: "low" }
const gFlashLatest = getThinkingConfig("gemini-flash-latest");
assert(JSON.stringify(gFlashLatest) === JSON.stringify({ thinkingLevel: ThinkingLevel.LOW }), "gemini-flash-latest returns { thinkingLevel: 'low' }");

const gFlashLiteLatest = getThinkingConfig("gemini-flash-lite-latest");
assert(JSON.stringify(gFlashLiteLatest) === JSON.stringify({ thinkingLevel: ThinkingLevel.LOW }), "gemini-flash-lite-latest returns { thinkingLevel: 'low' }");

// 5. Model lain / tidak dikenali: tiada thinkingConfig (undefined)
const unknownModel = getThinkingConfig("custom-model-x");
assert(unknownModel === undefined, "unknown model returns undefined (tiada thinkingConfig)");

// 6. Verify thinkingLevel and thinkingBudget are NEVER sent together in one request
const allTested = [g3Flash, g3Lite, g3Pro, g25Flash, g25Lite, g25Pro, gFlashLatest, gFlashLiteLatest, unknownModel];
for (const config of allTested) {
  if (config) {
    const hasLevel = "thinkingLevel" in config;
    const hasBudget = "thinkingBudget" in config;
    assert(!(hasLevel && hasBudget), "thinkingLevel and thinkingBudget are never combined");
  }
}

console.log("\n=== TESTING isThinkingError ===");
const err1 = { message: "Thinking level MINIMAL is not supported for this model.", code: 400, status: "INVALID_ARGUMENT" };
assert(isThinkingError(err1) === true, "isThinkingError detects 400 with 'thinking'");

const err2 = new Error("ApiError: 400 INVALID_ARGUMENT Thinking level not supported");
assert(isThinkingError(err2) === true, "isThinkingError detects Error object with 400 and thinking");

const err503 = { message: "Service Unavailable", code: 503, status: "UNAVAILABLE" };
assert(isThinkingError(err503) === false, "isThinkingError returns false for 503");

const err429 = { message: "Quota exceeded", code: 429, status: "RESOURCE_EXHAUSTED" };
assert(isThinkingError(err429) === false, "isThinkingError returns false for 429");

console.log("\n=== TESTING isRateLimitOrUnavailable ===");
assert(isRateLimitOrUnavailable(err503) === true, "isRateLimitOrUnavailable detects 503");
assert(isRateLimitOrUnavailable(err429) === true, "isRateLimitOrUnavailable detects 429");
assert(isRateLimitOrUnavailable(new Error("Resource exhausted due to rate limit")) === true, "isRateLimitOrUnavailable detects rate limit in Error");
assert(isRateLimitOrUnavailable(err1) === false, "isRateLimitOrUnavailable returns false for 400 invalid argument");

console.log("\n=== TESTING isNotFoundError ===");
const err404 = { message: "This model models/gemini-2.5-flash is no longer available to new users.", code: 404, status: "NOT_FOUND" };
assert(isNotFoundError(err404) === true, "isNotFoundError detects 404 not found");
assert(isNotFoundError(new Error("models/xyz NOT_FOUND")) === true, "isNotFoundError detects NOT_FOUND error string");
assert(isNotFoundError(err503) === false, "isNotFoundError returns false for 503");
assert(isNotFoundError(err1) === false, "isNotFoundError returns false for 400");

console.log("\n=== TESTING First-Question Memory Cache ===");
clearMrCostCacheForTest();
const k1 = normalizeMrCostCacheKey("  Apa itu   KOS TETAP?!  ", "ms");
const k2 = normalizeMrCostCacheKey("apa itu kos tetap", "ms");
assert(k1 === k2 && k1 === "ms:apa itu kos tetap", "normalizeMrCostCacheKey lowercases, removes punctuation & collapses spaces");

setCachedFirstAnswer(k1, "   ", "gemini-3.8-flash");
assert(getCachedFirstAnswer(k1) === null, "Empty responses are never cached");

setCachedFirstAnswer(k1, "Kos tetap ialah perbelanjaan yang kekal sama.", "gemini-3.8-flash");
const hit = getCachedFirstAnswer(k2);
assert(hit !== null && hit.text === "Kos tetap ialah perbelanjaan yang kekal sama.", "Cache hit returns stored response immediately");

for (let i = 0; i < FIRST_QUESTION_CACHE_MAX_ENTRIES + 25; i++) {
  setCachedFirstAnswer(`ms:soalan ${i}`, `Jawapan ${i}`, "gemini-3.8-flash");
}
assert(getMrCostCacheSizeForTest() === FIRST_QUESTION_CACHE_MAX_ENTRIES, `Cache caps cleanly at ${FIRST_QUESTION_CACHE_MAX_ENTRIES} entries`);
clearMrCostCacheForTest();

console.log("\nALL THINKING, CACHE & FAILOVER TESTS PASSED!");

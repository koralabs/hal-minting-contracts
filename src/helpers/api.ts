import {
  RateLimitedError,
  recordRateLimit,
  statedWaitMs,
  waitForRateLimit,
} from "@koralabs/kora-labs-common/chain";

import {
  HANDLE_API_ENDPOINT,
  HANDLE_ME_API_KEY,
  KORA_USER_AGENT,
} from "../constants/index.js";

const RATE_LIMIT_KEY = "handle-api";
// Longest stated wait worth holding a caller for; longer waits are handed back as RateLimitedError.
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

/**
 * GET/POST the Handle API. Honors rate limits: a 429 records the wait the server states (process-wide,
 * so no other call goes out before it) and throws RateLimitedError; calls made while a wait is
 * recorded sit it out, or throw it when it is longer than 30 s. Nothing is retried early.
 */
const fetchApi = async (
  endpoint: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any = {}
): Promise<Response> => {
  const { headers, ...rest } = params;
  await waitForRateLimit(RATE_LIMIT_KEY, MAX_RATE_LIMIT_WAIT_MS);
  const response = await fetch(`${HANDLE_API_ENDPOINT}/${endpoint}`, {
    headers: {
      ...headers,
      "User-Agent": KORA_USER_AGENT,
      "api-key": HANDLE_ME_API_KEY,
    },
    ...rest,
  });
  if (response.status === 429) {
    const body = await response
      .clone()
      .json()
      .catch(() => undefined);
    const waitMs = statedWaitMs(response.headers, body);
    if (waitMs !== null) recordRateLimit(RATE_LIMIT_KEY, waitMs);
    throw new RateLimitedError(
      RATE_LIMIT_KEY,
      waitMs ?? 0,
      waitMs === null ? `${endpoint}: 429 without a stated wait` : endpoint
    );
  }
  return response;
};

export { fetchApi };

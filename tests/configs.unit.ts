// Fetching the on-chain settings handles through the Handle API: the UTxO is rebuilt from the API's answers,
// its inline datum is decoded, and any failure surfaces as a specific error instead of a half-built settings object.
import { afterEach, describe, expect, it, vi } from "vitest";

import { get, has } from "../src/helpers/config/index.js";
import { buildMintingData, buildRefSpendSettingsData, buildRefSpendSettingsV1Data, buildSettingsData, buildSettingsV1Data, Cardano, fetchHandleUtxo, fetchMintingData, fetchRefSpendSettings, fetchSettings, MINTING_DATA_HANDLE_NAME, REF_SPEND_SETTINGS_HANDLE_NAME, SETTINGS_HANDLE_NAME } from "./v2.js";

const keyAddress = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Mainnet,
  { type: Cardano.CredentialType.KeyHash, hash: "2".repeat(56) as Cardano.Credential["hash"] },
  { type: Cardano.CredentialType.KeyHash, hash: "e".repeat(56) as Cardano.Credential["hash"] }
)
  .toAddress()
  .toBech32();

const settingsV1 = {
  policy_id: "b".repeat(56), allowed_minter: "c".repeat(56), hal_nft_price: BigInt(10), minting_data_script_hash: "d".repeat(56),
  orders_spend_script_hash: "a".repeat(56), ref_spend_proxy_script_hash: "f".repeat(56), ref_spend_governor: "0".repeat(56),
  ref_spend_admin: "c".repeat(56), royalty_spend_script_hash: "9".repeat(56), minting_start_time: 2_000, payment_address: keyAddress,
};
const TX = "ab".repeat(32);

/** Serves the Handle API for the given handle -> datum CBOR map; `status` overrides per-path responses. */
const serveHandles = (datums: Record<string, string>, status: Record<string, number> = {}) => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const path = String(url).split("api.handle.me/").pop()!;
    calls.push(path);
    if (status[path]) return new Response("nope", { status: status[path] });
    const [, name, leaf] = path.match(/^handles\/([^/]+)(?:\/(.+))?$/)!;
    if (leaf === "datum") return new Response(datums[name] ?? "", { headers: { "content-type": "text/plain" } });
    if (leaf === "utxo") return Response.json({ lovelace: 7_000_000 });
    return Response.json({ utxo: `${TX}#3`, hex: "000de140abcd", resolved_addresses: { ada: keyAddress } });
  });
  return calls;
};
afterEach(() => vi.unstubAllGlobals());

describe("fetchHandleUtxo", () => {
  // Invariant: the UTxO is rebuilt from the API: ref, address, lovelace, the single handle token and the inline datum.
  it("builds the UTxO from the handle, datum and utxo endpoints", async () => {
    const datum = buildMintingData({ mpt_root_hash: "11".repeat(32), whitelist_mpt_root_hash: "22".repeat(32) }).toCbor();
    serveHandles({ [MINTING_DATA_HANDLE_NAME]: ` ${datum}\n` });
    const [ref, output] = await fetchHandleUtxo(MINTING_DATA_HANDLE_NAME);
    expect(ref).toMatchObject({ txId: TX, index: 3, address: keyAddress });
    expect(output.value.coins).toBe(BigInt(7_000_000));
    expect([...output.value.assets!.values()]).toEqual([BigInt(1)]);
    expect([...output.value.assets!.keys()][0].endsWith("000de140abcd")).toBe(true);
    expect(output.datum).toBeDefined();
  });

  // Failure modes: an API error names the handle and path; a handle without datum is not usable.
  it("fails with the handle name on an HTTP error or a missing datum", async () => {
    serveHandles({}, { "handles/nope": 404 });
    await expect(fetchHandleUtxo("nope")).rejects.toThrow("nope: GET handles/nope failed with HTTP 404");
    serveHandles({});
    await expect(fetchHandleUtxo("nodatum")).rejects.toThrow("nodatum Datum Not Found");
  });
});

describe("fetchSettings / fetchRefSpendSettings / fetchMintingData", () => {
  it("decodes settings and the V1 data from the settings handle", async () => {
    const datum = buildSettingsData({ mint_governor: "ee".repeat(28), mint_version: BigInt(2), data: buildSettingsV1Data(settingsV1) }).toCbor();
    const calls = serveHandles({ [SETTINGS_HANDLE_NAME]: datum });
    const result = await fetchSettings(true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.settings).toMatchObject({ mint_governor: "ee".repeat(28), mint_version: BigInt(2) });
    expect(result.data.settingsV1).toMatchObject({ hal_nft_price: BigInt(10), minting_start_time: 2_000, payment_address: keyAddress });
    expect(calls[0]).toBe(`handles/${SETTINGS_HANDLE_NAME}`);
  });

  it("decodes ref-spend settings and minting data", async () => {
    serveHandles({
      [REF_SPEND_SETTINGS_HANDLE_NAME]: buildRefSpendSettingsData({ ref_spend_governor: "0".repeat(56), data: buildRefSpendSettingsV1Data({ policy_id: "b".repeat(56), ref_spend_admin: "c".repeat(56) }) }).toCbor(),
      [MINTING_DATA_HANDLE_NAME]: buildMintingData({ mpt_root_hash: "11".repeat(32), whitelist_mpt_root_hash: "22".repeat(32) }).toCbor(),
    });
    const ref = await fetchRefSpendSettings();
    expect(ref.ok && ref.data.refSpendSettingsV1).toEqual({ policy_id: "b".repeat(56), ref_spend_admin: "c".repeat(56) });
    const minting = await fetchMintingData();
    expect(minting.ok && minting.data.mintingData).toEqual({ mpt_root_hash: "11".repeat(32), whitelist_mpt_root_hash: "22".repeat(32) });
  });

  // Failure mode: a datum of the wrong shape is returned as an Err, never as partially decoded settings.
  it("returns an error result when the datum has the wrong shape", async () => {
    const wrong = buildMintingData({ mpt_root_hash: "11".repeat(32), whitelist_mpt_root_hash: "22".repeat(32) }).toCbor();
    serveHandles({ [SETTINGS_HANDLE_NAME]: wrong, [REF_SPEND_SETTINGS_HANDLE_NAME]: wrong, [MINTING_DATA_HANDLE_NAME]: "00" });
    expect((await fetchSettings(false)).ok).toBe(false);
    expect((await fetchRefSpendSettings()).ok).toBe(false);
    expect((await fetchMintingData()).ok).toBe(false);
  });

  // Failure mode: settings whose V1 payload is malformed are rejected at the V1 step.
  it("returns an error when the settings data payload cannot be decoded", async () => {
    const datum = buildSettingsData({ mint_governor: "ee".repeat(28), mint_version: BigInt(2), data: buildMintingData({ mpt_root_hash: "11", whitelist_mpt_root_hash: "22" }) }).toCbor();
    serveHandles({ [SETTINGS_HANDLE_NAME]: datum });
    expect((await fetchSettings(true)).ok).toBe(false);
  });
});

describe("env config helpers", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reads strings and numbers and reports missing or non-numeric values", () => {
    vi.stubEnv("C7_STR", "abc");
    vi.stubEnv("C7_NUM", "42");
    expect(get("C7_STR", "string")).toMatchObject({ ok: true, data: "abc" });
    expect(get("C7_NUM", "number")).toMatchObject({ ok: true, data: 42 });
    const notNumber = get("C7_STR", "number");
    expect(!notNumber.ok && notNumber.error).toBe("C7_STR in env is not number type.");
    const missing = get("C7_MISSING_KEY", "string");
    expect(!missing.ok && missing.error).toBe("C7_MISSING_KEY is not set.");
    expect(has("C7_STR")).toBe(true);
    expect(has("C7_MISSING_KEY")).toBe(false);
  });
});

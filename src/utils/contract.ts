import { ScriptDetails, ScriptType } from "@koralabs/kora-labs-common";

import { fetchApi } from "../helpers/api.js";

/**
 * The latest deployed script of `contractType` per the Handle API.
 *
 * `/scripts` returns Record<scriptAddress, ScriptDetails>, and `?type=X` is a prefix match on the
 * slug (`halmnt` also matches `halmntprx` / `halmntmpt`), so the entry is picked by exact type.
 * (1.x read the retired single-object shape and failed with "script details not deployed" / "has no
 * Ref script UTxO"; the engine hit and fixed the same break in its own loader.)
 */
const fetchDeployedScript = async (contractType: ScriptType): Promise<ScriptDetails> => {
  const query = new URLSearchParams({ latest: "true", type: contractType });
  const response = await fetchApi(`scripts?${query.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${contractType} script details: ${(await response.text()) || response.statusText}`);
  }
  const scripts = (await response.json()) as Record<string, ScriptDetails>;
  if (!scripts || typeof scripts !== "object") {
    throw new Error(`Failed to fetch ${contractType} script details: api returned ${typeof scripts}, expected Record<address, ScriptDetails>`);
  }
  for (const [address, entry] of Object.entries(scripts)) {
    if (entry?.type === contractType && entry?.latest !== false) {
      return { ...entry, refScriptAddress: entry.refScriptAddress ?? address } as ScriptDetails;
    }
  }
  throw new Error(`${contractType} script details not deployed (no entry with exact type among ${Object.keys(scripts).length})`);
};

export { fetchDeployedScript };

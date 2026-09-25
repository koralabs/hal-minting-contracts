import {
  bytes,
  constr,
  expectBytes,
  expectConstr,
  expectInt,
  int,
  PlutusData,
} from "../../cardano/index.js";
import { invariant } from "../../helpers/index.js";
import { RefSpendSettings, Settings } from "../types/index.js";

const buildSettingsData = (settings: Settings): PlutusData => {
  const { mint_governor, mint_version, data } = settings;
  return constr(0, [bytes(mint_governor), int(mint_version), data]);
};

/** `datum` is the settings handle's inline datum. */
const decodeSettingsDatum = (datum: PlutusData | undefined): Settings => {
  invariant(datum, "Settings must be inline datum");
  const { fields } = expectConstr(datum, "Settings", 0, 3);
  return {
    mint_governor: expectBytes(fields[0], "mint_governor"),
    mint_version: expectInt(fields[1], "mint_version"),
    data: fields[2],
  };
};

const buildRefSpendSettingsData = (settings: RefSpendSettings): PlutusData => {
  const { ref_spend_governor, data } = settings;
  return constr(0, [bytes(ref_spend_governor), data]);
};

const decodeRefSpendSettingsDatum = (
  datum: PlutusData | undefined
): RefSpendSettings => {
  invariant(datum, "RefSpendSettings must be inline datum");
  const { fields } = expectConstr(datum, "RefSpendSettings", 0, 2);
  return {
    ref_spend_governor: expectBytes(fields[0], "ref_spend_governor"),
    data: fields[1],
  };
};

export {
  buildRefSpendSettingsData,
  buildSettingsData,
  decodeRefSpendSettingsDatum,
  decodeSettingsDatum,
};

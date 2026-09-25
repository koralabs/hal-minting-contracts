import { Err, Ok, Result } from "ts-res";

import {
  assetId,
  Cardano,
  fromCbor,
  inlineDatumOf,
  parseUtxoRef,
  Utxo,
} from "../cardano/index.js";
import {
  LEGACY_POLICY_ID,
  MINTING_DATA_HANDLE_NAME,
  REF_SPEND_SETTINGS_HANDLE_NAME,
  SETTINGS_HANDLE_NAME,
} from "../constants/index.js";
import {
  decodeMintingDataDatum,
  decodeRefSpendSettingsDatum,
  decodeRefSpendSettingsV1Data,
  decodeSettingsDatum,
  decodeSettingsV1Data,
  MintingData,
  RefSpendSettings,
  RefSpendSettingsV1,
  Settings,
  SettingsV1,
} from "../contracts/index.js";
import { fetchApi, mayFail } from "../helpers/index.js";

interface HandleApiHandle {
  utxo: string;
  hex: string;
  resolved_addresses: { ada: string };
}

/** The UTxO holding `handleName` (per the Handle API), with its inline datum. */
const fetchHandleUtxo = async (handleName: string): Promise<Utxo> => {
  const json = async (path: string) => {
    const response = await fetchApi(path);
    if (!response.ok) throw new Error(`${handleName}: GET ${path} failed with HTTP ${response.status}`);
    return response.json();
  };
  const handle: HandleApiHandle = await json(`handles/${handleName}`);
  const datumResponse = await fetchApi(`handles/${handleName}/datum`, {
    headers: { Accept: "text/plain" },
  });
  const datumCbor = datumResponse.ok ? (await datumResponse.text()).trim() : "";
  if (!datumCbor) throw new Error(`${handleName} Datum Not Found`);
  const coins = BigInt((await json(`handles/${handleName}/utxo`)).lovelace);
  const address = handle.resolved_addresses.ada as Cardano.PaymentAddress;
  return [
    { ...parseUtxoRef(handle.utxo), address },
    {
      address,
      value: {
        coins,
        assets: new Map([[assetId(LEGACY_POLICY_ID, handle.hex), BigInt(1)]]),
      },
      datum: fromCbor(datumCbor).toCore(),
    },
  ];
};

const fetchSettings = async (
  isMainnet: boolean
): Promise<
  Result<{ settings: Settings; settingsV1: SettingsV1; settingsAssetTxInput: Utxo }, string>
> => {
  const settingsAssetTxInput = await fetchHandleUtxo(SETTINGS_HANDLE_NAME);
  const settings = mayFail(() => decodeSettingsDatum(inlineDatumOf(settingsAssetTxInput)));
  if (!settings.ok) return Err(settings.error);
  const settingsV1 = mayFail(() => decodeSettingsV1Data(settings.data.data, isMainnet));
  if (!settingsV1.ok) return Err(settingsV1.error);
  return Ok({ settings: settings.data, settingsV1: settingsV1.data, settingsAssetTxInput });
};

const fetchRefSpendSettings = async (): Promise<
  Result<
    {
      refSpendSettings: RefSpendSettings;
      refSpendSettingsV1: RefSpendSettingsV1;
      refSpendSettingsAssetTxInput: Utxo;
    },
    string
  >
> => {
  const refSpendSettingsAssetTxInput = await fetchHandleUtxo(REF_SPEND_SETTINGS_HANDLE_NAME);
  const refSpendSettings = mayFail(() =>
    decodeRefSpendSettingsDatum(inlineDatumOf(refSpendSettingsAssetTxInput))
  );
  if (!refSpendSettings.ok) return Err(refSpendSettings.error);
  const refSpendSettingsV1 = mayFail(() =>
    decodeRefSpendSettingsV1Data(refSpendSettings.data.data)
  );
  if (!refSpendSettingsV1.ok) return Err(refSpendSettingsV1.error);
  return Ok({
    refSpendSettings: refSpendSettings.data,
    refSpendSettingsV1: refSpendSettingsV1.data,
    refSpendSettingsAssetTxInput,
  });
};

const fetchMintingData = async (): Promise<
  Result<{ mintingData: MintingData; mintingDataAssetTxInput: Utxo }, string>
> => {
  const mintingDataAssetTxInput = await fetchHandleUtxo(MINTING_DATA_HANDLE_NAME);
  const mintingData = mayFail(() =>
    decodeMintingDataDatum(inlineDatumOf(mintingDataAssetTxInput))
  );
  if (!mintingData.ok) return Err(mintingData.error);
  return Ok({ mintingData: mintingData.data, mintingDataAssetTxInput });
};

export { fetchHandleUtxo, fetchMintingData, fetchRefSpendSettings, fetchSettings };

// @cardano-sdk/core, loaded through require() on purpose.
//
// This package is ESM, but kora-labs-common (whose txBuild finalizes our plans) is CommonJS and so
// loads cardano-sdk's CJS build. An ESM `import` would load the separate ESM build: two copies of
// every class (PlutusData, Transaction…) and of the Conway-era flag. Routing through this CommonJS
// file makes both packages share one cardano-sdk instance.
export { Cardano, Serialization, setInConwayEra } from "@cardano-sdk/core";

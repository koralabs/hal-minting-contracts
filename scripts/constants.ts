import path from "path";

import { NetworkName } from "../src/cardano/index.js";

export const { STORE_DIRECTORY = "" } = process.env;

// De Mi Constants
export const MPT_STORE_PATH = (network: NetworkName): string =>
  path.join(STORE_DIRECTORY, network.toLowerCase() + "-db"); // directory

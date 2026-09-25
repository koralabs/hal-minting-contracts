// The package under test, as consumers import it, plus test-only helpers.
import { CONTRACT_NAME } from "../src/constants/index.js";

export * from "../src/constants/index.js";
export * from "../src/index.js";
export const CONTRACT_NAME_VALUES = Object.values(CONTRACT_NAME) as string[];

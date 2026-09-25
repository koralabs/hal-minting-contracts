import { Store, Trie } from "@aiken-lang/merkle-patricia-forestry";
import { BlockfrostTxClient } from "@koralabs/kora-labs-common/txBuild";
import { existsSync } from "fs";

import { BLOCKFROST_API_KEY, NETWORK } from "../../src/constants/index.js";

class CommandImpl {
  storePath: string;
  mpt: Trie | null;
  blockfrost: BlockfrostTxClient;
  running = true;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.blockfrost = new BlockfrostTxClient({
      network: NETWORK,
      blockfrostApiKey: BLOCKFROST_API_KEY,
    });
    this.mpt = null;
  }

  async loadMPT() {
    if (existsSync(this.storePath)) {
      this.mpt = await Trie.load(new Store(this.storePath));
      console.log("Database exists, current state: ");
      console.log(this.mpt);
    } else {
      console.log("Database not exists");
    }
  }
}

export { CommandImpl };

import prompts from "prompts";

import { networkNameOf } from "../../src/cardano/index.js";
import { NETWORK } from "../../src/constants/index.js";
import { MPT_STORE_PATH } from "../constants.js";
import { doMPTActions } from "./mpt.js";
import { doOnChainActions } from "./on-chain.js";
import { CommandImpl } from "./types.js";

const main = async () => {
  const storePath = MPT_STORE_PATH(networkNameOf(NETWORK));
  const commandImpl = new CommandImpl(storePath);
  await commandImpl.loadMPT();

  while (commandImpl.running) {
    const mainAction = await prompts({
      message: "Pick main action",
      name: "action",
      type: "select",
      choices: [
        {
          title: "mpt",
          description: "MPT actions",
          value: () => doMPTActions(commandImpl),
        },
        {
          title: "on-chain",
          description: "On Chain Actions",
          value: () => doOnChainActions(commandImpl),
        },
        {
          title: "exit",
          description: "Exit",
          value: () => {
            commandImpl.running = false;
          },
        },
      ],
    });
    try {
      await mainAction.action();
    } catch (err) {
      console.error(err);
    }
  }
};

main();

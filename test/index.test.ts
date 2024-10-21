import { describe, test, expect, beforeAll } from "@jest/globals";
import { BrianCoinbaseSDK, BrianCoinbaseSDKOptions } from "../src/sdk";
import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";

// import environment variables
const BRIAN_API_KEY = process.env.BRIAN_API_KEY;
const CDP_SDK_API_KEY_NAME = process.env.CDP_SDK_API_KEY_NAME;
const CDP_SDK_API_KEY_SECRET = process.env.CDP_SDK_API_KEY_SECRET;
const COINBASE_FILE_PATH = process.env.COINBASE_FILE_PATH || "test";

if (!BRIAN_API_KEY || !CDP_SDK_API_KEY_NAME || !CDP_SDK_API_KEY_SECRET) {
  throw new Error("Required environment variables are missing");
}

const TIMEOUT = 30000;

describe("BrianCoinbaseSDK Tests", () => {
  let brianCoinbaseSDK: BrianCoinbaseSDK;

  const options: BrianCoinbaseSDKOptions = {
    brianApiKey: BRIAN_API_KEY,
    coinbaseApiKeyName: CDP_SDK_API_KEY_NAME,
    coinbaseApiKeySecret: CDP_SDK_API_KEY_SECRET,
    coinbaseFilePath: COINBASE_FILE_PATH,
  };

  beforeAll(() => {
    brianCoinbaseSDK = new BrianCoinbaseSDK(options);
  });

  /**************************
   * SDK INITIALIZATION TESTS *
   **************************/
  test("SDK initialization with missing Brian API key should throw an error", () => {
    expect(
      () =>
        new BrianCoinbaseSDK({
          ...options,
          brianApiKey: "",
        })
    ).toThrowError("Brian API key is required");
  });
  console.log(
    "SDK initialization with missing Coinbase credentials should throw an error"
  );

  test("SDK initialization with missing Coinbase credentials should throw an error", () => {
    expect(
      () =>
        new BrianCoinbaseSDK({
          brianApiKey: BRIAN_API_KEY,
        })
    ).toThrowError("Coinbase API key name + secret, or file path are required");
  });

  /*************************
   * WALLET MANAGEMENT TESTS *
   *************************/
  describe("Wallet Management", () => {
    test(
      "creates a new wallet",
      async () => {
        const wallet = await brianCoinbaseSDK.createWallet({
          networkId: "base-sepolia",
        });
        expect(wallet).toBeInstanceOf(Wallet);
        expect(brianCoinbaseSDK.getCurrentWallet()).toEqual(wallet);
      },
      TIMEOUT
    );

    test("exports the current wallet", async () => {
      const wallet = await brianCoinbaseSDK.createWallet({
        networkId: "base-sepolia",
      });
      const walletData = brianCoinbaseSDK.exportWallet();
      expect(walletData).not.toBeNull();
    });

    test("fails to fund the wallet if it's on the wrong network", async () => {
      await brianCoinbaseSDK.createWallet({
        networkId: Coinbase.networks.BaseMainnet,
      });
      await expect(brianCoinbaseSDK.fundWallet()).rejects.toThrow(
        "Wallet is not on Sepolia"
      );
    });
    /*
    test("funds the wallet using the faucet", async () => {
      const wallet = await brianCoinbaseSDK.createWallet({ networkId: "base-sepolia" });
      console.log("Funding wallet");
      const transaction = await brianCoinbaseSDK.fundWallet();
      expect(transaction.getTransactionHash()).toBeDefined(); 
    });*/
  });

  /********************
   * TRANSACTIONS TESTS *
   ********************/

  describe("Transaction Handling", () => {
    test(
      "performs a valid transfer transaction",
      async () => {
        //load wallet from env
        const wallet = await brianCoinbaseSDK.importWallet({
          walletId: process.env.CDP_TEST_WALLET_ID || "",
          seed: process.env.CDP_TEST_WALLET_SEED || "",
        });
        //load recipient address from env
        const recipientAddress = process.env.CDP_TEST_WALLET_ADDRESS || "";
        const txHashes = await brianCoinbaseSDK.transact(
          `Bridge 1 USDC to USDC from Base to Arbitrum`
        );
        expect(txHashes.length).toBeGreaterThan(0);
      },
      TIMEOUT
    );

    /*
    test("performs a valid swap transaction", async () => {
      const wallet = await brianCoinbaseSDK.importWallet({
        walletId: process.env.CDP_TEST_WALLET_ID || "",
        seed: process.env.CDP_TEST_WALLET_SEED || "",
      });
      //export standard wallet
      const walletData = brianCoinbaseSDK.getDefaultAddress();
      const exportedWallet = (await walletData).export();
      console.log(exportedWallet, "exported wallet");
      const txHashes = await brianCoinbaseSDK.transact(`swap 0.0004 ETH to USDC on Base`);
      expect(txHashes.length).toBeGreaterThan(0);
    }, TIMEOUT);
    */
    /*
    test("performs a valid deposit transaction", async () => {
      const wallet = await brianCoinbaseSDK.importWallet({
        walletId: process.env.CDP_TEST_WALLET_ID || "",
        seed: process.env.CDP_TEST_WALLET_SEED || "",
      });
      //export standard wallet
      const walletData = brianCoinbaseSDK.getDefaultAddress();
      const exportedWallet = (await walletData).export();
      console.log(exportedWallet, "exported wallet");
      const txHashes = await brianCoinbaseSDK.transact(`deposit 2$ of eth on aave on Base`);
      expect(txHashes.length).toBeGreaterThan(0);
    }, TIMEOUT);
    */
    /*
    test("performs a valid borrow transaction", async () => {
      const wallet = await brianCoinbaseSDK.importWallet({
        walletId: process.env.CDP_TEST_WALLET_ID || "",
        seed: process.env.CDP_TEST_WALLET_SEED || "",
      });
      //export standard wallet
      const walletData = brianCoinbaseSDK.getDefaultAddress();
      const exportedWallet = (await walletData).export();
      console.log(exportedWallet, "exported wallet");
      const txHashes = await brianCoinbaseSDK.transact(`borrow 1 USDC from aave on Base`);
      expect(txHashes.length).toBeGreaterThan(0);
    }, TIMEOUT);
    */
  });
});

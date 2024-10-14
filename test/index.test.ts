import { describe, test, expect, beforeAll } from "@jest/globals";
import {
  BrianCoinbaseSDK,
  BrianCoinbaseSDKOptions
} from "../src/sdk";
import { Wallet, WalletData } from "@coinbase/coinbase-sdk";

// import environment variables
const BRIAN_API_KEY = process.env.BRIAN_API_KEY;
const CDP_SDK_API_KEY_NAME = process.env.CDP_SDK_API_KEY_NAME;
const CDP_SDK_API_KEY_SECRET = process.env.CDP_SDK_API_KEY_SECRET;
const COINBASE_FILE_PATH = process.env.COINBASE_FILE_PATH || "test";
console.log("BRIAN_API_KEY", BRIAN_API_KEY);
console.log("CDP_SDK_API_KEY_NAME", CDP_SDK_API_KEY_NAME);
console.log("CDP_SDK_API_KEY_SECRET", CDP_SDK_API_KEY_SECRET);
console.log("COINBASE_FILE_PATH", COINBASE_FILE_PATH);

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
    expect(() => new BrianCoinbaseSDK({
      ...options,
      brianApiKey: "",
    })).toThrowError("Brian API key is required");
  });
  console.log("SDK initialization with missing Coinbase credentials should throw an error");

  test("SDK initialization with missing Coinbase credentials should throw an error", () => {
    expect(() => new BrianCoinbaseSDK({
      brianApiKey: BRIAN_API_KEY,
    })).toThrowError("Coinbase API key name + secret, or file path are required");
  });

  /*************************
   * WALLET MANAGEMENT TESTS *
   *************************/
  describe("Wallet Management", () => {
    test("creates a new wallet", async () => {
      const wallet = await brianCoinbaseSDK.createWallet({
        networkId: "base-sepolia",
      });
      expect(wallet).toBeInstanceOf(Wallet);
      expect(brianCoinbaseSDK.getCurrentWallet()).toEqual(wallet);
    }, TIMEOUT);

    test("exports the current wallet", async () => {
      const wallet = await brianCoinbaseSDK.createWallet({
        networkId: "base-sepolia",
      });
      const walletData = brianCoinbaseSDK.exportWallet();
      expect(walletData).not.toBeNull();
    });
    
    test("funds the wallet using the faucet", async () => {
      await brianCoinbaseSDK.createWallet({ networkId: "base-sepolia" });
      const transaction = await brianCoinbaseSDK.fundWallet();
      expect(transaction).toHaveProperty("txHash");
    });

    test("fails to fund the wallet if it's on the wrong network", async () => {
      await brianCoinbaseSDK.createWallet({ networkId: "wrong-network" });
      await expect(brianCoinbaseSDK.fundWallet()).rejects.toThrowError(
        "Wallet is not on Sepolia"
      );
    });
  });

  /********************
   * TRANSACTIONS TESTS *
   ********************/
  /*
  describe("Transaction Handling", () => {
    test("performs a valid transfer transaction", async () => {
      await brianCoinbaseSDK.createWallet({ networkId: "base-sepolia" });
      const txHashes = await brianCoinbaseSDK.transact("transfer 0.01 ETH to 0x123...");
      expect(txHashes.length).toBeGreaterThan(0);
    }, TIMEOUT);

    test("throws an error when no wallet is created before a transaction", async () => {
      brianCoinbaseSDK = new BrianCoinbaseSDK(options); // Reset without wallet
      await expect(brianCoinbaseSDK.transact("transfer 0.01 ETH")).rejects.toThrow(
        "No wallet created"
      );
    });

    test("handles an ERC-20 swap", async () => {
      await brianCoinbaseSDK.createWallet({ networkId: "base-sepolia" });
      const txHashes = await brianCoinbaseSDK.transact(
        "swap 10 USDC for USDT on Polygon"
      );
      expect(txHashes.length).toBeGreaterThan(0);
    }, TIMEOUT);

    test("handles a cross-chain bridge transaction", async () => {
      await brianCoinbaseSDK.createWallet({ networkId: "base-sepolia" });
      const txHashes = await brianCoinbaseSDK.transact(
        "bridge 5 USDC from Polygon to Ethereum"
      );
      expect(txHashes.length).toBeGreaterThan(0);
    }, TIMEOUT);
  });*/
});

import { BrianSDK } from "@brian-ai/sdk";
import {
  Coinbase,
  ContractInvocation,
  FaucetTransaction,
  Transfer,
  Wallet,
  WalletAddress,
  WalletCreateOptions,
  WalletData,
} from "@coinbase/coinbase-sdk";
import { decodeFunctionData, erc20Abi, formatUnits } from "viem";

interface BrianCoinbaseSDKOptions {
  brianApiKey: string;
  brianApiUrl?: string;
  coinbaseApiKeyName?: string;
  coinbaseApiKeySecret?: string;
  coinbaseFilePath?: string;
  coinbaseOptions?: {
    useServerSigner?: boolean;
    debugging?: boolean;
    basePath?: string;
  };
}

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

export class BrianCoinbaseSDK {
  private readonly brianSDK;
  private currentWallet: Wallet | null = null;

  constructor({
    brianApiKey,
    brianApiUrl,
    coinbaseApiKeyName,
    coinbaseApiKeySecret,
    coinbaseFilePath,
    coinbaseOptions,
  }: BrianCoinbaseSDKOptions) {
    if (!brianApiKey) {
      throw new Error("Brian API key is required");
    }
    if ((!coinbaseApiKeyName && !coinbaseApiKeySecret) || !coinbaseFilePath) {
      throw new Error(
        "Coinbase API key name + secret, or file path are required"
      );
    }
    this.brianSDK = new BrianSDK({ apiKey: brianApiKey, apiUrl: brianApiUrl });
    if (coinbaseApiKeyName && coinbaseApiKeySecret) {
      Coinbase.configure({
        apiKeyName: coinbaseApiKeyName,
        privateKey: coinbaseApiKeySecret,
        ...coinbaseOptions,
      });
    } else {
      Coinbase.configureFromJson({
        filePath: coinbaseFilePath,
        ...coinbaseOptions,
      });
    }
  }

  getCurrentWallet(): Wallet | null {
    return this.currentWallet;
  }

  async createWallet({
    networkId,
    timeoutSeconds,
    intervalSeconds,
  }: WalletCreateOptions): Promise<Wallet> {
    this.currentWallet = await Wallet.create({
      networkId,
      timeoutSeconds,
      intervalSeconds,
    });
    return this.currentWallet;
  }

  async importWallet(walletData: WalletData): Promise<Wallet> {
    this.currentWallet = await Wallet.import(walletData);
    return this.currentWallet;
  }

  exportWallet(): WalletData {
    if (!this.currentWallet) {
      throw new Error("No wallet created");
    }
    return this.currentWallet.export();
  }

  saveWallet__insecure(filePath: string, encrypt: boolean = true): string {
    if (!this.currentWallet) {
      throw new Error("No wallet created");
    }
    return this.currentWallet.saveSeed(filePath, encrypt);
  }

  async getDefaultAddress(): Promise<WalletAddress | undefined> {
    if (!this.currentWallet) {
      throw new Error("No wallet created");
    }
    return this.currentWallet.getDefaultAddress();
  }

  async fundWallet(): Promise<FaucetTransaction> {
    if (!this.currentWallet) {
      throw new Error("No wallet created");
    }
    if (this.currentWallet.getNetworkId() !== "base-sepolia") {
      throw new Error("Wallet is not on Sepolia");
    }
    return await this.currentWallet.faucet();
  }

  async transact(prompt: string) {
    if (!this.currentWallet) {
      throw new Error("No wallet created");
    }
    const walletAddress = await this.getDefaultAddress();
    if (!walletAddress) {
      throw new Error("No wallet address found");
    }
    const brianResponse = await this.brianSDK.transact({
      prompt,
      address: walletAddress.toString(),
    });

    const txHashes: (Transfer | ContractInvocation)[] = [];

    for (const transactionResult of brianResponse) {
      const { action, data } = transactionResult;

      if (action === "transfer") {
        const txStep = data.steps![0];
        if (!txStep) {
          continue;
        }
        if (data.fromToken?.address === NULL_ADDRESS) {
          // generate tx for ETH
          const ethTransferTx = await this.currentWallet.createTransfer({
            destination: txStep.to,
            amount: parseFloat(formatUnits(BigInt(txStep.value), 18)),
            assetId: Coinbase.assets.Eth,
          });
          txHashes.push(await ethTransferTx.wait());
        } else {
          const { args } = decodeFunctionData({
            abi: erc20Abi,
            data: txStep.data,
          });
          const erc20TransferTx = await this.currentWallet.invokeContract({
            contractAddress: txStep.to,
            method: "transfer",
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20TransferTx.wait());
        }
      }
    }
    return txHashes;
  }
}

/*ACTIONS:
swap -> enso or bungee or lifi or symbiosis
bridge -> bungee or lifi or synbiosis
deposit -> enso or lido
withdraw -> enso
borrow -> aave
repay -> aave
ens registration -> ens registrar
ens renewal -> ens registrar
*/
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
import { erc20Abi } from "viem";
import {
  AAVE_V3_L1_POOL_ABI,
  AAVE_V3_L2_POOL_ABI,
  BUNGEE_ROUTER_ABI,
  decodeFunctionDataForCdp,
  ENS_REGISTRAR_CONTROLLER_ABI,
  ENSO_ROUTER_ABI,
  LIDO_ABI,
  LIFI_ROUTER_ABI,
} from "./utils";

export interface BrianCoinbaseSDKOptions {
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
  readonly brianSDK;
  currentWallet: Wallet | null = null;

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

  async getDefaultAddress(): Promise<WalletAddress> {
    if (!this.currentWallet) {
      throw new Error("No wallet created");
    }
    return this.currentWallet.getDefaultAddress();
  }

  async getAddress(): Promise<string> {
    const walletAddress = await this.getDefaultAddress();
    return walletAddress?.getId();
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
      address: walletAddress?.getId().toString(),
    });

    const txHashes: (Transfer | ContractInvocation)[] = [];

    for (const transactionResult of brianResponse) {
      const { action, data, solver } = transactionResult;

      if (action === "transfer") {
        const txStep = data.steps![0];
        if (!txStep) {
          continue;
        }
        if (data.fromToken?.address === NULL_ADDRESS) {
          // generate tx for ETH
          const ethTransferTx = await this.currentWallet.createTransfer({
            destination: txStep.to,
            amount: BigInt(txStep.value),
            assetId: Coinbase.assets.Wei,
          });
          txHashes.push(await ethTransferTx.wait());
        } else {
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            txStep.data
          );
          const erc20TransferTx = await this.currentWallet.invokeContract({
            contractAddress: txStep.to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20TransferTx.wait());
        }
      }
      if (action === "swap") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;

        if (approveNeeded) {
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            data.steps![0].data
          );
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //retrieve swap data
        const solverAbi =
          solver === "Enso"
            ? ENSO_ROUTER_ABI
            : solver === "Bungee"
            ? BUNGEE_ROUTER_ABI
            : LIFI_ROUTER_ABI;

        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          solverAbi,
          data.steps![data.steps!.length - 1].data
        );
        //make swap
        const swapTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: solverAbi,
          args: decodedData,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await swapTx.wait());
      }
      if (action === "bridge") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //decode data according to CDP sdk
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            data.steps![0].data
          );

          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //get bridge solver
        const bridgeSolver = solver;
        //get solver abi
        const solverAbi =
          bridgeSolver === "Enso"
            ? ENSO_ROUTER_ABI
            : bridgeSolver === "Bungee"
            ? BUNGEE_ROUTER_ABI
            : LIFI_ROUTER_ABI;
        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          solverAbi,
          data.steps![data.steps!.length - 1].data
        );

        //make bridge
        const bridgeTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: solverAbi,
          args: decodedData,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await bridgeTx.wait());
      }
      if (action === "deposit") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //decode data according to CDP sdk
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            data.steps![0].data
          );
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //get deposit solver
        const depositSolver = solver;
        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          depositSolver === "Enso" ? ENSO_ROUTER_ABI : LIDO_ABI,
          data.steps![data.steps!.length - 1].data
        );

        //make deposit
        const depositTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: depositSolver === "Enso" ? ENSO_ROUTER_ABI : LIDO_ABI,
          args: decodedData,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await depositTx.wait());
      }
      if (action === "withdraw") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //decode data according to CDP sdk
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            data.steps![0].data
          );
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          ENSO_ROUTER_ABI,
          data.steps![data.steps!.length - 1].data
        );
        //make withdraw
        const withdrawTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: ENSO_ROUTER_ABI,
          args: decodedData,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await withdrawTx.wait());
      }
      if (action === "AAVE Borrow") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //decode data according to CDP sdk
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            data.steps![0].data
          );
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          data.steps![data.steps!.length - 1].chainId === 1
            ? AAVE_V3_L1_POOL_ABI
            : AAVE_V3_L2_POOL_ABI,
          data.steps![data.steps!.length - 1].data
        );
        //make borrow
        const borrowTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi:
            data.steps![data.steps!.length - 1].chainId === 1
              ? AAVE_V3_L1_POOL_ABI
              : AAVE_V3_L2_POOL_ABI,
          args: decodedData,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await borrowTx.wait());
      }
      if (action === "AAVE Repay") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //decode data according to CDP sdk
          const [decodedData, functionName] = decodeFunctionDataForCdp(
            erc20Abi,
            data.steps![0].data
          );
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args: decodedData,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          data.steps![data.steps!.length - 1].chainId === 1
            ? AAVE_V3_L1_POOL_ABI
            : AAVE_V3_L2_POOL_ABI,
          data.steps![data.steps!.length - 1].data
        );
        //make repay
        const repayTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi:
            data.steps![data.steps!.length - 1].chainId === 1
              ? AAVE_V3_L1_POOL_ABI
              : AAVE_V3_L2_POOL_ABI,
          args: decodedData,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await repayTx.wait());
      }
      if (action === "ENS Registration") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        //decode data according to CDP sdk
        const [decodedDataCommitment, functionNameCommitment] =
          decodeFunctionDataForCdp(
            ENS_REGISTRAR_CONTROLLER_ABI,
            data.steps![0].data
          );
        //make commitment
        const commitmentTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![0].to,
          method: functionNameCommitment,
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          args: decodedDataCommitment,
          amount: BigInt(data.steps![0].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await commitmentTx.wait());
        //wait 60 seconds for ens commitment to be made
        await new Promise((resolve) => setTimeout(resolve, 60000));
        //ens registration
        const [decodedDataRegistration, functionNameRegistration] =
          decodeFunctionDataForCdp(
            ENS_REGISTRAR_CONTROLLER_ABI,
            data.steps![1].data
          );
        //make registration
        const registrationTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![1].to,
          method: functionNameRegistration,
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          args: decodedDataRegistration,
          amount: BigInt(data.steps![1].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await registrationTx.wait());
      }
      if (action === "ENS Renewal") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        //decode data according to CDP sdk
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          ENS_REGISTRAR_CONTROLLER_ABI,
          data.steps![0].data
        );
        //make renewal
        const renewalTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![0].to,
          method: functionName,
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          args: decodedData,
          amount: BigInt(data.steps![0].value),
          assetId: Coinbase.assets.Wei,
        });
        txHashes.push(await renewalTx.wait());
      }
    }
    return txHashes;
  }
}

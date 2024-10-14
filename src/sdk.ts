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
import {
  AAVE_V3_L1_POOL_ABI,
  AAVE_V3_L2_POOL_ABI,
  BUNGEE_ROUTER_ABI,
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
      if (action === "swap") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        console.log("approveNeeded", approveNeeded);
        if (approveNeeded) {
          //retrieve approve data
          const { args, functionName } = decodeFunctionData({
            abi: erc20Abi,
            data: data.steps![0].data,
          });
          console.log("args", args);
          console.log("functionName", functionName);
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //get swap solver
        const swapSolver = solver;
        console.log("swapSolver", swapSolver);
        //retrieve swap data
        const solverAbi =
          swapSolver === "Enso"
            ? ENSO_ROUTER_ABI
            : swapSolver === "Bungee"
            ? BUNGEE_ROUTER_ABI
            : LIFI_ROUTER_ABI;
        const { args, functionName } = decodeFunctionData({
          abi: solverAbi,
          data: data.steps![data.steps!.length - 1].data,
        });
        const stringifiedArgs = args!.map((arg) =>
          typeof arg === "bigint" ? arg.toString() : arg
        );
        // console.log("stringifiedArgs", stringifiedArgs);

        // console.log("args", args);
        console.log("functionName", functionName);
        console.log(
          "Number(data.steps![data.steps!.length - 1].value)",
          Number(data.steps![data.steps!.length - 1].value)
        );
        console.log(
          "data.steps![data.steps!.length - 1].to",
          data.steps![data.steps!.length - 1].to
        );

        //make swap
        const swapTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: solverAbi,
          args: stringifiedArgs,
          amount: BigInt(data.steps![data.steps!.length - 1].value),
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
          //retrieve approve data
          const { args, functionName } = decodeFunctionData({
            abi: erc20Abi,
            data: data.steps![0].data,
          });
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //get bridge solver
        const bridgeSolver = solver;
        //retrieve bridge data
        const { args, functionName } = decodeFunctionData({
          abi:
            bridgeSolver === "Enso"
              ? ENSO_ROUTER_ABI
              : bridgeSolver === "Bungee"
              ? BUNGEE_ROUTER_ABI
              : LIFI_ROUTER_ABI,
          data: data.steps![data.steps!.length - 1].data,
        });

        //make bridge
        const bridgeTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi:
            bridgeSolver === "Enso"
              ? ENSO_ROUTER_ABI
              : bridgeSolver === "Bungee"
              ? BUNGEE_ROUTER_ABI
              : LIFI_ROUTER_ABI,
          args: args ?? [],
          amount: Number(data.steps![data.steps!.length - 1].value),
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
          //retrieve approve data
          const { args, functionName } = decodeFunctionData({
            abi: erc20Abi,
            data: data.steps![0].data,
          });
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //get deposit solver
        const depositSolver = solver;
        //retrieve deposit data
        const { args, functionName } = decodeFunctionData({
          abi: depositSolver === "Enso" ? ENSO_ROUTER_ABI : LIDO_ABI,
          data: data.steps![data.steps!.length - 1].data,
        });

        //make deposit
        const depositTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: depositSolver === "Enso" ? ENSO_ROUTER_ABI : LIDO_ABI,
          args: args ?? [],
          amount: Number(data.steps![data.steps!.length - 1].value),
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
          //retrieve approve data
          const { args, functionName } = decodeFunctionData({
            abi: erc20Abi,
            data: data.steps![0].data,
          });
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //retrieve withdraw data
        const { args, functionName } = decodeFunctionData({
          abi: ENSO_ROUTER_ABI,
          data: data.steps![data.steps!.length - 1].data,
        });

        //make withdraw
        const withdrawTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi: ENSO_ROUTER_ABI,
          args: args ?? [],
          amount: Number(data.steps![data.steps!.length - 1].value),
        });
        txHashes.push(await withdrawTx.wait());
      }
      if (action === "borrow") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //retrieve approve data
          const { args, functionName } = decodeFunctionData({
            abi: erc20Abi,
            data: data.steps![0].data,
          });
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //retrieve borrow data
        const { args, functionName } = decodeFunctionData({
          abi:
            data.steps![data.steps!.length - 1].chainId === 1
              ? AAVE_V3_L1_POOL_ABI
              : AAVE_V3_L2_POOL_ABI,
          data: data.steps![data.steps!.length - 1].data,
        });

        //make borrow
        const borrowTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi:
            data.steps![data.steps!.length - 1].chainId === 1
              ? AAVE_V3_L1_POOL_ABI
              : AAVE_V3_L2_POOL_ABI,
          args: args ?? [],
          amount: Number(data.steps![data.steps!.length - 1].value),
        });
        txHashes.push(await borrowTx.wait());
      }
      if (action === "repay") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        const approveNeeded = data.steps!.length > 1;
        if (approveNeeded) {
          //retrieve approve data
          const { args, functionName } = decodeFunctionData({
            abi: erc20Abi,
            data: data.steps![0].data,
          });
          //make approve
          const erc20ApproveTx = await this.currentWallet.invokeContract({
            contractAddress: data.steps![0].to,
            method: functionName,
            abi: erc20Abi,
            args,
          });
          txHashes.push(await erc20ApproveTx.wait());
        }
        //retrieve repay data
        const { args, functionName } = decodeFunctionData({
          abi:
            data.steps![data.steps!.length - 1].chainId === 1
              ? AAVE_V3_L1_POOL_ABI
              : AAVE_V3_L2_POOL_ABI,
          data: data.steps![data.steps!.length - 1].data,
        });

        //make repay
        const repayTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![data.steps!.length - 1].to,
          method: functionName,
          abi:
            data.steps![data.steps!.length - 1].chainId === 1
              ? AAVE_V3_L1_POOL_ABI
              : AAVE_V3_L2_POOL_ABI,
          args: args ?? [],
          amount: Number(data.steps![data.steps!.length - 1].value),
        });
        txHashes.push(await repayTx.wait());
      }
      if (action === "ensregistration") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        //ens domain commitment
        const { args, functionName } = decodeFunctionData({
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          data: data.steps![0].data,
        });
        //make commitment
        const commitmentTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![0].to,
          method: functionName,
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          args: args ?? [],
          amount: Number(data.steps![0].value),
        });
        txHashes.push(await commitmentTx.wait());
        //ens registration
        const { args: args2, functionName: functionName2 } = decodeFunctionData(
          {
            abi: ENS_REGISTRAR_CONTROLLER_ABI,
            data: data.steps![1].data,
          }
        );
        //make registration
        const registrationTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![1].to,
          method: functionName2,
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          args: args2 ?? [],
          amount: Number(data.steps![1].value),
        });
        txHashes.push(await registrationTx.wait());
      }
      if (action === "ensrenewal") {
        //check if there are any steps
        const txStepsLength = data.steps!.length;
        if (txStepsLength === 0) {
          continue;
        }
        //ens domain renewal
        const { args, functionName } = decodeFunctionData({
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          data: data.steps![0].data,
        });
        //make renewal
        const renewalTx = await this.currentWallet.invokeContract({
          contractAddress: data.steps![0].to,
          method: functionName,
          abi: ENS_REGISTRAR_CONTROLLER_ABI,
          args: args ?? [],
          amount: Number(data.steps![0].value),
        });
        txHashes.push(await renewalTx.wait());
      }
    }
    return txHashes;
  }
}

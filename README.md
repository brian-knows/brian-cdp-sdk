# Brian <> Coinbase SDK

A TypeScript SDK that integrates Brian AI's transaction capabilities with Coinbase's wallet functionality, providing a seamless interface for blockchain interactions.

## Features

- Easy integration with Brian AI and Coinbase SDKs
- Wallet management (create, import, export)
- Support for various blockchain operations:
  - Transfers (ETH and ERC20 tokens)
  - Swaps
  - Bridging
  - Deposits and Withdrawals
  - Borrowing and Repaying (AAVE)
  - ENS Registration and Renewal
- Automatic transaction handling based on Brian AI's responses

## Installation

```bash
npm install @brian-ai/cdp-sdk
```

## Usage

Here's a quick example of how to use the SDK:

```typescript
import { BrianCoinbaseSDK } from "brian-coinbase-sdk";

const sdk = new BrianCoinbaseSDK({
  brianApiKey: "your_brian_api_key",
  coinbaseApiKeyName: "your_coinbase_api_key_name",
  coinbaseApiKeySecret: "your_coinbase_api_key_secret",
});
// Create a wallet
await sdk.createWallet({ networkId: "base-sepolia" });
// Fund the wallet (only for Sepolia testnet)
await sdk.fundWallet();
// Execute a transaction based on a prompt
const txHashes = await sdk.transact("Swap 0.1 ETH for USDC");
console.log("Transaction hashes:", txHashes);
```

## Configuration

The `BrianCoinbaseSDK` constructor accepts the following options:

- `brianApiKey` (required): Your Brian AI API key
- `brianApiUrl` (optional): Custom Brian AI API URL
- `coinbaseApiKeyName` (required if not using file path): Your Coinbase API key name
- `coinbaseApiKeySecret` (required if not using file path): Your Coinbase API key secret
- `coinbaseFilePath` (required if not using API key): Path to Coinbase configuration file
- `coinbaseOptions` (optional): Additional Coinbase SDK options

## API Reference

- `createWallet(options: WalletCreateOptions): Promise<Wallet>`
- `importWallet(walletData: WalletData): Promise<Wallet>`
- `exportWallet(): WalletData`
- `saveWallet__insecure(filePath: string, encrypt?: boolean): string`
- `getDefaultAddress(): Promise<WalletAddress | undefined>`
- `fundWallet(): Promise<FaucetTransaction>`
- `transact(prompt: string): Promise<(Transfer | ContractInvocation)[]>`

For detailed information on each method, please refer to the source code and comments.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

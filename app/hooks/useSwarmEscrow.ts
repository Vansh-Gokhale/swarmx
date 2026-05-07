"use client";

import { useCallback, useMemo } from "react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@/app/lib/wallet/context";
import { useCluster } from "@/app/components/cluster-context";
import { getClusterUrl } from "@/app/lib/solana-client";
import idl from "@/app/idl/swarmx_escrow.json";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "4cCfXEjstobSmNohQKuvAJMug2BKdJwNp5PoUrkKbHHm"
);
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const ORCHESTRATOR = new PublicKey(
  process.env.NEXT_PUBLIC_ORCHESTRATOR_PUBKEY ||
    "FxZJgqExekSxW8pMXUDKTojU8TWF34KYkkyReUVUUdhC"
);

/**
 * Bridge between @solana/kit wallet and Anchor's expected wallet interface.
 * Anchor needs { publicKey, signTransaction, signAllTransactions }.
 */
function createAnchorWallet(session: {
  account: { address: string; publicKey: Uint8Array };
  signTransaction?: (tx: Uint8Array, chain: string) => Promise<Uint8Array>;
}, chain: string) {
  const pubkey = new PublicKey(session.account.address);

  return {
    publicKey: pubkey,
    signTransaction: async (tx: any) => {
      if (!session.signTransaction) throw new Error("Wallet does not support signing");
      // Serialize → sign → deserialize
      const { Transaction } = await import("@solana/web3.js");
      const serialized = tx.serialize({ requireAllSignatures: false });
      const signed = await session.signTransaction(serialized, chain);
      return Transaction.from(signed);
    },
    signAllTransactions: async (txs: any[]) => {
      const { Transaction } = await import("@solana/web3.js");
      return Promise.all(
        txs.map(async (tx) => {
          if (!session.signTransaction) throw new Error("Wallet does not support signing");
          const serialized = tx.serialize({ requireAllSignatures: false });
          const signed = await session.signTransaction!(serialized, chain);
          return Transaction.from(signed);
        })
      );
    },
  };
}

export function useSwarmEscrow() {
  const { wallet, signer } = useWallet();
  const { cluster } = useCluster();
  const chain = `solana:${cluster}`;
  const rpcUrl = getClusterUrl(cluster);

  const connection = useMemo(
    () => new Connection(rpcUrl, "confirmed"),
    [rpcUrl]
  );

  const getProgram = useCallback(() => {
    if (!wallet || !wallet.signTransaction) {
      throw new Error("Wallet not connected or does not support signing");
    }
    const anchorWallet = createAnchorWallet(wallet, chain);
    const provider = new AnchorProvider(connection, anchorWallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return new Program(idl as any, provider);
  }, [connection, wallet, chain]);

  const getTaskPDA = useCallback(
    (taskId: number): [PublicKey, number] => {
      const taskIdBuffer = Buffer.from(new BN(taskId).toArray('le', 8));
      return PublicKey.findProgramAddressSync(
        [Buffer.from("swarmx_task"), taskIdBuffer],
        PROGRAM_ID
      );
    },
    []
  );

  const getVaultPDA = useCallback(
    (taskId: number): [PublicKey, number] => {
      const taskIdBuffer = Buffer.from(new BN(taskId).toArray('le', 8));
      return PublicKey.findProgramAddressSync(
        [Buffer.from("swarmx_vault"), taskIdBuffer],
        PROGRAM_ID
      );
    },
    []
  );

  /**
   * Send initialize_task to devnet.
   * Deposits `amountUsdc` USDC into the escrow vault.
   */
  const initializeTask = useCallback(
    async (
      taskId: number,
      amountUsdc: number
    ): Promise<{ signature: string; taskPDA: string; explorerUrl: string }> => {
      if (!wallet) throw new Error("Connect your wallet first");

      const program = getProgram();
      const amountRaw = new BN(Math.floor(amountUsdc * 1_000_000));

      const [taskPDA] = getTaskPDA(taskId);
      const [vaultPDA] = getVaultPDA(taskId);

      const userPubkey = new PublicKey(wallet.account.address);

      const userATA = await getAssociatedTokenAddress(
        USDC_MINT,
        userPubkey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Removed local ATA and balance checks so the transaction is always requested
      // and sent to the wallet. The wallet will natively display simulation errors
      // if the user doesn't have sufficient funds.

      console.log("[SwarmX] Sending initialize_task...", {
        taskId,
        amountUsdc,
        taskPDA: taskPDA.toString(),
        vaultPDA: vaultPDA.toString(),
        userATA: userATA.toString(),
      });

      const signature = await program.methods
        .initializeTask(new BN(taskId), amountRaw)
        .accounts({
          task: taskPDA,
          vault: vaultPDA,
          user: userPubkey,
          orchestrator: ORCHESTRATOR,
          userAta: userATA,
          usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc({ commitment: "confirmed" });

      const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
      console.log("[SwarmX] TX confirmed!", { signature, explorerUrl });

      return {
        signature,
        taskPDA: taskPDA.toString(),
        explorerUrl,
      };
    },
    [wallet, connection, getProgram, getTaskPDA, getVaultPDA]
  );

  /**
   * Fetch on-chain task state
   */
  const fetchTask = useCallback(
    async (taskId: number) => {
      const program = getProgram();
      const [taskPDA] = getTaskPDA(taskId);
      try {
        const account = await (program.account as any).taskAccount.fetch(taskPDA);
        return {
          taskId: account.taskId.toString(),
          user: account.user.toString(),
          orchestrator: account.orchestrator.toString(),
          amount: account.amount.toNumber() / 1_000_000,
          status: Object.keys(account.status)[0],
          createdAt: new Date(
            account.createdAt.toNumber() * 1000
          ).toISOString(),
        };
      } catch {
        return null;
      }
    },
    [getProgram, getTaskPDA]
  );

  return { initializeTask, fetchTask, getTaskPDA, getVaultPDA };
}

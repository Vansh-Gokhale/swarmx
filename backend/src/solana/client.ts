import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import idl from "./swarmx_escrow.json";

let _programId: PublicKey | null = null;
let _connection: Connection | null = null;
let _orchestratorKeypair: Keypair | null = null;

function getProgramId() {
  if (!_programId) _programId = new PublicKey(process.env.PROGRAM_ID!);
  return _programId;
}

function getConnection() {
  if (!_connection) _connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"), "confirmed");
  return _connection;
}

function getOrchestratorKeypair() {
  if (!_orchestratorKeypair) _orchestratorKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ORCHESTRATOR_PRIVATE_KEY!)));
  return _orchestratorKeypair;
}

function getProgram() {
  const wallet = new Wallet(getOrchestratorKeypair());
  const provider = new AnchorProvider(getConnection(), wallet, {
    commitment: "confirmed",
  });
  return new Program(idl as any, provider);
}

function getTaskPDA(taskId: number): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(taskId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("swarmx_task"), buf],
    getProgramId()
  );
}

/**
 * Called by orchestrator backend after all agents complete.
 * Sends resolve_task instruction to Solana devnet.
 */
export async function resolveTaskOnChain(
  taskId: number,
  agentPayouts: Array<{
    agentPubkey: string;
    amountUsdc: number;
    label: string;
  }>
): Promise<{ signature: string; explorerUrl: string }> {
  const program = getProgram();
  const [taskPDA] = getTaskPDA(taskId);

  const payouts = agentPayouts.map((p) => ({
    agent: new PublicKey(p.agentPubkey),
    amount: new BN(Math.floor(p.amountUsdc * 1_000_000)),
    label: p.label,
  }));

  console.log("[Solana] Sending resolve_task...", {
    taskId,
    taskPDA: taskPDA.toString(),
    payouts: agentPayouts,
  });

  const signature = await program.methods
    .resolveTask(new BN(taskId), payouts)
    .accounts({
      task: taskPDA,
      orchestrator: getOrchestratorKeypair().publicKey,
      systemProgram: PublicKey.default,
    })
    .signers([getOrchestratorKeypair()])
    .rpc({ commitment: "confirmed" });

  const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  console.log("[Solana] resolve_task confirmed!", { signature, explorerUrl });

  return { signature, explorerUrl };
}

/**
 * Fetch task account state
 */
export async function fetchTaskState(taskId: number) {
  const program = getProgram();
  const [taskPDA] = getTaskPDA(taskId);
  try {
    const account = await (program.account as any).taskAccount.fetch(taskPDA);
    return {
      taskId: account.taskId.toString(),
      amount: account.amount.toNumber() / 1_000_000,
      status: Object.keys(account.status)[0],
      user: account.user.toString(),
      orchestrator: account.orchestrator.toString(),
    };
  } catch {
    return null;
  }
}

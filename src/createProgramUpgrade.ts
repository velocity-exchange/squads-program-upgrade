// eslint-disable-next-line filenames/match-regex
import { AnchorProvider, Wallet } from '@coral-xyz/anchor'
import { batchInstructionsToTxsWithPriorityFee, sendInstructions } from '@helium/spl-utils'
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage
} from '@solana/web3.js'
import * as multisig from "@sqds/multisig"
import { createCloseIdlAccountInstruction } from './createCloseIdlAccountInstruction'
import { createCreateIdlAccountInstruction } from './createCreateIdlAccountInstruction'
import { createIdlUpgradeInstruction } from './createIdlUpgradeInstruction'
import { createProgramUpgradeInstruction } from './createProgramUpgradeInstruction'
import { createResizeAccountInstruction } from './createResizeAccountInstruction'
import { getIDLPDA } from './pda'

export const createProgramUpgrade = async ({
  multisig: multisigPda,
  programId,
  buffer,
  spill,
  authority,
  wallet,
  networkUrl,
  idlBuffer
}: {
  multisig: PublicKey
  programId: PublicKey
  buffer: PublicKey
  spill: PublicKey
  authority: PublicKey
  idlBuffer: PublicKey
  wallet: Keypair
  networkUrl: string
}) => {
  const connection = new Connection(networkUrl)

  const idlPDA = await getIDLPDA(programId)
  const currIdlSize = (await connection.getAccountInfo(idlPDA, "processed"))!.data.length
  const idlBufferSize = (await connection.getAccountInfo(idlBuffer, "processed"))!.data.length

  console.log('Current IDL size:', currIdlSize);
  console.log('IDL Buffer size:', idlBufferSize);

  const instructions: TransactionInstruction[] = []
  // Add some padding in there for the IDL metadata
  if ((currIdlSize - 200) < idlBufferSize) {
    const idlSize = BigInt(idlBufferSize * 2)
    console.log('New IDL size:', idlSize.toString());

    // Create initial IDL account with a larger size
    instructions.push(
      await createCloseIdlAccountInstruction(programId, authority, authority),
      await createCreateIdlAccountInstruction(programId, authority, idlSize)
    );

    // Calculate number of resize operations needed
    const remainingSize = idlSize - 10000n;
    const numResizes = Math.ceil(Number(remainingSize) / 10000);
    console.log('Number of resize operations needed:', numResizes);

    // Add resize instructions in batches
    for (let i = 0; i < numResizes; i++) {
      instructions.push(await createResizeAccountInstruction(programId, authority));
    }
  }

  instructions.push(
    await createIdlUpgradeInstruction(programId, idlBuffer, authority),
    await createProgramUpgradeInstruction(programId, buffer, authority, spill)
  )

  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );

  const transactionIndex = Number(multisigInfo.transactionIndex);
  const newTransactionIndex = BigInt(transactionIndex + 1);
  const message = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions,
  });
  const transactionCreateIx = await multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    creator: wallet.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: message,
    memo: "Upgrade Program " + programId.toString()
  });
  const proposalCreateIx = await multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    // Must have "Voter" permissions at minimum
    creator: wallet.publicKey,
  });


  const realIxns = [
    transactionCreateIx,
    proposalCreateIx,
  ]

  const txnDrafts = await batchInstructionsToTxsWithPriorityFee(
    new AnchorProvider(
      connection,
      new Wallet(wallet),
      AnchorProvider.defaultOptions()
    ),
    realIxns
  )
  const txids: string[] = []
  for (const txnDraft of txnDrafts) {
    const txid = await sendInstructions(
      new AnchorProvider(
        connection,
        new Wallet(wallet),
        AnchorProvider.defaultOptions()
      ),
      txnDraft.instructions
    )
    txids.push(txid)
  }
  console.log(`Successfully created program upgrade for MS_PDA ${multisig.toString()} ${txids.map(txid => `https://explorer.solana.com/tx/${txid}`).join(', ')}`)
  return txids
}

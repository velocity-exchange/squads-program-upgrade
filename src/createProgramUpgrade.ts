// eslint-disable-next-line filenames/match-regex
import { AnchorProvider, BN, Wallet } from '@coral-xyz/anchor'
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet'
import { sendInstructions } from '@helium/spl-utils'
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction
} from '@solana/web3.js'
import Squads from '@sqds/sdk'
import { createIdlUpgradeInstruction } from './createIdlUpgradeInstruction'
import { createProgramUpgradeInstruction } from './createProgramUpgradeInstruction'
import { createResizeAccountInstruction } from './createResizeAccountInstruction'
import { getIDLPDA, getTxPDA } from './pda'

export const createProgramUpgrade = async ({
  multisig,
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
  const squads = Squads.endpoint(
    connection.rpcEndpoint,
    new NodeWallet(wallet),
    {
      commitmentOrConfig: 'finalized'
    }
  )

  const idlPDA = await getIDLPDA(programId)
  const currIdlSize = (await connection.getAccountInfo(idlPDA))!.data.length
  const bufferSize = (await connection.getAccountInfo(buffer))!.data.length

  const instructions: TransactionInstruction[] = []
  // Add some padding in there for the IDL metadata
  if ((currIdlSize - 200) < bufferSize) {
    const resizeAccountIx = await createResizeAccountInstruction(programId, authority)
    instructions.push(resizeAccountIx)
  }

  instructions.push(
    await createIdlUpgradeInstruction(programId, idlBuffer, authority),
    await createProgramUpgradeInstruction(programId, buffer, authority, spill)
  )

  const nextTransactionIndex = await squads.getNextTransactionIndex(multisig)
  const [transactionPDA] = getTxPDA(
    multisig,
    new BN(nextTransactionIndex, 10),
    squads.multisigProgramId
  )

  const realIxns = [
    await squads.buildCreateTransaction(multisig, 1, nextTransactionIndex),
    ...(await Promise.all(
      instructions.map((ix, idx) =>
        squads.buildAddInstruction(multisig, transactionPDA, ix, idx + 1)
      )
    )),
    await squads.buildActivateTransaction(multisig, transactionPDA),
    await squads.buildApproveTransaction(multisig, transactionPDA)
  ]

  const txid = await sendInstructions(
    new AnchorProvider(
      connection,
      new Wallet(wallet),
      AnchorProvider.defaultOptions()
    ),
    realIxns
  )

  console.log(
    `Successfully created program upgrade for MS_PDA ${multisig.toString()} https://explorer.solana.com/tx/${txid}`
  )
  return txid
}

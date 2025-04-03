import { AnchorProvider, BN, Wallet, utils, Program } from '@coral-xyz/anchor'
import { sendInstructions } from '@helium/spl-utils'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from '@solana/web3.js'
import { msProgramId } from './constants'
import { SquadsMpl } from './idl/squads_mpl'
import squadsMpl from './idl/squads_mpl.json'
import { getAuthorityPDA, getIDLPDA, getIxPDA, getTxPDA } from './pda'
import { createResizeAccountInstruction } from './createResizeAccountInstruction'

const SET_IDL_BUFFER_IX_DISCRIMINATOR = '40f4bc78a7e9690a03'
export const createIdlUpgrade = async ({
  multisig,
  programId,
  buffer,
  authority,
  wallet,
  networkUrl,
  authorityIndex = 1
}: {
  multisig: PublicKey
  programId: PublicKey
  buffer: PublicKey
  authority: PublicKey
  wallet: Keypair
  networkUrl: string
  authorityIndex?: number
}) => {
  const connection = new Connection(networkUrl)
  const program = new Program<SquadsMpl>(
    squadsMpl as SquadsMpl,
    msProgramId,
    new AnchorProvider(
      connection,
      new Wallet(wallet),
      AnchorProvider.defaultOptions()
    )
  )
  const multisigData = await program.account.ms.fetch(multisig)

  console.log(`Creating idl upgrade with
    buffer: ${buffer.toString()},
    multisig: ${multisig.toString()},
    authority: ${authority.toString()},
  `)
  const instructions: TransactionInstruction[] = []
  const transactionIndex = new BN(multisigData.transactionIndex + 1, 10)
  const [transactionPDA] = getTxPDA(multisig, transactionIndex, msProgramId)

  const [authorityPDA] = getAuthorityPDA(
    multisig,
    new BN(authorityIndex),
    msProgramId
  )
  if (authorityPDA.toString() !== authority.toString()) {
    throw `Invalid authority index ${authorityIndex} for authority ${authority.toString()}`
  }
  const createTransactionIx = await program.methods
    .createTransaction(authorityIndex)
    .accountsStrict({
      multisig,
      transaction: transactionPDA,
      creator: wallet.publicKey,
      systemProgram: SystemProgram.programId
    })
    .instruction()
  instructions.push(createTransactionIx)

  // first instruction
  const instructionIndex = 1
  const [instructionPDA] = getIxPDA(
    transactionPDA,
    new BN(instructionIndex, 10),
    msProgramId
  )

  const idlPDA = await getIDLPDA(programId)
  const currIdlSize = (await connection.getAccountInfo(idlPDA))!.data.length
  const bufferSize = (await connection.getAccountInfo(buffer))!.data.length

  // Add some padding in there for the IDL metadata
  if ((currIdlSize - 200) < bufferSize) {
    const resizeAccountIx = await createResizeAccountInstruction(programId, wallet.publicKey)
    instructions.push(resizeAccountIx)
  }

  const addInstructionIx = await program.methods
    .addInstruction({
      programId,
      keys: [
        {
          pubkey: buffer,
          isSigner: false,
          isWritable: true
        },
        {
          pubkey: idlPDA,
          isSigner: false,
          isWritable: true
        },
        {
          pubkey: authority,
          isSigner: true,
          isWritable: true
        }
      ],
      data: utils.bytes.hex.decode(`${SET_IDL_BUFFER_IX_DISCRIMINATOR}`)
    })
    .accountsStrict({
      multisig,
      creator: wallet.publicKey,
      transaction: transactionPDA,
      instruction: instructionPDA,
      systemProgram: SystemProgram.programId
    })
    .instruction()
  instructions.push(addInstructionIx)

  const activateTransactionIx = await program.methods
    .activateTransaction()
    .accountsStrict({
      multisig,
      transaction: transactionPDA,
      creator: wallet.publicKey,
      systemProgram: SystemProgram.programId
    })
    .instruction()
  instructions.push(activateTransactionIx)

  const approveTransactionIx = await program.methods
    .approveTransaction()
    .accountsStrict({
      multisig,
      member: wallet.publicKey,
      transaction: transactionPDA,
      systemProgram: SystemProgram.programId
    })
    .instruction()
  instructions.push(approveTransactionIx)

  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    AnchorProvider.defaultOptions()
  )
  const txid = await sendInstructions(
    provider,
    instructions
  )
  console.log(
    `Successfully created idl upgrade for authority ${authority.toString()} https://explorer.solana.com/tx/${txid}`
  )
  return txid
}

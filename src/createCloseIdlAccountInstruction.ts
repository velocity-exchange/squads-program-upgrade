import { idlAddress } from '@coral-xyz/anchor/dist/cjs/idl'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'

export async function createCloseIdlAccountInstruction(
  programId: PublicKey,
  authority: PublicKey,
  rentRefund: PublicKey
) {
  const prefix = Buffer.from('0a69e9a778bcf440', 'hex')
  const ixn = Buffer.from('05', 'hex')
  const data = Buffer.concat([prefix.reverse(), ixn])
  const idlAddr = await idlAddress(programId)

  const keys = [
    {
      pubkey: idlAddr,
      isWritable: true,
      isSigner: false
    },
    {
      pubkey: authority,
      isWritable: false,
      isSigner: true
    },
    {
      pubkey: rentRefund,
      isWritable: true,
      isSigner: false
    },
  ]

  return new TransactionInstruction({
    keys,
    programId,
    data
  })
}

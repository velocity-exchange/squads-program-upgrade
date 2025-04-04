import {PublicKey, TransactionInstruction} from '@solana/web3.js'
import { getIDLPDA } from './pda'

export async function createIdlUpgradeInstruction(
  programId: PublicKey,
  bufferAddress: PublicKey,
  upgradeAuthority: PublicKey
) {
  const prefix = Buffer.from('0a69e9a778bcf440', 'hex')
  const ixn = Buffer.from('03', 'hex')
  const data = Buffer.concat([prefix.reverse(), ixn])
  const idlAddr = await getIDLPDA(programId)

  const keys = [
    {
      pubkey: bufferAddress,
      isWritable: true,
      isSigner: false
    },
    {
      pubkey: idlAddr,
      isWritable: true,
      isSigner: false
    },
    {
      pubkey: upgradeAuthority,
      isWritable: true,
      isSigner: true
    }
  ]

  return new TransactionInstruction({
    keys,
    programId,
    data
  })
}

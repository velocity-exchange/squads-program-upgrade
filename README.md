# Squads Program Upgrade — Anchor 1.0

GitHub Action that proposes a Solana program upgrade through a Squads multisig, including the Anchor IDL update via the Solana **program-metadata-program** (`ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`).

Anchor 1.0 removed the legacy on-chain IDL instructions (`anchor idl set-buffer` / `IdlInstruction::Upgrade` with the baked-in `0a69e9a778bcf440`-style discriminator); IDL data moved out to the standalone program-metadata program. This branch emits the new `Initialize` / `SetData` / `Close` instructions instead of the old anchor-IDL ones.

## What it does

The action consumes already-uploaded buffer accounts (program `.so` buffer + program-metadata IDL buffer, both with authority transferred to the multisig vault) and creates a single Squads vault transaction + proposal containing:

1. (If the canonical IDL metadata PDA doesn't exist yet) program-metadata `Initialize` for the `(programId, "idl")` account
2. program-metadata `SetData` copying the IDL buffer into the metadata account
3. program-metadata `Close` returning the IDL buffer's rent to the spill address
4. BPF Loader Upgradeable `Upgrade` swapping the program's `.so` for the staged buffer

The proposer keypair must be a multisig member with at least Voter permissions. The proposal is not auto-approved or executed.

## Usage

```yaml
- uses: helium/squads-program-upgrade@<ref>
  with:
    network-url: ${{ secrets.RPC_URL }}
    program-multisig: ${{ secrets.MULTISIG }}
    program-id: <program-id>
    buffer: ${{ steps.buffer-deploy.outputs.buffer }}
    idl-buffer: ${{ steps.buffer-deploy.outputs.idl-buffer }}
    spill-address: ${{ secrets.DEPLOYER_ADDRESS }}
    authority: ${{ secrets.MULTISIG_VAULT }}
    name: "Deploy <program> <version>"
    keypair: ${{ secrets.DEPLOYER_KEYPAIR }}
```

## Inputs

| Input | Description |
| --- | --- |
| `network-url` | Solana RPC URL the action talks to (creates the proposal here) |
| `program-multisig` | Squads multisig PDA |
| `program-id` | Program being upgraded |
| `buffer` | BPF Upgradeable Loader buffer (authority = vault) |
| `idl-buffer` | program-metadata buffer (authority = vault). Omit to skip IDL update. |
| `spill-address` | Address receiving reclaimed buffer rent |
| `authority` | Upgrade authority — the Squads vault PDA |
| `name` | Memo string on the Squads transaction |
| `keypair` | Proposer keypair: base58 secret, `[1,2,3...]` JSON array, or path to a `~/.config/solana/id.json`-style file. Needs to be a multisig member. |

## Producing the buffers

The action does **not** upload buffers itself. Workflows are expected to do that beforehand — typically:

```bash
# 1. Program binary buffer
solana program write-buffer ./target/deploy/<program>.so -u "$RPC" -k ./deploy-keypair.json
solana program set-buffer-authority "$BUFFER" --new-buffer-authority "$VAULT" -u "$RPC"

# 2. IDL buffer via program-metadata
npx @solana-program/program-metadata@latest create-buffer ./target/idl/<program>.json \
  --rpc "$RPC" --keypair ./deploy-keypair.json
npx @solana-program/program-metadata@latest set-buffer-authority "$IDL_BUFFER" \
  --new-authority "$VAULT" --rpc "$RPC" --keypair ./deploy-keypair.json
```

Then pass `$BUFFER` and `$IDL_BUFFER` to this action.

## Build

```bash
yarn install
yarn package     # rebuild dist/index.js — required after editing src/
yarn test
```

Commit `dist/` along with source changes; GitHub Actions runs `dist/index.js` directly.

## Anchor 1.0 IDL wire format

Reference: [`@solana-program/program-metadata@0.5.1`](https://www.npmjs.com/package/@solana-program/program-metadata).

- Canonical metadata PDA: `findProgramAddress([programId, "idl" padded to 16 bytes], ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S)`
- `Initialize` (disc 1): metadata(W), authority(S), program(R), programData(R), system(R) — data: `seed(16) + encoding(1) + compression(1) + format(1) + dataSource(1) + Option<bytes>(no prefix)`
- `SetData` (disc 3): metadata(W), authority(S), buffer(W), program(R), programData(R) — data: `encoding(1) + compression(1) + format(1) + dataSource(1) + Option<bytes>(no prefix)`
- `Close` (disc 6): account(W), authority(S), program(R, optional via sentinel), programData(R, optional via sentinel), destination(W)

For Anchor-generated IDL JSON, the canonical defaults are `encoding=Utf8(1) compression=Zlib(2) format=Json(1) dataSource=Direct(0)`.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction, getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";

import { CowrieIssuer } from "../target/types/cowrie_issuer";


describe("cowrie_issuer", () => {
  const CWR_DECIMALS = 6;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.cowrieIssuer as Program<CowrieIssuer>;

  const [cowrieMint] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("cowrie_mint")],
    program.programId
  );
  const [cowrieAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("cowrie_authority")],
    program.programId
  );

  const creator = anchor.web3.Keypair.generate();
  const creatorAta = getAssociatedTokenAddressSync(
      cowrieMint,
      creator.publicKey,
  );

  it("Initializes Cowrie mint", async () => {
    await program.methods.initializeCowrie().rpc();
    const mint = await getMint(
      provider.connection,
      cowrieMint,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    expect(mint.decimals).to.be.equal(6);
    expect(mint.mintAuthority).not.to.be.null;
    expect(mint.mintAuthority!.equals(cowrieAuthority)).to.be.true;
    expect(mint.supply).to.be.equal(BigInt(0));
  });

  it("Creates Creator CWR ATA", async () => {
    const ix = createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        creatorAta,
        creator.publicKey,
        cowrieMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const tx = new anchor.web3.Transaction().add(ix);

    await provider.sendAndConfirm(tx);

    const tokenAccount = await getAccount(
        provider.connection,
        creatorAta,
    );

    expect(tokenAccount.mint.equals(cowrieMint)).to.be.true;
    expect(tokenAccount.owner.equals(creator.publicKey)).to.be.true;
    expect(tokenAccount.amount).to.equal(BigInt(0));
  });

  it("Rejects non-admin mint", async () => {
    const attacker = anchor.web3.Keypair.generate();

    let failed = false;

    try {
      await program.methods
          .mintCowrie(new anchor.BN(1))
          .accountsPartial({
            admin: attacker.publicKey,
            destination: creatorAta,
          })
          .signers([attacker])
          .rpc();
    } catch {
      failed = true;
    }

    expect(failed).to.be.true;
  });

  it("Admin mints 10,000 CWR to Creator", async () => {
    const mintAmount = new anchor.BN(10_000).mul(
        new anchor.BN(10).pow(
            new anchor.BN(CWR_DECIMALS),
        )
    );
    const beforeTokenAccount  = await getAccount(
        provider.connection,
        creatorAta,
    );
    const beforeMint = await getMint(
        provider.connection,
        cowrieMint,
    );
    console.log(
        "Before:",
        "Creator =", beforeTokenAccount.amount.toString(),
        "Supply =", beforeMint.supply.toString(),
    );
    await program.methods
        .mintCowrie(mintAmount)
        .accounts({
          destination: creatorAta,
        })
        .rpc();

    const afterTokenAccount = await getAccount(
        provider.connection,
        creatorAta,
    );
    const afterMint = await getMint(
        provider.connection,
        cowrieMint,
    );
    expect(afterTokenAccount.amount).to.be.equal(BigInt(mintAmount.toString()));
    expect(afterMint.supply).to.be.equal(BigInt(mintAmount.toString()));
  });
});

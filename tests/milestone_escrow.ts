import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";

import { CowrieIssuer } from "../target/types/cowrie_issuer";
import { MilestoneEscrow } from "../target/types/milestone_escrow";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { cwrToBaseUnits, u64ToLeBuffer } from "./helpers/helpers";

describe("milestone_escrow", () => {
  const CWR_DECIMALS = 6;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const cowrieProgram = anchor.workspace.cowrieIssuer as Program<CowrieIssuer>;
  const milestoneEscrowProgram = anchor.workspace
      .milestoneEscrow as Program<MilestoneEscrow>;

  const [cowrieMint] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("cowrie_mint")],
      cowrieProgram.programId
  );

  const [globalConfig] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")],
      milestoneEscrowProgram.programId
  );

  const creator = anchor.web3.Keypair.generate();
  const beneficiary = anchor.web3.Keypair.generate();

  const creatorAta = getAssociatedTokenAddressSync(
      cowrieMint,
      creator.publicKey
  );


  before(async () => {
    const mintInfo = await provider.connection.getAccountInfo(cowrieMint);
    if (mintInfo === null) {
      await cowrieProgram.methods.initializeCowrie().rpc();
    }

    const latestBlockhash =
        await provider.connection.getLatestBlockhash("confirmed");
    const airdropSignature = await provider.connection.requestAirdrop(
        creator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(
        {
          signature: airdropSignature,
          ...latestBlockhash,
        },
        "confirmed"
    );

    // 需要先给creator创建ATA
    const createAtaIx = createAssociatedTokenAccountInstruction(
        creator.publicKey,
        creatorAta,
        creator.publicKey,
        cowrieMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(createAtaIx);
    await anchor.web3.sendAndConfirmTransaction(
        provider.connection,
        tx,
        [creator],
        { commitment: "confirmed" }
    );

    const mintAmount = cwrToBaseUnits(10_000, CWR_DECIMALS);
    await cowrieProgram.methods
        .mintCowrie(mintAmount)
        .accounts({
          destination: creatorAta,
        })
        .rpc();

    const creatorTokenAccount = await getAccount(
        provider.connection,
        creatorAta
    );

    expect(creatorTokenAccount.amount).to.equal(
        BigInt(mintAmount.toString())
    );
  });


  it("Initializes global config", async () => {
    await milestoneEscrowProgram.methods
        .initializeGlobalConfig()
        .accounts({
          mint: cowrieMint,
        })
        .rpc();

    const config =
        await milestoneEscrowProgram.account.globalConfig.fetch(globalConfig);

    expect(config.paymentMint.equals(cowrieMint)).to.be.true;
    expect(config.nextEscrowId.toString()).to.equal("0");
  });

  it("Initializes escrow with 1_000 CWR, adds 3 milestones, and funds vault", async () => {
    const contractAmount = cwrToBaseUnits(1_000, CWR_DECIMALS);

    // 测试 demo 工程，先不考虑线上多并发抢global.escrow_id的问题
    const configBeforeCreate =
        await milestoneEscrowProgram.account.globalConfig.fetch(globalConfig);

    const escrowId = configBeforeCreate.nextEscrowId;

    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          u64ToLeBuffer(escrowId),
        ],
        milestoneEscrowProgram.programId
    );

    const deadline = new anchor.BN(
        Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    );

    await milestoneEscrowProgram.methods
        .initializeEscrow(
            beneficiary.publicKey,
            contractAmount,
            deadline
        )
        .accountsPartial({
          creator: creator.publicKey,
          globalConfig,
          escrow: escrowPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

    const escrowAfterCreate =
        await milestoneEscrowProgram.account.escrow.fetch(escrowPda);

    expect(escrowAfterCreate.id.toString()).to.equal(escrowId.toString());
    expect(escrowAfterCreate.creator.equals(creator.publicKey)).to.be.true;
    expect(escrowAfterCreate.beneficiary.equals(beneficiary.publicKey)).to.be.true;
    expect(escrowAfterCreate.mint.equals(cowrieMint)).to.be.true;
    expect(escrowAfterCreate.contractAmount.toString()).to.equal(
        contractAmount.toString()
    );
    expect(escrowAfterCreate.allocatedAmount.toString()).to.equal("0");
    expect(escrowAfterCreate.nextMilestoneId.toString()).to.equal("0");
    expect(escrowAfterCreate.status).to.have.property("draft");

    const milestoneAmounts = [
      cwrToBaseUnits(200, CWR_DECIMALS),
      cwrToBaseUnits(300, CWR_DECIMALS),
      cwrToBaseUnits(500, CWR_DECIMALS),
    ];

    const firstMilestoneId = escrowAfterCreate.nextMilestoneId;

    const milestonePdas = milestoneAmounts.map((_, offset) => {
      const milestoneId = firstMilestoneId.add(new anchor.BN(offset));

      return anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("milestone"),
            escrowPda.toBuffer(),
            u64ToLeBuffer(milestoneId),
          ],
          milestoneEscrowProgram.programId
      )[0];
    });

    const addMilestoneInstructions = await Promise.all(
        milestoneAmounts.map((amount, offset) =>
            milestoneEscrowProgram.methods
                .addMilestone(amount)
                .accountsPartial({
                  creator: creator.publicKey,
                  escrow: escrowPda,
                  milestone: milestonePdas[offset],
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction()
        )
    );

    const addMilestonesTx = new anchor.web3.Transaction().add(
        ...addMilestoneInstructions
    );

    await provider.sendAndConfirm(addMilestonesTx, [creator]);

    const escrowAfterMilestones =
        await milestoneEscrowProgram.account.escrow.fetch(escrowPda);

    expect(escrowAfterMilestones.allocatedAmount.toString()).to.equal(
        contractAmount.toString()
    );
    expect(escrowAfterMilestones.nextMilestoneId.toString()).to.equal("3");
    expect(escrowAfterMilestones.status).to.have.property("draft");

    for (let i = 0; i < milestonePdas.length; i += 1) {
      const milestone =
          await milestoneEscrowProgram.account.milestone.fetch(milestonePdas[i]);

      expect(milestone.escrow.equals(escrowPda)).to.be.true;
      expect(milestone.id.toString()).to.equal(
          firstMilestoneId.add(new anchor.BN(i)).toString()
      );
      expect(milestone.amount.toString()).to.equal(
          milestoneAmounts[i].toString()
      );
      expect(milestone.status).to.have.property("pending");
    }

    const vaultAta = getAssociatedTokenAddressSync(
        cowrieMint,
        escrowPda,
        true
    );

    const creatorBeforeFund = await getAccount(
        provider.connection,
        creatorAta
    );

    await milestoneEscrowProgram.methods
        .fundEscrow()
        .accountsPartial({
          creator: creator.publicKey,
          escrow: escrowPda,
          mint: cowrieMint,
          creatorTokenAccount: creatorAta,
          vault: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

    const creatorAfterFund = await getAccount(
        provider.connection,
        creatorAta
    );

    const vaultAfterFund = await getAccount(
        provider.connection,
        vaultAta
    );

    const escrowAfterFund =
        await milestoneEscrowProgram.account.escrow.fetch(escrowPda);

    const contractAmountRaw = BigInt(contractAmount.toString());

    expect(creatorAfterFund.amount).to.equal(
        creatorBeforeFund.amount - contractAmountRaw
    );
    expect(vaultAfterFund.amount).to.equal(contractAmountRaw);
    expect(vaultAfterFund.mint.equals(cowrieMint)).to.be.true;
    expect(vaultAfterFund.owner.equals(escrowPda)).to.be.true;
    expect(escrowAfterFund.status).to.have.property("active");
  });
});

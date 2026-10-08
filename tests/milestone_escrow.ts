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

  // 保存已完成 Fund 的账户地址，供后续 Approve / Claim 集成测试复用
  let fundedEscrowPda: anchor.web3.PublicKey;
  let firstMilestonePda: anchor.web3.PublicKey;
  let fundedVaultAta: anchor.web3.PublicKey;

  const creatorAta = getAssociatedTokenAddressSync(
    cowrieMint,
    creator.publicKey
  );

  before(async () => {
    const mintInfo = await provider.connection.getAccountInfo(cowrieMint);
    if (mintInfo === null) {
      await cowrieProgram.methods.initializeCowrie().rpc();
    }

    const latestBlockhash = await provider.connection.getLatestBlockhash(
      "confirmed"
    );
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

    expect(creatorTokenAccount.amount).to.equal(BigInt(mintAmount.toString()));
  });

  it("Initializes global config", async () => {
    await milestoneEscrowProgram.methods
      .initializeGlobalConfig()
      .accounts({
        mint: cowrieMint,
      })
      .rpc();

    const config = await milestoneEscrowProgram.account.globalConfig.fetch(
      globalConfig
    );

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
      [Buffer.from("escrow"), u64ToLeBuffer(escrowId)],
      milestoneEscrowProgram.programId
    );

    const deadline = new anchor.BN(
      Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    );

    await milestoneEscrowProgram.methods
      .initializeEscrow(beneficiary.publicKey, contractAmount, deadline)
      .accountsPartial({
        creator: creator.publicKey,
        globalConfig,
        escrow: escrowPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrowAfterCreate = await milestoneEscrowProgram.account.escrow.fetch(
      escrowPda
    );

    expect(escrowAfterCreate.id.toString()).to.equal(escrowId.toString());
    expect(escrowAfterCreate.creator.equals(creator.publicKey)).to.be.true;
    expect(escrowAfterCreate.beneficiary.equals(beneficiary.publicKey)).to.be
      .true;
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
      const milestone = await milestoneEscrowProgram.account.milestone.fetch(
        milestonePdas[i]
      );

      expect(milestone.escrow.equals(escrowPda)).to.be.true;
      expect(milestone.id.toString()).to.equal(
        firstMilestoneId.add(new anchor.BN(i)).toString()
      );
      expect(milestone.amount.toString()).to.equal(
        milestoneAmounts[i].toString()
      );
      expect(milestone.status).to.have.property("pending");
    }

    const vaultAta = getAssociatedTokenAddressSync(cowrieMint, escrowPda, true);

    const creatorBeforeFund = await getAccount(provider.connection, creatorAta);

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

    const creatorAfterFund = await getAccount(provider.connection, creatorAta);

    const vaultAfterFund = await getAccount(provider.connection, vaultAta);

    const escrowAfterFund = await milestoneEscrowProgram.account.escrow.fetch(
      escrowPda
    );

    const contractAmountRaw = BigInt(contractAmount.toString());

    expect(creatorAfterFund.amount).to.equal(
      creatorBeforeFund.amount - contractAmountRaw
    );
    expect(vaultAfterFund.amount).to.equal(contractAmountRaw);
    expect(vaultAfterFund.mint.equals(cowrieMint)).to.be.true;
    expect(vaultAfterFund.owner.equals(escrowPda)).to.be.true;
    expect(escrowAfterFund.status).to.have.property("active");

    fundedEscrowPda = escrowPda;
    firstMilestonePda = milestonePdas[0];
    fundedVaultAta = vaultAta;
  });

  it("Approves and claims the first milestone (200 CWR)", async () => {
    const claimAmount = cwrToBaseUnits(200, CWR_DECIMALS);
    const claimAmountRaw = BigInt(claimAmount.toString());

    // Claim 不会自动创建 Beneficiary ATA，测试中由 Creator 支付创建费用
    const beneficiaryAta = getAssociatedTokenAddressSync(
      cowrieMint,
      beneficiary.publicKey
    );

    const createBeneficiaryAtaIx = createAssociatedTokenAccountInstruction(
      creator.publicKey,
      beneficiaryAta,
      beneficiary.publicKey,
      cowrieMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      new anchor.web3.Transaction().add(createBeneficiaryAtaIx),
      [creator],
      { commitment: "confirmed" }
    );

    const vaultBeforeApprove = await getAccount(
      provider.connection,
      fundedVaultAta
    );
    const beneficiaryBeforeClaim = await getAccount(
      provider.connection,
      beneficiaryAta
    );

    // Creator 批准第一个 Milestone：只修改状态和待支付金额，不转 Token
    await milestoneEscrowProgram.methods
      .approveMilestone()
      .accountsPartial({
        creator: creator.publicKey,
        escrow: fundedEscrowPda,
        milestone: firstMilestonePda,
      })
      .signers([creator])
      .rpc();

    const escrowAfterApprove =
      await milestoneEscrowProgram.account.escrow.fetch(fundedEscrowPda);
    const milestoneAfterApprove =
      await milestoneEscrowProgram.account.milestone.fetch(firstMilestonePda);
    const vaultAfterApprove = await getAccount(
      provider.connection,
      fundedVaultAta
    );

    expect(milestoneAfterApprove.status).to.have.property("approved");
    expect(escrowAfterApprove.approvedOutstanding.toString()).to.equal(
      claimAmount.toString()
    );
    expect(escrowAfterApprove.releasedAmount.toString()).to.equal("0");
    expect(vaultAfterApprove.amount).to.equal(vaultBeforeApprove.amount);

    // Beneficiary 签名领取已批准款项，由 Escrow PDA 授权 Vault 转账
    await milestoneEscrowProgram.methods
      .claimMilestone()
      .accountsPartial({
        beneficiary: beneficiary.publicKey,
        escrow: fundedEscrowPda,
        milestone: firstMilestonePda,
        mint: cowrieMint,
        vault: fundedVaultAta,
        beneficiaryTokenAccount: beneficiaryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    const escrowAfterClaim = await milestoneEscrowProgram.account.escrow.fetch(
      fundedEscrowPda
    );
    const milestoneAfterClaim =
      await milestoneEscrowProgram.account.milestone.fetch(firstMilestonePda);
    const vaultAfterClaim = await getAccount(
      provider.connection,
      fundedVaultAta
    );
    const beneficiaryAfterClaim = await getAccount(
      provider.connection,
      beneficiaryAta
    );

    expect(milestoneAfterClaim.status).to.have.property("claimed");
    expect(escrowAfterClaim.approvedOutstanding.toString()).to.equal("0");
    expect(escrowAfterClaim.releasedAmount.toString()).to.equal(
      claimAmount.toString()
    );
    expect(escrowAfterClaim.status).to.have.property("active");
    expect(vaultAfterClaim.amount).to.equal(
      vaultBeforeApprove.amount - claimAmountRaw
    );
    expect(beneficiaryAfterClaim.amount).to.equal(
      beneficiaryBeforeClaim.amount + claimAmountRaw
    );
  });

  // 确认失败来自预期的合约业务规则，而不是账户传错等其他原因
  async function expectEscrowError(
    send: () => Promise<unknown>,
    expectedCode: string
  ) {
    let caught: unknown = null;
    try {
      await send();
    } catch (error) {
      caught = error;
    }

    expect(caught, `预期合约拒绝交易：${expectedCode}`).to.not.equal(null);
    const anchorError = caught as {
      error?: { errorCode?: { code?: string } };
      message?: string;
    };
    const errorCodeOrMessage =
      anchorError.error?.errorCode?.code ?? anchorError.message ?? "";
    expect(errorCodeOrMessage).to.include(expectedCode);
  }

  it("Rejects refund before deadline", async () => {
    // 复用之前已领取 200 CWR 的合同，此时还有 800 CWR 且未到期
    const vaultBefore = await getAccount(provider.connection, fundedVaultAta);
    const creatorBefore = await getAccount(provider.connection, creatorAta);

    await expectEscrowError(
      () =>
        milestoneEscrowProgram.methods
          .refundRemaining()
          .accountsPartial({
            creator: creator.publicKey,
            escrow: fundedEscrowPda,
            mint: cowrieMint,
            vault: fundedVaultAta,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc(),
      "DeadlineNotReached"
    );

    const escrowAfter = await milestoneEscrowProgram.account.escrow.fetch(
      fundedEscrowPda
    );
    const vaultAfter = await getAccount(provider.connection, fundedVaultAta);
    const creatorAfter = await getAccount(provider.connection, creatorAta);

    expect(escrowAfter.status).to.have.property("active");
    expect(vaultAfter.amount).to.equal(vaultBefore.amount);
    expect(creatorAfter.amount).to.equal(creatorBefore.amount);
  });

  it("Rejects outstanding approval and refunds 800 CWR after deadline", async () => {
    const contractAmount = cwrToBaseUnits(1_000, CWR_DECIMALS);
    const firstAmount = cwrToBaseUnits(200, CWR_DECIMALS);
    const remainingAmount = cwrToBaseUnits(800, CWR_DECIMALS);

    // 单独创建短期限合同，不修改之前 30 天期限的测试数据
    const config = await milestoneEscrowProgram.account.globalConfig.fetch(
      globalConfig
    );
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), u64ToLeBuffer(config.nextEscrowId)],
      milestoneEscrowProgram.programId
    );

    // 使用链上的 Clock 时间，避免本地时间与合约时间存在偏差
    const readChainTime = async (): Promise<number> => {
      const clock = await provider.connection.getAccountInfo(
        anchor.web3.SYSVAR_CLOCK_PUBKEY,
        "confirmed"
      );
      if (!clock) throw new Error("无法读取链上 Clock Sysvar");
      return Number(Buffer.from(clock.data).readBigInt64LE(32));
    };

    const deadline = new anchor.BN((await readChainTime()) + 8);

    await milestoneEscrowProgram.methods
      .initializeEscrow(beneficiary.publicKey, contractAmount, deadline)
      .accountsPartial({
        creator: creator.publicKey,
        globalConfig,
        escrow: escrowPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // 预先推导两份 Milestone PDA，并在一笔交易中完成创建
    const milestonePdas = [0, 1].map(
      (id) =>
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("milestone"),
            escrowPda.toBuffer(),
            u64ToLeBuffer(new anchor.BN(id)),
          ],
          milestoneEscrowProgram.programId
        )[0]
    );

    const amounts = [firstAmount, remainingAmount];
    const addInstructions = await Promise.all(
      amounts.map((amount, index) =>
        milestoneEscrowProgram.methods
          .addMilestone(amount)
          .accountsPartial({
            creator: creator.publicKey,
            escrow: escrowPda,
            milestone: milestonePdas[index],
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .instruction()
      )
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(...addInstructions),
      [creator]
    );

    const vaultAta = getAssociatedTokenAddressSync(cowrieMint, escrowPda, true);

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

    await milestoneEscrowProgram.methods
      .approveMilestone()
      .accountsPartial({
        creator: creator.publicKey,
        escrow: escrowPda,
        milestone: milestonePdas[0],
      })
      .signers([creator])
      .rpc();

    // 使用 Surfpool 时间跳转，直接推进到 Deadline 之后
    const timeTravelResponse = await fetch(provider.connection.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "surfnet_timeTravel",
        params: [
          {
            absoluteTimestamp: (deadline.toNumber() + 2) * 1000,
          },
        ],
      }),
    });

    if (!timeTravelResponse.ok) {
      throw new Error(`时间跳转 RPC 失败：${timeTravelResponse.status}`);
    }

    const timeTravelResult = (await timeTravelResponse.json()) as {
      error?: { message?: string };
    };
    if (timeTravelResult.error) {
      throw new Error(`时间跳转失败：${timeTravelResult.error.message}`);
    }
    expect(await readChainTime()).to.be.at.least(deadline.toNumber());

    // 已到期但还有 200 CWR 已批准未领取，Creator 不能退款
    await expectEscrowError(
      () =>
        milestoneEscrowProgram.methods
          .refundRemaining()
          .accountsPartial({
            creator: creator.publicKey,
            escrow: escrowPda,
            mint: cowrieMint,
            vault: vaultAta,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc(),
      "ApprovedFundsOutstanding"
    );

    const afterRejectedRefund =
      await milestoneEscrowProgram.account.escrow.fetch(escrowPda);
    const vaultAfterRejectedRefund = await getAccount(
      provider.connection,
      vaultAta
    );
    expect(afterRejectedRefund.status).to.have.property("active");
    expect(afterRejectedRefund.approvedOutstanding.toString()).to.equal(
      firstAmount.toString()
    );
    expect(vaultAfterRejectedRefund.amount).to.equal(
      BigInt(contractAmount.toString())
    );

    // Beneficiary 领取已批准的 200 CWR，解除退款锁定
    const beneficiaryAta = getAssociatedTokenAddressSync(
      cowrieMint,
      beneficiary.publicKey
    );
    await milestoneEscrowProgram.methods
      .claimMilestone()
      .accountsPartial({
        beneficiary: beneficiary.publicKey,
        escrow: escrowPda,
        milestone: milestonePdas[0],
        mint: cowrieMint,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    const creatorBeforeRefund = await getAccount(
      provider.connection,
      creatorAta
    );
    const vaultBeforeRefund = await getAccount(provider.connection, vaultAta);
    expect(vaultBeforeRefund.amount).to.equal(
      BigInt(remainingAmount.toString())
    );

    await milestoneEscrowProgram.methods
      .refundRemaining()
      .accountsPartial({
        creator: creator.publicKey,
        escrow: escrowPda,
        mint: cowrieMint,
        vault: vaultAta,
        creatorTokenAccount: creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator])
      .rpc();

    const creatorAfterRefund = await getAccount(
      provider.connection,
      creatorAta
    );
    const vaultAfterRefund = await getAccount(provider.connection, vaultAta);
    const escrowAfterRefund = await milestoneEscrowProgram.account.escrow.fetch(
      escrowPda
    );

    expect(creatorAfterRefund.amount - creatorBeforeRefund.amount).to.equal(
      BigInt(remainingAmount.toString())
    );
    expect(vaultAfterRefund.amount).to.equal(BigInt(0));
    expect(escrowAfterRefund.approvedOutstanding.toString()).to.equal("0");
    expect(escrowAfterRefund.releasedAmount.toString()).to.equal(
      firstAmount.toString()
    );
    expect(escrowAfterRefund.status).to.have.property("cancelled");
  });
});

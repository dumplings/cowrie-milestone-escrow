use crate::constants::{ESCROW_SEED, MILESTONE_SEED};
use crate::error::EscrowError;
use crate::state::{Escrow, EscrowStatus, Milestone, MilestoneStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct ClaimMilestone<'info> {
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [
            ESCROW_SEED,
            escrow.id.to_le_bytes().as_ref(),
        ],
        bump = escrow.bump,
        constraint = escrow.beneficiary == beneficiary.key(),
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [
            MILESTONE_SEED,
            milestone.escrow.as_ref(),
            milestone.id.to_le_bytes().as_ref(),
        ],
        bump = milestone.bump,
        constraint = milestone.escrow == escrow.key(),
    )]
    pub milestone: Account<'info, Milestone>,

    #[account(
        constraint = mint.key() == escrow.mint,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_milestone(ctx: Context<ClaimMilestone>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let milestone = &ctx.accounts.milestone;
    require!(
        escrow.status == EscrowStatus::Active,
        EscrowError::EscrowNotActive
    );
    require!(
        milestone.status == MilestoneStatus::Approved,
        EscrowError::MilestoneNotApproved
    );

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.beneficiary_token_account.to_account_info(),
        authority: ctx.accounts.escrow.to_account_info(),
    };
    let escrow_id_bytes = escrow.id.to_le_bytes();
    let bump = [escrow.bump];
    let seeds: &[&[&[u8]]] = &[&[ESCROW_SEED, escrow_id_bytes.as_ref(), bump.as_ref()]];
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, seeds);
    let amount = ctx.accounts.milestone.amount;
    let next_approved_outstanding = escrow
        .approved_outstanding
        .checked_sub(amount)
        .ok_or(EscrowError::ArithmeticError)?;
    let next_released_amount = escrow
        .released_amount
        .checked_add(amount)
        .ok_or(EscrowError::ArithmeticError)?;
    let is_completed = next_released_amount == escrow.contract_amount;
    token::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    let escrow = &mut ctx.accounts.escrow;
    let milestone = &mut ctx.accounts.milestone;
    milestone.status = MilestoneStatus::Claimed;
    escrow.approved_outstanding = next_approved_outstanding;
    escrow.released_amount = next_released_amount;
    if is_completed {
        escrow.status = EscrowStatus::Completed;
    }

    Ok(())
}

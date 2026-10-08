use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::state::{Escrow, EscrowStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct RefundRemaining<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [
            ESCROW_SEED,
            escrow.id.to_le_bytes().as_ref(),
        ],
        bump = escrow.bump,
        constraint = escrow.creator == creator.key(),
    )]
    pub escrow: Account<'info, Escrow>,

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
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_refund_remaining(ctx: Context<RefundRemaining>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    require!(
        escrow.status == EscrowStatus::Active,
        EscrowError::EscrowNotActive
    );
    require!(
        escrow.deadline <= Clock::get()?.unix_timestamp,
        EscrowError::DeadlineNotReached,
    );
    require!(
        escrow.approved_outstanding == 0,
        EscrowError::ApprovedFundsOutstanding,
    );

    let refund_amount = escrow
        .contract_amount
        .checked_sub(escrow.released_amount)
        .ok_or(EscrowError::ArithmeticError)?;
    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.creator_token_account.to_account_info(),
        authority: ctx.accounts.escrow.to_account_info(),
    };
    let escrow_id_bytes = escrow.id.to_le_bytes();
    let bump = [escrow.bump];
    let seeds: &[&[&[u8]]] = &[&[ESCROW_SEED, escrow_id_bytes.as_ref(), bump.as_ref()]];
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, seeds);
    token::transfer_checked(cpi_ctx, refund_amount, ctx.accounts.mint.decimals)?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.status = EscrowStatus::Cancelled;

    Ok(())
}

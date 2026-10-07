use crate::constants::{ESCROW_SEED, MILESTONE_SEED};
use crate::error::EscrowError;
use crate::state::{Escrow, EscrowStatus, Milestone};
use crate::MilestoneStatus;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AddMilestone<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [
            ESCROW_SEED,
            escrow.id.to_le_bytes().as_ref(),
        ],
        bump = escrow.bump,
        constraint = escrow.creator == creator.key()
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = creator,
        space = Milestone::DISCRIMINATOR.len() + Milestone::INIT_SPACE,
        seeds = [
            MILESTONE_SEED,
            escrow.key().as_ref(),
            escrow.next_milestone_id.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub milestone: Account<'info, Milestone>,
    pub system_program: Program<'info, System>,
}

pub fn handle_add_milestone(ctx: Context<AddMilestone>, amount: u64) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidMilestoneAmount);

    let escrow = &ctx.accounts.escrow;
    require!(
        escrow.status == EscrowStatus::Draft,
        EscrowError::EscrowNotDraft
    );

    let next_allocated_amount = escrow
        .allocated_amount
        .checked_add(amount)
        .ok_or(EscrowError::ArithmeticError)?;
    require!(
        next_allocated_amount <= escrow.contract_amount,
        EscrowError::AllocationExceedsContractAmount
    );

    let milestone = &mut ctx.accounts.milestone;
    let escrow = &mut ctx.accounts.escrow;
    milestone.amount = amount;
    milestone.id = escrow.next_milestone_id;
    milestone.escrow = escrow.key();
    milestone.status = MilestoneStatus::Pending;
    milestone.bump = ctx.bumps.milestone;
    escrow.allocated_amount = next_allocated_amount;
    escrow.next_milestone_id = escrow
        .next_milestone_id
        .checked_add(1)
        .ok_or(EscrowError::ArithmeticError)?;

    Ok(())
}

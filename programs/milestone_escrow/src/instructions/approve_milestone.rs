use anchor_lang::prelude::*;
use crate::state::{Escrow, Milestone, EscrowStatus, MilestoneStatus};
use crate::constants::{ESCROW_SEED, MILESTONE_SEED};
use crate::error::{EscrowError};

#[derive(Accounts)]
pub struct ApproveMilestone<'info> {
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
        mut,
        seeds = [
            MILESTONE_SEED,
            escrow.key().as_ref(),
            milestone.id.to_le_bytes().as_ref(),
        ],
        bump = milestone.bump,
        constraint = milestone.escrow == escrow.key(),
    )]
    pub milestone: Account<'info, Milestone>,
}

pub fn handle_approve_milestone(ctx: Context<ApproveMilestone>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let milestone = &ctx.accounts.milestone;
    require!(
        escrow.status == EscrowStatus::Active,
        EscrowError::EscrowNotActive,
    );
    require!(
        milestone.status == MilestoneStatus::Pending,
        EscrowError::MilestoneNotPending,
    );
    let next_approved_outstanding = escrow
        .approved_outstanding
        .checked_add(milestone.amount)
        .ok_or(EscrowError::ArithmeticError)?;

    let escrow = &mut ctx.accounts.escrow;
    let milestone = &mut ctx.accounts.milestone;
    escrow.approved_outstanding = next_approved_outstanding;
    milestone.status = MilestoneStatus::Approved;
    
    Ok(())
}

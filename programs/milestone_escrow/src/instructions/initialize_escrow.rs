use crate::constants::{ESCROW_SEED, GLOBAL_CONFIG_SEED};
use crate::error::EscrowError;
use crate::state::{Escrow, GlobalConfig};
use crate::EscrowStatus;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = creator,
        space = Escrow::DISCRIMINATOR.len() + Escrow::INIT_SPACE,
        seeds = [
            ESCROW_SEED,
            global_config.next_escrow_id.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_escrow(
    ctx: Context<InitializeEscrow>,
    beneficiary: Pubkey,
    contract_amount: u64,
    deadline: i64,
) -> Result<()> {
    require!(contract_amount > 0, EscrowError::InvalidContractAmount);
    require!(
        deadline > Clock::get()?.unix_timestamp,
        EscrowError::InvalidDeadline
    );

    let global_config = &ctx.accounts.global_config;
    let escrow = &mut ctx.accounts.escrow;

    escrow.id = global_config.next_escrow_id;
    escrow.creator = ctx.accounts.creator.key();
    escrow.beneficiary = beneficiary;
    escrow.mint = global_config.payment_mint;
    escrow.contract_amount = contract_amount;
    escrow.allocated_amount = 0;
    escrow.released_amount = 0;
    escrow.approved_outstanding = 0;
    escrow.next_milestone_id = 0;
    escrow.deadline = deadline;
    escrow.status = EscrowStatus::Draft;
    escrow.bump = ctx.bumps.escrow;

    let global_config = &mut ctx.accounts.global_config;
    global_config.next_escrow_id = global_config
        .next_escrow_id
        .checked_add(1)
        .ok_or(EscrowError::ArithmeticError)?;

    Ok(())
}

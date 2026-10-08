pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("41vibHeFu14nmgqvbtxeTn3VxMXRD2PyjnFJL1JJCfKy");

#[program]
pub mod milestone_escrow {
    use super::*;

    pub fn initialize_global_config(ctx: Context<InitializeGlobalConfig>) -> Result<()> {
        handle_initialize_global_config(ctx)
    }

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        beneficiary: Pubkey,
        contract_amount: u64,
        deadline: i64,
    ) -> Result<()> {
        handle_initialize_escrow(ctx, beneficiary, contract_amount, deadline)
    }

    pub fn add_milestone(ctx: Context<AddMilestone>, amount: u64) -> Result<()> {
        handle_add_milestone(ctx, amount)
    }

    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        handle_fund_escrow(ctx)
    }

    pub fn approve_milestone(ctx: Context<ApproveMilestone>) -> Result<()> {
        handle_approve_milestone(ctx)
    }

    pub fn claim_milestone(ctx: Context<ClaimMilestone>) -> Result<()> {
        handle_claim_milestone(ctx)
    }

    pub fn refund_remaining(ctx: Context<RefundRemaining>) -> Result<()> {
        handle_refund_remaining(ctx)
    }
}

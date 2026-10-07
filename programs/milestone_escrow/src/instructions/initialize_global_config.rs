use crate::constants::{ADMIN_ADDRESS, GLOBAL_CONFIG_SEED};
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    #[account(
        mut,
        address = ADMIN_ADDRESS,
    )]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = GlobalConfig::DISCRIMINATOR.len() + GlobalConfig::INIT_SPACE,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_global_config(ctx: Context<InitializeGlobalConfig>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    global_config.next_escrow_id = 0;
    global_config.payment_mint = ctx.accounts.mint.key();
    global_config.bump = ctx.bumps.global_config;

    Ok(())
}

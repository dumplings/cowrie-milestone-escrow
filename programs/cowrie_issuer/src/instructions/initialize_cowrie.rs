use crate::constants::{ADMIN_ADDRESS, COWRIE_AUTHORITY_SEED, COWRIE_MINT_SEED, CWR_DECIMALS};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

#[derive(Accounts)]
pub struct InitializeCowrie<'info> {
    #[account(
        mut,
        address = ADMIN_ADDRESS,
    )]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [COWRIE_MINT_SEED],
        bump,
        mint::decimals = CWR_DECIMALS,
        mint::authority = cowrie_authority,
    )]
    pub cowrie_mint: Account<'info, Mint>,

    /// CHECK: PDA authority identity，仅用于进行mint行为授权
    #[account(
        seeds = [COWRIE_AUTHORITY_SEED],
        bump,
    )]
    pub cowrie_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_cowrie(_ctx: Context<InitializeCowrie>) -> Result<()> {
    Ok(())
}

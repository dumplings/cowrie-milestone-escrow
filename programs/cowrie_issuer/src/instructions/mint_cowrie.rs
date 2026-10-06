use crate::constants::ADMIN_ADDRESS;
use crate::{COWRIE_AUTHORITY_SEED, COWRIE_MINT_SEED, CWR_DECIMALS};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

#[derive(Accounts)]
pub struct MintCowrie<'info> {
    #[account(address = ADMIN_ADDRESS)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [COWRIE_MINT_SEED],
        bump,
        mint::decimals = CWR_DECIMALS,
        mint::authority = cowrie_authority,
    )]
    pub cowrie_mint: Account<'info, Mint>,

    /// CHECK: PDA authority identity，仅作为 Cowrie Mint 的 mint authority
    #[account(
        seeds = [COWRIE_AUTHORITY_SEED],
        bump,
    )]
    pub cowrie_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = cowrie_mint,
    )]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_mint_cowrie(ctx: Context<MintCowrie>, amount: u64) -> Result<()> {
    let signer_seeds: &[&[&[u8]]] = &[&[COWRIE_AUTHORITY_SEED, &[ctx.bumps.cowrie_authority]]];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.cowrie_mint.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.cowrie_authority.to_account_info(),
    };
    let cpi_context =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);
    token::mint_to(cpi_context, amount)?;

    Ok(())
}

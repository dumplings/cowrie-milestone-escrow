pub mod constants;
pub mod error;
pub mod instructions;

use anchor_lang::prelude::*;
pub use constants::*;
pub use error::*;
pub use instructions::*;

declare_id!("J5sGAhrSvy6MyjFg1RYBdjS5QPcx5VYrw265rhd6XhMa");

#[program]
pub mod cowrie_issuer {
    use super::*;

    pub fn initialize_cowrie(ctx: Context<InitializeCowrie>) -> Result<()> {
        handle_initialize_cowrie(ctx)
    }

    pub fn mint_cowrie(ctx: Context<MintCowrie>, amount: u64) -> Result<()> {
        handle_mint_cowrie(ctx, amount)
    }
}

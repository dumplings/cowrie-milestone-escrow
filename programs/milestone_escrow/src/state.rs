use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub next_escrow_id: u64,
    pub payment_mint: Pubkey,
    pub bump: u8,
}

#[derive(InitSpace, Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize)]
pub enum EscrowStatus {
    Draft,
    Active,
    Completed,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub id: u64,
    pub creator: Pubkey,
    pub beneficiary: Pubkey,
    pub mint: Pubkey,

    pub contract_amount: u64,
    pub allocated_amount: u64,
    pub released_amount: u64,
    pub approved_outstanding: u64,

    pub next_milestone_id: u64,

    pub deadline: i64,
    pub status: EscrowStatus,
    pub bump: u8,
}

#[derive(InitSpace, Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize)]
pub enum MilestoneStatus {
    Pending,
    Approved,
    Claimed,
}

#[account]
#[derive(InitSpace)]
pub struct Milestone {
    pub escrow: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub status: MilestoneStatus,
    pub bump: u8,
}

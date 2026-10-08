use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("ContractAmount must be greater than 0")]
    InvalidContractAmount,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Arithmetic error")]
    ArithmeticError,
    #[msg("Only the escrow creator can perform this action")]
    UnauthorizedCreator,
    #[msg("Escrow must be in draft status")]
    EscrowNotDraft,
    #[msg("Milestone amount must be greater than 0")]
    InvalidMilestoneAmount,
    #[msg("Milestone allocation exceeds the contract amount")]
    AllocationExceedsContractAmount,
    #[msg("Milestone allocation must equal the contract amount before funding")]
    IncompleteMilestoneAllocation,
    #[msg("Escrow must be active")]
    EscrowNotActive,
    #[msg("Milestone must be pending")]
    MilestoneNotPending,
}

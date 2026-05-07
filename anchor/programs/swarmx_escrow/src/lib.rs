use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("4cCfXEjstobSmNohQKuvAJMug2BKdJwNp5PoUrkKbHHm");

#[program]
pub mod swarmx_escrow {
    use super::*;

    /// User deposits USDC into a PDA vault tied to this task
    pub fn initialize_task(
        ctx: Context<InitializeTask>,
        task_id: u64,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, SwarmXError::InvalidAmount);

        let task = &mut ctx.accounts.task;
        task.task_id = task_id;
        task.user = ctx.accounts.user.key();
        task.orchestrator = ctx.accounts.orchestrator.key();
        task.amount = amount;
        task.status = TaskStatus::Funded;
        task.created_at = Clock::get()?.unix_timestamp;
        task.bump = ctx.bumps.task;
        task.vault_bump = ctx.bumps.vault;

        // Transfer USDC from user ATA → vault PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(TaskCreated {
            task_id,
            user: ctx.accounts.user.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "SwarmX: task {} initialized, {} lamports USDC escrowed",
            task_id,
            amount
        );
        Ok(())
    }

    /// Orchestrator distributes USDC to agent wallets and closes the vault
    pub fn resolve_task(
        ctx: Context<ResolveTask>,
        task_id: u64,
        payouts: Vec<AgentPayout>,
    ) -> Result<()> {
        let task = &ctx.accounts.task;
        require!(task.status == TaskStatus::Funded, SwarmXError::TaskNotFunded);
        require!(
            ctx.accounts.orchestrator.key() == task.orchestrator,
            SwarmXError::UnauthorizedOrchestrator
        );

        // Payouts must sum to exactly escrowed amount
        let total: u64 = payouts.iter().map(|p| p.amount).sum();
        require!(total == task.amount, SwarmXError::PayoutMismatch);
        require!(payouts.len() <= 10, SwarmXError::TooManyPayouts);

        // Update task status
        let task = &mut ctx.accounts.task;
        task.status = TaskStatus::Resolved;

        emit!(TaskResolved {
            task_id,
            payouts: payouts.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "SwarmX: task {} resolved, {} payouts emitted",
            task_id,
            payouts.len()
        );
        Ok(())
    }

    /// Refund full USDC to user (called on agent failure)
    pub fn refund_task(ctx: Context<RefundTask>, task_id: u64) -> Result<()> {
        let task = &ctx.accounts.task;
        require!(task.status == TaskStatus::Funded, SwarmXError::TaskNotFunded);
        require!(
            ctx.accounts.orchestrator.key() == task.orchestrator,
            SwarmXError::UnauthorizedOrchestrator
        );

        let task_id_bytes = task_id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            b"swarmx_vault",
            task_id_bytes.as_ref(),
            &[task.vault_bump],
        ];
        let signer_seeds = &[seeds];

        // Transfer all USDC from vault back to user ATA
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, task.amount)?;

        let task = &mut ctx.accounts.task;
        task.status = TaskStatus::Refunded;

        emit!(TaskRefunded {
            task_id,
            user: task.user,
            amount: task.amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("SwarmX: task {} refunded", task_id);
        Ok(())
    }
}

// ── Account Structs ────────────────────────────────────────────────────────

#[account]
pub struct TaskAccount {
    pub task_id: u64,          // 8
    pub user: Pubkey,          // 32
    pub orchestrator: Pubkey,  // 32
    pub amount: u64,           // 8
    pub status: TaskStatus,    // 1
    pub created_at: i64,       // 8
    pub bump: u8,              // 1
    pub vault_bump: u8,        // 1
}

impl TaskAccount {
    // discriminator(8) + fields
    pub const LEN: usize = 8 + 8 + 32 + 32 + 8 + 1 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum TaskStatus {
    Funded,
    Resolved,
    Refunded,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AgentPayout {
    pub agent: Pubkey,
    pub amount: u64,
    pub label: String,
}

// ── Contexts ───────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(task_id: u64)]
pub struct InitializeTask<'info> {
    /// Task state PDA
    #[account(
        init,
        payer = user,
        space = TaskAccount::LEN,
        seeds = [b"swarmx_task", task_id.to_le_bytes().as_ref()],
        bump
    )]
    pub task: Account<'info, TaskAccount>,

    /// USDC vault PDA (holds the escrowed tokens)
    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = vault,
        seeds = [b"swarmx_vault", task_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User who is funding the task
    #[account(mut)]
    pub user: Signer<'info>,

    /// Orchestrator wallet (stored in task for authorization)
    /// CHECK: just storing the pubkey, no signing needed here
    pub orchestrator: UncheckedAccount<'info>,

    /// User's USDC ATA (source of funds)
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    /// Devnet USDC mint
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(task_id: u64)]
pub struct ResolveTask<'info> {
    #[account(
        mut,
        seeds = [b"swarmx_task", task_id.to_le_bytes().as_ref()],
        bump = task.bump,
        has_one = orchestrator @ SwarmXError::UnauthorizedOrchestrator,
    )]
    pub task: Account<'info, TaskAccount>,

    #[account(mut)]
    pub orchestrator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(task_id: u64)]
pub struct RefundTask<'info> {
    #[account(
        mut,
        seeds = [b"swarmx_task", task_id.to_le_bytes().as_ref()],
        bump = task.bump,
        has_one = orchestrator @ SwarmXError::UnauthorizedOrchestrator,
    )]
    pub task: Account<'info, TaskAccount>,

    #[account(
        mut,
        seeds = [b"swarmx_vault", task_id.to_le_bytes().as_ref()],
        bump = task.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = task.user,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(mut)]
    pub orchestrator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ── Events ─────────────────────────────────────────────────────────────────

#[event]
pub struct TaskCreated {
    pub task_id: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TaskResolved {
    pub task_id: u64,
    pub payouts: Vec<AgentPayout>,
    pub timestamp: i64,
}

#[event]
pub struct TaskRefunded {
    pub task_id: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum SwarmXError {
    #[msg("Task must be in Funded status")]
    TaskNotFunded,
    #[msg("Payout amounts must sum to exact task amount")]
    PayoutMismatch,
    #[msg("Only the registered orchestrator wallet can resolve or refund")]
    UnauthorizedOrchestrator,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Maximum 10 agent payouts per task")]
    TooManyPayouts,
}

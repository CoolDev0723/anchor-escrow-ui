use anchor_lang::prelude::*;
use anchor_spl::token::{self};
use spl_token::instruction::AuthorityType;

pub mod instructions;
pub mod state;

use crate::instructions::*;

declare_id!("7iDKuYGEDgVKqxAzM3GygLeGKgnJxk3jhVyDmiAhSx8h");


#[program]
pub mod anchor_escrow {
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";
    const FEE_PERCENT: f64 = 5.0;

    pub fn initialize(
        ctx: Context<Initialize>,
        _vault_account_bump: u8,
        initializer_amount: u64,
        taker_amount: u64,
    ) -> ProgramResult {
        ctx.accounts.escrow_account.initializer_key = *ctx.accounts.initializer.key;
        ctx.accounts.escrow_account.initializer_deposit_token_account
            = *ctx.accounts.initializer_deposit_token_account.to_account_info().key;
        ctx.accounts.escrow_account.initializer_receive_token_account
            = *ctx.accounts.initializer_receive_token_account.to_account_info().key;
        ctx.accounts.escrow_account.initializer_amount = initializer_amount;
        ctx.accounts.escrow_account.taker_amount = taker_amount;

        let (vault_authority, _vault_authority_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        token::set_authority(
            ctx.accounts.into_set_authority_context(),
            AuthorityType::AccountOwner,
            Some(vault_authority),
        )?;

        token::transfer(
            ctx.accounts.into_transfer_to_pda_context(),
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        Ok(())
    }

    pub fn transfer(
        ctx: Context<TransferToken>,
        amount: u64,
    ) -> ProgramResult {
        let fee_amount = (amount as f64 / 100.0 * FEE_PERCENT) as u64;
        msg!("Send token({}) to receiver", amount - fee_amount);
        token::transfer(
            ctx.accounts.into_transfer_to_receiver(),
            amount - fee_amount,
        )?;
        msg!("Send fee token({}) to service", fee_amount);
        token::transfer(
            ctx.accounts.into_transfer_to_service(),
            fee_amount,
        )?;
        msg!("END");
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> ProgramResult {
        let (_vault_authority, vault_authority_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&ESCROW_PDA_SEED[..], &[vault_authority_bump]];

        token::transfer(
            ctx.accounts
                .into_transfer_to_initializer_context()
                .with_signer(&[&authority_seeds[..]]),
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        token::close_account(
            ctx.accounts
                .into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())
    }

    pub fn exchange(ctx: Context<Exchange>) -> ProgramResult {
        let (_vault_authority, vault_authority_bump) =
            Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&ESCROW_PDA_SEED[..], &[vault_authority_bump]];

        token::transfer(
            ctx.accounts.into_transfer_to_initializer_context(),
            ctx.accounts.escrow_account.taker_amount,
        )?;

        token::transfer(
            ctx.accounts
                .into_transfer_to_taker_context()
                .with_signer(&[&authority_seeds[..]]),
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        token::close_account(
            ctx.accounts
                .into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())
    }
}



import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { AnchorEscrow } from '../target/types/anchor_escrow';
import {ParsedAccountData, PublicKey, SystemProgram, Transaction} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";
import { assert } from "chai";

describe('anchor-escrow', () => {

  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AnchorEscrow as Program<AnchorEscrow>;

  let mintA = null as Token;
  let mintB = null as Token;
  let aliceTokenAccountA = null;
  let aliceTokenAccountA2 = null;
  let aliceTokenAccountB = null;

  let bobTokenAccountA = null;
  let bobTokenAccountB = null;

  let serviceTokenAccountA = null;

  let vault_account_pda = null;
  let vault_account_bump = null;
  let vault_authority_pda = null;


  const takerAmount = 100000;
  const initializerAmount = 50000;
  const sendAmount = 120;

  const escrowAccount = anchor.web3.Keypair.generate();

  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();

  const aliceMainAccount = anchor.web3.Keypair.generate();
  const bobMainAccount = anchor.web3.Keypair.generate();
  const serviceMainAccount = anchor.web3.Keypair.generate();

  it("Initialize program state", async () => {
    // Airdropping tokens to a payer.
    await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(payer.publicKey, 10000000000), //10 sol
        "confirmed"
    );

    // Fund Main Accounts
    await provider.send(
        (() => {
          const tx = new Transaction();
          tx.add(
              //send sol
              SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: aliceMainAccount.publicKey,
                lamports: 1000000000, //1sol
              }),
              SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: bobMainAccount.publicKey,
                lamports: 1000000000, //1sol
              })
          );
          return tx;
        })(),
        [payer]
    );

    mintA = await Token.createMint(
        provider.connection,
        payer,
        mintAuthority.publicKey,
        null,
        0,
        TOKEN_PROGRAM_ID
    );

    mintB = await Token.createMint(
        provider.connection,
        payer,
        mintAuthority.publicKey,
        null,
        0,
        TOKEN_PROGRAM_ID
    );

    aliceTokenAccountA = await mintA.createAccount(aliceMainAccount.publicKey);
    aliceTokenAccountA2 = await mintA.createAccount(aliceMainAccount.publicKey);
    bobTokenAccountA = await mintA.createAccount(bobMainAccount.publicKey);
    serviceTokenAccountA = await mintA.createAccount(serviceMainAccount.publicKey);

    aliceTokenAccountB = await mintB.createAccount(aliceMainAccount.publicKey);
    bobTokenAccountB = await mintB.createAccount(bobMainAccount.publicKey);

    await mintA.mintTo(
        aliceTokenAccountA,
        mintAuthority.publicKey,
        [mintAuthority],
        initializerAmount
    );

    await mintB.mintTo(
        bobTokenAccountB,
        mintAuthority.publicKey,
        [mintAuthority],
        takerAmount
    );

    let aliceTokenAccountInfoA = await mintA.getAccountInfo(aliceTokenAccountA);
    let bobTokenAccountInfoB = await mintB.getAccountInfo(bobTokenAccountB);

    assert.ok(aliceTokenAccountInfoA.amount.toNumber() == initializerAmount);
    assert.ok(bobTokenAccountInfoB.amount.toNumber() == takerAmount);

    let accounts = await provider.connection.getParsedTokenAccountsByOwner(
        aliceMainAccount.publicKey,
            {
              mint: mintA.publicKey
            }
        )

    console.log("aliceTokenAccountA", aliceTokenAccountA.toBase58());
    if (accounts && accounts.value && Array.isArray(accounts.value)) {
      accounts.value.forEach((item) => {
        const {account, pubkey} = item;
        const amount1 = account.data.parsed.info.tokenAmount.amount;
        console.log("account", amount1, pubkey.toString());
      })
    }

  });

  it("transfer token", async () => {
    await program.rpc.transfer(
        new anchor.BN(sendAmount),
        {
          accounts: {
            initializer: aliceMainAccount.publicKey,
            senderTokenAccount: aliceTokenAccountA,
            receiverTokenAccount: bobTokenAccountA,
            serviceTokenAccount: serviceTokenAccountA,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [aliceMainAccount],
        }
    );
    let _aliceTokenAccountInfoA = await mintA.getAccountInfo(aliceTokenAccountA);
    console.log("alice", _aliceTokenAccountInfoA.amount.toNumber());
    let _bobTokenAccountInfoA = await mintA.getAccountInfo(bobTokenAccountA);
    console.log("bob", _bobTokenAccountInfoA.amount.toNumber());
    let _serviceTokenAccountInfoA = await mintA.getAccountInfo(serviceTokenAccountA);
    console.log("service", _serviceTokenAccountInfoA.amount.toNumber());

  });

  it("Initialize escrow", async () => {
    const [_vault_account_pda, _vault_account_bump] = await PublicKey.findProgramAddress(
        [Buffer.from(anchor.utils.bytes.utf8.encode("token-seed"))],
        program.programId
    );
    vault_account_pda = _vault_account_pda;
    vault_account_bump = _vault_account_bump;

    console.log(vault_account_pda.toBase58(), vault_account_bump); //bump is u8: byte

    const [_vault_authority_pda, _vault_authority_bump] = await PublicKey.findProgramAddress(
        [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
        program.programId
    );
    vault_authority_pda = _vault_authority_pda;

    await program.rpc.initialize(
        vault_account_bump,
        new anchor.BN(initializerAmount),
        new anchor.BN(takerAmount),
        {
          accounts: {
            initializer: aliceMainAccount.publicKey,
            mint: mintA.publicKey,
            vaultAccount: vault_account_pda,
            initializerDepositTokenAccount: aliceTokenAccountA,
            initializerReceiveTokenAccount: aliceTokenAccountB,
            escrowAccount: escrowAccount.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          instructions: [
            await program.account.escrowAccount.createInstruction(escrowAccount),
          ],
          signers: [escrowAccount, aliceMainAccount],
        }
    );

    let _vault = await mintA.getAccountInfo(vault_account_pda);
    console.log("_vault", _vault); //Is _vault the token account?

    let _escrowAccount = await program.account.escrowAccount.fetch(
        escrowAccount.publicKey
    );
    console.log("_escrowAccount", _escrowAccount);

    // Check that the new owner is the PDA.
    assert.ok(_vault.owner.equals(vault_authority_pda));

    // Check that the values in the escrow account match what we expect.
    assert.ok(_escrowAccount.initializerKey.equals(aliceMainAccount.publicKey));
    assert.ok(_escrowAccount.initializerAmount.toNumber() == initializerAmount);
    assert.ok(_escrowAccount.takerAmount.toNumber() == takerAmount);
    assert.ok(
        _escrowAccount.initializerDepositTokenAccount.equals(aliceTokenAccountA)
    );
    assert.ok(
        _escrowAccount.initializerReceiveTokenAccount.equals(aliceTokenAccountB)
    );
  });

  it("Exchange escrow state", async () => {
    await program.rpc.exchange({
      accounts: {
        taker: bobMainAccount.publicKey,
        takerDepositTokenAccount: bobTokenAccountB,
        takerReceiveTokenAccount: bobTokenAccountA,
        initializerDepositTokenAccount: aliceTokenAccountA,
        initializerReceiveTokenAccount: aliceTokenAccountB,
        initializer: aliceMainAccount.publicKey,
        escrowAccount: escrowAccount.publicKey,
        vaultAccount: vault_account_pda,
        vaultAuthority: vault_authority_pda,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [bobMainAccount]
    });

    let _takerTokenAccountA = await mintA.getAccountInfo(bobTokenAccountA);
    let _takerTokenAccountB = await mintB.getAccountInfo(bobTokenAccountB);
    let _initializerTokenAccountA = await mintA.getAccountInfo(aliceTokenAccountA);
    let _initializerTokenAccountB = await mintB.getAccountInfo(aliceTokenAccountB);

    assert.ok(_takerTokenAccountA.amount.toNumber() == initializerAmount);
    assert.ok(_initializerTokenAccountA.amount.toNumber() == 0);
    assert.ok(_initializerTokenAccountB.amount.toNumber() == takerAmount);
    assert.ok(_takerTokenAccountB.amount.toNumber() == 0);
  });

  it("Initialize escrow and cancel escrow", async () => {
    // Put back tokens into initializer token A account.
    await mintA.mintTo(
        aliceTokenAccountA,
        mintAuthority.publicKey,
        [mintAuthority],
        initializerAmount
    );

    await program.rpc.initialize(
        vault_account_bump,
        new anchor.BN(initializerAmount),
        new anchor.BN(takerAmount),
        {
          accounts: {
            initializer: aliceMainAccount.publicKey,
            vaultAccount: vault_account_pda,
            mint: mintA.publicKey,
            initializerDepositTokenAccount: aliceTokenAccountA,
            initializerReceiveTokenAccount: aliceTokenAccountB,
            escrowAccount: escrowAccount.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          instructions: [
            await program.account.escrowAccount.createInstruction(escrowAccount),
          ],
          signers: [escrowAccount, aliceMainAccount],
        }
    );

    // Cancel the escrow.
    await program.rpc.cancel({
      accounts: {
        initializer: aliceMainAccount.publicKey,
        initializerDepositTokenAccount: aliceTokenAccountA,
        vaultAccount: vault_account_pda,
        vaultAuthority: vault_authority_pda,
        escrowAccount: escrowAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [aliceMainAccount]
    });

    // Check the final owner should be the provider public key.
    const _initializerTokenAccountA = await mintA.getAccountInfo(aliceTokenAccountA);
    assert.ok(_initializerTokenAccountA.owner.equals(aliceMainAccount.publicKey));

    // Check all the funds are still there.
    assert.ok(_initializerTokenAccountA.amount.toNumber() == initializerAmount);
  });
});
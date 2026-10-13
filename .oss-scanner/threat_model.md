# Lido core threat model

The goal is to preserve stETH backing and pay ETH only to the entitled party. Internal shares are backed by ETH held by Lido or staked under Lido withdrawal credentials. External shares are backed by connected stVaults, which stake under their own credentials. Defects that break backing, move another party's assets, or prevent withdrawals have the highest priority.

## 1. Scope and reference material

The scan target is `lidofinance/core#master`. This model was written against `v4.1.0` (`1440c830e`, 2026-10-07), including DSM v5 and balance-based accounting from Staking Router v3. `git diff 1440c830e HEAD -- contracts` shows later contract changes.

`/src/deployed-mainnet.json` records deployment addresses, constructor arguments and initial parameters. The registry snapshot is from 2026-10-12; its core addresses and `v4.1.0` label were checked on 2026-10-13. These snapshots do not prove current bytecode parity, role assignments or governance-set values. Deployment status distinguishes these cases:

- **Live:** reachable in the deployed configuration.
- **Live, unused path:** deployed code that the recorded configuration cannot reach, such as a proof verifier's fork-pivot branch when its previous and current gindices are equal.
- **Future upgrade:** requires a redeploy or migration. `OracleReportSanityChecker.migrateBaselineSnapshot()` was already called on the live checker during the `v4.0.0` upgrade.
- **Not deployed / retired:** relevant only if a live contract still trusts it or sends it value.

The scan covers production Solidity in this repository. Excluded code includes test and deployment infrastructure (`test/`, `scripts/`, `tasks/`, TypeScript `lib/`, `docs/`, deployment JSON), executed or testnet-only `contracts/upgrade/`, `contracts/tooling/`, the scratch copy `contracts/0.6.11/deposit_contract.sol`, the executed `contracts/0.4.24/template/`, and testnet-only effects.

External projects are outside this scan: staking modules implemented elsewhere, `lido-oracle`, Dual Governance, Easy Track, Circuit Breaker, Execution Delegation Framework (EDF), and Aragon apps. Their integrations can establish the impact of a core defect. A defect confined to an external project is not a core finding.

The Dockerfile fetches optional, commit-pinned references for the offline review:

- `/opt/lido/execution-delegation-framework`: ERC-1271 guardian contracts called by DSM. The pin matches core's `EDF_REPO_REF`.
- `/opt/lido/staking-modules`: release `v3.0`, containing CSM v3 and Curated Module v2. It provides context for the router's module calls.
- `/opt/lido/dual-governance/contracts/Escrow.sol`: a consumer of core share conversions and withdrawal methods. A core defect can change veto weight or block rage quit.
- `/opt/lido/lido-improvement-proposals/LIPS/`: design intent, especially LIP-12 (post-Merge rewards and fees), LIP-23 (negative rebases), LIP-28 (Dual Governance), LIP-30 (triggerable withdrawals), LIP-34 (pausing), LIP-35 (accounting, top-ups and consolidations), and LIP-37 (EDF/DSM).
- `/opt/lido/deployed-contracts.md`: the address registry snapshot. Its commit is recorded in the Dockerfile.

A missing reference means its optional fetch failed. Reference snapshots do not establish current registrations or permissions. Easy Track and Circuit Breaker sources are not needed to test the core role boundaries below. Their authorized actions are assumptions of this scan.

## 2. Review priorities

All paths below are under `/src/contracts/`. Supporting libraries are in scope wherever they affect these paths.

1. **Share supply, backing and the share rate:** `0.4.24/Lido.sol`, `0.4.24/StETH.sol`, `0.4.24/StETHPermit.sol`, `0.6.12/WstETH.sol`, `0.8.9/Accounting.sol`, `0.8.9/Burner.sol`, `0.8.9/oracle/` and `0.8.9/sanity_checks/`; external-share accounting in `0.8.25/vaults/`, especially VaultHub, LazyOracle, OperatorGrid, StakingVault and `predeposit_guarantee/`.
2. **Deposits, top-ups and consolidations:** `0.8.9/DepositSecurityModule.sol`, `0.8.25/sr/`, `0.8.25/TopUpGateway.sol`, `0.8.25/CLValidatorVerifier.sol`, `0.8.25/consolidation/`, `0.4.24/nos/NodeOperatorsRegistry.sol`, and shared beacon-proof and withdrawal-credential libraries. NOR and Simple DVT use the in-repository `NodeOperatorsRegistry` implementation.
3. **Withdrawal finalization, claims and ETH custody:** `0.8.9/WithdrawalQueue.sol`, `0.8.9/WithdrawalQueueBase.sol`, `0.8.9/WithdrawalQueueERC721.sol`, `0.8.9/WithdrawalVault.sol`, `0.8.9/WithdrawalVaultEIP7685.sol` and `0.8.9/LidoExecutionLayerRewardsVault.sol`.
4. **Other reachable production code:** exit buses, triggerable withdrawals, exit-delay proofs, stVault dashboards and fees, proxies, access control, pauses and `LidoLocator`. Helper and vendored code matters when a defect reaches an in-scope contract; an upstream-known issue alone is not a new finding.

## 3. Actors and trust boundaries

### Untrusted actors

Attackers may use arbitrary contracts, flash loans, transaction ordering and multiple identities. They can use permissionless token, withdrawal, vault, proof and exit-triggering entry points, and choose callback or refund recipients where the interface permits it. Vault owners, node operators, their managers, depositors and PDG guarantors do not trust one another.

Attackers can force ETH into contracts, deposit to the beacon deposit contract for Lido pubkeys, operate their own validators, and request consensus-layer exits or consolidations for validators they control. A consolidation source and target need not share an owner. Assume the consensus layer enforces its eligibility and withdrawal-credential rules. Honest oracle reports can therefore contain consensus-layer state shaped by an attacker.

### Privileged actors with code-enforced bounds

A finding must identify the bound that the actor exceeds, or an unprivileged route into the role.

- **Oracle committees:** `HashConsensus` requires a majority quorum. Submitted data must match the agreed hash; reports and extra-data chunks must follow the frame and processing rules. `Accounting` accepts only `AccountingOracle`, and the sanity checker bounds accepted reports. `LazyOracle` checks report proofs, freshness, quarantine and fee limits. Vault reports do not set live `liabilityShares`. One committee member or `SUBMIT_DATA_ROLE` holder can submit agreed data, but cannot choose a report independently of consensus or bypass the hash, chunk and deadline checks.
- **Exit paths:** VEBO uses format 2 with module key checks and `maxBalanceExitRequestedPerReportInEth`. The role-committed hash path also accepts format 1, without that key check. TWG checks `ADD_FULL_WITHDRAWAL_REQUEST_ROLE`, rate limits and fees; it does not independently establish module/operator ownership of each supplied pubkey.
- **DSM guardians:** seed deposits require distinct, sorted guardian signatures meeting `quorum`. Deposit signatures bind the guardian, message type, chain, DSM, module, nonce, block and deposit root. `quorum == 0` blocks deposits. One guardian may pause deposits or unvet keys.
- **Staking modules:** governance selects the modules, and their implementations are trusted. The router enforces withdrawal credentials, allocation and ETH accounting at its boundary. A type-2 module self-reports its stake. An unprivileged actor causing an honest module to violate the boundary is in scope.
- **Top-up and consolidation operators:** `TOP_UP_ROLE` chooses targets and amounts subject to proofs, allocation and per-block bounds. `ALLOW_PAIR_ROLE` registers a submitter for a source/target operator pair; that submitter is authorized only for the pair. Credentials proofs do not independently prove module or operator ownership.
- **Burner role:** `requestBurnShares` can pull shares from an approver; the withdrawal queue gives an unlimited allowance. In core, `Accounting` uses this for finalization. Unintended paths that burn queue or user shares are in scope.
- **stVault roles and parties:** bad-debt socialization is restricted to one node operator; internalization is bounded by fresh reported debt. Forced exits require an obligations shortfall, and disconnect requires zero liability. Tier, share-limit and fee changes require the designated owner/operator confirmations. A depositor's authority over vault ETH does not authorize withdrawals to itself or changes to another vault.
- **Pausers:** Circuit Breaker and Dual Governance's `ResealManager` are authorized callers. The pinned registry lists seven core contracts covered by Circuit Breaker: WithdrawalQueueERC721, ValidatorsExitBusOracle, TriggerableWithdrawalsGateway, VaultHub, PredepositGuarantee, ConsolidationGateway and TopUpGateway. This records coverage at the snapshot date, not current permissions. Core `PausableUntil` accepts an indefinite duration. Claims and unstETH transfers remain available while the queue is paused. `StakingRouter`, `ConsolidationBus`, `ConsolidationMigrator` and `NodeOperatorsRegistry` have no pause. A pause protects only the entry points that check it.

### Trusted authority and external systems

Governance may upgrade contracts, assign roles and set any value that the relevant setter accepts. The Aragon Agent behind Dual Governance controls the core proxy/admin roles and the StakingVault beacon. The DSM owner controls its guardian set and unpauses deposits. Easy Track's executor is trusted for values that core accepts; core enforces its role and structural checks. A core invariant breaking under an accepted configuration remains in scope, with the setter and required value identified.

Assume Ethereum consensus, the deposit contract, EIP-4788 roots and the EIP-7002/EIP-7251 predeploys behave as specified. Registered rebase observers are trusted. Leaked keys, governance capture and abuse that stays within intended privileged authority are excluded.

## 4. Security properties

These are properties to test, subject to the accepted behavior in section 6. Existing audits or formal models do not establish that every implementation path satisfies them.

### Shares and accounting

- `Σ shares == totalShares`, `externalShares <= totalShares`, and `internalShares > 0`. WstETH holds at least as many shares as its supply. Buffered ETH does not exceed Lido's ETH balance. External shares equal connected vault liabilities plus bad debt awaiting internalization.
- Internal ETH counts the buffer, reported validator and pending-deposit balances, and deposits since the report. Each deposit enters one report's principal. `depositedNextReport <= depositedPostReport` matters because Solidity 0.4.24 subtracts these values unchecked.
- User mint, burn and rebalance paths preserve backing and do not reduce `internalEther / internalShares`. Bad debt reaches the share rate through `internalizeExternalBadDebt` in the oracle report. Shares held by Burner leave only through burning or the defined excess-recovery path.
- Reports include every registered module in registration order, and module validator balances sum exactly to the reported CL balance. Accounting bounds cover pending and activated balance growth, the decrease-window baseline, annual growth, withdrawal-vault balance and finalization share rate. Fee shares are minted only when CL-side value, including withdrawn ETH, grows relative to CL principal (LIP-12). When that condition holds, the fee base includes the CL gain and `elRewardsVaultTransfer`, the amount scheduled for collection from the EL rewards vault. EL rewards alone do not trigger fees. Router balances are updated before reward distribution and fee minting. A revert rolls back the whole report.
- Deposit and top-up spending stays within depositable ETH and never consumes the withdrawals reserve. Deposits reserve, withdrawals reserve and unreserved buffer remain distinct. The deposits reserve is not an on-chain restriction on withdrawal finalization (section 6).

### Deposits and validator movements

- Only DSM initiates router seed deposits; only TopUpGateway initiates router top-ups. ETH withdrawn from Lido for these operations reaches the deposit contract with Lido withdrawal credentials in the same call. The router preserves its entry ETH balance, and failure reverts the whole operation.
- A top-up proves an active validator with the module's `0x02` credentials against a sufficiently recent EIP-4788 root. The root's `childBlockTimestamp` must exceed the gateway's `lastTopUpTimestamp`. Exiting or slashed validators receive zero allocation. Nonzero allocations are gwei-aligned, at least 1 ETH and within gateway, module and router bounds. Missing or overwritten beacon roots fail closed.
- Consolidations prove the target's `0x02` credentials for `LidoLocator.withdrawalVault()`. Execution follows the bus delay, checks the DSM pause and `Lido.canDeposit()`, forwards the exact predeploy fee and refunds only the excess. The migrator binds deposited key indices to the fixed source/target modules and the authorized pair submitter.
- Allocation respects module share caps, demand and capacity. Deposited counts never decrease. Oracle-reported exited counts never decrease or exceed deposited counts; the privileged unsafe setter may lower them but cannot exceed deposits. A registered type-2 module must support the V2 methods the router calls.

### Withdrawals and exits

- Each withdrawal claim pays at most `min(requested stETH, shares * checkpointRate / 1e27)` to the owner's chosen recipient, once. Finalization is contiguous, locked ETH covers claims, and `lockedEtherAmount` does not exceed the queue balance.
- WithdrawalVault transfers its existing ETH to Lido only during the oracle report. Its immutable gateways can request exits or consolidations using exactly the supplied `msg.value`.
- Exit triggers require delivered data, the full EIP-7002 fee and available rate-limit capacity. The oracle exit path binds each pubkey to the module's registered key. An exit-delay proof binds the beacon root, slot, validator index and pubkey, proves no exit epoch, and uses a reference slot after both delivery and activation plus `SHARD_COMMITTEE_PERIOD`.

### stVaults and PDG

- Minting requires a fresh report, an unjailed vault, sufficient collateral after unsettled Lido fees, and vault/tier/group/external-share/staking limits. Withdrawals preserve locked collateral and unsettled fees. Liability and redemption totals remain consistent across vaults, tiers and groups. A disconnected vault has zero liability and locked collateral.
- Collateral calculations remain consistent across share-rate changes, tier changes, fee settlement and rebalance. Quarantined increases cannot support minting before release; a leaf applies at most once per root. Reconnect, disconnect and ref-slot changes cannot erase debt or count value twice.
- PDG sends a 1 ETH predeposit before credential proof and locks the corresponding node-operator bond. Activation and later guaranteed deposits require proof of the vault's credentials. The stage machine cannot reuse a pubkey or another validator's staged ETH. Connection requires a factory-deployed, non-ossified vault with PDG as depositor and exactly 31 ETH staged per pending activation. A connected vault retains that staged balance; bond accounting and guarantor refunds remain covered by PDG's ETH balance.
- Role checks, confirmations and ownership checks apply across callbacks and lifecycle changes. Initializers and version finalizers run once in the intended deployment sequence; upgrades require the admin, and paused entry points enforce their pause.

## 5. Integration details and review focus

- **Proof semantics:** gindex concatenation, slot binding, SSZ field lengths and endianness, fork-pivot selection, and BLS deposit-domain binding. Only TopUpGateway imposes a root-age bound; other proof consumers can use any root still in the EIP-4788 buffer. Equal old/new gindices can make a fork branch unreachable in the deployed configuration.
- **Identity versus credentials:** all type-2 modules share Lido's `0x02` credentials. A credentials proof does not prove module/operator ownership. Exit format 2 binds a registered pubkey, not deposit status or validator index. Deposits/top-ups use the router's stored credentials; consolidation derives them from the locator's withdrawal vault.
- **Cross-version accounting:** stVault contracts predate the `v4.0.0` change to internal-ETH accounting used by their conversions. Bad debt passes through VaultHub, RefSlotCache, Accounting and Lido. Other sensitive boundaries are report simulation versus application, packed arithmetic, and extra-data chunk parsing, ordering and deadlines.
- **Callbacks and zero-value paths:** refunds, claims, ERC-721 callbacks, PDG/vault calls, module hooks and rebase observers may re-enter other entry points. Zero-key deposits and all-zero top-ups still call modules and change state. State ordering and ETH conservation must hold across these calls.
- **Downstream consumers:** core conversions and withdrawals affect Dual Governance Escrow. Core views also feed honest off-chain services: the oracle uses `calculateFinalizationBatches` to construct report data. Impact depends on the resulting report or transaction and its later on-chain checks.
- **Finalization arithmetic:** batch-level ETH locking in `WithdrawalQueueBase.prefinalize` must cover per-request claims. Checkpoint boundaries, rate caps and tiny requests are sensitive to rounding.
- **Cached dependencies:** locator updates do not change immutable gateway or consolidation-stack addresses. An old address can matter if it retains authority or can still receive assets.

## 6. Known and accepted behavior

The mechanisms below describe known or accepted behavior. A variant with a new bypass, lower attacker cost, longer disruption or larger impact can still be a finding. Audit labels identify the existing reports: SR3 = 2026 Staking Router v3; V3 = Lido V3/stVaults; V2 = Lido V2; EDF = DSM v5/delegation.

- **Privileged actions and deployment:** pausing, including indefinite resealing, is authorized behavior. Permissionless initializers/migrations rely on atomic deployment. A finding requires an unauthorized action, an exceeded code bound, or a reachable live contract left open. Old OpenZeppelin role storage in StakingRouter is inert unless live authorization reads it.
- **Trusted callbacks:** an empty-data revert from a registered rebase observer aborts the oracle report (Ack3 NEST L6); analogous module-hook failures can abort their caller with `UnrecoverableModuleError`. A failed credentials-change hook intentionally leaves the module deposits-paused. An unprivileged trigger remains worth investigating.
- **Rounding:** tiny transfers may move zero shares, and claims leave dust. Below a share rate of 1, `transferSharesFrom` can spend zero allowance for small share amounts (Certora V3 L-10); the checked mainnet rate is above 1. Profitable repetition, third-party loss or a broken solvency check remain in scope.
- **Negative rebases and external deposits:** without a second-opinion oracle, an excessive CL decrease over the 36-day window rejects the report (LIP-23). Third-party deposits to Lido keys consume `externalPendingBalanceCapEth` (Certora SR3 C-01). A cheap trigger beyond that allowance or a way to steer the window baseline is not covered by those accepted mechanisms.
- **Bad debt:** smoothing ignores it and fees precede internalization (Certora V3 M-07/M-08; Certora SR3 L-03). Internalization can overstate the loss (MixBytes V3 M-1). Bunker mode starts on the next report, stVaults remain usable in bunker mode (MixBytes V3 H-1/M-3), and internalization can happen while PDG compensation is available (Certora V3 M-10). These do not excuse debt created or timed by an unprivileged actor for profit, excess loss beyond the report's debt, or a bypass of the internalization path.
- **Accounting limits:** external-to-internal rebalance ignores the staking pause/limit; external burns can lift the current limit above its maximum. Same-block `submit` can affect smoothing. Share-rate reconstruction omits fee-share divergence. A finding needs a resulting invariant violation, profitable mainnet attack or finalization beyond the permitted rate deviation. Keeping finalization out of the deposits reserve is an off-chain oracle rule, not an on-chain guard (LIP-35).
- **EL rewards:** `Lido` accounts for the requested amount without using the return value of `withdrawRewards` (MixBytes V3 L-11; Statemind SR3 INFORMATIONAL-43). Before collection, the report's sanity checks reject a reported EL-rewards vault balance above the actual balance. The ignored return alone is accepted behavior; a reachable withdrawal that transfers less ETH than Lido requested remains in scope.
- **Deposit liveness and modules:** a malicious governance-selected module can falsify data, steal deposits or halt them; this is excluded trusted-module behavior (Statemind V2 CRITICAL-02). NOR key vetting sets a count without binding it to the reviewed key set: an operator can replace unused keys after off-chain review and before the limit change executes (Statemind V2 HIGH-07). DSM guardians can unvet keys or pause deposits. Operators can invalidate a module nonce; anyone can change the deposit root. Withdrawal requests can invalidate near-maximum deposits/top-ups. Cheaper or persistent disruption, honest-module abuse, or changes to another operator's keys remain in scope.
- **DSM:** quorum may exceed guardian count. Unexpired pause signatures can work after unpause (Composable EDF LDO-55729910-L04). ERC-1271 admission checks ERC-165 support, while ECDSA verification remains possible and terminated delegation contracts remain registered (Composable/MixBytes EDF). These do not permit fewer than quorum valid distinct deposit signatures, seat/domain confusion or an expired intent.
- **Top-ups and consolidations:** top-ups use a privileged role and proofs, not a guardian quorum; `pendingBalanceGwei` is not proven. Top-ups do not read the DSM pause. Consolidation proves the target; Ethereum checks the source because WithdrawalVault submits the request. Consolidations ignore the quorum-above-guardian-count stop and module status, but must honor the DSM pause, stopped Lido and bunker mode (LIP-35; Certora/Statemind SR3).
- **Rate limits and exits:** delivered exit data can be retriggered for the full fee and consume quota (LIP-30). `maxValidatorsPerReport` and the exit bucket apply to the hash path, which permits format 1; VEBO has its own key and amount checks. Undelivered pre-upgrade hashes remain stuck. Resetting rate-limit capacity and the unbounded global consolidation delay are configuration behavior. None of these permits exceeding an active limit or triggering undelivered data.
- **Withdrawal quirks:** mixed batches can lock more ETH than claims need; one finalization can give partial rate recovery (Certora V2 H-05/M-04). Claiming to Lido mints stETH to the queue (Hexens V2 LID-19). Front-running a permit can revert a permit-based withdrawal request (core issue #803). Claims above entitlement, a recipient chosen by a non-owner, or excess locking forced by an unprivileged actor remain in scope.
- **Vault operator authority:** the authorized depositor may stake available vault ETH; the operator manager may make unguaranteed deposits after owner opt-in. The initial 1 ETH PDG deposit intentionally precedes credential proof. Unauthorized deposits, uncovered bonds, misuse of staged ETH, or activation under the wrong credentials remain in scope.
- **Vault lifecycle and fees:** direct ownership transfer can bypass Dashboard operator approval; reconnect resets the tier (Certora V3 L-08); forced disconnect skips operator fees (Certora V3 L-17); confirmations survive until expiry. Rebalancing and forced exits have no incentive. These do not authorize another party's transfer, debt removal, jail removal or confirmation reuse for different calldata/parties (Certora/Consensys V3).
- **Vault health and timing:** fee settlement and repeated small owner rebalances can worsen vault health (the rounding case is Certora V3 L-19). Quarantine holds the full increase; PDG compensation can trigger it. Out-of-order reports with gifts can delay one vault report by about a day, and a jailed owner can delay forced exits by funding the vault (Certora V3). Early quarantine release, double counting, wider disruption or loss shifted to another party remains in scope.

## 7. Severity

Rate the worst consequence the same root cause reaches, with explicit deployment and configuration assumptions. For governance-set parameters, name the accepted value and setter; Lido verifies live settings during triage.

- **Critical:** theft of user principal, claimable ETH or PDG bonds; unbacked shares; a share-rate reduction outside an oracle report; stake sent under wrong withdrawal credentials; claims above entitlement; permanent freezing of user funds; or Dual Governance weight without the corresponding locked value.
- **High:** theft or permanent freezing of yield/fees, treasury loss, unauthorized role/ownership/admin access, bypassed confirmations or DSM authorization, unauthorized or underpaid exits, false exit-delay proofs, profitable share-rate/rebase manipulation, repeatable vault Lido-fee avoidance, or an unprivileged freeze of claims/finalization/reports/vault withdrawals requiring a role holder to recover.
- **Medium:** unprofitable griefing, a report failure that recovers without governance action, a new or cheaper deposit/top-up/consolidation halt, bounded vault delays, harmful front-running, or block stuffing for profit.
- **Low:** promised returns not delivered without loss of value; wrong views/events without an effect on value or protocol decisions; over-deposits above MaxEB that Ethereum returns to Lido credentials.
- **Informational:** style, gas, best practices, unreachable branches, negligible non-accumulating rounding, or re-entry/off-chain effects without on-chain impact. Do not submit these as findings.

Apply these qualifications:

- Rate core views used by integrations or honest off-chain services by their demonstrated downstream effect, including report rejection or delay. A view is not automatically Low or High.
- Self-harm is Informational only if all loss stays with the actor. Loss shifted to holders, other vaults, node operators or guarantors is not self-harm.
- A deposit halt alone does not freeze user funds; withdrawal finalization can use the buffer without the deposit path.
- A freeze is permanent if no role action in the existing code can end it, even if an upgrade or redeploy could. Existing Dashboards cannot be upgraded, and ossified vaults retain their implementation.
- For an unused deployed path or future upgrade, state what makes it reachable and rate the impact under that condition. Retired code matters only through an affected live contract.
- Quantify the total reachable impact in ETH and shares, including repeated use and affected vaults/requests. Severity follows impact; confidence and reproduction status are separate.

## 8. Offline testing

Work in `/src`. The image builds Hardhat with Node 22 and Yarn 4.9.2, caches the compiler versions, and sets `MODE=scratch`. The scanner VM has 2 CPUs, 8 GiB and no Internet. Use focused suites; `yarn test` configures a 10 GiB heap and parallel Mocha. Network fetches and `MODE=forking` are unavailable.

```bash
yarn hardhat test --no-compile <test-files> --grep '<optional filter>'
# If the optional Foundry setup succeeded:
forge build --offline
forge test --offline --match-path '<test-file>'
# After adding a Solidity test helper:
SKIP_INTERFACES_CHECK=true SKIP_LINT_SOLIDITY=true yarn hardhat compile
```

Find subsystem tests under `test/0.4.24/`, `test/0.8.9/` and `test/0.8.25/`. Reuse `test/deploy/` and `test/suite` fixtures; put a standalone reproduction under `test/poc/`. `deployVaults` uses the real VaultHub with mocked dependencies. Use the corresponding LazyOracle or PDG suites when the property depends on those real contracts. `deployLidoDao({ rootAccount, initialized: true })` returns stopped Lido; grant `RESUME_ROLE` and resume it before testing active paths.

Use chain timestamps (`getCurrentBlockTimestamp()` or `time.latest()`). The accounting report test uses `Date.now()` and can intermittently hit `IncorrectReportTimestamp`; inspect report and block timestamps before attributing a failure to the contract.

Full scratch integration needs a local workaround. Copy `scripts/scratch/steps.json` to `scripts/scratch/steps-offline.json` without EDF step 0102. In `lib/protocol/helpers/edf.ts`, replace `deployDelegationContract`'s factory path with deployment of `ERC1271Guardian__Mock(delegate)` and return the mock as `{ address, contract }`. Then use:

```bash
export MODE=scratch NETWORK=hardhat STEPS_FILE=scratch/steps-offline.json \
  DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 GENESIS_TIME=1639659600 \
  GAS_PRIORITY_FEE=1 GAS_MAX_FEE=10 GAS_LIMIT=16000000 NETWORK_STATE_FILE=deployed-hardhat.json \
  AUTO_CONFIRM=true ALLOW_SKIP_STEPS=true SKIP_INTERFACES_CHECK=true SKIP_LINT_SOLIDITY=true
yarn hardhat test --no-compile test/integration/core/happy-path.integration.ts
```

This workaround was checked at `1440c830e` for core accounting/withdrawal and vault LazyOracle/PDG suites. It mocks guardians and Circuit Breaker, stubs Easy Track, and omits CSM/Curated Module v2. It does not cover EDF-specific, top-up or consolidation integrations. `INTEGRATION_WITH_CMv2=off` skips CMv2-dependent suites in broader runs. Keep harness edits separate from a proposed contract patch and state which dependencies a reproduction mocks.

The Hardhat network permits unlimited contract size, so it does not establish deployability. `lib/eips/` supplies predeploy helpers. For CL proofs, use `prepareLocalMerkleTree` in `lib/pdg.ts` or `lib/top-ups.ts` with a valid state. `updateBeaconBlockRoot` can install arbitrary roots; accepting a fabricated state under such a root does not demonstrate a production vulnerability.

## 9. Reports and patches

Lido triage needs the reviewed commit, deployment status, required actor/configuration, failed invariant, before/after value flow, and total impact across affected contracts. Evidence can be a reproduction against unmodified `contracts/`, or an exact code path with unreproduced steps marked. For a known mechanism, relevance depends on the new consequence or bypass.

Mitigation claims need the affected entry point, required authority and verified on-chain delay of the pause or role action. Live permissions and operational response times remain unknown where offline evidence is insufficient.

Patches must preserve proxy storage layout and initializer/version rules. Shared code must compile under every importing compiler version, including Solidity 0.4.24. Deployment constraints include:

- Storage patterns differ: ConsolidationBus and ConsolidationMigrator use sequential state, Lido uses fixed unstructured slots, and Burner and VaultHub use ERC-7201 namespaces. A layout rule for one contract does not establish compatibility for another.
- WithdrawalVault embeds both gateway addresses as immutables. Replacing either gateway address requires a new WithdrawalVault implementation and an upgrade of its proxy; a locator update alone does not change the cached addresses.
- StakingRouter links SRLib and BeaconChainDepositor. SRLib and NodeOperatorsRegistry both link MinFirstAllocationStrategy. A fix to that shared library therefore needs relinking through both paths, including the NOR and Simple DVT implementations.
- Existing Dashboards cannot be upgraded, and ossified vaults retain their implementation. Other fixes may require a redeploy, beacon/proxy upgrade, locator update or role reassignment.

Check bytecode size separately, especially VaultHub, because this image skips that check. Run compilation without the lint/interface skip flags for the final patch checks.

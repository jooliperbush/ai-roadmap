# BaseStonk on Arc — build-out plan

**Status:** proposal, written 9 September 2026. Arc public mainnet is dated 16 September 2026.
**Scope:** what changes when the BaseStonk launcher (Base, Robinhood Chain) is brought to Arc, what Arc makes possible that Base does not, what is missing on Arc at launch, and a phased plan with a first milestone inside the mainnet launch week.

Sources are listed at the end. Basestonk.io and docs.basestonk.io could not be fetched from the environment this was written in, so the BaseStonk mechanics below are taken from public descriptions of the product, not the live docs or the verified contracts. Treat every "BaseStonk today" statement as something to confirm against the real source before it becomes a design constraint.

---

## 0. The one-paragraph version

Arc is Circle's EVM L1 where USDC is the gas token, blocks land in well under a second, and Uniswap v4 (with hooks) is deployed on mainnet from day one. That is close to an ideal substrate for BaseStonk's core loop: one transaction creates a token, opens a v4 pool, and starts trading, with fees routed to holders as dividends. Three things change on Arc. First, USDC is both the native asset and an ERC-20 at a fixed address, with two different decimal views of the same balance, and this touches the launcher's "ends holding nothing" invariant, the pool currency choice, and every price calculation. Second, there are no tokenised equities on Arc at launch, so "dividends in stocks" cannot be the day-one headline; "dividends in dollars, euros and T-bills" can, and it is the more Arc-native story anyway. Third, the audience is different: Arc's validators are BlackRock, Visa, DTCC and Mastercard, Circle positions the chain as stablecoin finance rather than memecoins, and nodes run a mandatory denylist. A fair-launch, no-admin-key launcher whose tokens pay holders in USDC is one of the few launchpad designs that reads well to that audience. The recommendation is to ship a USDC-pair-only launcher against the canonical Arc PoolManager in the mainnet launch week, with dividends in USDC/EURC/USYC, and add the basket, gas sponsorship and equities as Arc's ecosystem fills in.

---

## 1. What BaseStonk is today (to be confirmed against the live docs)

| Property | BaseStonk on Base / Robinhood Chain |
|---|---|
| Launch | One transaction creates the token, initialises a Uniswap v4 pool and starts trading. |
| Fairness invariants | The launcher must end every launch holding nothing, or the transaction reverts. No admin key over any pool. Single-sided liquidity cannot pay out below the opening price. |
| Pairing | Against tokenised equities, USDC, or any Base ERC-20 (Clanker, Bankr and Virtuals tokens are routed and verified on-chain before deploy). |
| Hooks | Fully customisable v4 hooks per launch; creator fees. |
| Dividends | A percentage of trading volume, paid automatically in up to ten assets the creator chooses (stocks, ETFs, majors). The published example is 3% of $200k daily volume paying holders about $6,000 a day in the assets themselves. |
| Protocol token | $BSTONK: 50% auto-dividends, 50% buyback-and-burn. Launches can route a distribution to BSTONK holders ("the BSTONK Basket"). |
| Verification | Every contract is source-verified. |

The things worth carrying over unchanged are the invariants. They are the product. Everything else is a parameter.

---

## 2. What Arc is (facts as of 9 September 2026)

| Item | Value | Note |
|---|---|---|
| Mainnet | 16 September 2026, chain id **5042** (0x13b2) | Private mainnet is running now with 100+ builders. |
| Testnet | chain id **5042002**, `https://rpc.testnet.arc.network` (also `rpc.testnet.arc.io`), explorer `testnet.arcscan.app`, faucet `faucet.circle.com` | Public since 28 October 2025. Half a billion transactions by August 2026. |
| Execution | Reth-based, targets the Prague hard fork, standard JSON-RPC. EIP-7702 and ERC-4337 supported. | Foundry, Hardhat, viem all work unmodified. One deployer reported needing `--legacy` on testnet; verify EIP-1559 sends on current testnet. |
| Consensus | Malachite BFT, deterministic sub-second finality. | Treat one confirmation as final. Block time reported as ~500 ms by Uniswap's integration notes and ~2 s in other write-ups; measure it. |
| Gas token | **USDC**. Native balance and `msg.value` are 18-decimal "USDC-wei"; the ERC-20 interface is a predeploy at `0x3600000000000000000000000000000000000000` with 6 decimals. Same balance, two views, scale factor 1e12. **There is no wrapped USDC.** | This is the number-one integration risk called out by Uniswap's own Arc playbook. |
| Base fee | EIP-1559 with EWMA smoothing per the docs; observed as a constant 20 gwei (USDC-wei) across 1M+ blocks. | 250k gas ≈ $0.005. A 3M-gas launch ≈ $0.06. |
| Validators | Permissioned. Founding cohort: BlackRock, DTCC, Galaxy, Global Payments, ICE, Mastercard, MoneyGram, SBI, Standard Chartered, Sumitomo, Visa. | Contract deployment is permissionless. |
| Compliance surface | arc-node 0.8.0 makes denylist checks mandatory at the node. USDC itself carries Circle's blacklist. | A denylisted address cannot transact at all on Arc, since gas is USDC. |
| Native assets | USDC, EURC, USYC (Circle's tokenised T-bill fund). CCTP and Circle Gateway integrated. BlackRock BUIDL expected on Arc. DTCC tokenising DTC-custodied assets from H2 2027. | No tokenised equities (xStocks, Dinari, Backed, Ondo, Superstate) announced for Arc. |
| Privacy / FX | Opt-in confidential transfers; StableFX engine for USDC/EURC conversion. | FX is a real dividend feature (see 4.3). |

### 2.1 Uniswap on Arc (mainnet, from Uniswap's own playbook)

| Contract | Address |
|---|---|
| v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` (owner is a Safe proxy at `0x33f2…51e8`) |
| v4 Quoter | `0x8dc1…8f94` (full address in the Uniswap deployments page) |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43AC78BA3` (predeploy) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| v3 Factory | `0xf0db…3918` |
| SwapRouter02 | `0x53bf…6f77` |
| UniswapX Dutch V3 reactor | `0x0000000015134054eA82AE0bb9fda66b36402C36` |

Uniswap announced v4 AMM, pools, routing, SDK and API live with mainnet on 16 September, and explicitly "customizable v4 hooks". Testnet v4 addresses are not published anywhere findable; see 6.1 for what to do about that.

Uniswap's playbook notes, which apply directly to a launcher: reject the native sentinel `address(0)` as a currency and require `0x3600…0000` explicitly, because the 18/6 decimal mismatch will otherwise bite; there is no `WRAPPED_NATIVE_CURRENCY` entry for chain 5042.

### 2.2 Who else is building a launchpad on Arc

| Project | What it is | Relevance |
|---|---|---|
| ARCLaunch | "All-in-one memecoin platform": create, trade, bridge, unified balances, creator profiles, direct Uniswap launches, creator fees, referrals. Timed for mainnet week. | Direct competitor on the launch flow. No fairness invariants or dividends mentioned. |
| Radar DEX (ex-ArcDEXScan) | Token tracker plus a Uniswap v3-based launcher on Arc mainnet since July. | Weaker mechanics; strong on discovery. Worth being listed on. |
| Pools.Trade | Uniswap's own launchpad, live on Robinhood Chain. | Not announced for Arc, but Uniswap is on Arc, so assume it can arrive. |
| HookPad, Spark.fun | Hook-based modular launchpads on other chains. | Pattern references, possible Arc entrants. |

BaseStonk's edge against all of these is the same as on Base: the invariants and dividends in real assets. Nobody in that list is selling "your token pays you in dollars".

---

## 3. What has to change

### 3.1 Currency handling (the actual engineering work)

**Pool currency.** Every USDC-paired pool uses `Currency.wrap(0x3600…0000)`, never `CurrencyLibrary.ADDRESS_ZERO`. The launcher rejects `address(0)` as a pair currency at the top of `launch()`. Two reasons: the decimal mismatch Uniswap warns about, and liquidity fragmentation. If ARCLaunch or another launcher opens native-sentinel pools, the ERC-20 pools and the native pools are different pools for the same asset. Routers handle both, but hooks, dividends and analytics should live on one convention, and the ERC-20 one is the one Uniswap recommends.

**The "holds nothing" invariant.** On Base this is a loop over the ERC-20s touched plus a native ETH check. On Arc the native balance and the ERC-20 balance are the same balance, but the 6-decimal view rounds away anything below 1e12 USDC-wei. Check native in 18 decimals and every ERC-20 touched:

```solidity
// Sketch, not the real BaseStonk code.
function _assertHoldsNothing(Currency[] memory touched) internal view {
    if (address(this).balance != 0) revert LauncherRetainedValue(ARC_USDC, address(this).balance);
    for (uint256 i; i < touched.length; ++i) {
        address t = Currency.unwrap(touched[i]);
        if (t == address(0)) continue; // rejected earlier; belt and braces
        uint256 bal = IERC20(t).balanceOf(address(this));
        if (bal != 0) revert LauncherRetainedValue(t, bal);
    }
}
```

**Price maths.** Opening price and the single-sided range are computed against a 6-decimal quote asset. With an 18-decimal launch token and a 6-decimal USDC, `sqrtPriceX96` for "1 token = $0.0001" is a different number than against 18-decimal WETH. Make the launcher derive `sqrtPriceX96` from `(price, decimals0, decimals1)` and keep a unit test for the USDC case. Robinhood Chain launches against USDC already exercise this path; confirm rather than assume.

**Fee accounting in the hook.** If the dividend hook takes its cut in the pair currency via `poolManager.take(ARC_USDC, …)`, it receives 6-decimal ERC-20 units. Never mix that with `address(this).balance`. Store everything in 6-decimal units and convert only at the boundary if a native transfer is ever needed (it should not be).

**Front end.** The wagmi/viem chain definition for 5042 declares `nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }`, which is what wallets show. Every balance the app displays for trading should come from `balanceOf` on `0x3600…0000` (6 decimals), so the number a user sees in the app matches the number they see in the pool. Label the gas line "gas (USDC)".

### 3.2 Gas is cheap and denominated in dollars

This is a product change, not just a cost saving.

- **Launch cost is a fixed dollar amount.** ~3M gas ≈ $0.06. Quote it as "$0.06 to launch" in the UI. Nobody on Base can promise a number.
- **Dividend distribution can be pushed, not only pulled.** A claim is ~80k gas ≈ $0.002. A keeper distributing to the top 500 holders costs under a dollar. Keep the pull-based accumulator as the source of truth (it is safer and gas-neutral for the protocol), but add a keeper that sweeps claims for holders above a threshold so "auto-dividends" is literally true.
- **Gas sponsorship is native.** EIP-7702 and ERC-4337 are supported and the paymaster pays in USDC. A user who bridges 10 USDC can trade without ever seeing a "get gas" step. Phase 2.
- **Block time changes anti-snipe tuning.** Launch hooks that decay a high fee over the first N blocks assume 2-second blocks. On Arc, N blocks might be N/4 seconds. Tune by `block.timestamp`, not `block.number`.

### 3.3 The dividend basket without equities

BaseStonk's headline example is dividends in stocks and ETFs. At Arc mainnet there are none. Options, in order of preference:

1. **Ship "dollars, euros, T-bills".** USDC, EURC and USYC are native. A token whose holders receive T-bill yield exposure on every trade is a better fit for Arc's audience than a token that pays in NVDA, and it is unique to Arc. StableFX gives EUR dividends at institutional FX rates instead of a v4 hop through a thin EURC pool.
2. **Add BUIDL when it lands.** BlackRock's fund on Arc is expected; it is permissioned, so confirm transfer restrictions before promising it as a basket asset. Likely admin-allowlisted holders only, which would make it unsuitable for retail dividends. Do not promise it until confirmed.
3. **Equities when an issuer arrives.** Dinari (dShares, US-accessible since August 2026) and Backed are multi-chain; neither has announced Arc. Keep the basket interface asset-agnostic (any ERC-20 with a v4 route to USDC) so adding them is a config change.

The basket conversion path is: hook accrues USDC → keeper or claimant converts via v4 (or StableFX for EURC) → distributed per the creator's weights. Slippage and route limits per asset, with USDC as the fallback if a route is unavailable, so a dividend is never stuck behind a missing pool.

### 3.4 Pairing against "any Arc ERC-20"

Base has Clanker, Bankr and Virtuals as verified pair sources. Arc has none of those and no bridged WETH/WBTC at launch. Day one: **USDC only**, plus EURC and USYC as pairs if there is demand. Keep the routing-and-verification module but seed it with an empty allowlist and a governance path to add assets. This is also the cleanest compliance story: every pool on the platform is quoted in a Circle-issued asset.

### 3.5 Onboarding from Base

The existing user base is on Base. Bridging is CCTP v2 (burn on Base, mint native on Arc) and Circle Gateway (unified USDC balance across chains). Because the bridged USDC *is* gas, a user who bridges once is fully set up. Build the bridge step into the launch and trade flows rather than sending users to a third-party bridge. Gateway's unified balance means a Base user may be able to trade on Arc without an explicit bridge transaction at all; test this on testnet in Phase 0.

### 3.6 The protocol token

Bridging $BSTONK to Arc needs a general-purpose message bridge; CCTP only carries USDC, and no LayerZero/Wormhole-style deployment on Arc was findable. Three options:

| Option | Pro | Con |
|---|---|---|
| A. Protocol fees on Arc accrue to a USDC treasury; no token on Arc at launch | Zero token risk, nothing to explain to Circle-adjacent partners, fastest | Base BSTONK holders get nothing from Arc until a decision is made |
| B. Snapshot Base BSTONK holders and mint a mirrored balance on Arc | Rewards existing holders, no bridge dependency | Two supplies of one token; needs a burn-on-Base or a clear "these are different" story |
| C. Wait for a canonical bridge and use lock-and-mint | Clean, single supply | Timeline unknown |

Recommendation: A for launch week, with the treasury's fee share parameterised so it can be redirected to a token contract later without a migration. Decide B vs C once Arc's bridge landscape is visible, which will be weeks not months after mainnet.

### 3.7 Positioning and compliance

- Circle's public line is that Arc is "not a general-purpose L1 trying to compete through meme-coin activity". The product should not be marketed on Arc as a memecoin launchpad. "Launch a token that pays its holders in dollars" and "creator markets settled in USDC" are the same product with a different sentence.
- The node-level denylist and USDC blacklist mean a sanctioned address cannot interact with the protocol at all; the protocol needs no allowlist of its own. Document this in the terms rather than building anything.
- Read the Arc Terms of Use (Arc Network Services LLC, updated 15 May 2026) for any restriction on app types before mainnet deploy. Nothing found in public summaries suggests one, but the document was not readable from here.
- Fair-launch invariants are a compliance asset here. "The launcher cannot retain value and there is no admin key" is the sentence to lead with when institutional partners ask what this is.

---

## 4. Architecture on Arc

```
                          ┌──────────────────────────────┐
  creator ── launch() ──▶ │  StonkLauncher (Arc)         │
                          │  - rejects address(0) pair    │
                          │  - deploys fixed-supply token │
                          │  - mines hook address (CREATE2)
                          │  - initialize() pool on       │
                          │    canonical PoolManager      │
                          │  - mints single-sided range   │
                          │    ≥ opening price            │
                          │  - burns/locks LP position    │
                          │  - _assertHoldsNothing()      │
                          └──────────────┬───────────────┘
                                         │
             ┌───────────────────────────┼─────────────────────────────┐
             ▼                           ▼                             ▼
   ┌──────────────────┐        ┌───────────────────┐         ┌──────────────────┐
   │ LaunchToken      │        │ DividendHook       │         │ PoolManager      │
   │ ERC-20, no owner │◀──────▶│ afterSwap: take    │◀───────▶│ 0x8366…0951      │
   │ transfer → hook  │ notify │ fee in USDC(6d),   │  swaps  │ USDC = 0x3600…   │
   │ accumulator      │        │ split creator /    │         └──────────────────┘
   └──────────────────┘        │ holders / protocol │
                               │ / buyback          │
                               └─────────┬──────────┘
                                         │ USDC
                    ┌────────────────────┼─────────────────────┐
                    ▼                    ▼                     ▼
          ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
          │ BasketRouter     │  │ Treasury (USDC)  │  │ Keeper           │
          │ USDC→USYC/EURC   │  │ protocol share   │  │ sweeps claims,   │
          │ via v4 / StableFX│  │ (token-ready)    │  │ converts basket  │
          └──────────────────┘  └──────────────────┘  └──────────────────┘
```

### 4.1 Contracts

| Contract | Change from Base | Notes |
|---|---|---|
| `StonkLauncher` | Pair allowlist seeded with `0x3600…0000` (+ EURC, USYC). Reject `address(0)`. Native-balance check in the invariant. Price maths for 6-dec quote. | Deployed once, immutable, no owner beyond an allowlist governor with a timelock. |
| `LaunchToken` | None. | Fixed supply, no mint, no owner, no pause. Transfer hook updates the dividend accumulator. |
| `DividendHook` | Fee taken in 6-dec USDC. Anti-snipe decay by timestamp. Hook flags: `afterSwap` (fee), optionally `beforeSwap` (launch-window fee override) and `afterInitialize`. | One hook implementation, many pools, per-pool config keyed by `PoolId`. Address mined with the standard v4 flag mask; `HookMiner` from v4-periphery works on Arc unchanged. |
| `BasketRouter` | New. USDC → up to 10 assets by weight, v4 routes with per-asset slippage caps, StableFX adapter for EURC. Fallback to USDC. | Keep the asset list a config so equities are a change, not a redeploy. |
| `Treasury` | New, minimal. Receives the protocol share in USDC. Has a `setRecipient` behind a timelock so a future token contract can take over. | Option A from 3.6. |
| `Keeper` | New. Permissionless functions: `sweepClaims(pool, holders[])`, `convertBasket(pool)`. Incentive: small USDC tip from the batch. | Gas is ~$0.002/claim so anyone can run it. |

### 4.2 The afterSwap fee split (sketch)

```solidity
// Sketch. Real split values come from the launch config.
function _afterSwap(address, PoolKey calldata key, SwapParams calldata p, BalanceDelta d, bytes calldata)
    internal override returns (bytes4, int128)
{
    PoolConfig storage c = configs[key.toId()];
    // Fee always in the quote currency (USDC, 6 decimals on Arc).
    (Currency quote, int128 quoteDelta) = _quoteSide(key, d);
    uint256 volume = uint256(uint128(quoteDelta < 0 ? -quoteDelta : quoteDelta));
    uint256 bps = _currentFeeBps(c, block.timestamp);      // decays from launch-window fee to steady state
    uint256 fee = volume * bps / 10_000;
    poolManager.take(quote, address(this), fee);           // 6-dec units, never address(this).balance

    uint256 toHolders = fee * c.holdersBps / 10_000;
    uint256 toCreator = fee * c.creatorBps / 10_000;
    uint256 toProto   = fee - toHolders - toCreator;
    accumulator[key.toId()].add(toHolders);                // per-share accumulator, pull-based
    IERC20(Currency.unwrap(quote)).transfer(c.creator, toCreator);
    IERC20(Currency.unwrap(quote)).transfer(treasury, toProto);
    return (BaseHook.afterSwap.selector, int128(int256(fee)));
}
```

### 4.3 Where Arc gives something Base cannot

- **StableFX for EUR dividends.** Holders can choose EURC and get institutional FX rather than an AMM hop. Worth a line on the landing page.
- **USYC as a basket asset.** "Your token's trading volume buys you T-bills." No other launchpad venue has this natively.
- **A quoted launch price in dollars.** "$0.06 to launch, $0.005 per trade" is a marketing line and a UI element.
- **Sub-second finality.** Launch confirmation is instant; the "your pool is live" state can be shown from one receipt.
- **Gas sponsorship in USDC.** No "you need gas" moment for anyone who holds USDC anywhere Gateway reaches.

---

## 5. Front end and services

- **Chain config.** Add chain 5042 and 5042002 to the viem/wagmi config with the addresses in 2.1. Explorer links to Arcscan (mainnet URL pending; Blockscout at `arc-mainnet.cloud.blockscout.com` is a fallback).
- **Balances.** Read USDC via `balanceOf(0x3600…0000)` everywhere a trading balance is shown. Show the native balance only in a "gas" line.
- **Bridge-in step.** CCTP v2 Base→Arc inside the launch and trade flows. Test Gateway's unified balance on testnet first; if it lets a Base user trade on Arc without a bridge transaction, that becomes the default path.
- **Indexing.** The Graph lists Arc mainnet as supported. Reuse the existing subgraph with the PoolManager address swapped. The constant base fee makes "cost in USD" columns exact rather than estimated.
- **Discovery.** Get listed on Radar DEX at launch; it is the token tracker people on Arc already use.
- **Copy.** Replace every "stocks, ETFs" example with the assets actually available on Arc on that day. The one place to be careful: do not show an equity in a basket picker until an issuer is live on Arc.

---

## 6. Plan

### Phase 0 — testnet spike (this week, before 16 September)

Goal: the existing launcher running end-to-end on Arc testnet with the Arc-specific changes, so mainnet deploy on launch day is a config change.

1. Get the BaseStonk repo and its Robinhood Chain USDC-pair configuration; that is the closest existing path.
2. Foundry: add `arc_testnet` and `arc` RPC endpoints, chain ids 5042002 / 5042. Confirm EIP-1559 sends work on current testnet (one report used `--legacy`).
3. **Uniswap v4 on testnet (6.1).** Deploy your own `PoolManager` + `PositionManager` from v4-core/v4-periphery to Arc testnet if no canonical testnet deployment turns up. Same bytecode, same hook flag semantics; only the PoolManager address in the launcher config differs from mainnet.
4. Apply 3.1: reject `address(0)`, ERC-20 USDC as currency, native check in the invariant, 6-dec price maths, fee in 6-dec units.
5. Invariant/fuzz tests: launcher never retains value (18-dec native and every ERC-20); single-sided range never sells below opening price; hook fee split sums exactly; accumulator never over-distributes.
6. Measure block time and gas: launch, swap, claim, basket conversion. Put the real numbers in the UI copy.
7. Test CCTP v2 Base Sepolia → Arc testnet and Gateway in the app.

### Phase 1 — mainnet launch week (16 to 23 September)

Goal: first launches on Arc within the week Arc goes public, when attention on the chain is highest.

1. Deploy `StonkLauncher`, `DividendHook`, `BasketRouter` (USDC, EURC, USYC), `Treasury`, `Keeper` against the canonical PoolManager `0x8366…0951`. Verify all source on Arcscan.
2. Pair allowlist: USDC only on day one. EURC/USYC pairs behind a flag.
3. Basket: USDC, EURC (via StableFX if the adapter is ready, else v4), USYC.
4. Front end: chain switch, bridge-in, dollar-quoted costs.
5. Launch one house token to exercise everything, with the invariant transaction linked from the landing page.
6. Protocol fee share to the USDC treasury (option A).

### Phase 2 — first month

- Gas sponsorship: a 4337 paymaster paying USDC, so trading needs no gas step.
- Keeper network: permissionless `sweepClaims` with a tip; publish a runner.
- EURC via StableFX adapter if it was not ready for Phase 1.
- Anti-snipe hook variants tuned to measured block time.
- Token decision (3.6 B or C) once bridge options on Arc are visible.
- Listing and data: Radar DEX, DefiLlama adapter, subgraph on The Graph's Arc support.

### Phase 3 — as the ecosystem fills in

- BUIDL as a basket asset if its transfer restrictions allow retail holders (likely not; verify).
- Tokenised equities the day an issuer lands on Arc; the basket interface needs no change.
- Additional pair assets (bridged WETH/WBTC when a bridge exists) through the allowlist governor.
- Confidential transfers for dividend payouts if creators want private cap tables; Arc's opt-in privacy is the only chain where this is native.

### 6.1 The testnet Uniswap question

Uniswap's mainnet v4 addresses on Arc are public; testnet addresses are not. Two paths: ask Uniswap or the Arc builder community for the 5042002 deployment, or deploy v4-core yourself on testnet. The second path takes an afternoon and removes the dependency, and the hook address mining is identical either way because the flag bits live in the hook's own address, not the PoolManager's. Mainnet must use the canonical PoolManager, otherwise the pools are invisible to the Uniswap interface and routers.

---

## 7. Costs at 20 gwei USDC-wei

| Action | Gas (estimate) | USDC |
|---|---|---|
| Launch (token + hook config + pool init + mint + burn LP) | ~3,000,000 | ~$0.06 |
| Swap through hook | ~200,000 | ~$0.004 |
| Dividend claim | ~80,000 | ~$0.0016 |
| Keeper sweep, 500 holders | ~25,000,000 | ~$0.50 |
| Basket conversion, 3 assets | ~600,000 | ~$0.012 |

These are estimates from typical v4 hook gas profiles; replace them with Phase 0 measurements.

---

## 8. Risks and unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| Decimal mismatch between native (18) and ERC-20 (6) USDC | High | ERC-20 everywhere; reject `address(0)`; native check in the invariant; unit tests on price maths. |
| Uniswap v4 testnet deployment not findable | Medium | Deploy v4-core on testnet (6.1). |
| Block time discrepancy (~500 ms vs ~2 s) | Low | Measure; tune hooks by timestamp. |
| No tokenised equities on Arc | Medium (marketing) | Lead with USDC/EURC/USYC; asset-agnostic basket. |
| No general bridge for $BSTONK | Medium | Option A; treasury designed for later redirect. |
| Circle positioning against memecoin activity; node denylist | Medium (reputational) | Position as fair-launch creator markets in USDC; lead with invariants; read the Terms before deploy. |
| ARCLaunch and Radar DEX first-mover on Arc | Medium | Ship in launch week; compete on invariants and dividends, not on volume of launches. |
| Mainnet address for Arcscan and some Uniswap periphery contracts still pending | Low | Take from the Uniswap deployments page on launch day. |
| BaseStonk docs and contracts not reviewed for this plan | High (for this document) | First task in Phase 0 is reading the real code and correcting section 1 and 3. |

---

## 9. Decisions needed from you

1. Do you want the Arc deployment to share the BaseStonk brand and front end, or launch under an Arc-specific name? The plan assumes the same brand with a chain switch.
2. Protocol token: option A (USDC treasury, decide later) is the recommendation. Confirm or pick B/C.
3. Access to the BaseStonk contract repo, so Phase 0 starts from the real code rather than the sketches here.
4. Whether to pursue a Circle/Arc builder relationship before launch week; the founding-partner narrative is worth a conversation, and the fair-launch invariants are the pitch.

---

## Sources

Arc chain, fees and USDC interface
- Arc mainnet date, testnet stats, private mainnet: arc.io/blog "Arc mainnet goes live on September 16, 2026"
- USDC dual interface, `0x3600…0000`, 18/6 decimals: arc.io/blog "Building with USDC on Arc: one token, two interfaces"; "USDC for Every Action on Arc"
- Reth/Prague, EWMA fee smoothing, 7702/4337: chainstack.com/what-is-arc; docs.arc.io "Fees", "EVM differences", "Gas and fees"
- Testnet chain id, RPC, explorer, faucet, `--legacy` deploy note: github.com/kenhuangus/arc-ai-agents ARC_TESTNET_DEPLOYMENT_COMPLETE.md; trustswap.com/arc/testnet-guide
- Mainnet chain id 5042, Blockscout explorer: arc-scan.io/developers; thegraph.com/docs/en/supported-networks/arc
- Founding validators and integrations (BlackRock BUIDL, DTCC 2027): circle.com pressroom, 4 September 2026
- Validator permissioning, privacy, StableFX: everstake.one, coinbureau.com, eco.com write-ups on Arc
- Mandatory denylist in arc-node 0.8.0: github.com/circlefin/arc-node BREAKING_CHANGES.md
- Native assets USDC/EURC/USYC, CCTP, Gateway: docs.arc.io "Contract addresses"; kucoin.com "Arc Blockchain and USDC"
- Circle's "not competing through meme-coin activity" positioning: coinbureau.com "What is Circle Arc"
- Arc Terms of Use: docs.arc.io/terms (not readable from this environment)

Uniswap on Arc
- All mainnet addresses, constant 20 gwei basefee, ~500 ms blocks, native-sentinel rejection, no wrapped native: github.com/Uniswap/UniswapX playbook/chains/arc.md
- v4 with hooks live at mainnet: cryptobriefing.com "Uniswap expands liquidity layer to Arc network"; cryptotimes.io, 18 August 2026

BaseStonk
- Product description, invariants, dividends example, BSTONK tokenomics, Basket: basestonk.io, docs.basestonk.io and x.com/BaseStonk as quoted in search results (sites not fetchable from this environment)
- Robinhood Chain and Uniswap v4 tokenised-stock context: blog.uniswap.org "Uniswap is live on Robinhood Chain"; bankless.com on Pools.Trade

Competitors on Arc
- ARCLaunch: openpr.com and captainaltcoin.com press coverage, 13 August 2026
- Radar DEX: weex.com "Overview of Arc ecosystem projects"

Tokenised equities landscape
- Dinari dShares chains, Backed, Ondo, Superstate: coindesk.com 4 August 2026; eco.com "Tokenized equities 2026"

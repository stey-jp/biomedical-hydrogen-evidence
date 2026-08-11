# Architecture

## Goal

通常のWeb・REST・MCP requestを、保存済みの構造化Evidenceだけで低コストに処理します。query-time AIはありません。

```text
Cloudflare Worker
├─ Static Assets (asset-first)
│  ├─ index.html + search.js
│  ├─ study.html + study.js
│  └─ review.html + review.js (private login)
├─ /api/v1/* ─┐
├─ /mcp ──────┼─ Study service ─ Repository ─ D1
├─ /healthz ──┘
└─ /api/review/v1/* ─┬─ Review repository ── D1 audit events + reviewer bookmarks + title translation cache
                     └─ DeepL API Free + Europe PMC abstract lookup

iOS / Android ── HTTPS GET ──► first-party REST API
```

Web、REST、MCPは`searchStudies()`、`getStudy()`、`getEvidence()`を共有し、MCPからRESTへ自己HTTP接続しません。

Phase 2の候補収集は公開request pathから分離します。

```text
versioned discovery protocol
        │ explicit local command
        ▼
PubMed / Europe PMC / Crossref
        │ normalize + identity deduplicate + quality gate
        ▼
generated review manifest + D1 import SQL
        │ explicit reviewed import
        ▼
study_candidates (not public search) ── human screening ──► studies
```

Phase 3〜4とfield verificationは同じ公開request boundaryの外側です。Phase 5のcandidate screeningだけは、管理トークンで保護したsame-origin routeから実行できます。管理画面の翻訳routeも同じ認証・same-origin・rate limit境界内に置き、DeepL Secretをブラウザへ渡しません。タイトル訳だけを原文hash付きでD1へcacheし、Europe PMC要旨と要旨訳は永続化しません。

```text
authorized local source bundle
        │ plan hash + explicit budget approval
        ▼
OpenAI / Anthropic / Gemini (independent structured extraction)
        │ schema validation + exact snippet check
        ▼
model results + consensus + Evidence checks
        │ field-level human review
        ▼
D1 structured Evidence + immutable review history
```

## Request flow

1. Static filesはWorker application codeを通さず配信する。
2. API/MCP requestは独立したRate Limiting adapterを通る。
3. Routeが入力を検証し、shared serviceへ渡す。
4. Serviceがalias normalizationとAPI representationへのmappingを行う。
5. RepositoryがD1 prepared statementsだけを実行する。
6. Cache-ControlとETagを付け、短時間の再利用を許可する。

## D1 model

Bibliography、classification、population、interventions、outcomes、safety、transparency、provenance、extractions、consensus、verificationを分離します。過度な正規化は避けつつ、複数intervention/outcome、field-level provenance、モデルごとの独立抽出を表現します。discovery run、query、未確認candidate、source recordは公開研究modelから分離し、候補投入だけで検索結果へ混入しない構造です。Extraction run/source hash/provider call/Evidence check/consensus historyと、candidate/field/study review eventを追記可能な別tableで監査します。

検索用FTS5 documentはcontrolled ingestion時にmaterializeします。query-timeに複数tableを連結して全文検索documentを再構築しません。日本語の主要専門語は明示的なaliasでcanonical English termへ変換します。

## Query efficiency

- cursor pagination、API max 20、MCP max 10
- `limit + 1`だけ取得し、count queryを省略
- public ID/DOI/PMID/PMCIDのunique index
- species/design、route、condition、year、verificationのindex
- FTS5 virtual table
- study detailの関連collectionはD1 `batch()`でまとめる
- 明示列のみ取得し、`SELECT *`を使用しない

`scripts/query-plans.sql`で主要pathを検査します。FTS5のvirtual table scan表記はFTS index queryを意味し、通常tableの無条件full scanとは区別して確認します。

## Remote MCP

MCP SDK v2の`McpServer` factoryをrequestごとに作り、Cloudflare Agents SDKの`createMcpHandler()`へ渡します。`legacy: "reject"`で旧transportを受け付けず、Streamable HTTPだけを使用します。Durable Objects、session state、SSE、write tool、AI provider callはありません。CORS middlewareは`corsOptions: false`とし、wildcard CORSを付与しません。

## Rate limiting

`API_RATE_LIMITER`と`MCP_RATE_LIMITER`は別namespaceです。binding固有の処理はadapterへ隔離し、local/testでbindingがなければallow fallbackにします。本番bindingはCloudflare location単位のeventually consistentなabuse controlで、厳密な課金meterではありません。

## AI extraction boundary

Phase 1の無通信stubに加え、実provider adapterは明示的なmanaged commandからのみ呼び出します。planとsource/configをSHA-256で固定し、exact hash approval、request/document/provider上限、全credentialsの事前確認を通します。各providerは他の出力を受け取りません。D1には構造化field、model/prompt/schema version、token count、provenance、短いsnippet、check/historyを保存し、source本文やraw responseは保存しません。

Machine consensusは`machine_extracted`、`machine_checked`、`needs_human_review`までしか進めません。既存の`human_verified`と`disputed`はmachine importで上書きしません。

## Security

一般公開APIはread-only、same-origin Webと公式native clients向けです。本番のHTML/API HTTP requestはHTTPSへ恒久redirectし、HTMLにはHSTS、CSP、frame/referrer/permission制限を付与します。非公開review routeは別Rate Limiting binding、32文字以上のCloudflare Secret、30日で失効するHMAC署名済み`Secure` / `HttpOnly` / `SameSite=Strict` Cookie、same-origin write検査で保護します。SQL parameter binding、入力長、enum、年範囲、limit、cursor、public IDを検証します。candidate screeningは公開studyへの昇格を行わず、candidate snapshot hashと変更前statusをimmutable eventへ記録します。reviewer identifierはD1の非公開監査履歴と認証済みexportだけに保持し、一般公開APIへ返しません。native clientsもHTTPS GETだけを使用します。Provider secretと`DEEPL_API_KEY`はCloudflare Secretsまたはlocal `.dev.vars`を使い、Git・D1・ブラウザへ保存しません。

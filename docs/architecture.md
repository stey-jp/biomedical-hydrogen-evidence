# Architecture

## Goal

通常のWeb・REST・MCP requestを、保存済みの構造化Evidenceだけで低コストに処理します。query-time AIはありません。

```text
Cloudflare Worker
├─ Static Assets (asset-first)
│  ├─ index.html + search.js
│  └─ study.html + study.js
├─ /api/v1/* ─┐
├─ /mcp ──────┼─ Study service ─ Repository ─ D1
└─ /healthz ──┘
```

Web、REST、MCPは`searchStudies()`、`getStudy()`、`getEvidence()`を共有し、MCPからRESTへ自己HTTP接続しません。

## Request flow

1. Static filesはWorker application codeを通さず配信する。
2. API/MCP requestは独立したRate Limiting adapterを通る。
3. Routeが入力を検証し、shared serviceへ渡す。
4. Serviceがalias normalizationとAPI representationへのmappingを行う。
5. RepositoryがD1 prepared statementsだけを実行する。
6. Cache-ControlとETagを付け、短時間の再利用を許可する。

## D1 model

Bibliography、classification、population、interventions、outcomes、safety、transparency、provenance、extractions、consensus、verificationを分離します。過度な正規化は避けつつ、複数intervention/outcome、field-level provenance、モデルごとの独立抽出を表現します。

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

Phase 1のproviderは無通信stubです。将来の実providerは明示的な管理batch commandからのみ呼び出し、公開Worker routesへ接続しません。D1には構造化field、model/prompt/schema version、confidence、provenanceを保存し、巨大なraw responseは保存しません。

## Security

APIはread-only、same-origin前提です。SQL parameter binding、入力長、enum、年範囲、limit、cursor、public IDを検証します。secretはCloudflare Secretsまたはlocal `.dev.vars`を使い、Gitへcommitしません。


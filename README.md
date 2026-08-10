# Biomedical Hydrogen Evidence

Open, structured and verifiable evidence for biomedical research on molecular hydrogen (H₂).

## Overview

Biomedical Hydrogen Evidenceは、分子状水素に関する生物医学研究を、構造化・検証可能・追跡可能な形で公開するためのオープンなエビデンス基盤です。Phase 1では、Cloudflare Workers、Static Assets、D1、ステートレスRemote MCPを使った軽量な基盤を提供します。

- Official Web: https://biomedical-hydrogen-evidence.flat-voice-876d.workers.dev
- Remote MCP: https://biomedical-hydrogen-evidence.flat-voice-876d.workers.dev/mcp

## Purpose

目的は、収録研究、データ構造、抽出方法、判定ルール、根拠、検証状態、修正履歴、ソースコードをGitHub上で監査・再現・訂正できるようにすることです。将来2,000報以上の研究を扱える構造を、無料枠で運用しやすい形で整えます。

## Scope

対象は分子状水素（H₂）のhuman clinical studies、RCT、非ランダム化臨床研究、観察研究、症例報告、animal studies、in-vitro studies、systematic reviews、meta-analyses、other reviewsです。

## What this project is NOT

水素製品の販売サイト、特定の商品・メーカー・治療法の推奨、AIチャット、医療助言、hydrogen energy・green hydrogen・fuel cells・産業用水素のデータベースではありません。また、REST APIを一般開発者向けプラットフォームとして提供することを主目的にしていません。

「研究報告が存在すること」と「医学的効果が確立していること」は異なります。

## Transparency and auditability

各構造化フィールドは、可能な限り次を追跡します。

- 値の意味と元表記
- 原文の短い根拠と位置
- 抽出provider、model、prompt/schema version
- モデル間の一致状態
- 人による確認状態
- Gitによる修正履歴

AI生成文章そのものはEvidenceとして扱いません。

## Architecture

```text
Web / first-party REST API / public Remote MCP
                         │
                  shared study service
                         │
               prepared SQL repository
                         │
                    Cloudflare D1
```

静的HTML/CSS/JavaScriptはWorkers Static Assetsがasset-firstで配信します。`/api/v1/*`、`/mcp`、`/healthz`のみWorker codeを先に実行します。詳細は[docs/architecture.md](docs/architecture.md)を参照してください。

## Evidence model

Study、authors、classification、population、複数interventions、複数outcomes、safety、research transparencyを分離しています。数値は元の値・単位を失わず、必要な場合だけ正規化値・単位を併記します。研究全体を単純なpositive/negativeには分類しません。

## Provenance

`evidence_provenance`はfield単位でsource document/type、section、page/locator、検証に必要な短いsnippet、license、rights statusを保存します。論文PDF、出版社全文、長いLLM responseは保存しません。

## AI-assisted extraction

Phase 1はprovider interface、無通信stub、数値normalization、field-level consensus、verification ruleのみを実装します。外部AI API keyは不要です。将来の抽出も管理された手動batchまたは明示commandからのみ起動する設計とし、公開HTTP requestから開始しません。

## Multi-model comparison

各providerは他providerの結果を見ずに独立抽出する前提です。Consensusは同一fieldの正規化値を比較します。多数決や全会一致は正確性の保証ではなく、原文Evidenceと人の確認が優先されます。

## Human verification

状態は`unverified`、`machine_extracted`、`machine_checked`、`needs_human_review`、`human_verified`、`disputed`です。モデル一致だけで`human_verified`にはなりません。

## Search

検索時はD1の通常index、FTS5、明示的な英語・日本語alias normalizationだけを使います。embeddings、Vectorize、外部検索、LLM query rewritingはありません。cursor paginationで読み出し件数を制限します。

## Web

モバイル優先のHTML、Vanilla CSS、最小限のVanilla JavaScriptです。`/`で検索し、`/study?id={publicId}`で研究対象、デザイン、水素条件、outcomes、safety、funding/COI、provenance、verificationを確認できます。

同梱データはすべてsynthetic fixture / test onlyです。実在研究として表示せず、偽DOI・PMID・PMCIDを作成していません。

## MCP

`/mcp`はMCP SDK v2とCloudflare Agents SDKの`createMcpHandler()`を使う、read-only・stateless・Streamable HTTP endpointです。`McpAgent`、Durable Objects、旧SSE transport、自作protocolは使用しません。

Tools:

- `search_biomedical_hydrogen_evidence`（default 5、max 10）
- `get_biomedical_hydrogen_study`

MCP serverはD1の保存済みEvidenceを返すだけです。回答を生成するAIはMCP client側にあり、本serverはLLMを実行しません。

## First-party API

公式Webと将来の公式native clients向けのread-only APIです。D1の内部IDを公開せず、stable public IDと明示的なAPI representationを使います。wildcard CORS、write endpoint、認証システム、SDKはPhase 1にありません。

- `GET /api/v1/search`
- `GET /api/v1/studies`
- `GET /api/v1/studies/{publicId}`
- `GET /api/v1/studies/{publicId}/evidence`
- `GET /api/v1/meta/filters`
- `GET /healthz`

Schemaは[docs/openapi.yaml](docs/openapi.yaml)を参照してください。

## AI cost model

Web検索、REST API、MCP、研究詳細の通常利用では、OpenAI、Anthropic、Gemini、Workers AI、その他LLM APIを呼びません。つまり`query-time AI = 0`です。Phase 1にCron、Queues、Workflows、公開extraction endpointはありません。

## Data sources

Phase 1はsynthetic fixtureのみです。Phase 2でPubMed、Europe PMC、Crossref等から対象母集団を再現可能な方法で構築します。各sourceの利用条件とrights statusを記録します。

## Copyright

論文PDF、有料全文、出版社全文はGitHubやD1へ保存しません。Abstractも無条件に再配布可能とは仮定しません。Open Accessと自由な再配布を区別し、根拠snippetは検証に必要な短い範囲に限定します。

## Licensing

Project-owned codeは既存のApache License 2.0を維持します。第三者データにコードのlicenseを一律適用しません。区分ごとの扱いは[DATA_LICENSING.md](DATA_LICENSING.md)を参照してください。

## Development

前提はNode.js 20以上です。Node.jsは開発ツールの実行にのみ使い、本番runtimeはCloudflare Workersです。

```sh
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

`http://localhost:8787/`を開きます。local seedを再投入する場合は、重複を避けるためWranglerのlocal D1 stateを作り直してからmigrationとseedを順に実行してください。

Dependenciesは次の3つだけです。

- `agents`: Cloudflare公式のstateless MCP handler
- `@modelcontextprotocol/server`: MCP SDK v2 server（protocolを自作しないため）
- `zod`: MCP tool input schema（Agents SDKの推奨peer dependency）

`wrangler`はlocal D1、Worker development、deploy用のdev dependencyです。frontend runtime dependencyはありません。

## Testing

外部AI API keyなしで実行できます。

```sh
npm run check
npm run db:migrate:local
npm run db:seed:local
npm run db:plans:local
```

主要queryの`EXPLAIN QUERY PLAN`は`public_id`、PMID、DOI、species/design、administration route、year range、verified、condition、FTS keywordを確認します。

MCPはWorker起動後、InspectorでStreamable HTTP URL `http://localhost:8787/mcp`へ接続します。

```sh
npx @modelcontextprotocol/inspector@latest
```

## Rate limiting

Workers Rate Limiting bindingsを検索ロジックから分離しています。既定値はAPIが120 requests/minute、MCPが60 requests/minute（各Cloudflare location・key単位）です。超過時は`429`と`Retry-After: 60`を返します。bindingを再現できないtest/local環境ではadapterがallow fallbackになり、adapter自体をunit testします。

## Deployment

自動deployは設定していません。公式Cloudflare accountのD1は`wrangler.jsonc`へ設定済みです。

```sh
npx wrangler login
npx wrangler d1 migrations apply biomedical-hydrogen-evidence --remote
npm run deploy
```

Phase 1の公式deploymentには検索・詳細・MCPを検証するsynthetic fixtureだけを投入し、実在研究ではないことを全画面で明示します。別のCloudflare accountへ展開する場合だけD1を新規作成して`database_id`を更新し、Rate Limitingの`namespace_id`もaccount内で重複しない値に調整してください。

## Contributing

研究データの訂正は、Issueで根拠を提示し、review後にPull Requestで反映します。participant count、RCT分類、H₂濃度、outcome、DOI等の訂正履歴をGitで追跡します。詳細は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。

## Roadmap

- Phase 2: PubMed / Europe PMC / Crossref等から再現可能な研究母集団を構築
- Phase 3: OpenAI / Anthropic / Gemini等による独立した管理batch extraction
- Phase 4: Multi-model consensusと原文Evidence照合
- Phase 5: Human verification workflow
- Phase 6: 必要に応じて公式iOS / Android apps

## Disclaimer

本プロジェクトは研究情報の整理・検証支援を目的とし、診断、治療、予防、医療助言を提供しません。収録・未収録、分類、抽出、翻訳、検証には誤りがあり得ます。医学的判断には原論文と適切な医療専門家を確認してください。

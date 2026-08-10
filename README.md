# Biomedical Hydrogen Evidence

Open, structured and verifiable evidence for biomedical research on molecular hydrogen (H₂).

## Overview

Biomedical Hydrogen Evidenceは、分子状水素に関する生物医学研究を、構造化・検証可能・追跡可能な形で公開するためのオープンなエビデンス基盤です。Cloudflare上の公開基盤、再現可能な研究候補収集、3-provider独立Extraction、Evidence照合、human review workflow、公式iOS / Android read-only clientsを実装しています。

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
Web / first-party REST API / public Remote MCP / native clients
                                │
                         shared study service
                                │
                      prepared SQL repository
                                │
                           Cloudflare D1

offline managed commands: discovery → extraction → human review
```

静的HTML/CSS/JavaScriptはWorkers Static Assetsがasset-firstで配信します。`/api/v1/*`、`/mcp`、`/healthz`のみWorker codeを先に実行します。Discovery、Extraction、reviewは公開request pathから分離した明示commandです。詳細は[docs/architecture.md](docs/architecture.md)を参照してください。

## Evidence model

Study、authors、classification、population、複数interventions、複数outcomes、safety、research transparencyを分離しています。数値は元の値・単位を失わず、必要な場合だけ正規化値・単位を併記します。研究全体を単純なpositive/negativeには分類しません。

## Provenance

`evidence_provenance`はfield単位でsource document/type、section、page/locator、検証に必要な短いsnippet、license、rights statusを保存します。論文PDF、出版社全文、長いLLM responseは保存しません。

## AI-assisted extraction

OpenAI、Anthropic、Geminiのcurrent structured-output API adapterと、hashで承認するmanaged commandを実装しています。providerは他providerの出力を見ず、source documentを独立抽出します。budgetと全credentialsをprovider call前にpreflightし、公開HTTP requestからは開始できません。入力権利、plan、費用をmaintainerが明示承認した場合だけ実providerを呼びます。詳細は[docs/extraction-workflow.md](docs/extraction-workflow.md)を参照してください。

## Multi-model comparison

Consensusは同一fieldの正規化値を比較します。各providerの短いsnippetが入力sourceへ完全一致するか、locatorがあるかも別に記録します。多数決や全会一致、snippet一致は正確性の保証ではなく、原文Evidenceと人の確認が優先されます。

## Human verification

状態は`unverified`、`machine_extracted`、`machine_checked`、`needs_human_review`、`human_verified`、`disputed`です。候補screeningとfield reviewをCSVで行い、reviewer、理由、artifact hash、immutable eventをD1へ残します。モデル一致だけで`human_verified`にはなりません。手順は[docs/human-review.md](docs/human-review.md)を参照してください。

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

公開`studies`の同梱データはsynthetic fixtureだけです。Phase 2ではversion管理した検索式でPubMed、Europe PMC、Crossrefから書誌候補を取得し、DOI・PMID・PMCIDを使ってdeduplicateします。2026-08-10の管理runでは4,000 raw recordsから3,672 candidatesを構築し、本番D1の非公開candidate tableへ隔離しました。これは2,000件超の候補母集団であり、2,000件の収録済み・検証済み研究という意味ではありません。source、query、取得時刻、利用条件、rights statusを追跡します。詳細は[docs/discovery-protocol.md](docs/discovery-protocol.md)を参照してください。

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

研究候補を少量取得してlocal D1で確認する場合は、運用連絡先を環境変数で渡します。これは公開HTTP routeからは実行されません。

```powershell
$env:DISCOVERY_CONTACT_EMAIL = "maintainer@example.org"
npm run discovery:collect -- --max-results=25
```

Extractionはplan作成とexact hash承認を分離します。次は通信しないsynthetic dry runです。

```powershell
npm run extraction:dry-run
```

候補・field review commandと公式mobile clientのbuild方法は[human review手順](docs/human-review.md)と[mobile client手順](docs/mobile-clients.md)を参照してください。

Dependenciesは次の3つだけです。

- `agents`: Cloudflare公式のstateless MCP handler
- `@modelcontextprotocol/server`: MCP SDK v2 server（protocolを自作しないため）
- `zod`: MCP tool input schema（Agents SDKの推奨peer dependency）

`wrangler`はlocal D1、Worker development、deploy用のdev dependencyです。frontend runtime dependencyはありません。

## Testing

外部AI API keyなしで実行できます。

```sh
npm run check
npm run check:worker-boundary
npm run db:migrate:local
npm run db:seed:local
npm run extraction:dry-run
npm run db:plans:local
```

主要queryの`EXPLAIN QUERY PLAN`は`public_id`、PMID、DOI、species/design、administration route、year range、verified、condition、FTS keywordに加え、candidate、extraction run/provider call/Evidence check、human review event lookupを確認します。CIはこれらに加え、zero-network extraction SQL import、Android lint/APK build、iOS simulator buildを実行します。

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

公開`studies`には検索・詳細・MCPを検証するsynthetic fixtureだけを投入し、実在研究ではないことを全画面で明示します。実在書誌候補は非公開candidate tableに隔離します。managed extraction / review SQLは内容をreviewした後だけ別途適用します。別のCloudflare accountへ展開する場合だけD1を新規作成して`database_id`を更新し、Rate Limitingの`namespace_id`もaccount内で重複しない値に調整してください。

## Contributing

研究データの訂正は、Issueで根拠を提示し、review後にPull Requestで反映します。participant count、RCT分類、H₂濃度、outcome、DOI等の訂正履歴をGitで追跡します。詳細は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。

## Roadmap

- Phase 1: Cloudflare/D1/Web/API/MCP公開基盤（実装・本番deploy済み）
- Phase 2: PubMed / Europe PMC / Crossrefによる2,000件超の候補母集団（実装・本番D1隔離投入済み）
- Phase 3: OpenAI / Anthropic / Gemini独立managed Extraction（実装済み）
- Phase 4: Multi-model consensusと原文Evidence照合（実装済み）
- Phase 5: Human verification workflow（実装済み、実候補のreviewは継続運用）
- Phase 6: 公式iOS / Android read-only apps（実装済み）

実装と継続運用の境界は[Phase completion matrix](docs/completion-matrix.md)を参照してください。

## Disclaimer

本プロジェクトは研究情報の整理・検証支援を目的とし、診断、治療、予防、医療助言を提供しません。収録・未収録、分類、抽出、翻訳、検証には誤りがあり得ます。医学的判断には原論文と適切な医療専門家を確認してください。

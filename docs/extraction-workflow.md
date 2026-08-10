# Managed extraction workflow

## Boundary

Phase 3のExtractionは、maintainerが明示的に実行するoffline batchです。公開Web、REST API、MCP、Cloudflare Workerからは起動できません。通常利用の`query-time AI = 0`は維持されます。

OpenAI、Anthropic、Geminiは同じsource documentを互いの出力を見ずに独立して処理します。各値は短い原文snippetを必須とし、モデル一致は正しさやhuman verificationを意味しません。

実装時に参照したprovider仕様:

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Batch API](https://developers.openai.com/api/docs/guides/batch)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output?lang=rest)
- [Gemini Interactions API](https://ai.google.dev/api/interactions-api)

現在のorchestratorは監査しやすい逐次実行です。provider側のasync Batch APIへ移行する場合も、同じplan hash、独立性、schema、budget gate、provenance要件を維持します。

## Source bundle

入力はlocal JSONです。schemaは[`fixtures/extraction-source-bundle.synthetic.json`](../fixtures/extraction-source-bundle.synthetic.json)を参照してください。各documentには既存の`BHE-*` public ID、source/section、license、rights status、source textを指定します。

`providerProcessingAuthorized`は、権利・契約・倫理面を確認して外部providerへ送信できる場合だけ`true`にします。PDFや全文をrepositoryまたはD1へ保存せず、入力bundleも`.generated/`等のGit対象外に置きます。`unknown`や`restricted`は送信許可を意味しません。

## Plan and explicit approval

まず課金を発生させないplanを作ります。

```powershell
npm run extraction:plan -- --input=.generated/sources/bundle.json
```

planにはprovider/model、最大request数、token上限、document metadata、source/config hash、exact approval hashが入りますが、source本文は入りません。内容と見積上限をreviewした後だけ、全provider keyを環境変数で渡してexact hashを承認します。

```powershell
$env:OPENAI_API_KEY = "..."
$env:ANTHROPIC_API_KEY = "..."
$env:GEMINI_API_KEY = "..."
npm run extraction:run -- --plan=.generated/extraction/EXTR-....plan.json --approve-plan=<exact-plan-sha256>
```

実行前に全credentialsをpreflightするため、一部providerだけを誤って先行実行しません。source/config/planが計画後に変わった場合は停止します。既定上限は25 documents、3 providers、75 requests、1 document 50,000 characters、1 request 6,000 output tokensです。

## Structured result and Evidence check

provider responseは厳格なJSON SchemaとZodで検証します。許可field以外、重複field、500 charactersを超えるsnippet、型違反を拒否します。snippetはlocal source textとの完全一致を機械確認し、locatorの有無と合わせて`source_aligned`または`needs_human_review`にします。

生成SQLは次だけを保存します。

- run、plan/source hash、provider/model、token count、request fingerprint/status
- field値、短いsnippet、locator、rights metadata
- model別抽出、field consensus、Evidence check、履歴

source本文、raw provider response、API keyは保存しません。machine処理は既存の`human_verified`または`disputed`を上書きしません。

## Import

resultとSQLをreviewし、まずlocal D1で確認します。

```powershell
npx wrangler d1 execute biomedical-hydrogen-evidence --local --file=.generated/extraction/EXTR-....sql
npx wrangler d1 execute biomedical-hydrogen-evidence --local --command="PRAGMA foreign_key_check"
```

本番へ反映する場合だけ`--remote`へ変更します。対象studyは先に公開`studies`へ存在している必要があります。

## Zero-network dry run

CIとlocal検証ではproject-created synthetic fixtureとinjected responseだけを使用します。provider network callもAPI keyも不要です。

```powershell
npm run extraction:dry-run
npx wrangler d1 execute biomedical-hydrogen-evidence --local --file=.generated/extraction/synthetic-dry-run.sql
```

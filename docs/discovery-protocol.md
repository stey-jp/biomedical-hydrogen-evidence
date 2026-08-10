# Discovery protocol

## Purpose and boundary

Phase 2のdiscoveryは、PubMed、Europe PMC、Crossrefから分子状水素研究の候補母集団を再現可能に構築する管理バッチです。候補であることは収録・医学的有効性・検証済みを意味しません。人がscopeと書誌情報を確認するまで、公開`studies`とは別の`study_candidates`に保存します。

公開Web、REST API、MCPからこの処理は起動できません。query-time AIも使用しません。

## Versioned sources and queries

検索式、endpoint、scopeは[`config/discovery.v1.json`](../config/discovery.v1.json)でversion管理します。

| Source | Endpoint / method | Collection policy |
| --- | --- | --- |
| PubMed | NCBI E-utilities `ESearch` + `ESummary` | `tool`と連絡先emailを送信。API keyなしでは約3 requests/second以下、ありでは約10 requests/second以下に制御 |
| Europe PMC | REST `search`, JSON `lite` | `cursorMark`でpagingし、1 request最大1,000件 |
| Crossref | versioned REST `/v1/works` | `mailto`を送るpolite request。journal article metadataだけを候補化 |

参照した公式仕様:

- [NCBI E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [Europe PMC RESTful Web Service](https://dev.europepmc.org/RestfulWebService)
- [Crossref REST API etiquette](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)
- [Crossref API versioning](https://www.crossref.org/documentation/retrieve-metadata/api-versioning/)

検索式は感度を優先した候補生成用です。特にCrossrefのbibliographic queryは結果総数が広いため、ranked resultを上限付きで取得し、人によるscope screeningを必須とします。

## Run

Node.js 20以上で、運用連絡先を環境変数から渡します。emailと`NCBI_API_KEY`は生成manifest、SQL、consoleへ保存しません。

```powershell
$env:DISCOVERY_CONTACT_EMAIL = "maintainer@example.org"
$env:NCBI_API_KEY = "optional"
npm run discovery:collect -- --max-results=25
```

主なoption:

- `--sources=pubmed,europepmc,crossref`
- `--max-results=25`: queryごとの上限、1〜10,000
- `--protocol=config/discovery.v1.json`
- `--output-dir=.generated/discovery`

`.generated/`はGit対象外です。各runは次を生成します。

- `{runId}.json`: protocol version、実行時刻、完全な検索式、連絡先を除いたrequest URL、件数、候補metadata、品質プロファイル
- `{runId}.sql`: D1へ明示的にreview後に投入するSQL

Abstract、全文、PDF、raw API responseは保存しません。

## Identity and screening

候補のgrainは「リンクしたDOI、PMID、PMCID、または識別子がない場合のnormalized title + yearごとに1件」です。DOI、PMID、PMCIDを正規化し、複数識別子を橋渡しするrecordも同一候補へ統合します。強い識別子がない場合だけtitle-year fallbackを使います。

タイトルによる`screening_hint`は優先順位付けであり、自動採否ではありません。

- `likely_biomedical`: タイトルに分子状水素介入を示すphraseがある
- `likely_non_biomedical`: fuel cell、green hydrogen、production、storage等の除外signalがある
- `needs_review`: タイトルだけでは判定できない

全候補の`review_status`初期値は`pending`です。`study_candidates`から公開`studies`への昇格はこの収集commandの責務外です。

## Automated quality gate

manifestは次をcountとrateの両方で記録します。

- raw record数、候補数、deduplication rate
- source別件数とqueryごとのreported/retrieved件数
- DOI、PMID、PMCID、publication yearのcompleteness
- 複数sourceで確認できた候補率
- screening hint分布
- 無効source record、重複candidate key、統合後の識別子重複、未来年、欠落title

無効source record、統合後のidentity重複、明らかな未来年はblocking errorとし、SQLを生成しません。scope screeningやtitle欠落はriskとして残し、人が判断します。

## D1 import and audit

まずlocalへ適用して件数と外部キーを確認します。

```powershell
npm run db:migrate:local
npx wrangler d1 execute biomedical-hydrogen-evidence --local --file=.generated/discovery/{runId}.sql
npx wrangler d1 execute biomedical-hydrogen-evidence --local --command="PRAGMA foreign_key_check"
```

確認後だけ`--remote`へ同じmigrationとSQLを適用します。D1にはrun、query、候補、source record、runとの対応を保存します。候補は公開検索の対象外なので、投入だけでWeb/API/MCPの研究結果に表示されません。

## Known limitations

- source rankingとindexingの変更により、同じqueryでも後日の結果順・件数は変わり得ます。
- title-based hintはabstract/full textを使わないため、偽陽性・偽陰性があります。
- sourceごとにmetadata coverageとrights条件が異なります。
- 小さい`--max-results`はpipeline検証用であり、母集団の網羅性を示しません。

## Current production candidate run

2026-08-10にprotocol v1で各query最大1,000件を取得した`DISC-20260810185337-b3db5ac4`を実行しました。

- raw records: 4,000
- deduplicated candidates: 3,672
- DOI completeness: 95.48%
- PMID completeness: 48.56%
- PMCID completeness: 19.09%
- cross-source candidates: 305
- screening hints: `likely_biomedical` 1,064、`needs_review` 2,455、`likely_non_biomedical` 153
- invalid records / duplicate candidate keys / future years: 0

品質gateを通過し、本番D1の`study_candidates`へ隔離投入しました。公開`studies`は増やしていません。このsnapshotは2,000件超のreview対象母集団を満たしますが、網羅性、採用、医学的効果、human verificationを主張しません。

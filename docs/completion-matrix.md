# Phase completion matrix

この表は、Phase 1〜6の実装状態と「実装済み」と「運用上の継続作業」を分離します。

| Phase | Status | Implemented evidence | Operational boundary |
| --- | --- | --- | --- |
| 1: Public evidence platform | Complete | Worker + Static Assets、D1 schema/index/FTS、shared service、read-only REST、stateless Remote MCP、rate limit、synthetic fixtures、OpenAPI、tests、production deploy | 公開`studies`は人が承認したrecordだけ。現時点の同梱公開dataはsynthetic fixtures |
| 2: Reproducible discovery | Complete | versioned PubMed / Europe PMC / Crossref queries、pagination、identity dedup、quality gate、candidate D1隔離、review CSV | 2026-08-10 runは4,000 raw recordsから3,672 candidates。候補は研究採用・有効性・verificationを意味しない |
| 3: Independent extraction | Complete | OpenAI Responses、Anthropic Messages、Gemini Interactions adapter、strict structured output、independent prompts、hash approval、budget/credential preflight、zero-network dry run | 実provider実行にはmaintainer自身のkey、費用承認、source processing authorizationが必要。公開requestからは起動不可 |
| 4: Consensus + Evidence | Complete | field-level normalization/consensus、短いexact snippet照合、locator check、provider/run provenance、history、machine status | agreementは正確性を保証せず、Evidenceとの意味的妥当性は人が確認 |
| 5: Human verification | Complete | candidate/field review CSV、immutable decision events、reviewer/reason/hash、explicit promotion、human status protection | 3,672候補の実screeningと実論文field verificationは継続する人手作業。AIで代行しない |
| 6: Official native clients | Complete | native Android / iOS read-only apps、HTTPS GET、fixture/verification/disclaimer表示、Android lint/APK build、mobile CI | store署名・審査・公開はowner accountで行う外部運用。iOS compileはmacOS CIで検証 |

## Invariants

- 公開Web / API / MCP / native clientの通常requestはLLM providerを呼ばない。
- AI extraction endpointを公開しない。OpenAI口語訳は認証・same-origin・rate limit済みreview routeの明示操作だけに限定する。
- candidateはhuman screeningまで公開studyへ混入しない。
- machine consensusは`human_verified`を生成・上書きしない。
- PDF、全文、raw provider response、secretをGit/D1へ保存しない。
- stable public IDを公開し、D1 integer IDを外部契約にしない。

## Evidence of verification

- Node syntax/unit/integration tests
- local D1 migrations、synthetic seed、managed extraction SQL import、foreign-key check
- `EXPLAIN QUERY PLAN`によるpublic search、candidate、extraction、review index確認
- Android lint + debug APK build
- GitHub ActionsによるLinux Node/D1、Android、macOS iOS build
- production D1 migration、live Web/API/MCP smoke tests

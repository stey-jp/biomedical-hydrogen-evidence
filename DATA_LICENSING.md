# Data Licensing

コードのlicenseと、収録データ・原文コンテンツの権利は同一ではありません。本書は各区分を分離して扱うための方針です。法的助言ではありません。

## Project-owned code

本repositoryで作成されたsource codeと設定は、repositoryのApache License 2.0に従います。既存licenseの権利を追加文言で制限しません。

## Project-created annotations

Projectが独自に作成した分類、検証メモ、provenance locator等には、由来と利用条件を記録します。第三者著作物を含むannotationには、その第三者の権利が残り得ます。

## Bibliographic metadata

Title、authors、DOI、PMID、journal等のmetadataはsourceごとのterms、database rights、適用法が異なり得ます。全metadataを無条件にApache-2.0またはCC BYとして宣言しません。sourceとrights statusを記録します。

Phase 2のPubMed、Europe PMC、Crossref候補はsource record URLとsource-specificなrights noteを保持します。Crossref recordにCreative Commons URLが明示される場合は対応するrights statusへ正規化しますが、metadata全体や論文本文へ同じlicenseが及ぶとは推定しません。PubMed/Europe PMCの出所だけを根拠に自由再配布可能とは判定しません。

## Abstracts

Abstractは無条件に自由再配布可能とは仮定しません。sourceのlicenseが明確でないabstract全文は保存・再配布せず、必要な場合も検証目的の短いsnippetとlocatorを優先します。

## Publisher content

出版社のtable、figure、supplement、本文等には出版社・著者・第三者の著作権が存在し得ます。Open Accessであることと、あらゆる条件で再配布できることを混同しません。

## Full text and PDFs

論文PDF、有料全文、出版社全文をGitHubへ保存しません。D1にも全文を保存しません。合法的なsourceへのURL、license、rights status、短いverification snippetを保存します。

## AI-extracted structured data

AIで抽出した値には、原資料の権利、抽出providerのterms、project annotationとしての性質が重なる場合があります。provider/model/prompt/schema versionとprovenanceを記録しますが、第三者由来の構造化データ全体を一律にApache-2.0やCC BYとは宣言しません。

Managed extractionへ入力するdocumentごとに、source license、rights status、外部provider処理の権限を個別確認します。`providerProcessingAuthorized: true`は、その入力をproviderへ送信する明示的な運用判断であり、source自体のlicense変更や再配布許可を表しません。source bundle、source本文、raw provider responseはD1へ保存せず、短い検証snippetだけを必要最小限に扱います。

## Rights status vocabulary

`cc_by`、`cc_by_nc`、`cc0`、`public_domain`、`restricted`、`unknown`を使用します。`unknown`は自由利用の意味ではありません。状態が明確になるまで保守的に扱います。

## Phase 1 fixtures

`fixtures/synthetic.sql`はproject-created synthetic test dataです。実在論文から抽出したものではなく、医療上の主張を表しません。

## Phase 2 discovery artifacts

Discovery manifestとD1 candidate tableは書誌metadata、source attribution、検索provenance、project-created screening hintを含みます。raw API response、Abstract、全文、PDFは保存しません。screening hintはsourceの主張ではなく、review順序付けのためのproject annotationです。

## Human review artifacts

Candidate/field review CSVはGit対象外のlocal artifactです。review resultとしてD1へ保存するのはdecision、理由、reviewer identifier、artifact hash、短いprovenance参照です。review作業でも論文全文、PDF、長いabstract、長い引用をIssueやPull Requestへ複製しません。

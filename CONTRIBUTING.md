# Contributing

Biomedical Hydrogen Evidenceへの貢献は、透明性、監査可能性、再現性、訂正可能性を優先します。

## 研究データの訂正

1. GitHub Issueを作成する。
2. 対象studyの`public_id`とfield名を示す。
3. 原論文のsection、page、table、figure等のlocatorと、検証に必要な短い根拠を示す。
4. 著作権・利用条件を確認し、論文全文や有料PDFを添付しない。
5. Review後、migrationまたは管理されたdata changeとしてPull Requestを作成する。
6. CIとreviewを通過してからmergeする。

訂正例はparticipant count、study design/RCT分類、H₂濃度、投与経路、outcome、DOI、PMID、verification statusです。単に「AIがそう答えた」という説明は根拠になりません。

## Data requirements

- 外部識別子にはstable public IDを使い、D1のinteger IDを外部公開しない。
- SQLはprepared statementとparameter bindingを使う。
- 新しい値には可能な限りprovenanceとrights statusを付ける。
- 数値の元表記・元単位を失わない。
- 研究全体を単純なpositive/negativeへ分類しない。
- `human_verified`は人が根拠を確認した場合だけ使用する。
- PDF、出版社全文、長いabstract/本文、巨大なLLM responseをcommitしない。

## Synthetic fixtures

Test dataは必ず`synthetic`、`fixture`、`test only`と明示し、実在研究らしい偽DOI・PMID・PMCIDを作らないでください。

## Code changes

依存関係と抽象化は必要最小限にします。query-time AI、公開write endpoint、wildcard CORS、ORM、query builder、frontend frameworkは追加しません。新しい主要queryにはindexと`EXPLAIN QUERY PLAN`を追加してください。

```sh
npm install
npm run check
npm run db:migrate:local
npm run db:seed:local
npm run db:plans:local
```

## Review priorities

1. Scientific correctness
2. Traceability
3. Simplicity
4. Maintainability
5. Performance and D1 rows-read efficiency

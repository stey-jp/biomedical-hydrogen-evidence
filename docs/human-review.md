# Human review workflow

## Authority and audit trail

Phase 5は候補screeningとfield verificationを別々に扱います。AIの多数決、全会一致、confidence、原文snippetの機械的一致だけでは`human_verified`にしません。各import batchは1人のreviewer、根拠、時刻、入力artifact SHA-256を記録し、判断eventを追記します。

## Candidate screening

Discovery manifestからreview CSVを作ります。

```powershell
npm run review:candidates -- export --manifest=.generated/discovery/DISC-....json
```

全件CSVとの互換性を保ったまま、screening hintで絞り込み、監査可能な固定順序で小分けにもできます。たとえば`likely_biomedical`候補を100件ずつに分ける場合は次のとおりです。

```powershell
npm run review:candidates -- export --manifest=.generated/discovery/DISC-....json --screening-hint=likely_biomedical --batch-size=100
```

出力index JSONには対象件数、粒度、識別子充足率、source coverage、各CSVのSHA-256を記録します。batch内の順序はsource数、DOI/PMID/PMCIDの充足数、出版年、`candidate_key`で決定論的に並べます。これは確認しやすい順へのtriageであり、採否や`human_verified`を自動判定するものではありません。

reviewerは各行に次を入力します。

- `decision`: `include`、`exclude`、`duplicate`、`needs_review`
- `reason`: DOI/PMID、scope、原資料等に基づく理由
- `reviewer`: 監査可能なreviewer identifier

完成行からreview event SQLを作ります。これは候補状態だけを更新し、既定では公開しません。

```powershell
npm run review:candidates -- import --manifest=.generated/discovery/DISC-....json --csv=.generated/review/DISC-....candidate-review.csv
```

`include`を公開`studies`へ昇格する場合は、出力されたpromotion hashを別stepで明示承認します。

```powershell
npm run review:candidates -- import --manifest=.generated/discovery/DISC-....json --csv=.generated/review/DISC-....candidate-review.csv --promote-includes --approve-promotion=<exact-hash>
```

昇格直後のstudyは`unverified`です。候補採用は抽出fieldのhuman verificationを意味しません。

## Field verification

managed extraction resultから、providerごとの短いsnippetとconsensusをreview CSVへ展開します。

```powershell
npm run review:fields -- export --result=.generated/extraction/EXTR-....result.json
```

各fieldに`decision`、`reviewer`、`note`を入力します。`human_verified`または`disputed`には、reviewerが実際に確認した`provenance_provider`が必要です。選択肢は`needs_human_review`、`human_verified`、`disputed`です。

```powershell
npm run review:fields -- import --result=.generated/extraction/EXTR-....result.json --csv=.generated/review/EXTR-....field-review.csv
```

study全体を`human_verified`にするには、そのstudyで今回抽出された全fieldが同じbatchで`human_verified`であり、D1上にも未確認・disputed fieldが残っていない必要があります。SQLはこの条件を再確認し、満たさなければ`needs_human_review`を維持します。`field_verification_events`と`study_change_events`へ履歴を残します。

## Import checks

生成SQLはcommitやremote適用前にreviewし、local D1で検証します。

```powershell
npx wrangler d1 execute biomedical-hydrogen-evidence --local --file=.generated/review/REVIEW-....sql
npx wrangler d1 execute biomedical-hydrogen-evidence --local --command="PRAGMA foreign_key_check"
```

論文全文、PDF、長いabstract、長いprovider responseをCSV、Issue、Pull Requestへ貼り付けません。必要最小限のsnippetとlocatorを使います。

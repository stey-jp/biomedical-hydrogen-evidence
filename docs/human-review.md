# Human review workflow

## Authority and audit trail

Phase 5は候補screeningとfield verificationを別々に扱います。AIの多数決、全会一致、confidence、原文snippetの機械的一致だけでは`human_verified`にしません。各import batchは1人のreviewer、根拠、時刻、入力artifact SHA-256を記録し、判断eventを追記します。

## Candidate screening

### スマートフォンUI（PC常時起動不要）

本番Workerの`/review`は、非公開candidate tableを直接screeningするモバイル優先の管理画面です。一般公開APIとは分離され、`REVIEW_ADMIN_TOKEN`でログインした同一originのブラウザだけが読み書きできます。本番HTTP requestはHTTPSへredirectし、トークンそのものはブラウザへ保存せず、ログイン後は30日で失効する署名済み`Secure` / `HttpOnly` / `SameSite=Strict` Cookieを使います。reviewer identifierはD1の非公開監査履歴と認証済みCSVだけに保持し、一般公開APIへ返しません。

初回だけ32文字以上のランダムな管理トークンと、DeepL API Free、OpenAI、OpenAlex、Springer Nature、ElsevierのAPIキーをCloudflare Secretへ登録し、Workerをdeployします。OpenAIは`gpt-5.6-luna`を`reasoning.effort: max`で呼び出します。キーはGit、`.dev.vars.example`、ブラウザへ保存しません。

```powershell
npx wrangler secret put REVIEW_ADMIN_TOKEN
npx wrangler secret put DEEPL_API_KEY
npx wrangler secret put OPENAI_REVIEW_API_KEY
npx wrangler secret put OPENALEX_API_KEY
npx wrangler secret put SPRINGER_NATURE_API_KEY
npx wrangler secret put ELSEVIER_API_KEY
npm run deploy
```

以後はスマートフォンから`https://<worker-domain>/review`を開きます。優先候補、要確認候補、対象外の可能性がある候補を切り替え、reviewer identifierを入力して、`採用`、`対象外`、`保留`、`重複`を選びます。保存後は次の未判定候補へ進み、D1から再開できるためPCは不要です。保留した候補はオプション設定の「表示する判定状態」を「保留済み」へ切り替えると再表示でき、採用・対象外・重複へ再判定できます。同様に「採用済み」を選ぶと採用済み候補を再表示し、対象外・保留・重複へ再判定できます。DeepLキーが未設定・一時利用不能でも、英語原文による判定と保存は継続できます。

- `採用`と`保留`は1 tap、`対象外`は定型理由を選ぶ2 tapです。
- `重複`は同一正規化タイトルの候補を自動表示します。候補がなければcandidate key、DOI、PMID、PMCIDで検索し、重複先を特定できた場合だけ保存します。不確実なら`保留`にします。
- 直前の判定は同じ画面で再表示して修正できます。修正も上書きではなく新しいreview eventとして残ります。
- 論文カードは左右スワイプまたは「前の論文」「次の論文」で、判定を保存せずに前後移動できます。未判定・保留済み・採用済みの各表示状態で共通です。
- `CSV書き出し`は選択中キューの判定済み行を、既存importに必要な`candidate_key`、`decision`、`reason`、`reviewer`を含むCSVとして保存します。
- タイトルは英語原文の直下にDeepLの日本語参考訳を表示します。EN→JA用語集を初回に自動作成し、原文SHA-256、provider model、用語集version、翻訳時刻とともにD1へcacheします。タイトル変更時はhash不一致で再翻訳します。
- `要旨対訳`は候補の出版社と識別子に応じて取得元を振り分けます。Springer NatureまたはElsevierを判定できる場合は出版社公式API、PMCIDはEurope PMC、PMIDはPubMed、その他のDOIはCrossrefをそれぞれ優先し、未収録の場合は残りの取得元、OpenAlex要旨インデックス、OpenAIRE Research Graphへfallbackします。文単位で原文と日本語参考訳を並べ、要旨本文・要旨訳はD1へ保存せず、そのブラウザタブのmemoryだけで再利用します。利用条件にかかわらず原資料へのlinkを残します。
- 掲載誌の`引用指標`はOpenAlex `2yr_mean_citedness`を表示します。これはClarivateの公式Journal Impact Factorではありません。誌名は無料のNLM Catalog（補助的にCrossref）でISSNへ解決し、OpenAlexのISSNと一致した場合だけ採用します。ISSNを解決できない場合は、完全誌名または各単語の前方一致で安全に略称を照合します。値がない場合は未収録と表示します。Cron Triggerは毎時、未収録または30日以上古い誌名をreview待ちの表示順で最大12件更新し、年・取得時刻・OpenAlex sourceをD1へ保持します。個別の外部APIエラーはその誌名だけを次回へ繰り越します。
- 翻訳は判断補助です。意味がずれる可能性があるため、採否・重複の最終判断では英語原文と原資料を優先します。日本語参考訳だけを根拠に自動判定・公開昇格・`human_verified`化しません。
- `ブックマーク`はcandidateをreviewer identifierごとにD1へ保存し、保存後のバックグラウンド処理でタイトルをDeepL翻訳してD1へcacheします。ブックマーク一覧では原文タイトルの直下に日本語訳を表示し、チェックした最大10件をまとめて小学生・中学生・高校生の3段階から選んだ口語訳にできます。原資料表示、レビュー画面への再表示、解除、CSV書き出しも可能です。reviewerはtrim後の完全一致で分離されます。
- Reviewer入力は履歴選択と新規identifier入力を1つに統合しています。判定を1件以上保存したidentifierは、次回以降の入力候補リストに最終判定日の新しい順で表示され、候補にないidentifierも同じ欄へ直接入力できます。

各判定は`human_review_batches`と`candidate_review_events`へ追記し、判定時に表示されたcandidate snapshotのSHA-256、reviewer、理由、時刻、変更前statusを記録します。`include`はcandidate screening状態だけを変更し、公開`studies`への昇格や`human_verified`化は行いません。

local確認では`.dev.vars.example`を`.dev.vars`へコピーし、実際のランダムトークン、DeepL API Freeキー、OpenAlex APIキーへ置き換えてから`npm run dev`を実行します。`.dev.vars`はGit管理外です。

### CSV workflow

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

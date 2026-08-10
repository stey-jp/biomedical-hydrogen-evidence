# Official mobile clients

Phase 6のiOS / Android appは、公式first-party REST APIのread-only clientです。検索とstudy detail表示だけを行い、AI API、write API、認証情報、外部SDKを含みません。候補tableはAPIで公開されないため、未screening候補も表示されません。

## Android

- Java 17、Android SDK 36、min SDK 26
- Android Gradle Plugin 9.2.0、checksum固定Gradle 9.4.1 wrapper
- platform Java UI、`HttpURLConnection`、`org.json`のみ
- cleartext trafficとbackupを無効化

```powershell
cd clients/android
.\gradlew.bat :app:lintDebug :app:assembleDebug
```

成果物は`clients/android/app/build/outputs/apk/debug/app-debug.apk`です。

## iOS

- SwiftUI / Foundationのみ
- iOS 17以降、Xcode 16以降
- `URLSession`のHTTPS GETのみ

```sh
xcodebuild -project clients/ios/BiomedicalHydrogenEvidence.xcodeproj \
  -target BiomedicalHydrogenEvidence \
  -configuration Debug \
  -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO build
```

WindowsではXcodeを実行できないため、GitHub Actionsの`macos-latest` jobでも同じtargetをbuildします。App Store / Play公開、署名、store metadata、analytics、通知、user accountはこのrepositoryの実装範囲外です。

## Safety language

両appは研究報告の存在と医学的効果の確立を区別するdisclaimer、verification status、synthetic fixture noticeを表示します。診断・治療の助言は提供しません。

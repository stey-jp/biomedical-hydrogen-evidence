import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Android client is a read-only HTTPS first-party client", () => {
  const manifest = read("clients/android/app/src/main/AndroidManifest.xml");
  const api = read("clients/android/app/src/main/java/jp/stey/biomedicalhydrogenevidence/ApiClient.java");
  const build = read("clients/android/app/build.gradle");
  const wrapper = read("clients/android/gradle/wrapper/gradle-wrapper.properties");

  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(api, /setRequestMethod\("GET"\)/);
  assert.doesNotMatch(api, /setRequestMethod\("(?:POST|PUT|PATCH|DELETE)"\)/);
  assert.match(build, /https:\/\/biomedical-hydrogen-evidence\.flat-voice-876d\.workers\.dev/);
  assert.match(build, /compileSdk\s*=\s*36/);
  assert.match(build, /targetSdk\s*=\s*36/);
  assert.match(wrapper, /gradle-9\.4\.1-bin\.zip/);
  assert.match(wrapper, /distributionSha256Sum=[a-f0-9]{64}/);
  assert.doesNotMatch(`${api}\n${build}`, /api[_-]?key|openai|anthropic|gemini/i);
});

test("iOS client sources are in the project and only issue GET requests", () => {
  const project = read("clients/ios/BiomedicalHydrogenEvidence.xcodeproj/project.pbxproj");
  const api = read("clients/ios/BiomedicalHydrogenEvidence/APIClient.swift");
  const models = read("clients/ios/BiomedicalHydrogenEvidence/Models.swift");
  const sources = [
    "BiomedicalHydrogenEvidenceApp.swift",
    "Models.swift",
    "APIClient.swift",
    "ContentView.swift",
    "StudyDetailView.swift",
  ];

  for (const source of sources) assert.match(project, new RegExp(source.replace(".", "\\.")));
  assert.match(api, /request\.httpMethod = "GET"/);
  assert.doesNotMatch(api, /httpMethod = "(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(api, /https:\/\/biomedical-hydrogen-evidence\.flat-voice-876d\.workers\.dev/);
  assert.match(models, /let verificationStatus: String/);
  assert.match(models, /let fixtureNotice: String\?/);
  assert.doesNotMatch(`${api}\n${models}`, /api[_-]?key|openai|anthropic|gemini/i);
});

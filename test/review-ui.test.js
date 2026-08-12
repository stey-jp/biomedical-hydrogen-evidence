import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(`${root}/public/review.html`, "utf8");
const script = readFileSync(`${root}/public/js/review.js`, "utf8");
const styles = readFileSync(`${root}/public/css/review-20260812.css`, "utf8");

test("review UI integrates reviewer history and supports undecided card navigation", () => {
  assert.match(html, /<input id="reviewer" list="reviewer-history"/u);
  assert.match(html, /<datalist id="reviewer-history"><\/datalist>/u);
  assert.doesNotMatch(html, /<select id="reviewer-history"/u);
  assert.match(html, /id="previous"[^>]*>前の論文</u);
  assert.match(html, /id="skip"[^>]*>次の論文</u);
  assert.match(script, /addEventListener\("pointerdown"/u);
  assert.match(script, /moveCandidate\(deltaX > 0 \? "previous" : "next"\)/u);
});

test("review dialogs lock page scrolling and keep scrolling inside the modal", () => {
  assert.match(styles, /html\.modal-open,[\s\S]*body\.modal-open[\s\S]*overflow: hidden/u);
  assert.match(styles, /\.dialog-card \{[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;/u);
  assert.match(script, /document\.documentElement\.classList\.toggle\("modal-open", locked\)/u);
});

test("colloquial controls use reference-translation wording without a level badge", () => {
  assert.match(script, /"日本語参考訳"/u);
  assert.doesNotMatch(`${html}\n${script}`, /DeepL訳/u);
  assert.doesNotMatch(html, /colloquial-level-value/u);
  assert.match(styles, /--range-position/u);
  assert.match(styles, /\.bookmark-count-button[^\n]*justify-content: center/u);
});

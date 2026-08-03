import assert from "node:assert/strict";
import test from "node:test";
import {
  readDeclarationsFromJavascript,
  transformJavascriptScriptToSkill,
} from "../src/transform-javascript-script-to-skill.mjs";

const HEADER = `#!/usr/bin/env node
/**
 * @description Makes a widget from raw
 *   material, wrapped across two lines.
 *
 * @param {string} material - raw material is present
 * @param {boolean} clear - the bench is clear
 * @returns {object} a widget exists
 *
 * Free prose about widgets.
 * It spans two lines.
 */
console.log("hi");
`;

test("readDeclarationsFromJavascript reads only the first block comment", () => {
  const header = readDeclarationsFromJavascript(HEADER);
  assert.ok(header);
  assert.deepEqual(
    header.declarations.map((d) => d.tag),
    ["description", "param", "param", "returns"],
  );
  const description = header.declarations.find((d) => d.tag === "description");
  assert.equal(description.value, "Makes a widget from raw material, wrapped across two lines.");
  assert.equal(header.prose, "Free prose about widgets.\nIt spans two lines.");
});

test("readDeclarationsFromJavascript returns null with no leading block comment", () => {
  assert.equal(readDeclarationsFromJavascript("#!/usr/bin/env node\nconsole.log(1);\n"), null);
});

test("readDeclarationsFromJavascript ignores a second, later block comment", () => {
  const text = "/**\n * @description first-one\n */\nconst x = 1;\n/**\n * @description second-one\n */\n";
  const header = readDeclarationsFromJavascript(text);
  assert.equal(header.declarations.length, 1);
  assert.equal(header.declarations[0].value, "first-one");
});

test("transformJavascriptScriptToSkill composes a record, derives name and script from the filename", () => {
  const result = transformJavascriptScriptToSkill(HEADER, "make-a-widget.js");
  assert.ok(result.record, JSON.stringify(result));
  assert.deepEqual(result.record, {
    name: "make-a-widget",
    description: "Makes a widget from raw material, wrapped across two lines.",
    params: ["{string} material - raw material is present", "{boolean} clear - the bench is clear"],
    returns: ["{object} a widget exists"],
    script: "scripts/make-a-widget.js",
  });
  assert.equal(result.body, "Free prose about widgets.\nIt spans two lines.");
});

test("transformJavascriptScriptToSkill derives name from an .mjs filename too", () => {
  const result = transformJavascriptScriptToSkill(
    "/**\n * @description does a thing\n */\n",
    "do-a-thing.mjs",
  );
  assert.equal(result.record.name, "do-a-thing");
  assert.equal(result.record.script, "scripts/do-a-thing.mjs");
});

test("transformJavascriptScriptToSkill refuses a script with no header", () => {
  const result = transformJavascriptScriptToSkill("console.log(1);\n", "x.js");
  assert.match(result.error, /no leading block comment/u);
});

test("transformJavascriptScriptToSkill accepts a header with no @description", () => {
  const result = transformJavascriptScriptToSkill("/**\n * @param {string} x - a thing\n */\n", "x.js");
  assert.ok(result.record, JSON.stringify(result));
  assert.equal(result.record.name, "x");
  assert.deepEqual(result.record.params, ["{string} x - a thing"]);
});

test("transformJavascriptScriptToSkill refuses an unknown declaration", () => {
  const text = "/**\n * @description doing a thing\n * @nonsense-tag some value\n */\n";
  const result = transformJavascriptScriptToSkill(text, "x.js");
  assert.match(result.error, /unknown declaration '@nonsense-tag'/u);
});

test("transformJavascriptScriptToSkill refuses the retired invented-dialect tags", () => {
  for (const tag of ["skill", "verb-phrase", "closure-kind", "precondition", "postcondition", "witness", "fuel", "model"]) {
    const text = `/**\n * @description doing a thing\n * @${tag} some value\n */\n`;
    const result = transformJavascriptScriptToSkill(text, "x.js");
    assert.match(result.error, new RegExp(`unknown declaration '@${tag}'`, "u"), `@${tag} should be refused as unknown`);
  }
});

test("transformJavascriptScriptToSkill refuses a declared @script", () => {
  const text = "/**\n * @description doing a thing\n * @script scripts/elsewhere.js\n */\n";
  const result = transformJavascriptScriptToSkill(text, "x.js");
  assert.match(result.error, /unknown declaration '@script'/u);
});

test("transformJavascriptScriptToSkill accumulates repeated @param, @returns, and @throws", () => {
  const text = [
    "/**",
    " * @description doing a thing",
    " * @param {string} a - the first argument",
    " * @param {string} b - the second argument",
    " * @throws {Error} when a is missing",
    " * @throws {Error} when b is missing",
    " * @returns {object} the result",
    " */",
    "",
  ].join("\n");
  const result = transformJavascriptScriptToSkill(text, "x.js");
  assert.deepEqual(result.record.params, ["{string} a - the first argument", "{string} b - the second argument"]);
  assert.deepEqual(result.record.throws, ["{Error} when a is missing", "{Error} when b is missing"]);
  assert.deepEqual(result.record.returns, ["{object} the result"]);
});

test("transformJavascriptScriptToSkill omits params, returns, and throws when none are declared", () => {
  const result = transformJavascriptScriptToSkill("/**\n * @description doing a thing\n */\n", "x.js");
  assert.ok(!("params" in result.record));
  assert.ok(!("returns" in result.record));
  assert.ok(!("throws" in result.record));
});

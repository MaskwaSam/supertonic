import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const flutterDir = resolve(testDir, '..');
const repoDir = resolve(flutterDir, '..');

const helperSource = readFileSync(resolve(flutterDir, 'lib/helper.dart'), 'utf8');
const mainSource = readFileSync(resolve(flutterDir, 'lib/main.dart'), 'utf8');
const fixture = JSON.parse(
  readFileSync(resolve(repoDir, 'tests/conformance/conformance.json'), 'utf8'),
);

const listMatch = helperSource.match(
  /const List<String> availableLangs\s*=\s*\[([\s\S]*?)\];/,
);
assert.ok(listMatch, 'Flutter must declare the availableLangs constant');

const flutterLangs = [...listMatch[1].matchAll(/'([a-z]{2})'/g)].map(
  (match) => match[1],
);
assert.deepEqual(
  flutterLangs,
  fixture.limits.languages,
  'Flutter language options must match the shared conformance fixture',
);

assert.match(
  mainSource,
  /DropdownButton<String>\s*\([\s\S]*?items:\s*availableLangs/,
  'Flutter must render its language input as a controlled dropdown',
);
assert.match(
  mainSource,
  /value:\s*_selectedLang/,
  'The dropdown must reflect the selected synthesis language',
);
assert.match(
  mainSource,
  /if\s*\(!isValidLang\(_selectedLang\)\)/,
  'Flutter must validate the selected language at the synthesis boundary',
);
assert.match(
  mainSource,
  /\.call\(\s*_textController\.text,\s*_selectedLang,/,
  'Synthesis must use the controlled language selection',
);

console.log(
  `Flutter language selector: ${flutterLangs.length} controlled options match the shared fixture`,
);

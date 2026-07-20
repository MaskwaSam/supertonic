import 'dart:convert';
import 'dart:io';

import '../lib/text_utils.dart';

void main() {
  final scriptDir = File.fromUri(Platform.script).parent;
  final fixtureFile = File('${scriptDir.path}/../../tests/conformance/conformance.json');
  final fixture = jsonDecode(fixtureFile.readAsStringSync()) as Map<String, dynamic>;
  final cases = fixture['chunking'] as List<dynamic>;
  for (final rawCase in cases) {
    final testCase = rawCase as Map<String, dynamic>;
    final actual = chunkText(testCase['text'] as String, maxLen: testCase['max_len'] as int);
    final expected = (testCase['expected'] as List<dynamic>).cast<String>();
    if (jsonEncode(actual) != jsonEncode(expected)) {
      throw StateError('${testCase['name']}: got $actual, expected $expected');
    }
    if (actual.any((chunk) => chunk.runes.length > (testCase['max_len'] as int))) {
      throw StateError('${testCase['name']}: chunk exceeded maxLen');
    }
  }
  final trimmed = trimWaveform(<double>[1, 2, 3, 4, 5], 0.3, 10);
  if (jsonEncode(trimmed) != jsonEncode(<double>[1, 2, 3])) {
    throw StateError('waveform trim failed: $trimmed');
  }
  stdout.writeln('Dart conformance: ${cases.length} shared chunking cases and waveform trim passed');
}

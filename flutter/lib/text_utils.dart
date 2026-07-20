import 'dart:math' as math;

const _abbreviations = <String>{
  'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Sr.', 'Jr.', 'St.', 'Ave.',
  'Rd.', 'Blvd.', 'Dept.', 'Inc.', 'Ltd.', 'Co.', 'Corp.', 'etc.',
  'vs.', 'i.e.', 'e.g.', 'Ph.D.'
};

int _scalarLength(String value) => value.runes.length;

bool _isWhitespace(int scalar) =>
    RegExp(r'\s', unicode: true).hasMatch(String.fromCharCode(scalar));

bool _isAbbreviation(List<int> prefix) {
  final text = String.fromCharCodes(prefix).trimRight();
  final parts = text.isEmpty ? <String>[] : text.split(RegExp(r'\s+'));
  final token = parts.isEmpty ? '' : parts.last;
  return _abbreviations.contains(token) || RegExp(r'^[A-Z]\.$').hasMatch(token);
}

List<String> _splitSentences(String text) {
  final scalars = text.runes.toList();
  final sentences = <String>[];
  var start = 0;
  var i = 0;
  while (i < scalars.length) {
    final scalar = scalars[i];
    final punctuation = scalar == 0x2e || scalar == 0x21 || scalar == 0x3f;
    final followedBySpace = i + 1 == scalars.length || _isWhitespace(scalars[i + 1]);
    final abbreviation = scalar == 0x2e && _isAbbreviation(scalars.sublist(start, i + 1));
    if (punctuation && followedBySpace && !abbreviation) {
      final sentence = String.fromCharCodes(scalars.sublist(start, i + 1)).trim();
      if (sentence.isNotEmpty) sentences.add(sentence);
      i++;
      while (i < scalars.length && _isWhitespace(scalars[i])) i++;
      start = i;
      continue;
    }
    i++;
  }
  final tail = String.fromCharCodes(scalars.sublist(start)).trim();
  if (tail.isNotEmpty) sentences.add(tail);
  return sentences;
}

List<String> _hardWrap(String text, int maxLen) {
  final chunks = <String>[];
  var current = '';
  for (final rawWord in text.split(RegExp(r'\s+'))) {
    var word = rawWord.runes.toList();
    while (word.length > maxLen) {
      if (current.isNotEmpty) {
        chunks.add(current);
        current = '';
      }
      chunks.add(String.fromCharCodes(word.sublist(0, maxLen)));
      word = word.sublist(maxLen);
    }
    final remainder = String.fromCharCodes(word);
    if (remainder.isEmpty) continue;
    final candidate = current.isEmpty ? remainder : '$current $remainder';
    if (_scalarLength(candidate) <= maxLen) {
      current = candidate;
    } else {
      chunks.add(current);
      current = remainder;
    }
  }
  if (current.isNotEmpty) chunks.add(current);
  return chunks;
}

/// Chunk text without exceeding [maxLen] Unicode scalar values.
List<String> chunkText(String text, {int maxLen = 300}) {
  if (maxLen <= 0) throw ArgumentError.value(maxLen, 'maxLen', 'must be positive');
  text = text.trim();
  if (text.isEmpty) return <String>[];

  final chunks = <String>[];
  for (final rawParagraph in text.split(RegExp(r'\n\s*\n+'))) {
    final paragraph = rawParagraph.trim();
    if (paragraph.isEmpty) continue;
    var current = '';
    for (final sentence in _splitSentences(paragraph)) {
      if (_scalarLength(sentence) > maxLen) {
        if (current.isNotEmpty) chunks.add(current);
        current = '';
        chunks.addAll(_hardWrap(sentence, maxLen));
        continue;
      }
      final candidate = current.isEmpty ? sentence : '$current $sentence';
      if (_scalarLength(candidate) <= maxLen) {
        current = candidate;
      } else {
        chunks.add(current);
        current = sentence;
      }
    }
    if (current.isNotEmpty) chunks.add(current);
  }
  return chunks;
}

/// Remove vocoder padding based on the predicted duration.
List<double> trimWaveform(List<double> wav, double durationSeconds, int sampleRate) {
  if (!durationSeconds.isFinite || durationSeconds <= 0 || sampleRate <= 0) {
    return <double>[];
  }
  final length = math.min(wav.length, (durationSeconds * sampleRate).floor());
  return wav.sublist(0, length);
}

#include "text_utils.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <unordered_set>

namespace {
const std::unordered_set<std::string> kAbbreviations = {
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.", "St.",
    "Ave.", "Rd.", "Blvd.", "Dept.", "Inc.", "Ltd.", "Co.",
    "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D."
};

std::string trimAscii(const std::string& value) {
    auto first = std::find_if_not(value.begin(), value.end(), [](unsigned char ch) { return std::isspace(ch); });
    auto last = std::find_if_not(value.rbegin(), value.rend(), [](unsigned char ch) { return std::isspace(ch); }).base();
    return first < last ? std::string(first, last) : std::string();
}

std::vector<std::string> utf8Scalars(const std::string& value) {
    std::vector<std::string> scalars;
    for (std::size_t i = 0; i < value.size();) {
        const unsigned char lead = static_cast<unsigned char>(value[i]);
        std::size_t width = 1;
        if ((lead & 0xE0) == 0xC0) width = 2;
        else if ((lead & 0xF0) == 0xE0) width = 3;
        else if ((lead & 0xF8) == 0xF0) width = 4;
        if (i + width > value.size()) width = 1;
        scalars.push_back(value.substr(i, width));
        i += width;
    }
    return scalars;
}

std::size_t scalarLength(const std::string& value) {
    return utf8Scalars(value).size();
}

bool isAbbreviation(const std::string& prefix) {
    const auto trimmed = trimAscii(prefix);
    const auto space = trimmed.find_last_of(" \t\r\n");
    const auto token = space == std::string::npos ? trimmed : trimmed.substr(space + 1);
    return kAbbreviations.count(token) != 0
        || (token.size() == 2 && std::isupper(static_cast<unsigned char>(token[0])) && token[1] == '.');
}

std::vector<std::string> splitSentences(const std::string& text) {
    std::vector<std::string> sentences;
    std::size_t start = 0;
    for (std::size_t i = 0; i < text.size(); ++i) {
        const char ch = text[i];
        if (ch != '.' && ch != '!' && ch != '?') continue;
        if (i + 1 < text.size() && !std::isspace(static_cast<unsigned char>(text[i + 1]))) continue;
        if (ch == '.' && isAbbreviation(text.substr(start, i - start + 1))) continue;
        auto sentence = trimAscii(text.substr(start, i - start + 1));
        if (!sentence.empty()) sentences.push_back(std::move(sentence));
        start = i + 1;
        while (start < text.size() && std::isspace(static_cast<unsigned char>(text[start]))) ++start;
        i = start == 0 ? 0 : start - 1;
    }
    auto tail = trimAscii(text.substr(start));
    if (!tail.empty()) sentences.push_back(std::move(tail));
    return sentences;
}

std::vector<std::string> hardWrap(const std::string& text, std::size_t max_len) {
    std::vector<std::string> chunks;
    std::istringstream words(text);
    std::string raw_word;
    std::string current;
    while (words >> raw_word) {
        auto scalars = utf8Scalars(raw_word);
        while (scalars.size() > max_len) {
            if (!current.empty()) {
                chunks.push_back(std::move(current));
                current.clear();
            }
            std::string piece;
            for (std::size_t i = 0; i < max_len; ++i) piece += scalars[i];
            chunks.push_back(std::move(piece));
            scalars.erase(scalars.begin(), scalars.begin() + static_cast<std::ptrdiff_t>(max_len));
        }
        std::string word;
        for (const auto& scalar : scalars) word += scalar;
        if (word.empty()) continue;
        const auto candidate = current.empty() ? word : current + " " + word;
        if (scalarLength(candidate) <= max_len) current = candidate;
        else {
            chunks.push_back(std::move(current));
            current = std::move(word);
        }
    }
    if (!current.empty()) chunks.push_back(std::move(current));
    return chunks;
}
}  // namespace

std::vector<std::string> chunkTextConform(const std::string& text, std::size_t max_len) {
    if (max_len == 0) throw std::invalid_argument("max_len must be positive");
    const auto input = trimAscii(text);
    if (input.empty()) return {};

    std::regex paragraph_regex(R"(\n\s*\n+)");
    std::sregex_token_iterator iter(input.begin(), input.end(), paragraph_regex, -1), end;
    std::vector<std::string> chunks;
    for (; iter != end; ++iter) {
        const auto paragraph = trimAscii(*iter);
        if (paragraph.empty()) continue;
        std::string current;
        for (const auto& sentence : splitSentences(paragraph)) {
            if (scalarLength(sentence) > max_len) {
                if (!current.empty()) {
                    chunks.push_back(std::move(current));
                    current.clear();
                }
                auto wrapped = hardWrap(sentence, max_len);
                chunks.insert(chunks.end(), wrapped.begin(), wrapped.end());
                continue;
            }
            const auto candidate = current.empty() ? sentence : current + " " + sentence;
            if (scalarLength(candidate) <= max_len) current = candidate;
            else {
                chunks.push_back(std::move(current));
                current = sentence;
            }
        }
        if (!current.empty()) chunks.push_back(std::move(current));
    }
    return chunks;
}

std::vector<float> trimWaveform(const std::vector<float>& wav, float duration_seconds, int sample_rate) {
    if (!std::isfinite(duration_seconds) || duration_seconds <= 0.0f || sample_rate <= 0) return {};
    const auto requested = static_cast<std::size_t>(duration_seconds * static_cast<float>(sample_rate));
    const auto length = std::min(requested, wav.size());
    return std::vector<float>(wav.begin(), wav.begin() + static_cast<std::ptrdiff_t>(length));
}

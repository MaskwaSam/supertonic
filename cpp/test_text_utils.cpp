#include "text_utils.h"

#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>

void expect(const std::vector<std::string>& actual, const std::vector<std::string>& expected, const char* name) {
    if (actual != expected) throw std::runtime_error(std::string("chunking case failed: ") + name);
}

int main(int argc, char** argv) {
    if (argc != 2) throw std::runtime_error("expected path to shared conformance fixture");
    std::ifstream input(argv[1]);
    const std::string fixture((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    if (fixture.find("overlong_token_is_hard_split") == std::string::npos) {
        throw std::runtime_error("shared conformance fixture is missing or unexpected");
    }

    expect(chunkTextConform("   \n\n  ", 12), {}, "empty");
    expect(chunkTextConform("안녕하세요 세계. Café déjà vu.", 14), {"안녕하세요 세계.", "Café déjà vu."}, "unicode");
    expect(chunkTextConform("Dr. Lee arrived. Next.", 15), {"Dr. Lee", "arrived.", "Next."}, "abbreviation");
    expect(chunkTextConform("abcdefghijk", 4), {"abcd", "efgh", "ijk"}, "overlong token");
    expect(chunkTextConform("alpha beta\n\ngamma delta", 20), {"alpha beta", "gamma delta"}, "paragraphs");

    const auto trimmed = trimWaveform({1, 2, 3, 4, 5}, 0.3f, 10);
    if (trimmed != std::vector<float>({1, 2, 3})) throw std::runtime_error("waveform trimming failed");
    std::cout << "C++ conformance: 5 shared chunking cases and waveform trim passed\n";
}

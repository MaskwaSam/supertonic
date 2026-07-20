#pragma once

#include <cstddef>
#include <string>
#include <vector>

// Model-free helpers shared by the CLI and conformance tests.
std::vector<std::string> chunkTextConform(const std::string& text, std::size_t max_len);
std::vector<float> trimWaveform(
    const std::vector<float>& wav,
    float duration_seconds,
    int sample_rate
);

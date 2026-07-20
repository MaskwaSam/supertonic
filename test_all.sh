#!/bin/bash

# Supertonic - Test All Language Implementations
# This script runs inference tests for supported CLI language examples.
# Flutter and iOS are manual-only because they require platform app tooling.

set -e  # Exit on error
set -o pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

export UV_CACHE_DIR="${UV_CACHE_DIR:-$SCRIPT_DIR/.uv-cache}"
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$SCRIPT_DIR/.clang-module-cache}"
SWIFT_HOME="${SWIFT_HOME:-$SCRIPT_DIR/.swift-home}"
mkdir -p "$UV_CACHE_DIR" "$CLANG_MODULE_CACHE_PATH" "$SWIFT_HOME"

INTERACTIVE=true
TEST_MODE=1
CLEAN_RESULTS=""
SELECTED_LANGS="py,nodejs,go,rust,csharp,java,swift,cpp"
TEST_TIMEOUT="${TEST_TIMEOUT:-0}"
LOG_DIR="${LOG_DIR:-$SCRIPT_DIR/test-logs}"

usage() {
    cat <<'USAGE'
Usage: ./test_all.sh [options]

Options:
  --mode default|batch|long|all   Test mode; default is interactive prompt or default.
  --clean                         Clean results folders before running.
  --no-clean                      Do not clean results folders.
  --langs list                    Comma-separated subset: py,nodejs,go,rust,csharp,java,swift,cpp.
  --timeout seconds               Per-test timeout if the timeout command is available.
  -h, --help                      Show this help.

Flutter and iOS examples are manual-only and are not run by this script.
USAGE
}

while [ $# -gt 0 ]; do
    INTERACTIVE=false
    case "$1" in
        --mode)
            TEST_MODE="${2:-default}"
            shift 2
            ;;
        --clean)
            CLEAN_RESULTS=true
            shift
            ;;
        --no-clean)
            CLEAN_RESULTS=false
            shift
            ;;
        --langs)
            SELECTED_LANGS="${2:-$SELECTED_LANGS}"
            shift 2
            ;;
        --timeout)
            TEST_TIMEOUT="${2:-0}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

echo "=================================="
echo "Supertonic - Testing All Examples"
echo "=================================="
echo ""

if [ "$INTERACTIVE" = true ]; then
    # Ask user to select test mode
    echo "Select test mode:"
    echo "  1) Default inference only"
    echo "  2) Batch inference only"
    echo "  3) Long-form inference only"
    echo "  4) All tests (default + batch + long-form)"
    echo -e "Enter your choice (1/2/3/4) [default: 1]: \c"
    read -r TEST_MODE
    TEST_MODE=${TEST_MODE:-1}
fi

case $TEST_MODE in
    1|default)
        TEST_DEFAULT=true
        TEST_BATCH=false
        TEST_LONGFORM=false
        echo "Running default inference tests only"
        ;;
    2|batch)
        TEST_DEFAULT=false
        TEST_BATCH=true
        TEST_LONGFORM=false
        echo "Running batch inference tests only"
        ;;
    3|long|longform)
        TEST_DEFAULT=false
        TEST_BATCH=false
        TEST_LONGFORM=true
        echo "Running long-form inference tests only"
        ;;
    4|all)
        TEST_DEFAULT=true
        TEST_BATCH=true
        TEST_LONGFORM=true
        echo "Running all tests (default + batch + long-form)"
        ;;
    *)
        echo "Invalid choice. Using default inference only."
        TEST_DEFAULT=true
        TEST_BATCH=false
        TEST_LONGFORM=false
        ;;
esac
echo ""

# Batch inference test data - multilingual examples
BATCH_VOICE_STYLE_1="assets/voice_styles/M1.json"
BATCH_VOICE_STYLE_2="assets/voice_styles/F1.json"
BATCH_TEXT_1="The sun sets behind the mountains, painting the sky in shades of pink and orange."
BATCH_TEXT_2="오늘 아침에 공원을 산책했는데, 새소리와 바람 소리가 너무 기분 좋았어요."
BATCH_LANG_1="en"
BATCH_LANG_2="ko"

# Long-form inference test data
LONGFORM_VOICE_STYLE="assets/voice_styles/M1.json"
LONGFORM_TEXT="This is a very long text that will be automatically split into multiple chunks. The system will process each chunk separately and then concatenate them together with natural pauses between segments. This ensures that even very long texts can be processed efficiently while maintaining natural speech flow and avoiding memory issues. The text chunking algorithm intelligently splits on paragraph and sentence boundaries, preserving the natural flow of the content. When a sentence is too long, it further splits on commas and spaces as needed. This multi-level approach ensures optimal chunk sizes for inference while maintaining linguistic coherence."

if [ -z "$CLEAN_RESULTS" ] && [ "$INTERACTIVE" = true ]; then
    # Ask if user wants to clean results folders
    echo -e "Do you want to clean all results folders before running tests? (y/N): \c"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        CLEAN_RESULTS=true
    else
        CLEAN_RESULTS=false
    fi
fi

if [ "$CLEAN_RESULTS" = true ]; then
    echo ""
    echo "Cleaning results folders..."
    
    # List of result directories
    declare -a RESULT_DIRS=(
        "py/results"
        "nodejs/results"
        "go/results"
        "rust/results"
        "csharp/results"
        "java/results"
        "swift/results"
        "cpp/build/results"
    )
    
    for dir in "${RESULT_DIRS[@]}"; do
        if [ -d "$SCRIPT_DIR/$dir" ]; then
            echo "  - Cleaning $dir"
            rm -rf "$SCRIPT_DIR/$dir"/*
        fi
    done
    
    echo "Results folders cleaned!"
    echo ""
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track results
declare -a PASSED=()
declare -a FAILED=()

# Local toolchain fallbacks for Homebrew keg-only installs.
DOTNET_CMD="${DOTNET_CMD:-dotnet}"
if ! "$DOTNET_CMD" --list-runtimes 2>/dev/null | grep -q "Microsoft.NETCore.App 9\\."; then
    if [ -x "/opt/homebrew/opt/dotnet@9/bin/dotnet" ]; then
        DOTNET_CMD="/opt/homebrew/opt/dotnet@9/bin/dotnet"
        export DOTNET_ROOT="${DOTNET_ROOT:-/opt/homebrew/opt/dotnet@9/libexec}"
    elif [ -x "/usr/local/opt/dotnet@9/bin/dotnet" ]; then
        DOTNET_CMD="/usr/local/opt/dotnet@9/bin/dotnet"
        export DOTNET_ROOT="${DOTNET_ROOT:-/usr/local/opt/dotnet@9/libexec}"
    fi
fi

if ! javac -version >/dev/null 2>&1; then
    if [ -x "/opt/homebrew/opt/openjdk@17/bin/javac" ]; then
        export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
        export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
    elif [ -x "/usr/local/opt/openjdk@17/bin/javac" ]; then
        export JAVA_HOME="/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
        export PATH="/usr/local/opt/openjdk@17/bin:$PATH"
    fi
fi

lang_enabled() {
    case ",$SELECTED_LANGS," in
        *",$1,"*) return 0 ;;
        *) return 1 ;;
    esac
}

require_tool() {
    local tool=$1
    local hint=$2
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Missing required tool: $tool. $hint" >&2
        return 1
    fi
    return 0
}

preflight() {
    local failed=false

    if lang_enabled py; then
        require_tool uv "Install uv: https://docs.astral.sh/uv/" || failed=true
    fi
    if lang_enabled nodejs; then
        require_tool node "Install Node.js 16 or newer." || failed=true
        require_tool npm "Install npm with Node.js." || failed=true
    fi
    if lang_enabled go; then
        require_tool go "Install Go and the ONNX Runtime C library." || failed=true
    fi
    if lang_enabled rust; then
        require_tool cargo "Install Rust/Cargo." || failed=true
    fi
    if lang_enabled csharp; then
        if ! "$DOTNET_CMD" --version >/dev/null 2>&1; then
            echo "Missing required tool: dotnet. Install .NET 9 or newer." >&2
            failed=true
        fi
    fi
    if lang_enabled java; then
        require_tool javac "Install a JDK, not only a JRE." || failed=true
        require_tool mvn "Install Maven." || failed=true
    fi
    if lang_enabled swift; then
        require_tool swift "Install Swift 5.9 or newer." || failed=true
    fi
    if lang_enabled cpp; then
        require_tool cmake "Install CMake." || failed=true
    fi

    if [ "$failed" = true ]; then
        echo "Preflight failed. Install missing tools or narrow the run with --langs." >&2
        exit 1
    fi
}

install_node_deps() {
    local dir=$1
    echo "Installing Node.js dependencies in $dir..."
    cd "$SCRIPT_DIR/$dir"
    if [ ! -f package-lock.json ]; then
        echo "Missing package-lock.json in $dir; dependency installs must use a committed lockfile." >&2
        exit 1
    fi
    npm ci --silent
    cd "$SCRIPT_DIR"
}

# Helper function to show statistics
show_stats() {
    local name=$1
    local results_dir=$2
    
    if [ -d "$results_dir" ]; then
        # Count .wav files
        local file_count=$(find "$results_dir" -name "*.wav" -type f 2>/dev/null | wc -l | tr -d ' ')
        
        if [ "$file_count" -gt 0 ]; then
            # Calculate total size
            local total_size=0
            while IFS= read -r file; do
                if [ -f "$file" ]; then
                    local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
                    total_size=$((total_size + size))
                fi
            done < <(find "$results_dir" -name "*.wav" -type f 2>/dev/null)
            
            # Calculate statistics
            local total_size_mb
            local avg_size_kb
            if command -v bc >/dev/null 2>&1; then
                total_size_mb=$(echo "scale=2; $total_size / 1024 / 1024" | bc)
                avg_size_kb=$(echo "scale=2; $total_size / $file_count / 1024" | bc)
            else
                total_size_mb=$((total_size / 1024 / 1024))
                avg_size_kb=$((total_size / file_count / 1024))
            fi
            
            echo -e "${BLUE}[$name]${NC} 📊 Statistics:"
            echo -e "${BLUE}[$name]${NC}   - Files generated: $file_count"
            echo -e "${BLUE}[$name]${NC}   - Total size: ${total_size_mb} MB"
            echo -e "${BLUE}[$name]${NC}   - Average file size: ${avg_size_kb} KB"
        fi
    fi
}

# Helper function to run tests
run_test() {
    local name=$1
    local dir=$2
    shift 2
    local cmd="$@"
    local safe_name
    safe_name=$(printf "%s" "$name" | tr -cs 'A-Za-z0-9._-' '_')
    local log_file="$LOG_DIR/${safe_name}.log"
    local wav_baseline="$LOG_DIR/${safe_name}.wav-baseline.json"

    echo -e "${BLUE}[$name]${NC} Running inference..."
    cd "$SCRIPT_DIR/$dir"
    mkdir -p "$LOG_DIR"
    
    # Determine results directory based on the directory
    local results_dir="$SCRIPT_DIR/$dir/results"
    if [[ "$dir" == "cpp/build" ]]; then
        results_dir="$SCRIPT_DIR/cpp/build/results"
    fi

    python3 "$SCRIPT_DIR/tests/validate_wavs.py" snapshot "$results_dir" "$wav_baseline"
    
    # Run command and prefix each output line with the language name
    local command_ok=false
    if [ "$TEST_TIMEOUT" -gt 0 ] && command -v timeout >/dev/null 2>&1; then
        if timeout "$TEST_TIMEOUT" bash -lc "$cmd" 2>&1 | sed "s/^/[$name] /" | tee "$log_file"; then
            command_ok=true
        fi
    elif eval "$cmd" 2>&1 | sed "s/^/[$name] /" | tee "$log_file"; then
        command_ok=true
    fi

    if [ "$command_ok" = true ] && python3 "$SCRIPT_DIR/tests/validate_wavs.py" validate "$results_dir" "$wav_baseline"; then
        echo -e "${GREEN}[$name]${NC} ✓ Success (valid, non-silent WAV output)"
        show_stats "$name" "$results_dir"
        PASSED+=("$name")
    else
        echo -e "${RED}[$name]${NC} ✗ Failed"
        FAILED+=("$name")
    fi
    echo ""
    cd "$SCRIPT_DIR"
}

preflight

# ====================================
# Python
# ====================================
if lang_enabled py; then
echo -e "${YELLOW}Testing Python...${NC}"
if [ "$TEST_DEFAULT" = true ]; then
    run_test "Python (default)" "py" "uv run example_onnx.py"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "Python (batch)" "py" "uv run example_onnx.py --batch --voice-style ../$BATCH_VOICE_STYLE_1 ../$BATCH_VOICE_STYLE_2 --text '$BATCH_TEXT_1' '$BATCH_TEXT_2' --lang $BATCH_LANG_1 $BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "Python (long-form)" "py" "uv run example_onnx.py --voice-style ../$LONGFORM_VOICE_STYLE --text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# JavaScript (Node.js)
# ====================================
if lang_enabled nodejs; then
echo -e "${YELLOW}Testing JavaScript (Node.js)...${NC}"
install_node_deps nodejs
if [ "$TEST_DEFAULT" = true ]; then
    run_test "JavaScript (default)" "nodejs" "node example_onnx.js"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "JavaScript (batch)" "nodejs" "node example_onnx.js --batch --voice-style ../$BATCH_VOICE_STYLE_1,../$BATCH_VOICE_STYLE_2 --text '$BATCH_TEXT_1|$BATCH_TEXT_2' --lang $BATCH_LANG_1,$BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "JavaScript (long-form)" "nodejs" "node example_onnx.js --voice-style ../$LONGFORM_VOICE_STYLE --text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# Go
# ====================================
if lang_enabled go; then
echo -e "${YELLOW}Testing Go...${NC}"
echo "Cleaning Go cache..."
cd go && go clean && cd ..
if [ -z "${ONNXRUNTIME_LIB_PATH:-}" ] && command -v brew >/dev/null 2>&1; then
    ORT_PREFIX="$(brew --prefix onnxruntime 2>/dev/null || true)"
    if [ -n "$ORT_PREFIX" ]; then
        export ONNXRUNTIME_LIB_PATH="$ORT_PREFIX/lib/libonnxruntime.dylib"
    fi
fi
if [ "$TEST_DEFAULT" = true ]; then
    run_test "Go (default)" "go" "go run example_onnx.go helper.go"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "Go (batch)" "go" "go run example_onnx.go helper.go --batch -voice-style ../$BATCH_VOICE_STYLE_1,../$BATCH_VOICE_STYLE_2 -text '$BATCH_TEXT_1|$BATCH_TEXT_2' -lang $BATCH_LANG_1,$BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "Go (long-form)" "go" "go run example_onnx.go helper.go -voice-style ../$LONGFORM_VOICE_STYLE -text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# Rust
# ====================================
if lang_enabled rust; then
echo -e "${YELLOW}Testing Rust...${NC}"
echo "Building Rust project..."
cd rust && cargo clean && cd ..
if [ "$TEST_DEFAULT" = true ]; then
    run_test "Rust (default)" "rust" "cargo run --release"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "Rust (batch)" "rust" "cargo run --release -- --batch --voice-style ../$BATCH_VOICE_STYLE_1,../$BATCH_VOICE_STYLE_2 --text '$BATCH_TEXT_1|$BATCH_TEXT_2' --lang $BATCH_LANG_1,$BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "Rust (long-form)" "rust" "cargo run --release -- --voice-style ../$LONGFORM_VOICE_STYLE --text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# C#
# ====================================
if lang_enabled csharp; then
echo -e "${YELLOW}Testing C#...${NC}"
echo "Building C# project..."
cd csharp && DOTNET_CLI_HOME="$SCRIPT_DIR/.dotnet" "$DOTNET_CMD" clean && cd ..
if [ "$TEST_DEFAULT" = true ]; then
    run_test "C# (default)" "csharp" "DOTNET_CLI_HOME='$SCRIPT_DIR/.dotnet' '$DOTNET_CMD' run --configuration Release"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "C# (batch)" "csharp" "DOTNET_CLI_HOME='$SCRIPT_DIR/.dotnet' '$DOTNET_CMD' run --configuration Release -- --batch --voice-style ../$BATCH_VOICE_STYLE_1,../$BATCH_VOICE_STYLE_2 --text '$BATCH_TEXT_1|$BATCH_TEXT_2' --lang $BATCH_LANG_1,$BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "C# (long-form)" "csharp" "DOTNET_CLI_HOME='$SCRIPT_DIR/.dotnet' '$DOTNET_CMD' run --configuration Release -- --voice-style ../$LONGFORM_VOICE_STYLE --text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# Java
# ====================================
if lang_enabled java; then
echo -e "${YELLOW}Testing Java...${NC}"
echo "Building Java project..."
cd java && mvn -Dmaven.repo.local="$SCRIPT_DIR/.m2/repository" clean install -q && cd ..
if [ "$TEST_DEFAULT" = true ]; then
    run_test "Java (default)" "java" "mvn -Dmaven.repo.local='$SCRIPT_DIR/.m2/repository' exec:java -q"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "Java (batch)" "java" "mvn -Dmaven.repo.local='$SCRIPT_DIR/.m2/repository' exec:java -q -Dexec.args='--batch --voice-style ../$BATCH_VOICE_STYLE_1,../$BATCH_VOICE_STYLE_2 --text \"$BATCH_TEXT_1|$BATCH_TEXT_2\" --lang $BATCH_LANG_1,$BATCH_LANG_2'"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "Java (long-form)" "java" "mvn -Dmaven.repo.local='$SCRIPT_DIR/.m2/repository' exec:java -q -Dexec.args='--voice-style ../$LONGFORM_VOICE_STYLE --text \"$LONGFORM_TEXT\"'"
fi
fi

# ====================================
# Swift
# ====================================
if lang_enabled swift; then
echo -e "${YELLOW}Testing Swift...${NC}"
echo "Building Swift project..."
cd swift && HOME="$SWIFT_HOME" CLANG_MODULE_CACHE_PATH="$CLANG_MODULE_CACHE_PATH" swift build --disable-sandbox -c release && cd ..
if [ "$TEST_DEFAULT" = true ]; then
    run_test "Swift (default)" "swift" "HOME='$SWIFT_HOME' CLANG_MODULE_CACHE_PATH='$CLANG_MODULE_CACHE_PATH' .build/release/example_onnx"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "Swift (batch)" "swift" "HOME='$SWIFT_HOME' CLANG_MODULE_CACHE_PATH='$CLANG_MODULE_CACHE_PATH' .build/release/example_onnx --batch --voice-style ../$BATCH_VOICE_STYLE_1,../$BATCH_VOICE_STYLE_2 --text '$BATCH_TEXT_1|$BATCH_TEXT_2' --lang $BATCH_LANG_1,$BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "Swift (long-form)" "swift" "HOME='$SWIFT_HOME' CLANG_MODULE_CACHE_PATH='$CLANG_MODULE_CACHE_PATH' .build/release/example_onnx --voice-style ../$LONGFORM_VOICE_STYLE --text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# C++
# ====================================
if lang_enabled cpp; then
echo -e "${YELLOW}Testing C++...${NC}"
echo "Building C++ project..."
cmake -S cpp -B cpp/build && cmake --build cpp/build --config Release
if [ "$TEST_DEFAULT" = true ]; then
    run_test "C++ (default)" "cpp/build" "./example_onnx"
fi
if [ "$TEST_BATCH" = true ]; then
    run_test "C++ (batch)" "cpp/build" "./example_onnx --batch --voice-style ../../$BATCH_VOICE_STYLE_1,../../$BATCH_VOICE_STYLE_2 --text '$BATCH_TEXT_1|$BATCH_TEXT_2' --lang $BATCH_LANG_1,$BATCH_LANG_2"
fi
if [ "$TEST_LONGFORM" = true ]; then
    run_test "C++ (long-form)" "cpp/build" "./example_onnx --voice-style ../../$LONGFORM_VOICE_STYLE --text '$LONGFORM_TEXT'"
fi
fi

# ====================================
# Summary
# ====================================
echo "=================================="
echo "Test Summary"
echo "=================================="
echo ""

if [ ${#PASSED[@]} -gt 0 ]; then
    echo -e "${GREEN}Passed (${#PASSED[@]}):${NC}"
    for lang in "${PASSED[@]}"; do
        echo -e "  ${GREEN}✓${NC} $lang"
    done
    echo ""
fi

if [ ${#FAILED[@]} -gt 0 ]; then
    echo -e "${RED}Failed (${#FAILED[@]}):${NC}"
    for lang in "${FAILED[@]}"; do
        echo -e "  ${RED}✗${NC} $lang"
    done
    echo ""
    exit 1
else
    echo -e "${GREEN}All tests passed! 🎉${NC}"
    exit 0
fi

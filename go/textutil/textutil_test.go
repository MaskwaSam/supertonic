package textutil

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unicode/utf8"
)

type fixtureFile struct {
	Chunking []struct {
		Name     string   `json:"name"`
		Text     string   `json:"text"`
		MaxLen   int      `json:"max_len"`
		Expected []string `json:"expected"`
	} `json:"chunking"`
	InvalidCLI []struct {
		Name  string      `json:"name"`
		Field string      `json:"field"`
		Value interface{} `json:"value"`
	} `json:"invalid_cli"`
}

func loadFixture(t *testing.T) fixtureFile {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	path := filepath.Join(filepath.Dir(file), "..", "..", "tests", "conformance", "conformance.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture fixtureFile
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestChunkingFixture(t *testing.T) {
	for _, tc := range loadFixture(t).Chunking {
		t.Run(tc.Name, func(t *testing.T) {
			actual := ChunkText(tc.Text, tc.MaxLen)
			if len(actual) != len(tc.Expected) {
				t.Fatalf("got %#v, want %#v", actual, tc.Expected)
			}
			for i := range actual {
				if actual[i] != tc.Expected[i] {
					t.Fatalf("got %#v, want %#v", actual, tc.Expected)
				}
				if utf8.RuneCountInString(actual[i]) > tc.MaxLen {
					t.Fatalf("chunk exceeds max: %q", actual[i])
				}
			}
		})
	}
}

func TestInvalidCLIFixture(t *testing.T) {
	base := CLIInputs{TotalStep: 8, Speed: 1.05, NTest: 1, Text: []string{"Hello."}, Lang: []string{"en"}}
	for _, tc := range loadFixture(t).InvalidCLI {
		t.Run(tc.Name, func(t *testing.T) {
			input := base
			switch tc.Field {
			case "total_step":
				input.TotalStep = int(tc.Value.(float64))
			case "speed":
				if tc.Value == "NaN" {
					input.Speed = math.NaN()
				} else {
					input.Speed = tc.Value.(float64)
				}
			case "n_test":
				input.NTest = int(tc.Value.(float64))
			case "text":
				input.Text = []string{tc.Value.(string)}
			case "lang":
				input.Lang = []string{tc.Value.(string)}
			}
			if ValidateCLI(input) == nil {
				t.Fatal("invalid input was accepted")
			}
		})
	}
}

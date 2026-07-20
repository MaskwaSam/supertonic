// Package textutil contains model-free text chunking and CLI validation.
package textutil

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var AvailableLangs = []string{
	"en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es",
	"et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv",
	"nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
}

const (
	MinTotalStep      = 1
	MaxTotalStep      = 100
	MinSpeed          = 0.25
	MaxSpeed          = 4.0
	MinNTest          = 1
	MaxNTest          = 100
	MaxTextCodepoints = 100000
)

var abbreviations = map[string]bool{
	"Dr.": true, "Mr.": true, "Mrs.": true, "Ms.": true, "Prof.": true,
	"Sr.": true, "Jr.": true, "St.": true, "Ave.": true, "Rd.": true,
	"Blvd.": true, "Dept.": true, "Inc.": true, "Ltd.": true, "Co.": true,
	"Corp.": true, "etc.": true, "vs.": true, "i.e.": true, "e.g.": true,
	"Ph.D.": true,
}

func isAbbreviation(prefix string) bool {
	fields := strings.Fields(prefix)
	if len(fields) == 0 {
		return false
	}
	token := fields[len(fields)-1]
	if abbreviations[token] {
		return true
	}
	runes := []rune(token)
	return len(runes) == 2 && unicode.IsUpper(runes[0]) && runes[1] == '.'
}

func splitSentences(text string) []string {
	runes := []rune(text)
	start := 0
	var sentences []string
	for i, r := range runes {
		if r != '.' && r != '!' && r != '?' {
			continue
		}
		if i+1 < len(runes) && !unicode.IsSpace(runes[i+1]) {
			continue
		}
		if r == '.' && isAbbreviation(string(runes[start:i+1])) {
			continue
		}
		if sentence := strings.TrimSpace(string(runes[start : i+1])); sentence != "" {
			sentences = append(sentences, sentence)
		}
		start = i + 1
		for start < len(runes) && unicode.IsSpace(runes[start]) {
			start++
		}
	}
	if tail := strings.TrimSpace(string(runes[start:])); tail != "" {
		sentences = append(sentences, tail)
	}
	return sentences
}

func hardWrap(text string, maxLen int) []string {
	var chunks []string
	current := ""
	for _, rawWord := range strings.Fields(text) {
		wordRunes := []rune(rawWord)
		for len(wordRunes) > maxLen {
			if current != "" {
				chunks = append(chunks, current)
				current = ""
			}
			chunks = append(chunks, string(wordRunes[:maxLen]))
			wordRunes = wordRunes[maxLen:]
		}
		word := string(wordRunes)
		if word == "" {
			continue
		}
		candidate := word
		if current != "" {
			candidate = current + " " + word
		}
		if utf8.RuneCountInString(candidate) <= maxLen {
			current = candidate
		} else {
			chunks = append(chunks, current)
			current = word
		}
	}
	if current != "" {
		chunks = append(chunks, current)
	}
	return chunks
}

// ChunkText returns chunks bounded by Unicode scalar count.
func ChunkText(text string, maxLen int) []string {
	if maxLen <= 0 {
		panic("maxLen must be positive")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return []string{}
	}
	paragraphs := regexp.MustCompile(`\n\s*\n+`).Split(text, -1)
	var chunks []string
	for _, rawParagraph := range paragraphs {
		paragraph := strings.TrimSpace(rawParagraph)
		if paragraph == "" {
			continue
		}
		current := ""
		for _, sentence := range splitSentences(paragraph) {
			if utf8.RuneCountInString(sentence) > maxLen {
				if current != "" {
					chunks = append(chunks, current)
					current = ""
				}
				chunks = append(chunks, hardWrap(sentence, maxLen)...)
				continue
			}
			candidate := sentence
			if current != "" {
				candidate = current + " " + sentence
			}
			if utf8.RuneCountInString(candidate) <= maxLen {
				current = candidate
			} else {
				chunks = append(chunks, current)
				current = sentence
			}
		}
		if current != "" {
			chunks = append(chunks, current)
		}
	}
	return chunks
}

type CLIInputs struct {
	TotalStep int
	Speed     float64
	NTest     int
	Text      []string
	Lang      []string
}

func ValidateCLI(v CLIInputs) error {
	if v.TotalStep < MinTotalStep || v.TotalStep > MaxTotalStep {
		return fmt.Errorf("-total-step must be between %d and %d", MinTotalStep, MaxTotalStep)
	}
	if math.IsNaN(v.Speed) || math.IsInf(v.Speed, 0) || v.Speed < MinSpeed || v.Speed > MaxSpeed {
		return fmt.Errorf("-speed must be finite and between %.2f and %.2f", MinSpeed, MaxSpeed)
	}
	if v.NTest < MinNTest || v.NTest > MaxNTest {
		return fmt.Errorf("-n-test must be between %d and %d", MinNTest, MaxNTest)
	}
	if len(v.Text) == 0 {
		return fmt.Errorf("at least one -text value is required")
	}
	for _, text := range v.Text {
		if strings.TrimSpace(text) == "" {
			return fmt.Errorf("-text values must not be blank")
		}
		if utf8.RuneCountInString(text) > MaxTextCodepoints {
			return fmt.Errorf("-text values must not exceed %d Unicode scalar values", MaxTextCodepoints)
		}
	}
	allowed := make(map[string]bool, len(AvailableLangs))
	for _, lang := range AvailableLangs {
		allowed[lang] = true
	}
	for _, lang := range v.Lang {
		if !allowed[lang] {
			return fmt.Errorf("unsupported language code: %s", lang)
		}
	}
	return nil
}

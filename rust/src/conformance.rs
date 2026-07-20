//! Pure, model-free text chunking and CLI validation.

pub const AVAILABLE_LANGS: &[&str] = &[
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu",
    "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
];

pub const MIN_TOTAL_STEP: usize = 1;
pub const MAX_TOTAL_STEP: usize = 100;
pub const MIN_SPEED: f32 = 0.25;
pub const MAX_SPEED: f32 = 4.0;
pub const MIN_N_TEST: usize = 1;
pub const MAX_N_TEST: usize = 100;
pub const MAX_TEXT_CODEPOINTS: usize = 100_000;

const ABBREVIATIONS: &[&str] = &[
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.", "St.", "Ave.", "Rd.", "Blvd.", "Dept.",
    "Inc.", "Ltd.", "Co.", "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D.",
];

fn is_abbreviation(prefix: &[char]) -> bool {
    let text: String = prefix.iter().collect();
    let token = text.split_whitespace().last().unwrap_or("");
    ABBREVIATIONS.contains(&token)
        || (token.chars().count() == 2
            && token.chars().next().is_some_and(char::is_uppercase)
            && token.ends_with('.'))
}

fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if matches!(ch, '.' | '!' | '?')
            && (i + 1 == chars.len() || chars[i + 1].is_whitespace())
            && !(ch == '.' && is_abbreviation(&chars[start..=i]))
        {
            let sentence: String = chars[start..=i]
                .iter()
                .collect::<String>()
                .trim()
                .to_string();
            if !sentence.is_empty() {
                sentences.push(sentence);
            }
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            start = i;
            continue;
        }
        i += 1;
    }
    let tail: String = chars[start..].iter().collect::<String>().trim().to_string();
    if !tail.is_empty() {
        sentences.push(tail);
    }
    sentences
}

fn hard_wrap(text: &str, max_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for raw_word in text.split_whitespace() {
        let mut word: Vec<char> = raw_word.chars().collect();
        while word.len() > max_len {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            chunks.push(word.drain(..max_len).collect());
        }
        if word.is_empty() {
            continue;
        }
        let word: String = word.into_iter().collect();
        let candidate = if current.is_empty() {
            word.clone()
        } else {
            format!("{current} {word}")
        };
        if candidate.chars().count() <= max_len {
            current = candidate;
        } else {
            chunks.push(std::mem::replace(&mut current, word));
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

pub fn chunk_text(text: &str, max_len: usize) -> Vec<String> {
    assert!(max_len > 0, "max_len must be positive");
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }

    let mut paragraphs = Vec::new();
    let mut paragraph = String::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !paragraph.trim().is_empty() {
                paragraphs.push(std::mem::take(&mut paragraph));
            }
        } else {
            if !paragraph.is_empty() {
                paragraph.push(' ');
            }
            paragraph.push_str(line.trim());
        }
    }
    if !paragraph.trim().is_empty() {
        paragraphs.push(paragraph);
    }

    let mut chunks = Vec::new();
    for paragraph in paragraphs {
        let mut current = String::new();
        for sentence in split_sentences(&paragraph) {
            if sentence.chars().count() > max_len {
                if !current.is_empty() {
                    chunks.push(std::mem::take(&mut current));
                }
                chunks.extend(hard_wrap(&sentence, max_len));
                continue;
            }
            let candidate = if current.is_empty() {
                sentence.clone()
            } else {
                format!("{current} {sentence}")
            };
            if candidate.chars().count() <= max_len {
                current = candidate;
            } else {
                chunks.push(std::mem::replace(&mut current, sentence));
            }
        }
        if !current.is_empty() {
            chunks.push(current);
        }
    }
    chunks
}

pub struct CliInputs<'a> {
    pub total_step: usize,
    pub speed: f32,
    pub n_test: usize,
    pub text: &'a [String],
    pub lang: &'a [String],
}

pub fn validate_cli(values: CliInputs<'_>) -> Result<(), String> {
    if !(MIN_TOTAL_STEP..=MAX_TOTAL_STEP).contains(&values.total_step) {
        return Err(format!(
            "--total-step must be between {MIN_TOTAL_STEP} and {MAX_TOTAL_STEP}"
        ));
    }
    if !values.speed.is_finite() || !(MIN_SPEED..=MAX_SPEED).contains(&values.speed) {
        return Err(format!(
            "--speed must be finite and between {MIN_SPEED} and {MAX_SPEED}"
        ));
    }
    if !(MIN_N_TEST..=MAX_N_TEST).contains(&values.n_test) {
        return Err(format!(
            "--n-test must be between {MIN_N_TEST} and {MAX_N_TEST}"
        ));
    }
    if values.text.is_empty() || values.text.iter().any(|text| text.trim().is_empty()) {
        return Err("--text values must not be blank".to_string());
    }
    if values
        .text
        .iter()
        .any(|text| text.chars().count() > MAX_TEXT_CODEPOINTS)
    {
        return Err(format!(
            "--text values must not exceed {MAX_TEXT_CODEPOINTS} Unicode scalar values"
        ));
    }
    if values.lang.is_empty()
        || values
            .lang
            .iter()
            .any(|lang| !AVAILABLE_LANGS.contains(&lang.as_str()))
    {
        return Err("unsupported or missing language code".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_chunk_cases() {
        let cases = [
            ("   \n\n  ", 12, vec![]),
            (
                "안녕하세요 세계. Café déjà vu.",
                14,
                vec!["안녕하세요 세계.", "Café déjà vu."],
            ),
            (
                "Dr. Lee arrived. Next.",
                15,
                vec!["Dr. Lee", "arrived.", "Next."],
            ),
            ("abcdefghijk", 4, vec!["abcd", "efgh", "ijk"]),
            (
                "alpha beta\n\ngamma delta",
                20,
                vec!["alpha beta", "gamma delta"],
            ),
        ];
        for (text, max_len, expected) in cases {
            assert_eq!(chunk_text(text, max_len), expected);
        }
    }

    #[test]
    fn cli_bounds_are_enforced() {
        let text = vec!["Hello.".to_string()];
        let lang = vec!["en".to_string()];
        assert!(validate_cli(CliInputs {
            total_step: 8,
            speed: 1.05,
            n_test: 1,
            text: &text,
            lang: &lang
        })
        .is_ok());
        assert!(validate_cli(CliInputs {
            total_step: 0,
            speed: 1.05,
            n_test: 1,
            text: &text,
            lang: &lang
        })
        .is_err());
        assert!(validate_cli(CliInputs {
            total_step: 8,
            speed: f32::NAN,
            n_test: 1,
            text: &text,
            lang: &lang
        })
        .is_err());
        assert!(validate_cli(CliInputs {
            total_step: 8,
            speed: 1.05,
            n_test: 101,
            text: &text,
            lang: &lang
        })
        .is_err());
    }
}

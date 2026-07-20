use clap::Parser;
use std::fs;
use std::path::PathBuf;

mod conformance;
mod error;
mod helper;

use conformance::{validate_cli, CliInputs};
use error::{message, Result};
use helper::{load_text_to_speech, load_voice_style, sanitize_filename, timer, write_wav_file};

#[derive(Parser, Debug)]
#[command(name = "TTS ONNX Inference")]
#[command(about = "TTS Inference with ONNX Runtime (Rust)", long_about = None)]
struct Args {
    #[arg(long, default_value = "false")]
    use_gpu: bool,

    #[arg(long, default_value = "../assets/onnx")]
    onnx_dir: String,

    #[arg(long, default_value = "8")]
    total_step: usize,

    #[arg(long, default_value = "1.05")]
    speed: f32,

    #[arg(long, default_value = "4")]
    n_test: usize,

    #[arg(long, value_delimiter = ',', default_values_t = vec!["../assets/voice_styles/M1.json".to_string()])]
    voice_style: Vec<String>,

    #[arg(long, value_delimiter = '|', default_values_t = vec!["This morning, I took a walk in the park, and the sound of the birds and the breeze was so pleasant that I stopped for a long time just to listen.".to_string()])]
    text: Vec<String>,

    #[arg(long, value_delimiter = ',', default_values_t = vec!["en".to_string()])]
    lang: Vec<String>,

    #[arg(long, default_value = "results")]
    save_dir: String,

    #[arg(long, default_value = "false")]
    batch: bool,
}

fn main() -> Result<()> {
    println!("=== TTS Inference with ONNX Runtime (Rust) ===\n");

    let args = Args::parse();
    let total_step = args.total_step;
    let speed = args.speed;
    let n_test = args.n_test;
    let voice_style_paths = &args.voice_style;
    let text_list = &args.text;
    let lang_list = &args.lang;
    let save_dir = &args.save_dir;
    let batch = args.batch;

    validate_cli(CliInputs {
        total_step,
        speed,
        n_test,
        text: text_list,
        lang: lang_list,
    })
    .map_err(message)?;

    if batch {
        if voice_style_paths.len() != text_list.len() {
            return Err(message(format!(
                "Number of voice styles ({}) must match number of texts ({})",
                voice_style_paths.len(),
                text_list.len()
            )));
        }
        if lang_list.len() != text_list.len() {
            return Err(message(format!(
                "Number of languages ({}) must match number of texts ({})",
                lang_list.len(),
                text_list.len()
            )));
        }
    } else if voice_style_paths.len() != 1 || text_list.len() != 1 || lang_list.len() != 1 {
        return Err(message(
            "multiple voice styles, texts, or languages require --batch",
        ));
    }

    let bsz = if batch { voice_style_paths.len() } else { 1 };
    let mut text_to_speech = load_text_to_speech(&args.onnx_dir, args.use_gpu)?;
    let style = load_voice_style(voice_style_paths, true)?;
    fs::create_dir_all(save_dir)?;

    for n in 0..n_test {
        println!("\n[{}/{}] Starting synthesis...", n + 1, n_test);

        let (wav, duration) = if batch {
            timer("Generating speech from text", || {
                text_to_speech.batch(text_list, lang_list, &style, total_step, speed)
            })?
        } else {
            let (w, d) = timer("Generating speech from text", || {
                text_to_speech.call(&text_list[0], &lang_list[0], &style, total_step, speed, 0.3)
            })?;
            (w, vec![d])
        };

        for i in 0..bsz {
            let fname = format!("{}_{}.wav", sanitize_filename(&text_list[i], 20), n + 1);
            let wav_slice = if batch {
                let wav_len = wav.len() / bsz;
                let actual_len = (text_to_speech.sample_rate as f32 * duration[i]) as usize;
                let wav_start = i * wav_len;
                let wav_end = wav_start + actual_len.min(wav_len);
                &wav[wav_start..wav_end]
            } else {
                let actual_len = (text_to_speech.sample_rate as f32 * duration[0]) as usize;
                &wav[..actual_len.min(wav.len())]
            };

            let output_path = PathBuf::from(save_dir).join(&fname);
            write_wav_file(&output_path, wav_slice, text_to_speech.sample_rate)?;
            println!("Saved: {}", output_path.display());
        }
    }

    println!("\n=== Synthesis completed successfully! ===");
    Ok(())
}

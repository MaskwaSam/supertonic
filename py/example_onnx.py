import argparse
import os
from text_utils import CliInputs, validate_cli_inputs


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="TTS Inference with ONNX")

    parser.add_argument(
        "--use-gpu", action="store_true", help="Use GPU for inference (default: CPU)"
    )
    parser.add_argument(
        "--onnx-dir",
        type=str,
        default="../assets/onnx",
        help="Path to ONNX model directory",
    )
    parser.add_argument(
        "--total-step", type=int, default=8, help="Number of denoising steps"
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=1.05,
        help="Speech speed (default: 1.05, higher = faster)",
    )
    parser.add_argument(
        "--n-test", type=int, default=4, help="Number of times to generate"
    )
    parser.add_argument("--batch", action="store_true", help="Batch processing")
    parser.add_argument(
        "--voice-style",
        type=str,
        nargs="+",
        default=["../assets/voice_styles/M1.json"],
        help="Voice style file path(s). Can specify multiple files for batch processing",
    )
    parser.add_argument(
        "--text",
        type=str,
        nargs="+",
        default=[
            "This morning, I took a walk in the park, and the sound of the birds and the breeze was so pleasant that I stopped for a long time just to listen."
        ],
        help="Text(s) to synthesize. Can specify multiple texts for batch processing",
    )
    parser.add_argument(
        "--lang",
        type=str,
        nargs="+",
        default=["en"],
        help="Language(s) of the text(s). Can specify multiple languages for batch processing",
    )
    parser.add_argument(
        "--save-dir", type=str, default="results", help="Output directory"
    )

    return parser.parse_args(argv), parser


def main(argv=None):
    print("=== TTS Inference with ONNX Runtime (Python) ===\n")
    args, parser = parse_args(argv)
    try:
        validate_cli_inputs(CliInputs(
            total_step=args.total_step,
            speed=args.speed,
            n_test=args.n_test,
            text=args.text,
            lang=args.lang,
        ))
        if args.batch:
            if len(args.voice_style) != len(args.text):
                raise ValueError(
                    f"Number of voice styles ({len(args.voice_style)}) must match number of texts ({len(args.text)})"
                )
            if len(args.lang) != len(args.text):
                raise ValueError(
                    f"Number of languages ({len(args.lang)}) must match number of texts ({len(args.text)})"
                )
        elif len(args.voice_style) != 1 or len(args.text) != 1 or len(args.lang) != 1:
            raise ValueError("Multiple voice styles, texts, or languages require --batch")
    except ValueError as exc:
        parser.error(str(exc))

    # Import model/runtime dependencies only after all inputs are validated.
    import soundfile as sf
    from helper import load_text_to_speech, timer, sanitize_filename, load_voice_style

    bsz = len(args.voice_style) if args.batch else 1
    text_to_speech = load_text_to_speech(args.onnx_dir, args.use_gpu)
    style = load_voice_style(args.voice_style, verbose=True)

    for n in range(args.n_test):
        print(f"\n[{n+1}/{args.n_test}] Starting synthesis...")
        with timer("Generating speech from text"):
            if args.batch:
                wav, duration = text_to_speech.batch(
                    args.text, args.lang, style, args.total_step, args.speed
                )
            else:
                wav, duration = text_to_speech(
                    args.text[0], args.lang[0], style, args.total_step, args.speed
                )
        os.makedirs(args.save_dir, exist_ok=True)
        for b in range(bsz):
            fname = f"{sanitize_filename(args.text[b], 20)}_{n+1}.wav"
            w = wav[b, : int(text_to_speech.sample_rate * duration[b].item())]
            sf.write(os.path.join(args.save_dir, fname), w, text_to_speech.sample_rate)
            print(f"Saved: {args.save_dir}/{fname}")
    print("\n=== Synthesis completed successfully! ===")


if __name__ == "__main__":
    main()

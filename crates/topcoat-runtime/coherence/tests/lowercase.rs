use std::fmt::Write;

use topcoat::runtime::expr;
use topcoat_runtime_coherence::{Case, coherent};

// Compare to ordinary Rust as well as to the server surrogate. Agreement
// between two incorrect surrogate implementations must not pass these tests.
fn assert_lowercase(input: &str) {
    let compiled = expr!(input.to_lowercase());
    assert_eq!(
        compiled.clone().into_evaluated_and_js().0,
        input.to_lowercase()
    );
    Case::evaluated("input.to_lowercase()", compiled).assert();
}

#[test]
fn lowercase_strings_and_composition() {
    for input in [
        "",
        "already lowercase 123",
        "ASCII MiXeD",
        "\u{00c9}\u{0416}\u{0391}\u{4e2d}\u{1f980}",
        "I\u{0130}\u{0131}i",
        "\u{03a3}",
        "\u{039f}\u{03a3}",
        "\u{039f}\u{03a3}\u{0391}",
        "A\u{0301}\u{03a3}\u{0301}",
        "A\u{03a3}\u{0301}B",
        "A'\u{03a3}'",
        "A\u{03a3}'B",
        "\u{0345}\u{03a3}",
        "A\u{03a3}\u{0345}",
        "A\u{03a3}\u{0345}B",
        "A \u{03a3}",
        "A\u{03a3} B",
        "\u{10400}\u{104b0}\u{1e900}",
        // Unicode 16 and 17 additions, absent from older browser tables.
        "\u{1c89}\u{a7ce}\u{10d50}\u{16ea0}",
        // These mappings and Cased properties differ between Unicode 17 and 18.
        "\u{a7dd}\u{03a3} A\u{03a3}\u{a7dd} \u{1df40}",
        "A\u{0558}\u{03a3} A\u{03a3}\u{0558}B",
        "\0\u{10ffff}",
    ] {
        assert_lowercase(input);
        let owned = input.to_owned();
        assert_eq!(
            expr!(owned.to_lowercase()).into_evaluated_and_js().0,
            owned.to_lowercase()
        );
        coherent!(owned.to_lowercase());
        coherent!(owned.trim().to_lowercase().contains("a"));
        coherent!(owned.to_lowercase().len());
        coherent!(direct => owned.to_lowercase());
    }
    coherent!("HELLO".to_lowercase());
}

#[test]
fn compiled_lowercase_carries_the_target_unicode_version() {
    let (_, js) = expr!("HELLO".to_lowercase()).into_evaluated_and_js();
    let (major, minor, patch) = char::UNICODE_VERSION;
    let version = format!("{major}.{minor}.{patch}");
    assert!(js.to_source().contains(&version));
}

#[test]
fn every_unicode_scalar_and_sigma_context_matches_rust() {
    // Null separates contexts. Batching avoids a V8 context per scalar while
    // keeping failure reports bounded. These contexts distinguish Cased,
    // Case_Ignorable, their intersection, and neither, on both sides of sigma.
    for start in (0..=0x0010_ffff).step_by(4096) {
        let mut input = String::new();
        for code in start..=(start + 4095).min(0x0010_ffff) {
            if let Some(c) = char::from_u32(code) {
                write!(
                    input,
                    "{c}\0{c}\u{03a3}\0A{c}\u{03a3}\0A\u{03a3}{c}\0A\u{03a3}{c}A\0"
                )
                .unwrap();
            }
        }
        assert_lowercase(&input);
    }
}

#[test]
fn long_case_ignorable_context() {
    let marks = "\u{0301}".repeat(16_384);
    assert_lowercase(&format!("A{marks}\u{03a3}{marks}"));
    assert_lowercase(&format!("A{marks}\u{03a3}{marks}B"));
}

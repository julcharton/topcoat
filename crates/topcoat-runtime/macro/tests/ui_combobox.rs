//! Compiles the installable UI source and records its actual HTML/handlers.

#[path = "../../../topcoat-ui/registry/src/components/combobox.rs"]
mod combobox_source;
#[path = "../../../topcoat-ui/registry/src/components/floating.rs"]
mod floating;
#[path = "../../../topcoat-ui/registry/src/components/input.rs"]
mod input;

use combobox_source::{ComboboxOption, ComboboxState, combobox, combobox_results};
use serde_json::{Value, json};
use topcoat::{
    Result,
    context::Cx,
    runtime::{Event, SignalValues, shard, signal},
    view::{Attributes, View, ViewExt, attributes, component, view},
};

fn catalog(version: &str) -> Vec<ComboboxOption> {
    let mut options = [
        ("alpha", "Alpha", false),
        ("beta", "Beta", true),
        ("gamma", "Gamma", false),
        ("aland", "\u{00c5}land", false),
        ("duplicate", "Alpha", false),
    ]
    .into_iter()
    .map(|(value, label, disabled)| ComboboxOption {
        value: value.to_owned(),
        label: label.to_owned(),
        disabled,
    })
    .collect::<Vec<_>>();
    match version {
        "large" => {
            options.extend((5..1000).map(|index| ComboboxOption {
                value: format!("value-{index}"),
                label: format!("Option {index}"),
                disabled: false,
            }));
            // Put Gamma at the far end so retaining it must inspect the new data
            // and update its navigation index rather than reuse the old position.
            options.rotate_left(3);
        }
        "active_removed" => options.retain(|option| option.value != "gamma"),
        "active_disabled" => options[2].disabled = true,
        "removed" => options.retain(|option| option.value != "alpha"),
        "disabled" => options[0].disabled = true,
        "renamed" => "New Alpha".clone_into(&mut options[0].label),
        "reordered" => options.reverse(),
        _ => {}
    }
    options
}

#[shard("/combobox-test-results")]
async fn results(state: ComboboxState, version: String) -> Result<impl View> {
    let options = catalog(&version);
    Ok(view! { combobox_results(state: state, options: &options) })
}

#[component]
async fn harness(
    cx: &Cx,
    version: &str,
    default: Option<&str>,
    #[default(false)] required: bool,
    #[default(false)] disabled: bool,
    #[default("owner")] owner: &str,
    #[default("Region")] label: &str,
    #[default("")] naming: &str,
    #[default] attrs: Attributes,
) -> Result<impl View> {
    // Initial selection is stable while the shard's catalog changes independently.
    let options = catalog("initial");
    let state = ComboboxState::new(cx, &options, default)?;
    let submits = signal(cx, || 0usize);
    let caption = format!("{owner}-caption");
    Ok(view! {
        <form
            id=(owner)
            @submit=$(|event: Event| {
                event.prevent_default();
                submits.increment();
            })
        >
            <button type="reset">"Reset"</button>
            <button>"Submit"</button>
        </form>
        <output id="submits">$(submits.get())</output>
        <fieldset id="fieldset">
            <label id=(state.label_id()) for=(state.input_id())>(label)</label>
            <span id=(&caption)>"Region caption"</span>
            combobox(
                state: state.clone(),
                name: "region",
                form: Some(owner),
                required: required,
                disabled: disabled,
                attrs: attributes! {
                    (attrs)
                    placeholder="Choose a region"
                    aria-describedby="hint"
                    if naming == "aria-label" {
                        aria-label="Deploy region"
                    }
                    if naming == "aria-labelledby" {
                        aria-labelledby=(&caption)
                        aria-label="Unused name"
                    }
                },
                results(state: state.clone(), version: version.to_owned())
            )
            <p id="hint">"Choose an available region."</p>
        </fieldset>
        <button id="outside">"Outside"</button>
    })
}

#[component]
async fn optional_naming(cx: &Cx, naming: &str, #[default] attrs: Attributes) -> Result<impl View> {
    let label = signal(cx, || None::<String>);
    let labelledby = signal(cx, || None::<String>);
    Ok(view! {
        <button @click=$(|_event: Event| label.set(Some("Deploy region".to_owned())))>
            "Set label"
        </button>
        <button @click=$(|_event: Event| label.set(None))>"Clear label"</button>
        <button @click=$(|_event: Event| label.set(Some(" \t ".to_owned())))>
            "Blank label"
        </button>
        <button
            @click=$(|_event: Event| label.set(
                    Some("Deploy <region> & \"zone\"".to_owned()),
                ))
        >
            "Quoted label"
        </button>
        <button
            @click=$(|_event: Event| labelledby.set(Some("owner-caption".to_owned())))
        >
            "Set reference"
        </button>
        <button @click=$(|_event: Event| labelledby.set(None))>
            "Clear reference"
        </button>
        harness(
            version: "initial",
            default: None,
            attrs: attributes! {
                (attrs)
                if naming != "aria-labelledby" {
                    :aria-label=$(label.get())
                }
                if naming != "aria-label" {
                    :aria-labelledby=$(labelledby.get())
                }
            }
        )
    })
}

async fn multiple(keys: &[&str]) -> String {
    let cx = &Cx::default();
    stable_html(
        &view! {
            cx =>
            #[key(key)]
            for key in keys {
                harness(version: "initial", default: None, owner: key, label: key)
            }
        }
        .single()
        .await
        .unwrap()
        .render(cx),
    )
}

async fn render(values: Value, version: &str, default: Option<&str>) -> String {
    let values: SignalValues = serde_json::from_value(values).unwrap();
    let cx = &Cx::default().with(values);
    stable_html(
        &view! { cx => harness(version: version, default: default) }
            .single()
            .await
            .unwrap()
            .render(cx),
    )
}

/// Attributes uses a `HashMap`. Canonicalize only attribute order, preserving the
/// exact compiled expressions, values, and markup for the drift assertion.
fn stable_html(html: &str) -> String {
    let mut output = String::new();
    let mut remaining = html;
    while let Some((before, tag)) = remaining.split_once('<') {
        output.push_str(before);
        if tag.starts_with("!--") {
            let (comment, after) = tag.split_once("-->").unwrap();
            output.push('<');
            output.push_str(comment);
            output.push_str("-->");
            remaining = after;
            continue;
        }
        let mut quoted = false;
        let end = tag
            .char_indices()
            .find_map(|(index, character)| {
                if character == '"' {
                    quoted = !quoted;
                }
                (character == '>' && !quoted).then_some(index)
            })
            .unwrap();
        let mut start = 0;
        let mut parts = Vec::new();
        for (index, character) in tag[..end].char_indices() {
            if character == '"' {
                quoted = !quoted;
            }
            if character.is_ascii_whitespace() && !quoted {
                if start != index {
                    parts.push(&tag[start..index]);
                }
                start = index + character.len_utf8();
            }
        }
        if start != end {
            parts.push(&tag[start..end]);
        }
        parts[1..].sort_unstable();
        output.push('<');
        output.push_str(&parts.join(" "));
        output.push('>');
        remaining = &tag[end + 1..];
    }
    output.push_str(remaining);
    output
}

fn declarations(html: &str) -> Vec<Value> {
    html.split("<!--::topcoat::signal(")
        .skip(1)
        .map(|part| {
            let json = part
                .split_once(")-->")
                .unwrap()
                .0
                .replace("&quot;", "\"")
                .replace("&amp;", "&");
            serde_json::from_str(&json).expect(&json)
        })
        .collect()
}

fn result_html(html: &str) -> &str {
    let start = html.split_once("<!--::topcoat::shard::start(").unwrap().1;
    start
        .split_once("-->")
        .unwrap()
        .1
        .split_once("<!--::topcoat::shard::end(")
        .unwrap()
        .0
}

fn search_values(signals: &[Value], query: &str, revision: usize, clear: bool) -> Value {
    let search = signals
        .iter()
        .find(|signal| signal["v"]["v"]["query"].is_string())
        .unwrap();
    let mut request = search["v"].clone();
    request["v"]["query"] = query.into();
    request["v"]["revision"]["v"] = revision.to_string().into();
    let mut values = json!({search["id"].as_str().unwrap(): request});
    if clear {
        let selection = signals
            .iter()
            .find(|signal| signal["v"]["v"]["v"]["value"] == "alpha")
            .unwrap();
        values[selection["id"].as_str().unwrap()] = json!({"t":"Option", "v":null});
    }
    values
}

#[tokio::test]
async fn compiled_combobox_fixture_is_current() {
    let initial = render(json!({}), "initial", Some("alpha")).await;
    let declarations = declarations(&initial);
    let mut fixture = json!({"initial": initial, "signals": declarations});
    fixture["empty"] = render(json!({}), "initial", None).await.into();
    fixture["disabled_default"] = render(json!({}), "initial", Some("beta")).await.into();
    fixture["missing_default"] = render(json!({}), "initial", Some("missing")).await.into();
    let cx = &Cx::default();
    fixture["required"] = stable_html(
        &view! { cx => harness(version: "initial", default: None, required: true) }
            .single()
            .await
            .unwrap()
            .render(cx),
    )
    .into();
    fixture["disabled"] = stable_html(
        &view! {
            cx =>
            harness(version: "initial", default: Some("alpha"), disabled: true)
        }
        .single()
        .await
        .unwrap()
        .render(cx),
    )
    .into();
    fixture["multiple"] = multiple(&["one", "two"]).await.into();
    fixture["reordered"] = multiple(&["two", "one"]).await.into();
    for naming in ["aria-label", "aria-labelledby"] {
        fixture[naming] = stable_html(
            &view! { cx => harness(version: "initial", default: None, naming: naming) }
                .single()
                .await
                .unwrap()
                .render(cx),
        )
        .into();
    }
    for naming in ["aria-label", "aria-labelledby", "both"] {
        fixture["optional_naming"][naming] = stable_html(
            &view! { cx => optional_naming(naming: naming) }
                .single()
                .await
                .unwrap()
                .render(cx),
        )
        .into();
    }
    for (name, naming, attrs) in [
        (
            "static_label",
            "aria-labelledby",
            attributes! { cx => aria-label="Deploy region" },
        ),
        (
            "static_reference",
            "aria-label",
            attributes! { cx => aria-labelledby="owner-caption" },
        ),
    ] {
        fixture["optional_naming"][name] = stable_html(
            &view! { cx => optional_naming(naming: naming, attrs: attrs) }
                .single()
                .await
                .unwrap()
                .render(cx),
        )
        .into();
    }
    for (name, query, revision) in [
        ("ga1", "ga", 1),
        ("zz2", "zz", 2),
        ("ga3", "ga", 3),
        ("empty2", "", 2),
        ("empty4", "", 4),
        ("unicode1", "\u{00e5}", 1),
    ] {
        let html = render(
            search_values(&declarations, query, revision, true),
            "initial",
            Some("alpha"),
        )
        .await;
        fixture["search"][name] = result_html(&html).into();
    }
    // The full catalog is authoritative for selection/default reconciliation.
    for version in [
        "removed",
        "disabled",
        "renamed",
        "reordered",
        "large",
        "active_removed",
        "active_disabled",
    ] {
        let html = render(json!({}), version, Some("alpha")).await;
        fixture["catalog"][version] = result_html(&html).into();
    }
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../browser/tests/ui-combobox.json"
    );
    if std::env::var_os("UPDATE_COMBOBOX_FIXTURE").is_some() {
        std::fs::write(path, serde_json::to_string_pretty(&fixture).unwrap() + "\n").unwrap();
    }
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        fixture, expected,
        "regenerate with UPDATE_COMBOBOX_FIXTURE=1 cargo test -p topcoat-runtime-macro --test ui_combobox"
    );
}

#[test]
fn rejects_ambiguous_values() {
    let cx = Cx::default();
    let mut options = catalog("initial");
    options[1].value = options[0].value.clone();
    assert!(ComboboxState::new(&cx, &options, None).is_err());
    options[1].value.clear();
    assert!(ComboboxState::new(&cx, &options, None).is_err());
}

#[tokio::test]
async fn identities_are_distinct_stable_and_follow_keys() {
    fn input_ids(html: &str) -> Vec<&str> {
        html.split("<label for=\"")
            .skip(1)
            .map(|part| part.split_once('"').unwrap().0)
            .collect()
    }

    let html = render(json!({}), "initial", None).await;
    let signals = declarations(&html);
    let ids = signals
        .iter()
        .map(|signal| signal["id"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(
        ids.len(),
        signals.len(),
        "each state field needs its own signal identity"
    );
    let first = multiple(&["one", "two"]).await;
    let again = multiple(&["one", "two"]).await;
    let reversed = multiple(&["two", "one"]).await;
    let ids = input_ids(&first);
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    assert_eq!(input_ids(&again), ids);
    assert_eq!(
        input_ids(&reversed),
        ids.into_iter().rev().collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn unicode_search_is_server_only_and_preserves_order_and_duplicate_labels() {
    let initial = render(json!({}), "initial", Some("alpha")).await;
    assert_eq!(result_html(&initial).matches("role=\"option\"").count(), 5);
    let signals = declarations(&initial);
    let matched = render(
        search_values(&signals, "\u{00e5}", 1, true),
        "initial",
        Some("alpha"),
    )
    .await;
    let markup = result_html(&matched);
    assert_eq!(markup.matches("role=\"option\"").count(), 1);
    assert!(markup.contains("\u{00c5}land"));
    assert!(!markup.contains("Gamma"));
    assert!(!markup.contains("Beta"));
    assert!(!markup.contains("toLowerCase"));
    let empty = render(
        search_values(&signals, "unknown", 1, true),
        "initial",
        Some("alpha"),
    )
    .await;
    assert!(!result_html(&empty).contains("role=\"option\""));
    assert!(result_html(&empty).contains("role=\"status\""));
}

#[tokio::test]
async fn accepted_result_code_has_constant_structure_as_the_catalog_grows() {
    fn without_rows(html: &str, expected_rows: usize) -> String {
        let encoded = html
            .split_once("data-topcoat-after-render=\"")
            .unwrap()
            .1
            .split_once('"')
            .unwrap()
            .0;
        let source = encoded.replace("&quot;", "\"").replace("&amp;", "&");
        let capture = "cx.hydrate({\"t\":\"Slice\"";
        assert_eq!(source.matches(capture).count(), 1);
        let start = source.find(capture).unwrap() + "cx.hydrate(".len();
        // Decode the generated row JSON, preserving every executable byte.
        let mut json = serde_json::Deserializer::from_str(&source[start..]).into_iter::<Value>();
        let rows = json.next().unwrap().unwrap();
        assert_eq!(rows["v"].as_array().unwrap().len(), expected_rows);
        let end = start + json.byte_offset();
        assert!(source[end..].starts_with(')'));
        format!("{}ROWS{}", &source[..start], &source[end..])
    }
    let small = render(json!({}), "initial", Some("alpha")).await;
    let large = render(json!({}), "large", Some("alpha")).await;
    assert_eq!(without_rows(&small, 4), without_rows(&large, 999));
}

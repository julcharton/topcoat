use std::panic::catch_unwind;

use topcoat::{
    Result,
    context::Cx,
    runtime::{
        DialogElement, ElementRef, Event, HtmlElement, InputElement, ScrollAlignment,
        ScrollBehavior, ScrollIntoViewOptions, SelectElement, TextAreaElement, expr,
    },
    view::{View, ViewExt, component, element_id, view},
};

#[component]
async fn field(cx: &Cx, key: usize) -> Result<impl View> {
    let input = ElementRef::<InputElement>::new(element_id(cx));
    Ok(view! {
        <input id=(input.id()) data-key=(key)>
        <button
            data-key=(key)
            @click=$(|_e| {
                input.resolve().unwrap().focus(true).unwrap();
            })
        >
            "Focus"
        </button>
    })
}

async fn keyed_fields(keys: &[usize]) -> String {
    let cx = &Cx::default();
    view! {
        cx =>
        #[key(key)]
        for key in keys {
            field(key: *key)
        }
    }
    .single()
    .await
    .unwrap()
    .render(cx)
}

#[test]
fn server_execution_is_rejected_before_any_action() {
    let input = ElementRef::<InputElement>::new("field");
    let options = ScrollIntoViewOptions::default();
    assert!(catch_unwind(|| expr!(input.resolve().unwrap().focus(true))).is_err());
    assert!(catch_unwind(|| expr!(input.resolve().unwrap().scroll_into_view(options))).is_err());
    let (handler, _) = expr!(|| {
        input
            .resolve()
            .unwrap()
            .set_custom_validity("Invalid")
            .unwrap();
    })
    .into_evaluated_and_js();
    assert!(catch_unwind(handler).is_err());
    let dialog = ElementRef::<DialogElement>::new("dialog");
    assert!(catch_unwind(|| expr!(dialog.resolve().unwrap().show_modal())).is_err());
    let html = ElementRef::<HtmlElement>::new("container");
    assert!(catch_unwind(|| expr!(html.resolve().unwrap().show_popover())).is_err());
}

#[tokio::test]
async fn browser_fixture_matches_compiled_actions() {
    let input = ElementRef::<InputElement>::new("field");
    let select = ElementRef::<SelectElement>::new("select");
    let textarea = ElementRef::<TextAreaElement>::new("textarea");
    let dialog = ElementRef::<DialogElement>::new("dialog");
    let html = ElementRef::<HtmlElement>::new("container");
    let mut fixture = serde_json::json!({
        "form_error": expr!(|element: InputElement| element.form_target().unwrap_err().is_disconnected()).into_evaluated_and_js().1.to_source(),
        "focus": expr!(|| input.resolve().unwrap().focus(true)).into_evaluated_and_js().1.to_source(),
        "focus_scroll": expr!(|| input.resolve().unwrap().focus(false)).into_evaluated_and_js().1.to_source(),
        "contains": expr!(|e: Event| html.resolve().unwrap().contains(e.target)).into_evaluated_and_js().1.to_source(),
        "show_popover": expr!(|| html.resolve().unwrap().show_popover()).into_evaluated_and_js().1.to_source(),
        "hide_popover": expr!(|| html.resolve().unwrap().hide_popover()).into_evaluated_and_js().1.to_source(),
        "show_modal": expr!(|| dialog.resolve().unwrap().show_modal()).into_evaluated_and_js().1.to_source(),
        "close": expr!(|| dialog.resolve().unwrap().close("accepted")).into_evaluated_and_js().1.to_source(),
        "keyed": keyed_fields(&[1, 2]).await,
        "reordered": keyed_fields(&[2, 1]).await,
    });
    macro_rules! control {
        ($reference:ident) => {{
            serde_json::json!({
                "set": expr!(|| $reference.resolve().unwrap().set_custom_validity("Choose a value")).into_evaluated_and_js().1.to_source(),
                "clear": expr!(|| $reference.resolve().unwrap().set_custom_validity("")).into_evaluated_and_js().1.to_source(),
                "report": expr!(|| $reference.resolve().unwrap().report_validity()).into_evaluated_and_js().1.to_source(),
                "form": expr!(|| $reference.resolve().unwrap().form_target()).into_evaluated_and_js().1.to_source(),
            })
        }};
    }
    fixture["input"] = control!(input);
    fixture["select"] = control!(select);
    fixture["textarea"] = control!(textarea);
    for (name, alignment) in [
        ("start", ScrollAlignment::Start),
        ("center", ScrollAlignment::Center),
        ("end", ScrollAlignment::End),
        ("nearest", ScrollAlignment::Nearest),
    ] {
        let options = ScrollIntoViewOptions {
            block: alignment,
            inline: alignment,
            behavior: ScrollBehavior::Instant,
        };
        fixture["scroll"][name] = serde_json::json!(
            expr!(|| html.resolve().unwrap().scroll_into_view(options))
                .into_evaluated_and_js()
                .1
                .to_source()
        );
    }
    for (name, behavior) in [
        ("auto", ScrollBehavior::Auto),
        ("smooth", ScrollBehavior::Smooth),
    ] {
        let options = ScrollIntoViewOptions {
            behavior,
            ..Default::default()
        };
        fixture["scroll"][name] = serde_json::json!(
            expr!(|| html.resolve().unwrap().scroll_into_view(options))
                .into_evaluated_and_js()
                .1
                .to_source()
        );
    }
    let mixed = ScrollIntoViewOptions {
        block: ScrollAlignment::End,
        inline: ScrollAlignment::Center,
        behavior: ScrollBehavior::Instant,
    };
    fixture["scroll"]["mixed"] = serde_json::json!(
        expr!(|| html.resolve().unwrap().scroll_into_view(mixed))
            .into_evaluated_and_js()
            .1
            .to_source()
    );
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../browser/tests/browser-actions.json"
    );
    if std::env::var_os("UPDATE_BROWSER_ACTION_FIXTURE").is_some() {
        std::fs::write(path, serde_json::to_string_pretty(&fixture).unwrap() + "\n").unwrap();
    }
    let expected: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        fixture, expected,
        "regenerate with UPDATE_BROWSER_ACTION_FIXTURE=1 cargo test -p topcoat-runtime-macro --test browser_actions"
    );
}

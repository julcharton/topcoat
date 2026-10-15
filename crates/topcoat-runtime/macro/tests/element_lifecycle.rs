use topcoat::{
    Result,
    context::Cx,
    runtime::{
        DialogElement, EffectContext, ElementRef, Event, HtmlElement, Signal, element_lifecycle,
        expr, signal,
    },
    view::{Child, View, ViewExt, attributes, component, view},
};

// This minimal native integration exercises the public lifecycle attachment.
// Application modal policy belongs to UI consumers, not the runtime.
#[component]
async fn native_dialog(
    id: &'static str,
    open: Signal<bool>,
    closes: Signal<usize>,
    close_updates: Signal<bool>,
    focus: &'static str,
    #[default] child: Child<'_>,
) -> Result<impl View> {
    let reference = ElementRef::<DialogElement>::new(id);
    let focus = ElementRef::<HtmlElement>::new(focus);
    let observe = open.clone();
    let closing = open.clone();
    let configure = expr!(|scope: EffectContext| {
        let owned = reference.resolve().unwrap();
        scope.listen(scope.target(), "beforetoggle", |event: Event| {
            if event.new_state.is_some() {
                if event.new_state.unwrap() == "closed" {
                    closing.set(false);
                }
            }
        });
        let _current = scope.clone();
        scope.listen(scope.target(), "toggle", |_event: Event| {
            let actual = raw!("cx.hydrate(${_current}.element.open)", false);
            if observe.get() != actual {
                observe.set(actual);
            }
        });
        || {
            let result = owned.close("");
            if result.is_err() {
                let error = result.unwrap_err();
                if !error.is_disconnected() {
                    Err::<(), _>(error).unwrap();
                }
            }
        }
    });
    let reconcile = expr!(|_scope: EffectContext| {
        let wanted = open.get();
        let actual = raw!("cx.hydrate(${_scope}.element.open)", false);
        if wanted != actual {
            let element = reference.resolve().unwrap();
            if wanted {
                let shown = element.show_modal().unwrap();
                if shown {
                    focus.resolve().unwrap().focus(true).unwrap();
                } else {
                    open.set(false);
                }
            } else {
                element.close("").unwrap();
            }
        }
    });
    let lifecycle = element_lifecycle(configure, reconcile).live_attribute("open");
    let mut attrs = attributes! { (lifecycle) };
    // Keep snapshot attribute order stable; normal spreads use an unordered map.
    let lifecycle = attrs.remove("data-topcoat-element-lifecycle").unwrap();
    Ok(view! {
        <dialog
            id=(id)
            data-topcoat-element-lifecycle=(lifecycle)
            @close=$(|_event: Event| {
                closes.increment();
                if close_updates.get() {
                    open.set(false);
                }
            })
        >
            (child)
        </dialog>
    })
}

#[component]
async fn fixture_page(cx: &Cx, alternate: bool) -> Result<impl View> {
    let first = signal(cx, || false);
    let second = signal(cx, || false);
    let child_open = signal(cx, || false);
    let closes = signal(cx, || 0usize);
    let child_closes = signal(cx, || 0usize);
    let close_updates = signal(cx, || false);
    let open = if alternate {
        second.clone()
    } else {
        first.clone()
    };
    let focus = if alternate {
        "modal-auto"
    } else {
        "modal-target"
    };
    Ok(view! {
        <button id="trigger" @click=$(|_event| open.set(true))>"Open"</button>
        <button id="first" @click=$(|_event| first.toggle())>"First signal"</button>
        <button id="second" @click=$(|_event| second.toggle())>"Second signal"</button>
        <input
            id="close-updates-open"
            type="checkbox"
            @change=$(|event: Event| {
                close_updates.set(event.target.checked);
            })
        >
        <output id="state">$(open.get())</output>
        <output id="first-state">$(first.get())</output>
        <output id="second-state">$(second.get())</output>
        <output id="child-state">$(child_open.get())</output>
        <output id="closes">$(closes.get())</output>
        <output id="child-closes">$(child_closes.get())</output>
        native_dialog(
            id: "modal",
            open: open,
            closes: closes,
            close_updates: close_updates.clone(),
            focus: focus,
            <input id="modal-auto" autofocus="">
            <input id="modal-target">
            <button id="child-trigger" @click=$(|_event| child_open.set(true))>
                "Child"
            </button>
            native_dialog(
                id: "child",
                open: child_open,
                closes: child_closes,
                close_updates: close_updates,
                focus: "child-target",
                <input id="child-auto" autofocus="">
                <input id="child-target">
            )
        )
    })
}

async fn render(alternate: bool) -> String {
    let cx = &Cx::default();
    view! { cx => fixture_page(alternate: alternate) }
        .single()
        .await
        .unwrap()
        .render(cx)
}

#[tokio::test]
async fn browser_fixture_matches_compiled_lifecycle() {
    let fixture = serde_json::json!({
        "initial": render(false).await,
        "alternate": render(true).await,
    });
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../browser/tests/element-lifecycle.json"
    );
    if std::env::var_os("UPDATE_ELEMENT_LIFECYCLE_FIXTURE").is_some() {
        let json = serde_json::to_string_pretty(&fixture)
            .unwrap()
            .replace("\n  ", "\n\t");
        std::fs::write(path, json + "\n").unwrap();
    }
    let expected: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        fixture, expected,
        "regenerate with UPDATE_ELEMENT_LIFECYCLE_FIXTURE=1 cargo test -p topcoat-runtime-macro --test element_lifecycle"
    );
    let html = fixture["initial"].as_str().unwrap();
    assert_eq!(html.matches("data-topcoat-element-lifecycle=").count(), 2);
    assert!(!html.contains(" open="));
    assert!(!html.contains("::topcoat::dep("));
}

#[test]
fn live_attribute_rejects_identity_metadata_and_invalid_names() {
    for name in [
        "id",
        "data-topcoat-effect",
        "OPEN",
        "",
        "has space",
        "x:attr",
    ] {
        assert!(
            std::panic::catch_unwind(|| {
                element_lifecycle(
                    expr!(|_scope: EffectContext| || {}),
                    expr!(|_scope: EffectContext| {}),
                )
                .live_attribute(name)
            })
            .is_err()
        );
    }
}

#[tokio::test]
async fn lifecycle_forwards_through_attribute_spreads() {
    let cx = &Cx::default();
    let lifecycle = element_lifecycle(
        expr!(|_scope: EffectContext| || {}),
        expr!(|_scope: EffectContext| {}),
    );
    let attrs = attributes! { cx => (lifecycle) };
    let html = view! { cx => <section id="forwarded" (attrs)></section> }
        .single()
        .await
        .unwrap()
        .render(cx);
    assert_eq!(html.matches("data-topcoat-element-lifecycle=").count(), 1);
    assert!(html.contains("id=\"forwarded\""));
}

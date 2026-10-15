//! Compiled reset ownership fixtures with independent application controllers.

use topcoat::{
    Result,
    context::Cx,
    router::page,
    runtime::{EffectContext, Event, Signal, effect, expr, shard, signal},
    view::{View, attributes, view},
};

use crate::{calendar_showcase::date, components::date_picker::date_picker};

#[page("/calendar-reset-tests")]
async fn fixtures(cx: &Cx) -> Result<impl View> {
    let first = signal(cx, || "2024-03-15".to_owned());
    let second = signal(cx, || "2024-03-15".to_owned());
    let switched = signal(cx, || false);
    let shown = signal(cx, || true);
    let armed = signal(cx, || false);
    let runs = signal(cx, || 0u64);
    let reset = effect(expr!(|_scope: EffectContext| {
        let _requested = armed.get();
        runs.increment();
        // A later accidental subscription must be observable without a reset loop.
        armed.set(false);
        raw!("${_requested}.dehydrate() && ${_scope}.element.closest('form').reset()");
    }));
    Ok(view! {
        <!DOCTYPE html>
        <html>
            <head>
                <title>"Calendar reset ownership"</title>
                topcoat::runtime::script()
                <link rel="stylesheet" href=(topcoat::tailwind::stylesheet!())>
            </head>
            <body>
                <form id="ordering-form">
                    <div (reset)></div>
                    owner(
                        first: first.clone(),
                        second: second.clone(),
                        switched: switched.clone(),
                        shown: shown.clone()
                    )
                    <button
                        type="button"
                        id="effect-reset"
                        @click=$(|_e: Event| armed.set(true))
                    >
                        "Reset from an effect"
                    </button>
                    <button
                        type="button"
                        id="switch-controller"
                        @click=$(|_e: Event| switched.toggle())
                    >
                        "Switch controller"
                    </button>
                    <button
                        type="button"
                        id="remove-owner"
                        @click=$(|_e: Event| shown.toggle())
                    >
                        "Toggle owner"
                    </button>
                    <button
                        type="button"
                        id="same-first"
                        @click=$(|_e: Event| first.set(first.get()))
                    >
                        "Write first value"
                    </button>
                    <button
                        type="button"
                        id="change-first"
                        @click=$(|_e: Event| first.set("2024-04-20".to_owned()))
                    >
                        "Change first value"
                    </button>
                    <button type="reset" id="native-reset">"Reset"</button>
                    <span id="first-value">$(first.get())</span>
                    <span id="second-value">$(second.get())</span>
                    <span id="effect-runs">$(runs.get())</span>
                </form>
            </body>
        </html>
    })
}

#[shard]
async fn owner(
    first: Signal<String>,
    second: Signal<String>,
    switched: Signal<bool>,
    shown: Signal<bool>,
) -> Result<impl View> {
    let second_owner = switched.get();
    let value = if second_owner { second } else { first };
    Ok(view! {
        <div
            id="reset-owner"
            data-controller=(if second_owner { "second" } else { "first" })
        >
            if shown.get() {
                date_picker(
                    value: value,
                    today: date("2024-01-31"),
                    default_value: Some(date("2024-01-31")),
                    name: "ordered",
                    label: "Ordered date",
                    attrs: attributes! { id="ordering-picker" }
                )
            }
        </div>
    })
}
